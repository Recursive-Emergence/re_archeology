from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
import json
import os
import glob
from pathlib import Path
from backend.utils import gcs_utils
from backend.utils.config import settings
import logging
import asyncio
import uuid  # Added missing import
from backend.api.routers.task_lidar_scan import LidarScanTaskManager
import threading

router = APIRouter()

# GCS bucket and prefix for tasks data
GCS_BUCKET_NAME = os.getenv('GCS_TASKS_BUCKET', 're_archaeology')
GCS_TASKS_PREFIX = 'tasks/'

def load_all_tasks_from_gcs(status_filter: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Load all tasks from GCS. Optionally filter by status.
    Args:
        status_filter: If provided, only return tasks with this status.
    Returns:
        List of task dicts.
    """
    task_dict = {}
    try:
        client = gcs_utils.get_gcs_client()
        bucket = gcs_utils.get_gcs_bucket(GCS_BUCKET_NAME, client)
        blobs = gcs_utils.list_blobs(bucket, prefix=GCS_TASKS_PREFIX)
        for blob in blobs:
            rel_path = blob.name[len(GCS_TASKS_PREFIX):]
            # Skip archived tasks and any subfolders
            if blob.name.startswith(f'{GCS_TASKS_PREFIX}archive/'):
                continue
            if not (blob.name.endswith('.json') and '/' not in rel_path):
                continue
            data_bytes = gcs_utils.safe_download_blob(bucket, blob.name, logger=logging.getLogger("backend.api.routers.tasks"))
            if not data_bytes:
                continue
            task_data = json.loads(data_bytes.decode('utf-8'))
            task_id = task_data['id']
            if status_filter and task_data.get('status') != status_filter:
                continue
            if task_id not in task_dict or task_data['updated_at'] > task_dict[task_id]['updated_at']:
                task_data["decay_value"] = calculate_task_decay(task_data)
                if isinstance(task_data.get("progress"), (int, float)):
                    progress_val = task_data["progress"]
                    task_data["progress"] = {
                        "scan": progress_val,
                        "detection": progress_val if task_data["status"] == "completed" else 0,
                        "overall": progress_val
                    }
                if "profiles" not in task_data:
                    task_data["profiles"] = ["default_windmill"]
                # Ensure all values are JSON-serializable (convert numpy types)
                def to_serializable(val):
                    import numpy as np
                    if isinstance(val, (np.generic,)):
                        return val.item()
                    if isinstance(val, dict):
                        return {k: to_serializable(v) for k, v in val.items()}
                    if isinstance(val, list):
                        return [to_serializable(v) for v in val]
                    return val
                task_data = to_serializable(task_data)
                # Remove session logic
                task_dict[task_id] = task_data
    except Exception as e:
        print(f"[ERROR] Error accessing tasks in GCS: {e}")
        import traceback
        traceback.print_exc()
    return list(task_dict.values())

def load_existing_tasks() -> List[Dict[str, Any]]:
    """Legacy alias for API: load all tasks from GCS (no status filter)."""
    return load_all_tasks_from_gcs()

def load_running_tasks_from_gcs() -> List[Dict[str, Any]]:
    """Helper for startup: load only running tasks from GCS."""
    return load_all_tasks_from_gcs(status_filter="running")

def calculate_task_decay(task: Dict[str, Any]) -> float:
    """Calculate decay value based on findings quality and time"""
    try:
        # Parse created_at timestamp
        created_at = datetime.fromisoformat(task["created_at"].replace('Z', '+00:00'))
        
        # Base decay from time
        days_elapsed = (datetime.now(timezone.utc) - created_at).days
        time_decay = 0.9 ** (days_elapsed / 7)  # 7-day half-life
        
        # Quality multiplier based on findings
        findings = task.get("findings", [])
        if not findings:
            quality_multiplier = 0.1  # Low value for tasks with no findings
        else:
            # If findings have scores, use them; otherwise use a default based on count
            if all("score" in f for f in findings):
                avg_score = sum(f["score"] for f in findings) / len(findings)
                quality_multiplier = min(1.0, avg_score / 0.8)
            else:
                # Use findings count as a proxy for quality
                quality_multiplier = min(1.0, len(findings) / 5.0)
        
        return time_decay * quality_multiplier
        
    except Exception:
        return 0.5  # Default decay value if calculation fails


@router.get("/tasks", response_model=List[Dict[str, Any]])
async def get_tasks(
    status: Optional[str] = None,
    min_decay: Optional[float] = 0.1
) -> List[Dict[str, Any]]:
    """
    Get all tasks with optional filtering by status and minimum decay value.
    Only returns tasks with decay_value >= min_decay for frontend display.
    """
    try:
        # Load existing tasks from files
        all_tasks = load_existing_tasks()
        
        # Filter tasks by decay value (backend filtering)
        filtered_tasks = [task for task in all_tasks if task["decay_value"] >= min_decay]
        
        # Filter by status if provided
        if status:
            filtered_tasks = [task for task in filtered_tasks if task["status"] == status]
        
        return filtered_tasks
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving tasks: {str(e)}")


@router.get("/tasks/{task_id}", response_model=Dict[str, Any])
async def get_task(task_id: str) -> Dict[str, Any]:
    """Get a specific task by ID"""
    try:
        all_tasks = load_existing_tasks()
        task = next((task for task in all_tasks if task["id"] == task_id), None)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        return task
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving task: {str(e)}")


@router.post("/tasks/{task_id}/navigate")
async def navigate_to_task(task_id: str) -> Dict[str, Any]:
    """
    Get navigation data for a specific task.
    Returns coordinates, bounds, and optimal zoom level.
    """
    try:
        all_tasks = load_existing_tasks()
        task = next((task for task in all_tasks if task["id"] == task_id), None)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        # Calculate optimal zoom based on range size
        max_dimension = max(task["range"]["width_km"], task["range"]["height_km"])
        if max_dimension <= 5:
            optimal_zoom = 14  # City level
        elif max_dimension <= 15:
            optimal_zoom = 12  # District level
        elif max_dimension <= 50:
            optimal_zoom = 10  # Regional level
        else:
            optimal_zoom = 8   # Country level
        
        return {
            "task_id": task_id,
            "center_coordinates": task["start_coordinates"],
            "bounds": {
                "southwest": [
                    task["start_coordinates"][0] - (task["range"]["height_km"] / 111),  # Rough km to degree conversion
                    task["start_coordinates"][1] - (task["range"]["width_km"] / (111 * 0.7))  # Adjusted for latitude
                ],
                "northeast": [
                    task["start_coordinates"][0] + (task["range"]["height_km"] / 111),
                    task["start_coordinates"][1] + (task["range"]["width_km"] / (111 * 0.7))
                ]
            },
            "optimal_zoom": optimal_zoom,
            "range": task["range"],
            "status": task["status"]
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating navigation data: {str(e)}")

async def start_task_scanning_session(task_data: Dict[str, Any]):
    """
    Start the scanning session for a task using the new Lidar scan logic from demo_ws_tiles.py.
    """
    from lidar_factory.factory import LidarMapFactory
    import numpy as np
    task = Task(task_data)
    try:
        task.logger.info(f"[SCAN] Starting Lidar scan for task {task.id}")
        task.update_status('running', '')
        task.set_progress(0)
        # Extract scan parameters
        start_lat, start_lon = task.data["start_coordinates"]
        width_km = task.data["range"]["width_km"]
        height_km = task.data["range"]["height_km"]
        grid_x = max(1, round(width_km / 5))
        grid_y = max(1, round(height_km / 5))
        lats = np.linspace(start_lat, start_lat + height_km / 111, grid_y)
        lons = np.linspace(start_lon, start_lon + width_km / (111 * 0.7), grid_x)
        factory = LidarMapFactory()
        total_tiles = grid_x * grid_y
        completed_tiles = 0
        findings = []
        for row in range(grid_y):
            for col in range(grid_x):
                lat = lats[row]
                lon = lons[col]
                patch = factory.get_patch(lat, lon, size_m=40, preferred_resolution_m=5, preferred_data_type="DSM")
                elev = float(np.nanmean(patch.data)) if patch and patch.data is not None else None
                if elev is not None and elev > 0:
                    findings.append({
                        'id': str(uuid.uuid4()),
                        'score': round(float(elev) / 100, 2),
                        'lat': lat,
                        'lon': lon,
                        'timestamp': datetime.now(timezone.utc).isoformat()
                    })
                completed_tiles += 1
                progress = int(100 * completed_tiles / total_tiles)
                task.set_progress(progress)
        task.data['findings'] = findings
        task.complete()
        task.logger.info(f"[SCAN] Lidar scan completed for task {task.id} with {len(findings)} findings.")
    except Exception as e:
        task.logger.error(f"[SCAN] Error in Lidar scan for task {task.id}: {e}")
        task.update_status('error', str(e))

def save_task_data(task_data: Dict[str, Any]) -> bool:
    """Save task data to GCS as JSON (update or create new)."""
    try:
        task_id = task_data['id']
        client = gcs_utils.get_gcs_client()
        bucket = gcs_utils.get_gcs_bucket(GCS_BUCKET_NAME, client)
        blob_name = f"{GCS_TASKS_PREFIX}{task_id}.json"
        # Update the updated_at timestamp
        task_data['updated_at'] = datetime.now(timezone.utc).isoformat()
        bucket.blob(blob_name).upload_from_string(json.dumps(task_data, indent=2), content_type='application/json')
        logging.getLogger(__name__).info(f"✅ Updated task in GCS: {blob_name}")
        return True
    except Exception as e:
        logging.getLogger(__name__).error(f"Error saving task data to GCS: {e}")
        return False

class Task:
    def __init__(self, data: Optional[Dict[str, Any]] = None, **kwargs):
        self.logger = logging.getLogger(__name__)
        if data:
            self.data = data
        else:
            self.data = kwargs
        # Ensure required fields
        self.data.setdefault('id', self.data.get('id') or str(uuid.uuid4()))
        self.data.setdefault('status', 'pending')
        self.data.setdefault('progress', 0)
        self.data.setdefault('findings', [])
        self.data.setdefault('error_message', '')
        self.data.setdefault('created_at', datetime.now(timezone.utc).isoformat())
        self.data.setdefault('updated_at', datetime.now(timezone.utc).isoformat())
        self.data.setdefault('profiles', ['default_windmill'])
        # Remove session manager and session fields

    @property
    def id(self):
        return self.data.get('id')

    @property
    def status(self):
        return self.data.get('status')

    @property
    def progress(self):
        return self.data.get('progress')

    @property
    def findings(self):
        return self.data.get('findings', [])

    def save(self):
        self.data['updated_at'] = datetime.now(timezone.utc).isoformat()
        save_task_data(self.data)

    def update_status(self, status: str, error_message: str = ""):
        self.data['status'] = status
        self.data['error_message'] = error_message
        self.save()

    def add_finding(self, finding: Dict[str, Any]):
        if 'findings' not in self.data or not isinstance(self.data['findings'], list):
            self.data['findings'] = []
        self.data['findings'].append(finding)
        self.save()

    def set_progress(self, progress: int):
        self.data['progress'] = progress
        self.save()

    def complete(self):
        self.data['status'] = 'completed'
        self.data['completed_at'] = datetime.now(timezone.utc).isoformat()
        self.save()

    def to_dict(self):
        return self.data

    @classmethod
    def load(cls, task_id: str):
        all_tasks = load_existing_tasks()
        logger = logging.getLogger(__name__)
        norm_task_id = str(task_id).strip().lower()
        logger.info(f"[Task.load] Looking for task_id: {norm_task_id}")
        found_ids = [str(t['id']).strip().lower() for t in all_tasks]
        logger.info(f"[Task.load] All available task IDs: {found_ids}")
        for t in all_tasks:
            if str(t['id']).strip().lower() == norm_task_id:
                logger.info(f"[Task.load] Found task with id: {t['id']}")
                return cls(t)
        # Fuzzy match: suggest close matches if any
        from difflib import get_close_matches
        close = get_close_matches(norm_task_id, found_ids, n=1, cutoff=0.8)
        if close:
            logger.warning(f"[Task.load] Task id {task_id} not found, but close match: {close[0]}")
        else:
            logger.warning(f"[Task.load] Task id {task_id} not found in available tasks.")
        return None

    @classmethod
    def all(cls, status_filter: Optional[str] = None):
        return [cls(t) for t in load_all_tasks_from_gcs(status_filter)]

    @classmethod
    def running(cls):
        return cls.all(status_filter='running')

class TaskManager:
    """
    System-wide manager for all tasks. Provides a clean interface for task lifecycle and status management.
    Use this as the main entry point for Bella or other system components.

    Command Interface for LLM/Bella (Unified):
    -----------------------------------------
    Use the `execute_command(command: dict, user_id: Optional[str])` method to perform all task actions.
    The command must be a JSON/dict with at least an 'action' field. Supported actions and required fields:

    Unified actions:
    - start:   {"action": "start", "coordinates": [lat, lon], "range_km": {"width": 5, "height": 5}, "profiles": ["default_windmill"], "user_id": "..."}
    - restart: {"action": "restart", "task_id": "..."}
    - resume:  {"action": "resume", "task_id": "..."}
      (All three will start or resume the lidar scan session from the last cached point, set status to 'running', and update progress.)

    - pause:   {"action": "pause", "task_id": "..."}
    - stop:    {"action": "stop", "task_id": "..."}
    - abort:   {"action": "abort", "task_id": "..."}
      (All three will stop the lidar scan session and set status to 'paused'.)

    - delete:  {"action": "delete", "task_id": "..."}
      (Archives and deletes the specified task. Admin privileges required.)

    - status:  {"action": "status", "task_id": "..."}
    - list:    {"action": "list"}

    The return value is always a dict with at least:
      - success: bool
      - message: str
      - task_id: str (if relevant)
      - data: dict (task data, if relevant)

    To add new actions or richer messages, extend the execute_command method and update this docstring.
    """
    def __init__(self):
        self.logger = logging.getLogger(__name__)

    def new_task(self, start_coordinates, range_km, profiles, user_id, type_="scan") -> Task:
        width_km = range_km.get('width', range_km.get('width_km', 5))
        height_km = range_km.get('height', range_km.get('height_km', 5))
        task = Task(
            type=type_,
            status="running",
            start_coordinates=start_coordinates,
            range={"width_km": width_km, "height_km": height_km},
            user_id=user_id,
            profiles=profiles
        )
        task.save()
        self.logger.info(f"[TaskManager] Created new task {task.id} for user {user_id}")
        return task

    def get_task(self, task_id: str) -> Optional[Task]:
        return Task.load(task_id)

    def list_tasks(self, status_filter: Optional[str] = None) -> list:
        return Task.all(status_filter)

    def update_task_status(self, task_id: str, new_status: str, error_message: str = "") -> bool:
        task = self.get_task(task_id)
        if not task:
            return False
        task.update_status(new_status, error_message)
        return True

    def set_task_progress(self, task_id: str, progress: int) -> bool:
        task = self.get_task(task_id)
        if not task:
            return False
        task.set_progress(progress)
        return True

    def add_task_finding(self, task_id: str, finding: dict) -> bool:
        task = self.get_task(task_id)
        if not task:
            return False
        task.add_finding(finding)
        return True

    def complete_task(self, task_id: str) -> bool:
        task = self.get_task(task_id)
        if not task:
            return False
        task.complete()
        return True

    def delete_task(self, task_id: str, is_admin: bool = False, user_id: Optional[str] = None) -> bool:
        from backend.api.routers.auth_utils import is_admin_user
        # Determine admin status from user_id/email if user_id is provided
        admin_status = is_admin
        if user_id is not None:
            admin_status = is_admin_user(user_id)
        if not admin_status:
            self.logger.warning(f"[TaskManager] Non-admin attempted to delete task {task_id}")
            return False
        # Stop any running lidar scan for this task
        try:
            lidar_scan_task_manager.stop_scan(task_id)
        except Exception as e:
            self.logger.warning(f"[TaskManager] Exception while stopping lidar scan for deleted task {task_id}: {e}")
        # Move the task JSON to archive folder in GCS
        try:
            client = gcs_utils.get_gcs_client()
            bucket = gcs_utils.get_gcs_bucket(GCS_BUCKET_NAME, client)
            src_blob_name = f"{GCS_TASKS_PREFIX}{task_id}.json"
            dst_blob_name = f"{GCS_TASKS_PREFIX}archive/{task_id}.json"
            self.logger.info(f"[TaskManager] Attempting to delete/archive task. src_blob_name={src_blob_name}, dst_blob_name={dst_blob_name}")
            # List all blobs under tasks/ for debug
            all_blobs = list(bucket.list_blobs(prefix=GCS_TASKS_PREFIX))
            all_blob_names = [b.name for b in all_blobs]
            self.logger.info(f"[TaskManager] All blobs under {GCS_TASKS_PREFIX}: {all_blob_names}")
            # Use get_blob instead of exists for reliability
            src_blob = bucket.get_blob(src_blob_name)
            self.logger.info(f"[TaskManager] get_blob result for {src_blob_name}: {src_blob}")
            if not src_blob:
                self.logger.warning(f"[TaskManager] Task {task_id} not found for deletion. src_blob_name={src_blob_name}")
                return False
            bucket.copy_blob(src_blob, bucket, dst_blob_name)
            bucket.delete_blob(src_blob_name)
            self.logger.info(f"[TaskManager] Task {task_id} archived to {dst_blob_name}")
            return True
        except Exception as e:
            self.logger.error(f"[TaskManager] Error archiving task {task_id}: {e}")
            return False

    def execute_command(self, command: dict, user_id: Optional[str] = None, is_admin: bool = False) -> dict:
        """
        Execute a task command from a JSON/dict snippet (as from LLM/Bella).
        Returns a dict: {success, message, data, ...}
        """
        from backend.api.routers.auth_utils import is_admin_user
        import contextvars
        # Try to get user info from FastAPI global request state if not provided
        if not user_id:
            try:
                # Try to get user from thread-local storage (FastAPI request.state)
                request = getattr(threading.current_thread(), 'request', None)
                if request and hasattr(request, 'state') and hasattr(request.state, 'user'):
                    user = getattr(request.state, 'user', None)
                    if user and isinstance(user, dict):
                        user_id = user.get('email')
            except Exception:
                user_id = None
        # Fallback: try to get user from environment variable (for testing)
        if not user_id:
            user_id = os.environ.get('RE_ARCHAEOLOGY_SYSTEM_USER_EMAIL')
        try:
            action = command.get("action")
            task_id = command.get("task_id")
            profiles = command.get("profiles", ["default_windmill"])
            coordinates = command.get("coordinates")
            range_km = command.get("range_km")
            user = user_id  # Always use backend-authenticated email for admin checks
            # Determine admin status from user_id/email
            admin_status = is_admin_user(user)
            # Only allow admin for start/stop/delete/restart/resume/pause/abort
            if action in ("start", "restart", "resume", "pause", "stop", "abort", "delete") and not admin_status:
                return {"success": False, "message": f"Admin privileges required for action '{action}'."}
            if not action:
                return {"success": False, "message": "No action specified in command."}
            # Unified start/restart/resume
            if action in ("start", "restart", "resume"):
                if action == "start":
                    if not coordinates or not range_km or not user:
                        return {"success": False, "message": "Missing coordinates, range_km, or user_id for start."}
                    task = self.new_task(coordinates, range_km, profiles, user)
                else:
                    if not task_id:
                        return {"success": False, "message": f"Task ID required for action '{action}'."}
                    # Validate task_id strictly
                    task = self.get_task(task_id)
                    if not task:
                        return {"success": False, "message": f"Task {task_id} not found"}
                    task.update_status("running")
                asyncio.create_task(lidar_scan_task_manager.start_scan(task.id if action != "start" else task.id))
                return {"success": True, "message": f"Task {task.id} started/resumed and lidar scan session initiated.", "task_id": task.id, "data": task.to_dict()}
            elif action == "delete":
                if not task_id:
                    return {"success": False, "message": "Task ID required for delete."}
                deleted = self.delete_task(task_id, user_id=user)
                if deleted:
                    return {"success": True, "message": f"Task {task_id} archived and deleted."}
                else:
                    return {"success": False, "message": f"Failed to delete/archive task {task_id}."}
            elif action in ("pause", "stop", "abort"):
                if not task_id:
                    return {"success": False, "message": f"Task ID required for action '{action}'."}
                self.logger.info(f"[TaskManager] {action} requested for task_id: {task_id}")
                # Validate task_id strictly
                task = self.get_task(task_id)
                if not task:
                    self.logger.warning(f"[TaskManager] {action} failed: Task {task_id} not found.")
                    return {"success": False, "message": f"Task {task_id} not found."}
                # --- Patch: Wait for lidar scan to stop before updating status ---
                scan_stopped = threading.Event()
                def on_scan_stopped(_):
                    scan_stopped.set()
                lidar_scan_task_manager.stop_scan(task_id, on_stopped_callback=on_scan_stopped)
                scan_stopped.wait(timeout=10)  # Wait up to 10s for scan to stop
                task.update_status("paused")
                return {"success": True, "message": f"Task {task_id} paused/stopped and lidar scan session stopped.", "task_id": task_id}
            elif action == "status":
                if not task_id:
                    return {"success": False, "message": f"Task ID required for action 'status'."}
                task = self.get_task(task_id)
                if not task:
                    return {"success": False, "message": f"Task {task_id} not found."}
                return {"success": True, "message": f"Task {task_id} status fetched.", "task_id": task_id, "data": task.to_dict()}
            elif action == "list":
                tasks = self.list_tasks()
                return {"success": True, "message": f"Listed {len(tasks)} tasks.", "data": [t.to_dict() for t in tasks]}
            else:
                return {"success": False, "message": f"Unknown action: {action}"}
        except Exception as e:
            self.logger.error(f"[TaskManager] Exception in execute_command: {e}")
            return {"success": False, "message": f"Error executing command: {e}"}

# Singleton instance for system-wide task management
system_task_manager = TaskManager()
lidar_scan_task_manager = LidarScanTaskManager(parent_task_manager=system_task_manager)

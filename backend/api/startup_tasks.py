"""
Startup tasks module for restarting running archaeological tasks.
Handles resuming LiDAR scanning and detection for tasks that were interrupted.
"""

import json
import logging
import asyncio
import numpy as np
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone
import os

from .routers.discovery_sessions import active_sessions
from .routers.messenger_websocket import frontend_backend_messenger
from .routers.discovery_lidar import run_lidar_scan_async
from .routers.discovery_utils import get_available_structure_types
from backend.utils import gcs_utils
from backend.api.routers.tasks import load_running_tasks_from_gcs

logger = logging.getLogger(__name__)

# GCS bucket and prefix for tasks data
GCS_BUCKET_NAME = os.getenv('GCS_TASKS_BUCKET', 're_archaeology')
GCS_TASKS_PREFIX = 'tasks/'

def get_app_root():
    """Get the application root directory"""
    import os
    return "/app" if os.path.exists("/app") else os.getcwd()

async def check_and_restart_running_tasks():
    """
    Check for tasks with 'running' status and restart their LiDAR scanning and detection.
    This function is called during backend startup.
    """
    logger.info("🔍 Checking for running tasks to restart...")
    
    try:
        running_tasks = await load_running_tasks()
        
        if not running_tasks:
            logger.info("✅ No running tasks found")
            return
        
        logger.info(f"🔄 Found {len(running_tasks)} running tasks to restart")
        
        for task in running_tasks:
            try:
                await restart_task_session(task)
                logger.info(f"✅ Restarted task {task['id']}")
            except Exception as e:
                logger.error(f"❌ Failed to restart task {task['id']}: {e}")
                
        logger.info("🚀 Running tasks restart process completed")
        
    except Exception as e:
        logger.error(f"❌ Error in startup task check: {e}")

async def load_running_tasks() -> List[Dict[str, Any]]:
    """Load all tasks with 'running' status from GCS task JSONs (centralized logic)."""
    return load_running_tasks_from_gcs()

async def restart_task_session(task: Dict[str, Any]):
    """
    Restart a LiDAR scanning and detection session for a running task.
    
    Args:
        task: Task data dictionary containing coordinates, range, and session info
    """
    try:
        import uuid
        
        # Remove any old sessions for this task from active_sessions
        old_sessions = [sid for sid, s in active_sessions.items() if s.get("task_id") == task["id"]]
        for sid in old_sessions:
            del active_sessions[sid]
            logger.info(f"Removed old session {sid} for task {task['id']} before restart.")
        
        # Extract task parameters
        task_id = task["id"]
        # Always generate a NEW session ID for restarts to avoid conflicts
        session_id = str(uuid.uuid4())  
        start_coords = task["start_coordinates"]  # [lat, lon]
        range_info = task["range"]  # {"width_km": x, "height_km": y}
        
        logger.info(f"🔄 Restarting task {task_id} with NEW session {session_id}")
        
        # Calculate scan parameters - preserve rectangular dimensions
        center_lat = float(start_coords[0])
        center_lon = float(start_coords[1])
        
        # Use rectangular dimensions from the task
        width_km = range_info["width_km"]
        height_km = range_info["height_km"]
        
        # Get app root and available structure types
        app_root = get_app_root()
        available_types, default_type = get_available_structure_types(app_root, logger)
        
        # Create scan configuration with rectangular dimensions
        config = {
            "center_lat": center_lat,
            "center_lon": center_lon,
            "width_km": width_km,
            "height_km": height_km,
            "data_type": "DSM",
            "streaming_mode": True,
            "enable_detection": True,  # Enable detection for restarted tasks
            "structure_type": default_type,
            "prefer_high_resolution": min(width_km, height_km) <= 1.0,  # Use high res for small areas
            "task_id": task_id,  # Add task_id for tracking
            "resumed": True  # Mark as resumed task
        }
        
        # Set preferred resolution based on minimum dimension
        min_dimension_km = min(width_km, height_km)
        if min_dimension_km <= 1.0:
            preferred_resolution = 0.5
        elif min_dimension_km <= 5.0:
            preferred_resolution = 1.0
        else:
            preferred_resolution = 2.0
            
        # Create session info
        tile_size_m = 40
        area_width_m = width_km * 1000
        area_height_m = height_km * 1000
        tiles_x = max(1, int(np.ceil(area_width_m / tile_size_m)))
        tiles_y = max(1, int(np.ceil(area_height_m / tile_size_m)))
        total_tiles = tiles_x * tiles_y
        
        session_info = {
            "session_id": session_id,
            "type": "lidar_scan",
            "status": "started",  # Use 'started' for consistency with scan endpoint
            "config": config,
            "preferred_resolution": preferred_resolution,
            "enable_detection": True,
            "structure_type": default_type,
            "start_time": datetime.now(timezone.utc).isoformat(),
            "total_tiles": total_tiles,
            "processed_tiles": 0,
            "streaming_mode": True,
            "tile_size_m": tile_size_m,
            "is_paused": False,
            "tile_queue": [],
            "current_tile_index": 0,
            "task_id": task_id  # Critical: link the session to the task
        }
        # Add session to active sessions
        active_sessions[session_id] = session_info
        
        # Update task data with new session ID
        await update_task_session_id(task_id, session_id)
        
        # Send notification about task restart
        await frontend_backend_messenger.send_message({
            "type": "session_start",
            "session_id": session_id,
            "task_id": task_id,
            "message": f"Restarted scanning task {task_id} with detection enabled",
            "config": {
                "center_lat": center_lat,
                "center_lon": center_lon,
                "width_km": width_km,
                "height_km": height_km,
                "total_tiles": total_tiles
            },
            "restart": True,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
        # Start the scanning process in background
        asyncio.create_task(run_lidar_scan_async(session_id, session_info))
        
        logger.info(f"✅ Restarted task {task_id} with session {session_id}")
        logger.info(f"   📍 Center: {center_lat:.4f}, {center_lon:.4f}")
        logger.info(f"   � Area: {width_km}×{height_km} km")
        logger.info(f"   🎯 Total tiles: {total_tiles}")
        
    except Exception as e:
        logger.error(f"❌ Failed to restart task {task['id']}: {e}")
        raise

async def update_task_session_id(task_id: str, new_session_id: str):
    """
    Update the session_id for a task in its JSON file in GCS.
    
    Args:
        task_id: Task ID to update
        new_session_id: New session ID to assign
    """
    try:
        from backend.utils import gcs_utils
        import os
        GCS_BUCKET_NAME = os.getenv('GCS_TASKS_BUCKET', 're_archaeology')
        GCS_TASKS_PREFIX = 'tasks/'
        client = gcs_utils.get_gcs_client()
        bucket = gcs_utils.get_gcs_bucket(GCS_BUCKET_NAME, client)
        blob_name = f"{GCS_TASKS_PREFIX}{task_id}.json"
        blob = bucket.blob(blob_name)
        if not blob.exists():
            logger.error(f"Task file not found for task {task_id} in GCS")
            return
        data_bytes = blob.download_as_bytes()
        task_data = json.loads(data_bytes.decode('utf-8'))
        task_data["session_id"] = new_session_id
        task_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        task_data["sessions"] = {"scan": new_session_id}
        blob.upload_from_string(json.dumps(task_data, indent=2), content_type='application/json')
        logger.info(f"✅ Updated task {task_id} with new session ID: {new_session_id}")
    except Exception as e:
        logger.error(f"❌ Failed to update session ID for task {task_id}: {e}")

async def update_task_progress(task_id: str, progress: Optional[float] = None, findings: Optional[List[Dict]] = None, tile_data: Optional[Dict] = None):
    """
    Update progress for a running task and save to JSON file in GCS.
    
    Args:
        task_id: Task ID to update
        progress: New progress value (0-100) or None to keep current progress
        findings: Optional list of new findings to add (must be a list of dictionaries)
        tile_data: Optional tile data to add to bitmap cache
    """
    try:
        from backend.utils import gcs_utils
        import os
        GCS_BUCKET_NAME = os.getenv('GCS_TASKS_BUCKET', 're_archaeology')
        GCS_TASKS_PREFIX = 'tasks/'
        client = gcs_utils.get_gcs_client()
        bucket = gcs_utils.get_gcs_bucket(GCS_BUCKET_NAME, client)
        blob_name = f"{GCS_TASKS_PREFIX}{task_id}.json"
        blob = bucket.blob(blob_name)
        if not blob.exists():
            logger.error(f"Task file not found for task {task_id} in GCS")
            return
        data_bytes = blob.download_as_bytes()
        task_data = json.loads(data_bytes.decode('utf-8'))
        if progress is not None:
            task_data["progress"] = progress
            task_data["updated_at"] = datetime.now(timezone.utc).isoformat()
            if progress >= 100.0:
                task_data["status"] = "completed"
                task_data["completed_at"] = datetime.now(timezone.utc).isoformat()
        if findings:
            if not isinstance(findings, list):
                logger.warning(f"Expected findings to be a list, got {type(findings)}. Converting to list.")
                findings = [findings] if findings is not None else []
            if "findings" not in task_data:
                task_data["findings"] = []
            task_data["findings"].extend(findings)
            task_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        blob.upload_from_string(json.dumps(task_data, indent=2), content_type='application/json')
        if progress is not None:
            if progress >= 100.0:
                logger.info(f"✅ Task {task_id} completed (100%)")
            elif progress >= 1.0 and progress % 1.0 == 0:
                logger.info(f"📊 Task {task_id} progress: {int(progress)}%")
            elif progress == 0:
                logger.info(f"🚀 Task {task_id} started")
        if findings and isinstance(findings, list):
            logger.info(f"🎯 Added {len(findings)} findings to task {task_id}")
        elif findings:
            logger.info(f"🎯 Added 1 finding to task {task_id}")
    except Exception as e:
        logger.error(f"❌ Failed to update task {task_id}: {e}")

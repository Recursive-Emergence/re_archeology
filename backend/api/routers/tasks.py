from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
import json
import os
import glob
from pathlib import Path
from backend.utils import gcs_utils
from backend.utils.config import settings

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
            if not (blob.name.endswith('.json') and '/' not in rel_path):
                continue
            try:
                data_bytes = blob.download_as_bytes()
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
                    if "sessions" not in task_data:
                        task_data["sessions"] = {
                            "scan": task_data.get("session_id", f"scan_{task_data['id'][:8]}"),
                            "detection": f"detection_{task_data['id'][:8]}"
                        }
                    task_dict[task_id] = task_data
            except Exception as e:
                print(f"Error loading task blob {blob.name}: {e}")
                continue
    except Exception as e:
        print(f"Error accessing tasks in GCS: {e}")
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

"""
Startup tasks module for restarting running archaeological tasks.
Handles resuming LiDAR scanning and detection for tasks that were interrupted.
"""

import json
import logging
import asyncio
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone
import glob

from .routers.discovery_sessions import active_sessions
from .routers.discovery_connections import discovery_manager
from .routers.discovery_lidar import run_lidar_scan_async
from .routers.discovery_utils import get_available_structure_types

logger = logging.getLogger(__name__)

# Path to existing tasks data
TASKS_DATA_PATH = Path(__file__).parent.parent.parent / "data" / "tasks"

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
    """Load all tasks with 'running' status from JSON files"""
    running_tasks = []
    
    try:
        # Find all JSON files in tasks directory
        task_files = glob.glob(str(TASKS_DATA_PATH / "*.json"))
        
        for task_file in task_files:
            try:
                with open(task_file, 'r') as f:
                    task_data = json.load(f)
                    
                # Check if task is running and has progress > 0
                if (task_data.get("status") == "running" and 
                    isinstance(task_data.get("progress"), (int, float)) and 
                    task_data.get("progress") > 0):
                    running_tasks.append(task_data)
                    
            except Exception as e:
                logger.error(f"Error loading task file {task_file}: {e}")
                continue
                
    except Exception as e:
        logger.error(f"Error accessing tasks directory: {e}")
    
    return running_tasks

async def restart_task_session(task: Dict[str, Any]):
    """
    Restart a LiDAR scanning and detection session for a running task.
    
    Args:
        task: Task data dictionary containing coordinates, range, and session info
    """
    try:
        # Extract task parameters
        task_id = task["id"]
        session_id = task.get("session_id", task_id)  # Use existing session_id or task_id
        start_coords = task["start_coordinates"]  # [lat, lon]
        range_info = task["range"]  # {"width_km": x, "height_km": y}
        
        # Calculate scan parameters
        center_lat = float(start_coords[0])
        center_lon = float(start_coords[1])
        
        # Use the larger dimension for radius (converting rectangular range to circular)
        radius_km = max(range_info["width_km"], range_info["height_km"]) / 2
        
        # Get app root and available structure types
        app_root = get_app_root()
        available_types, default_type = get_available_structure_types(app_root, logger)
        
        # Create scan configuration
        config = {
            "center_lat": center_lat,
            "center_lon": center_lon,
            "radius_km": radius_km,
            "data_type": "DSM",
            "streaming_mode": True,
            "enable_detection": True,  # Enable detection for restarted tasks
            "structure_type": default_type,
            "prefer_high_resolution": radius_km <= 1.0,  # Use high res for small areas
            "task_id": task_id,  # Add task_id for tracking
            "resumed": True  # Mark as resumed task
        }
        
        # Set preferred resolution based on area size
        if radius_km <= 1.0:
            preferred_resolution = 0.5
        elif radius_km <= 5.0:
            preferred_resolution = 1.0
        else:
            preferred_resolution = 2.0
            
        # Create session info
        tile_size_m = 40
        radius_m = radius_km * 1000
        scan_grid_size = int(2 * radius_m / tile_size_m)
        
        session_info = {
            "session_id": session_id,
            "type": "lidar_scan",
            "status": "running",
            "config": config,
            "preferred_resolution": preferred_resolution,
            "enable_detection": True,
            "structure_type": default_type,
            "start_time": datetime.now(timezone.utc).isoformat(),
            "total_tiles": scan_grid_size * scan_grid_size,
            "processed_tiles": 0,
            "streaming_mode": True,
            "tile_size_m": tile_size_m,
            "is_paused": False,
            "tile_queue": [],
            "current_tile_index": 0,
            "task_id": task_id,  # Link to original task
            "resumed": True  # Mark as resumed
        }
        
        # Add session to active sessions
        active_sessions[session_id] = session_info
        
        # Send notification about task restart
        await discovery_manager.send_message({
            "type": "task_resumed",
            "session_id": session_id,
            "task_id": task_id,
            "message": f"Resumed scanning task {task_id} with detection enabled",
            "config": {
                "center_lat": center_lat,
                "center_lon": center_lon,
                "radius_km": radius_km,
                "total_tiles": scan_grid_size * scan_grid_size
            },
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
        # Start the scanning process in background
        asyncio.create_task(run_lidar_scan_async(session_id, session_info))
        
        logger.info(f"✅ Restarted task {task_id} with session {session_id}")
        logger.info(f"   📍 Center: {center_lat:.4f}, {center_lon:.4f}")
        logger.info(f"   🔍 Radius: {radius_km:.1f} km")
        logger.info(f"   🎯 Total tiles: {scan_grid_size * scan_grid_size}")
        
    except Exception as e:
        logger.error(f"❌ Failed to restart task {task['id']}: {e}")
        raise

async def update_task_progress(task_id: str, progress: Optional[float] = None, findings: List[Dict] = None):
    """
    Update progress for a running task and save to JSON file.
    
    Args:
        task_id: Task ID to update
        progress: New progress value (0-100) or None to keep current progress
        findings: Optional list of new findings to add
    """
    try:
        # Find the task file
        task_files = glob.glob(str(TASKS_DATA_PATH / f"*{task_id}*.json"))
        
        if not task_files:
            logger.error(f"Task file not found for task {task_id}")
            return
            
        task_file = task_files[0]
        
        # Load current task data
        with open(task_file, 'r') as f:
            task_data = json.load(f)
        
        # Update progress if provided
        if progress is not None:
            task_data["progress"] = progress
            task_data["updated_at"] = datetime.now(timezone.utc).isoformat()
            
            # Mark as completed if progress is 100%
            if progress >= 100.0:
                task_data["status"] = "completed"
                task_data["completed_at"] = datetime.now(timezone.utc).isoformat()
        
        # Add findings if provided
        if findings:
            if "findings" not in task_data:
                task_data["findings"] = []
            task_data["findings"].extend(findings)
            task_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        
        # Save updated task data
        with open(task_file, 'w') as f:
            json.dump(task_data, f, indent=2)
            
        if progress is not None:
            logger.info(f"📊 Updated task {task_id} progress to {progress}%")
        if findings:
            logger.info(f"🎯 Added {len(findings)} findings to task {task_id}")
        
    except Exception as e:
        logger.error(f"❌ Failed to update task {task_id}: {e}")

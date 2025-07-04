"""
LiDAR scanning endpoints and background tasks for the discovery API.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional
import asyncio
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
import os
import json

from backend.api.routers.discovery_utils import get_available_structure_types, get_profile_name_for_structure_type
from backend.api.routers.discovery_models import SessionIdRequest
from backend.api.routers.discovery_sessions import active_sessions, _active_detection_tasks, _session_tile_data
from backend.api.routers.discovery_connections import discovery_manager
from lidar_factory.factory import LidarMapFactory

router = APIRouter()

# Global variable to store the most recent patch info
current_patch_info = None  # {"resolution": "0.5m", "resolution_m": 0.5, "resolution_description": "High resolution", "source_dataset": "Dataset name", "lat": 52.4751, "lon": 4.8156, "timestamp": "2023-10-01T12:00:00Z"}

def get_app_root():
    # Use /app if it exists (Docker/Cloud), else use current working directory (local)
    return "/app" if os.path.exists("/app") else os.getcwd()

# --- LiDAR Scan Endpoints ---

@router.post("/discovery/lidar-scan")
async def start_lidar_scan(
    config: Dict[str, Any],
    current_user: Optional[Dict[str, Any]] = Depends(lambda: None)
):
    """
    Start a LiDAR tile-by-tile scanning operation.
    Streams elevation data patches without structure detection.
    """
    try:
        import uuid
        from datetime import datetime, timezone
        import numpy as np
        
        session_id = str(uuid.uuid4())
        center_lat = float(config.get('center_lat', 52.4751))
        center_lon = float(config.get('center_lon', 4.8156))
        radius_km = float(config.get('radius_km', 2.0))
        tile_size_m = 40
        prefer_high_resolution = config.get('prefer_high_resolution', False)
        enable_detection = config.get('enable_detection', False)
        # Use dynamic app_root
        app_root = get_app_root()
        import logging
        logger = logging.getLogger(__name__)
        available_types, default_type = get_available_structure_types(app_root, logger)
        structure_type = config.get('structure_type', default_type)
        if prefer_high_resolution:
            preferred_resolution = 0.25
        elif radius_km <= 1.0:
            preferred_resolution = 0.5
        else:
            preferred_resolution = 1.0
        radius_m = radius_km * 1000
        scan_grid_size = int(2 * radius_m / tile_size_m)
        session_info = {
            "session_id": session_id,
            "type": "lidar_scan",
            "status": "started",
            "config": config,
            "preferred_resolution": preferred_resolution,
            "enable_detection": enable_detection,
            "structure_type": structure_type,
            "start_time": datetime.now(timezone.utc).isoformat(),
            "total_tiles": scan_grid_size * scan_grid_size,
            "processed_tiles": 0,
            "streaming_mode": True,
            "tile_size_m": tile_size_m,
            "is_paused": False,
            "tile_queue": [],
            "current_tile_index": 0
        }
        active_sessions[session_id] = session_info
        if enable_detection:
            await discovery_manager.send_message({
                "type": "detection_starting",
                "session_id": session_id,
                "message": "Starting real-time sliding detection during LiDAR scan",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
        asyncio.create_task(run_lidar_scan_async(session_id, session_info))
        return {
            "session_id": session_id,
            "status": "started",
            "message": f"LiDAR scan started for {scan_grid_size}x{scan_grid_size} tiles" + (" with detection" if enable_detection else ""),
            "total_tiles": scan_grid_size * scan_grid_size,
            "enable_detection": enable_detection,
            "structure_type": structure_type
        }
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"❌ Failed to start LiDAR scan: {e}")
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"Failed to start LiDAR scan: {str(e)}")

@router.post("/discovery/pause-resume-lidar")
async def pause_resume_lidar_scan(
    session_id: str,
    current_user: Optional[Dict[str, Any]] = Depends(lambda: None)
):
    # ...existing code from discovery.py...
    pass

@router.post("/discovery/pause-lidar")
async def pause_lidar_scan(
    request: SessionIdRequest,
    current_user: Optional[Dict[str, Any]] = Depends(lambda: None)
):
    # ...existing code from discovery.py...
    pass

@router.post("/discovery/resume-lidar")
async def resume_lidar_scan(
    request: SessionIdRequest,
    current_user: Optional[Dict[str, Any]] = Depends(lambda: None)
):
    # ...existing code from discovery.py...
    pass

# --- LiDAR Scan Background Task ---

async def run_lidar_scan_async(session_id: str, session_info: Dict[str, Any]):
    """
    Background task to perform tile-by-tile LiDAR scanning using LidarFactory
    """
    try:
        import numpy as np
        from datetime import datetime, timezone
        config = session_info["config"]
        center_lat = float(config.get('center_lat', 52.4751))
        center_lon = float(config.get('center_lon', 4.8156))
        radius_km = float(config.get('radius_km', 2.0))
        tile_size_m = 40
        data_type = config.get('data_type', 'DSM')
        streaming_mode = config.get('streaming_mode', True)
        preferred_resolution = session_info.get('preferred_resolution', 1.0)
        enable_detection = config.get('enable_detection', False)
        # Use dynamic app_root
        app_root = get_app_root()
        import logging
        logger = logging.getLogger(__name__)
        available_types, default_type = get_available_structure_types(app_root, logger)
        structure_type = config.get('structure_type', default_type)
        from kernel.detector_profile import DetectorProfileManager
        profile_manager = DetectorProfileManager(profiles_dir=f"{app_root}/profiles")
        profile_name = get_profile_name_for_structure_type(structure_type, app_root, logger)
        profile = profile_manager.load_profile(profile_name)
        profile_resolution_m = profile.geometry.resolution_m
        radius_m = radius_km * 1000
        lat_delta = radius_m / 111320
        lon_delta = radius_m / (111320 * np.cos(np.radians(center_lat)))
        north_lat = center_lat + lat_delta
        south_lat = center_lat - lat_delta
        east_lon = center_lon + lon_delta
        west_lon = center_lon - lon_delta
        area_width_m = 2 * radius_m
        area_height_m = 2 * radius_m
        tiles_x = max(1, int(np.ceil(area_width_m / tile_size_m)))
        tiles_y = max(1, int(np.ceil(area_height_m / tile_size_m)))
        session_info["status"] = "running"
        session_info["processed_tiles"] = 0
        session_info["total_tiles"] = tiles_x * tiles_y
        session_info["processed_tile_ids"] = set()
        for row in range(tiles_y):
            for col in range(tiles_x):
                current_session = active_sessions.get(session_id)
                if not current_session or current_session.get("status") == "stopped":
                    logger.info(f"🛑 LiDAR scan {session_id} stopped by user")
                    return
                while True:
                    current_session = active_sessions.get(session_id)
                    if not current_session or current_session.get("status") == "stopped":
                        logger.info(f"🛑 LiDAR scan {session_id} stopped while checking pause")
                        return
                    if not current_session.get("is_paused", False):
                        break
                    logger.info(f"⏸️ LiDAR scan {session_id} is paused at tile ({row},{col}), waiting...")
                    await asyncio.sleep(0.2)
                tile_id = f"tile_{row}_{col}"
                if tile_id in session_info.get("processed_tile_ids", set()):
                    logger.warning(f"🔄 Skipping duplicate tile {tile_id}")
                    continue
                session_info.setdefault("processed_tile_ids", set()).add(tile_id)
                lat_step = (north_lat - south_lat) / tiles_y
                lon_step = (east_lon - west_lon) / tiles_x
                tile_lat = north_lat - (row + 0.5) * lat_step
                tile_lon = west_lon + (col + 0.5) * lon_step
                try:
                    result = LidarMapFactory.get_patch(
                        lat=tile_lat,
                        lon=tile_lon,
                        size_m=tile_size_m,
                        preferred_resolution_m=preferred_resolution,
                        preferred_data_type=data_type
                    )
                    # --- Update global current_patch_info with latest patch info ---
                    if result is not None:
                        global current_patch_info
                        current_patch_info = {
                            "resolution": f"{result.resolution_m}m",
                            "resolution_m": result.resolution_m,
                            "resolution_description": getattr(result, "resolution_description", None),
                            "is_high_resolution": getattr(result, "is_high_resolution", None),
                            "source_dataset": getattr(result, "source_dataset", None),
                            "lat": tile_lat,
                            "lon": tile_lon,
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        }
                    elevation_data = None
                    if result is not None:
                        elevation_data = result.data
                        if "resolution_metadata" not in session_info:
                            session_info["resolution_metadata"] = {
                                "resolution_description": result.resolution_description,
                                "is_high_resolution": result.is_high_resolution,
                                "source_dataset": result.source_dataset,
                                "resolution_m": result.resolution_m
                            }
                        elev_min = float(np.nanmin(elevation_data))
                        elev_max = float(np.nanmax(elevation_data))
                        elev_mean = float(np.nanmean(elevation_data))
                        h, w = elevation_data.shape
                        max_viz_size = 64
                        if h > max_viz_size or w > max_viz_size:
                            step_h = max(1, h // max_viz_size)
                            step_w = max(1, w // max_viz_size)
                            viz_elevation = elevation_data[::step_h, ::step_w].tolist()
                            viz_shape = [len(viz_elevation), len(viz_elevation[0])]
                        else:
                            viz_elevation = elevation_data.tolist()
                            viz_shape = [h, w]
                        lat_delta_tile = (tile_size_m / 2) / 111320
                        lon_delta_tile = (tile_size_m / 2) / (111320 * np.cos(np.radians(tile_lat)))
                        tile_bounds = {
                            "south": tile_lat - lat_delta_tile,
                            "west": tile_lon - lon_delta_tile,
                            "north": tile_lat + lat_delta_tile,
                            "east": tile_lon + lon_delta_tile
                        }
                        tile_result = {
                            "session_id": session_id,
                            "tile_id": tile_id,
                            "type": "lidar_tile",
                            "center_lat": tile_lat,
                            "center_lon": tile_lon,
                            "size_m": tile_size_m,
                            "tile_bounds": tile_bounds,
                            "has_data": True,
                            "actual_resolution": result.resolution_description,
                            "is_high_resolution": result.is_high_resolution,
                            "source_dataset": result.source_dataset,
                            "grid_row": row,
                            "grid_col": col,
                            "grid_total_rows": tiles_y,
                            "grid_total_cols": tiles_x,
                            "elevation_stats": {
                                "min": float(np.nanmin(elevation_data)),
                                "max": float(np.nanmax(elevation_data)),
                                "mean": float(np.nanmean(elevation_data)),
                                "std": float(np.nanstd(elevation_data))
                            },
                            "shape": elevation_data.shape,
                            "viz_elevation": viz_elevation,
                            "viz_shape": viz_shape,
                            "scan_bounds": {
                                "north": north_lat,
                                "south": south_lat,
                                "east": east_lon,
                                "west": west_lon
                            },
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        }
                        await discovery_manager.send_message(tile_result)
                        # Store tile data for detection
                        if session_id not in _session_tile_data:
                            _session_tile_data[session_id] = {}
                        _session_tile_data[session_id][tile_id] = {
                            'lat': tile_lat,
                            'lon': tile_lon,
                            'elevation_data': elevation_data
                        }
                        # --- Real-time detection per tile (legacy behavior) ---
                        if enable_detection:
                            detector = await get_session_detector(session_id, structure_type, app_root, logger)
                            if detector is not None:
                                from kernel.core_detector import ElevationPatch
                                patch_obj = ElevationPatch(
                                    elevation_data=elevation_data,
                                    lat=tile_lat,
                                    lon=tile_lon,
                                    source="LiDARScan",
                                    resolution_m=detector.profile.geometry.resolution_m,
                                    patch_size_m=detector.profile.geometry.patch_size_m[0]
                                )
                                result_obj = detector.detect_structure(patch_obj)
                                confidence = float(getattr(result_obj, 'confidence', 0.0)) if hasattr(result_obj, 'confidence') else 0.0
                                is_positive = bool(getattr(result_obj, 'detected', False)) if hasattr(result_obj, 'detected') else False
                                final_score = float(getattr(result_obj, 'final_score', 0.0)) if hasattr(result_obj, 'final_score') else 0.0
                                patch_id = f"{session_id}_{row}_{col}"
                                patch_result_msg = {
                                    'type': 'patch_result',
                                    'patch': {
                                        'session_id': str(session_id),
                                        'patch_id': patch_id,
                                        'lat': float(tile_lat),
                                        'lon': float(tile_lon),
                                        'timestamp': datetime.now(timezone.utc).isoformat(),
                                        'is_positive': is_positive,
                                        'confidence': confidence,
                                        'detection_result': {
                                            'confidence': confidence,
                                            'method': 'G2_dutch_windmill',
                                            'elevation_source': 'AHN4_real',
                                            'phi0': confidence * 0.8 if is_positive else 0.1,
                                            'psi0': confidence * 0.9 if is_positive else 0.15,
                                            'g2_detected': is_positive,
                                            'g2_confidence': confidence,
                                            'g2_final_score': final_score,
                                            'g2_feature_scores': {},
                                            'g2_metadata': {},
                                            'g2_reason': '',
                                            'patch_bounds': tile_bounds,
                                            'visualization_elevation': viz_elevation
                                        },
                                        'elevation_stats': {
                                            'min': float(np.nanmin(elevation_data)),
                                            'max': float(np.nanmax(elevation_data)),
                                            'mean': float(np.nanmean(elevation_data)),
                                            'std': float(np.nanstd(elevation_data))
                                        },
                                        'patch_size_m': detector.profile.geometry.patch_size_m[0]
                                    },
                                    'session_id': str(session_id),
                                    'session_progress': {
                                        'processed': session_info["processed_tiles"] + 1,
                                        'total': session_info["total_tiles"],
                                        'percentage': float(((session_info["processed_tiles"] + 1) / session_info["total_tiles"]) * 100)
                                    },
                                    'timestamp': datetime.now(timezone.utc).isoformat()
                                }
                                await discovery_manager.send_message(patch_result_msg)
                                # Send detection_result if positive
                                if is_positive:
                                    detection_message = {
                                        'type': 'detection_result',
                                        'confidence': confidence,
                                        'final_score': final_score,
                                        'detected': True,
                                        'lat': tile_lat,
                                        'lon': tile_lon,
                                        'session_id': str(session_id),
                                        'patch_id': patch_id,
                                        'timestamp': datetime.now(timezone.utc).isoformat()
                                    }
                                    await discovery_manager.send_message(detection_message)
                                # Send patch_scanning for frontend lens movement
                                await discovery_manager.send_message({
                                    'type': 'patch_scanning',
                                    'patch_id': patch_id,
                                    'lat': float(tile_lat),
                                    'lon': float(tile_lon),
                                    'timestamp': datetime.now(timezone.utc).isoformat()
                                })
                    else:
                        lat_delta_tile = (tile_size_m / 2) / 111320
                        lon_delta_tile = (tile_size_m / 2) / (111320 * np.cos(np.radians(tile_lat)))
                        tile_bounds = {
                            "south": tile_lat - lat_delta_tile,
                            "west": tile_lon - lon_delta_tile,
                            "north": tile_lat + lat_delta_tile,
                            "east": tile_lon + lon_delta_tile
                        }
                        tile_result = {
                            "session_id": session_id,
                            "tile_id": tile_id,
                            "type": "lidar_tile",
                            "center_lat": tile_lat,
                            "center_lon": tile_lon,
                            "size_m": tile_size_m,
                            "tile_bounds": tile_bounds,
                            "has_data": False,
                            "actual_resolution": session_info.get("resolution_metadata", {}).get("resolution_description", f"{preferred_resolution}m"),
                            "is_high_resolution": session_info.get("resolution_metadata", {}).get("is_high_resolution", False),
                            "source_dataset": session_info.get("resolution_metadata", {}).get("source_dataset", "unknown"),
                            "grid_row": row,
                            "grid_col": col,
                            "grid_total_rows": tiles_y,
                            "grid_total_cols": tiles_x,
                            "scan_bounds": {
                                "north": north_lat,
                                "south": south_lat,
                                "east": east_lon,
                                "west": west_lon
                            },
                            "message": "No LiDAR data available",
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        }
                        await discovery_manager.send_message(tile_result)
                    session_info["processed_tiles"] = row * tiles_x + col + 1
                    
                    # Calculate progress percentage
                    progress_percent = (session_info["processed_tiles"] / session_info["total_tiles"]) * 100
                    
                    # Update task progress if this is a resumed task
                    # Only update at reasonable intervals to reduce log spam
                    if session_info.get("task_id"):
                        try:
                            from backend.api.startup_tasks import update_task_progress
                            # Only update every 10% or at completion
                            if (progress_percent >= 100.0 or 
                                int(progress_percent) % 10 == 0 and 
                                int(progress_percent) != int((session_info["processed_tiles"] - 1) / session_info["total_tiles"] * 100)):
                                await update_task_progress(session_info["task_id"], progress_percent)
                        except Exception as e:
                            logger.error(f"Failed to update task progress: {e}")
                    
                    progress_update = {
                        "session_id": session_id,
                        "type": "lidar_progress",
                        "processed_tiles": session_info["processed_tiles"],
                        "total_tiles": session_info["total_tiles"],
                        "progress_percent": progress_percent,
                        "actual_resolution": session_info.get("resolution_metadata", {}).get("resolution_description", f"{preferred_resolution}m"),
                        "is_high_resolution": session_info.get("resolution_metadata", {}).get("is_high_resolution", False),
                        "source_dataset": session_info.get("resolution_metadata", {}).get("source_dataset", "unknown"),
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
                    await discovery_manager.send_message(progress_update)
                    await asyncio.sleep(0.1)
                except Exception as e:
                    logger.error(f"Error processing tile {row},{col}: {e}")
                    continue
        session_info["status"] = "completed"
        session_info["end_time"] = datetime.now(timezone.utc).isoformat()
        
        # Update task completion if this is a resumed task
        if session_info.get("task_id"):
            try:
                from backend.api.startup_tasks import update_task_progress
                await update_task_progress(session_info["task_id"], 100.0)
                logger.info(f"✅ Marked task {session_info['task_id']} as completed")
            except Exception as e:
                logger.error(f"Failed to update task completion: {e}")
        
        completion_message = {
            "session_id": session_id,
            "type": "lidar_completed",
            "message": f"LiDAR scan completed. Processed {session_info['processed_tiles']} tiles.",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        await discovery_manager.send_message(completion_message)
        logger.info(f"[DEBUG] At end of scan: enable_detection={session_info.get('config', {}).get('enable_detection', None)} (type: {type(session_info.get('config', {}).get('enable_detection', None))})")
        # Automatically trigger detection if enabled
        try:
            if session_info.get('config', {}).get('enable_detection', False):
                logger.info(f"🟢 [POST-SCAN] Auto-starting detection for session {session_id} after LiDAR scan. _session_tile_data keys: {list(_session_tile_data.keys())}")
                scan_area = {
                    'lat': float(config.get('center_lat', 52.4751)),
                    'lon': float(config.get('center_lon', 4.8156)),
                    'size_km': float(config.get('radius_km', 2.0)) * 2
                }
                task = asyncio.create_task(run_coordinated_detection(session_id, scan_area, app_root, logger))
                logger.info(f"[DEBUG] Detection task scheduled: {task}")
        except Exception as e:
            logger.error(f"❌ [EXCEPTION] Failed to schedule detection after scan: {e}", exc_info=True)
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"❌ [EXCEPTION] Error in LiDAR scan {session_id}: {e}", exc_info=True)
        session_info["status"] = "error"
        session_info["error"] = str(e)
        error_message = {
            "session_id": session_id,
            "type": "lidar_error",
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        await discovery_manager.send_message(error_message)

# --- Detection and Detector Helpers (restored from legacy) ---

from backend.api.routers.discovery_sessions import _session_detectors

async def get_session_detector(session_id: str, structure_type: str, app_root: str, logger) -> Optional[Any]:
    """Get or create a cached detector for the session."""
    cache_key = f"{session_id}_{structure_type}"
    if cache_key not in _session_detectors:
        try:
            from kernel import G2StructureDetector
            from kernel.detector_profile import DetectorProfileManager
            profile_manager = DetectorProfileManager(profiles_dir=f"{app_root}/profiles")
            profile_name = get_profile_name_for_structure_type(structure_type, app_root, logger)
            profile = profile_manager.load_profile(profile_name)
            detector = G2StructureDetector(profile=profile)
            _session_detectors[cache_key] = detector
            logger.info(f"✅ G2 detector cached for session {session_id}")
        except Exception as e:
            logger.error(f"❌ Failed to initialize G2 detector: {e}")
            return None
    return _session_detectors[cache_key]

async def run_coordinated_detection(session_id: str, scan_area: dict, app_root: str, logger):
    logger.info(f"[DEBUG] Entered run_coordinated_detection for session {session_id} with scan_area={scan_area}")
    logger.info(f"🎯 [DETECTION ENTRY] run_coordinated_detection called for session {session_id}. _session_tile_data keys: {list(_session_tile_data.keys())}")
    
    if session_id not in _session_tile_data:
        logger.warning(f"❌ [DETECTION EARLY EXIT] No tile data found for session {session_id}. _session_tile_data keys: {list(_session_tile_data.keys())}")
        return
    
    tile_count = len(_session_tile_data[session_id])
    logger.info(f"🎯 [DETECTION START] Starting coordinated detection for session {session_id} with {tile_count} tiles")
    
    await discovery_manager.send_message({
        "type": "detection_starting",
        "session_id": session_id,
        "message": "Starting coordinated detection across scanned area",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    
    # Get task_id if this is a resumed task
    task_id = None
    if session_id in active_sessions:
        task_id = active_sessions[session_id].get("task_id")
    
    findings = []  # Collect findings for task update
    
    from kernel.detector_profile import DetectorProfileManager
    profile_manager = DetectorProfileManager(profiles_dir=f"{app_root}/profiles")
    profile = profile_manager.load_profile("dutch_windmill.json")
    
    detection_patch_size_m = profile.geometry.patch_size_m[0]
    detection_step_size_m = 10
    
    lat_center = scan_area.get('lat')
    lon_center = scan_area.get('lon')
    size_km = scan_area.get('size_km')
    
    if lat_center is None or lon_center is None or size_km is None:
        logger.error(f"❌ Invalid scan_area parameters: lat={lat_center}, lon={lon_center}, size_km={size_km}")
        return
    
    lat_m_per_deg = 111320
    lon_m_per_deg = 111320 * np.cos(np.radians(lat_center))
    half_size_m = (size_km * 1000) / 2
    
    steps_lat = int(size_km * 1000 / detection_step_size_m)
    steps_lon = int(size_km * 1000 / detection_step_size_m)
    total_steps = steps_lat * steps_lon
    
    available_types, default_type = get_available_structure_types(app_root, logger)
    structure_type = default_type
    
    detector = await get_session_detector(session_id, structure_type, app_root, logger)
    if not detector:
        logger.error("❌ Failed to get detector for coordinated detection")
        return
    
    processed_steps = 0
    for i in range(steps_lat):
        for j in range(steps_lon):
            if session_id not in _active_detection_tasks:
                logger.info(f"🛑 Detection cancelled for session {session_id}")
                return
            offset_lat_m = half_size_m - (i * detection_step_size_m) - (detection_patch_size_m / 2)
            offset_lon_m = -half_size_m + (j * detection_step_size_m) + (detection_patch_size_m / 2)
            patch_lat = lat_center + offset_lat_m / lat_m_per_deg
            patch_lon = lon_center + offset_lon_m / lon_m_per_deg
            elevation_patch = None
            min_distance = float('inf')
            for tile_id, tile_data in _session_tile_data[session_id].items():
                lat_diff = abs(tile_data['lat'] - patch_lat)
                lon_diff = abs(tile_data['lon'] - patch_lon)
                distance = (lat_diff ** 2 + lon_diff ** 2) ** 0.5
                if distance < min_distance:
                    min_distance = distance
                    elevation_patch = tile_data['elevation_data']
            if elevation_patch is not None:
                from kernel.core_detector import ElevationPatch
                patch_obj = ElevationPatch(
                    elevation_data=elevation_patch,
                    lat=patch_lat,
                    lon=patch_lon,
                    source="CoordinatedDetection",
                    resolution_m=detector.profile.geometry.resolution_m,
                    patch_size_m=detector.profile.geometry.patch_size_m[0]
                )
                result = detector.detect_structure(patch_obj)
                confidence = float(getattr(result, 'confidence', 0.0)) if hasattr(result, 'confidence') else 0.0
                is_positive = bool(getattr(result, 'detected', False)) if hasattr(result, 'detected') else False
                final_score = float(getattr(result, 'final_score', 0.0)) if hasattr(result, 'final_score') else 0.0
                # Compose patch_result message (fully legacy-compatible)
                patch_result_msg = {
                    'type': 'patch_result',
                    'patch': {
                        'session_id': str(session_id),
                        'patch_id': patch_id,
                        'lat': float(patch_lat),
                        'lon': float(patch_lon),
                        'timestamp': datetime.now(timezone.utc).isoformat(),
                        'is_positive': is_positive,
                        'confidence': confidence,
                        'detection_result': {
                            'confidence': confidence,
                            'method': 'G2_dutch_windmill',
                            'elevation_source': 'AHN4_real',
                            'phi0': confidence * 0.8 if is_positive else 0.1,
                            'psi0': confidence * 0.9 if is_positive else 0.15,
                            'g2_detected': is_positive,
                            'g2_confidence': confidence,
                            'g2_final_score': final_score,
                            'g2_feature_scores': {},
                            'g2_metadata': {},
                            'g2_reason': '',
                            'patch_bounds': {},
                            'visualization_elevation': None
                        },
                        'elevation_stats': {},
                        'patch_size_m': detection_patch_size_m
                    },
                    'session_id': str(session_id),
                    'session_progress': {
                        'processed': 0,  # Optionally update if you track progress
                        'total': 0,
                        'percentage': 0.0
                    },
                    'timestamp': datetime.now(timezone.utc).isoformat()
                }
                await discovery_manager.send_message(patch_result_msg)
                if is_positive:
                    # Add to findings collection
                    finding = {
                        "lat": patch_lat,
                        "lon": patch_lon,
                        "confidence": confidence,
                        "score": final_score,
                        "type": structure_type,
                        "detected_at": datetime.now(timezone.utc).isoformat()
                    }
                    findings.append(finding)
                    
                    detection_message = {
                        'type': 'detection_result',
                        'confidence': confidence,
                        'final_score': final_score,
                        'detected': True,
                        'lat': patch_lat,
                        'lon': patch_lon,
                        'session_id': str(session_id),
                        'patch_id': patch_id,
                        'timestamp': datetime.now(timezone.utc).isoformat()
                    }
                    await discovery_manager.send_message(detection_message)
            
            # Send patch_scanning message for frontend lens movement (legacy-compatible)
            patch_id = f"{session_id}_{i}_{j}"
            await discovery_manager.send_message({
                'type': 'patch_scanning',
                'patch_id': patch_id,
                'lat': float(patch_lat),
                'lon': float(patch_lon),
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
            
            # Update progress
            processed_steps += 1
            if processed_steps % 10 == 0:  # Update every 10 steps to avoid spam
                detection_progress = (processed_steps / total_steps) * 100
                findings_count = len(findings) if isinstance(findings, list) else 0
                await discovery_manager.send_message({
                    'type': 'detection_progress',
                    'session_id': str(session_id),
                    'processed_steps': processed_steps,
                    'total_steps': total_steps,
                    'progress_percent': detection_progress,
                    'findings_count': findings_count,
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })
            
            await asyncio.sleep(0.15)
    if session_id in _active_detection_tasks:
        del _active_detection_tasks[session_id]
    
    # Update task with findings if this is a resumed task
    if task_id and findings:
        try:
            from backend.api.startup_tasks import update_task_progress
            # Don't change progress here - detection doesn't affect scan progress
            # Just add the findings
            await update_task_progress(task_id, None, findings)
            # Safe logging with type checking
            if isinstance(findings, list):
                logger.info(f"✅ Added {len(findings)} findings to task {task_id}")
            else:
                logger.info(f"✅ Added findings to task {task_id}")
        except Exception as e:
            logger.error(f"Failed to update task findings: {e}")
    
    # At the end, send session_completed (legacy-compatible)
    await discovery_manager.send_message({
        'type': 'session_completed',
        'session': {
            'session_id': str(session_id),
            'status': 'completed',
            'end_time': datetime.now(timezone.utc).isoformat(),
            'findings_count': len(findings)
        },
        'timestamp': datetime.now(timezone.utc).isoformat()
    })

@router.get("/discovery/discovered_sites")
async def get_discovered_sites():
    """Return the list of discovered archaeological sites from lattice/discovered.json"""
    try:
        app_root = get_app_root()
        discovered_path = os.path.join(app_root, "lattice", "discovered.json")
        if not os.path.exists(discovered_path):
            return JSONResponse(status_code=404, content={"error": "discovered.json not found"})
        with open(discovered_path, "r", encoding="utf-8") as f:
            sites = json.load(f)
        # If the file is a dict with a 'sites' key, return just the array
        if isinstance(sites, dict) and "sites" in sites:
            return sites["sites"]
        return sites
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"❌ Failed to load discovered sites: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

@router.get("/api/resolution")
async def get_lidar_resolution(
    lat: float = Query(...),
    lon: float = Query(...),
    radius_km: float = Query(1.0),
    data_type: str = Query("DSM")
):
    # Return the most recent patch info (global)
    if current_patch_info is not None and current_patch_info.get('resolution') is not None:
        return {
            'success': True,
            'resolution': current_patch_info['resolution'],
            'resolution_m': current_patch_info['resolution_m'],
            'resolution_description': current_patch_info['resolution_description'],
            'source_dataset': current_patch_info['source_dataset'],
            'message': 'Resolution from most recent scan.'
        }
    else:
        return {
            'success': False,
            'resolution': None,
            'resolution_m': None,
            'resolution_description': None,
            'source_dataset': None,
            'message': 'No scan has been run yet, resolution unavailable.'
        }

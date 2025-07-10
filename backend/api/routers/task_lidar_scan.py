import asyncio
import json
from backend.api.routers.messenger_websocket import frontend_backend_messenger
import logging
import threading
import numpy as np
from lidar_factory.factory import LidarMapFactory
from backend.utils.gcs_utils import get_gcs_bucket, upload_blob, download_blob, blob_exists, safe_download_blob
from io import BytesIO
from PIL import Image
from google.api_core.exceptions import NotFound  # <-- Add this import
import time
import os
from concurrent.futures import ThreadPoolExecutor

# Delay import to avoid circular import
system_task_manager = None

class LidarScanTaskManager:
    def __init__(self, parent_task_manager=None):
        self.parent_task_manager = parent_task_manager
        self.active_sessions = {}  # task_id -> dict with task, stop_event, etc.
        self.session_stopped_callbacks = {}  # task_id -> callback
        self.logger = logging.getLogger("backend.api.routers.task_lidar_scan")
        
        # Resource throttling configuration
        self.max_concurrent_scans = int(os.getenv("LIDAR_MAX_CONCURRENT_SCANS", "1"))
        self.tile_processing_delay = float(os.getenv("LIDAR_TILE_DELAY_MS", "50")) / 1000.0  # Convert to seconds
        self.batch_size = int(os.getenv("LIDAR_BATCH_SIZE", "10"))  # Process N tiles before yielding
        self.websocket_batch_size = int(os.getenv("LIDAR_WS_BATCH_SIZE", "5"))  # Send N messages before yielding
        
        # Create limited thread pool for scanning
        self.scan_executor = ThreadPoolExecutor(
            max_workers=self.max_concurrent_scans,
            thread_name_prefix="lidar-scan"
        )
        
        # WebSocket message queue to batch sends
        self.ws_message_queue = []
        self.ws_queue_lock = threading.Lock()

    async def start_scan(self, task_id: str):
        """Start a LiDAR scan session asynchronously without blocking."""
        self.logger.info(f"[SCAN] start_scan called for task_id={task_id}")
        
        # Check if already running
        if task_id in self.active_sessions:
            self.logger.warning(f"[SCAN] Task {task_id} is already running")
            return False
        
        # Create session data
        stop_event = threading.Event()
        session_data = {
            'stop_event': stop_event,
            'task': None,  # Will be set by the background task
            'started_at': asyncio.get_event_loop().time()
        }
        self.active_sessions[task_id] = session_data
        
        # Start scan in background without blocking
        loop = asyncio.get_running_loop()
        task = loop.create_task(self._run_scan_async(task_id, stop_event))
        session_data['task'] = task
        
        # Add cleanup callback
        task.add_done_callback(lambda t: self._cleanup_session(task_id, t))
        
        self.logger.info(f"[SCAN] Started background scan for task_id={task_id}")
        return True
    
    async def _run_scan_async(self, task_id: str, stop_event: threading.Event):
        """Run the scan in a limited thread executor to avoid blocking the event loop."""
        loop = asyncio.get_running_loop()
        try:
            # Use the limited thread pool instead of the default unlimited one
            await loop.run_in_executor(self.scan_executor, self._run_scan_blocking, task_id, stop_event)
        except Exception as e:
            self.logger.error(f"[SCAN] Async scan failed for task_id={task_id}: {e}")
            raise
    
    def _cleanup_session(self, task_id: str, task):
        """Clean up session data when task completes."""
        self.logger.info(f"[SCAN] Cleaning up session for task_id={task_id}")
        session_data = self.active_sessions.pop(task_id, None)
        
        if task.exception():
            self.logger.error(f"[SCAN] Task {task_id} failed: {task.exception()}")
        else:
            self.logger.info(f"[SCAN] Task {task_id} completed successfully")
        
        # Call stopped callback if registered
        callback = self.session_stopped_callbacks.pop(task_id, None)
        if callback:
            try:
                callback(task_id)
            except Exception as cb_exc:
                self.logger.warning(f"[SCAN] Exception in session stopped callback for {task_id}: {cb_exc}")

    def _run_scan_blocking(self, task_id: str, stop_event: threading.Event):
        try:
            bucket = get_gcs_bucket("re_archaeology")
            task_blob_path = f"tasks/{task_id}.json"
            self.logger.info(f"[SCAN] Attempting to download task definition from {task_blob_path}")
            try:
                task_bytes = safe_download_blob(bucket, task_blob_path, logger=self.logger)
            except Exception as e:
                self.logger.error(f"[SCAN] Error downloading task file from GCS: {e}")
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(frontend_backend_messenger.send_message({
                        "type": "error", "message": f"Error downloading task file from GCS: {e}", "task_id": task_id
                    }))
                finally:
                    loop.close()
                return
            if not task_bytes:
                self.logger.info(f"[SCAN] Task file not found in GCS: {task_id}")
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(frontend_backend_messenger.send_message({
                        "type": "error", "message": f"Task file not found in GCS: {task_id}", "task_id": task_id
                    }))
                finally:
                    loop.close()
                return
            try:
                task = json.loads(task_bytes.decode("utf-8"))
            except Exception as e:
                self.logger.error(f"[SCAN] Failed to parse task JSON for {task_id}: {e}")
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(frontend_backend_messenger.send_message({
                        "type": "error", "message": f"Failed to parse task JSON for {task_id}", "task_id": task_id
                    }))
                finally:
                    loop.close()
                return
            # --- Always update grid and levels in task profile at scan start ---
            # Use TaskManager to update the task profile
            if self.parent_task_manager:
                task_obj = self.parent_task_manager.get_task(task_id)
                if task_obj:
                    task_data = task_obj.to_dict()
                    width_km = task_data["range"]["width_km"]
                    height_km = task_data["range"]["height_km"]
                    tile_km = 5
                    preferred_res = task_data.get("preferred_resolution", 10)
                    if preferred_res >= 30:
                        tile_km = 10
                    elif preferred_res >= 10:
                        tile_km = 5
                    else:
                        tile_km = 2
                    grid_x = max(1, int(np.ceil(width_km / tile_km)))
                    grid_y = max(1, int(np.ceil(height_km / tile_km)))
                    MAX_TILES = 80
                    if grid_x * grid_y > MAX_TILES:
                        scale = (grid_x * grid_y / MAX_TILES) ** 0.5
                        grid_x = max(1, int(np.ceil(grid_x / scale)))
                        grid_y = max(1, int(np.ceil(grid_y / scale)))
                    levels = [
                        {"res": 8.0, "subtiles": 1},
                        {"res": 4.0, "subtiles": 2},
                        {"res": 2.0, "subtiles": 4},
                        {"res": 1.0, "subtiles": 8}
                    ]
                    task_data["grid_x"] = int(grid_x)
                    task_data["grid_y"] = int(grid_y)
                    serializable_levels = []
                    for lvl in levels:
                        serializable_levels.append({
                            "res": float(lvl["res"]),
                            "subtiles": int(lvl["subtiles"])
                        })
                    task_data["levels"] = serializable_levels
                    task_obj.data = task_data
                    task_obj.save()
            self.logger.info(f"[SCAN] Loaded task: {task_id}, start_coordinates={task.get('start_coordinates')}, range={task.get('range')}")
            
            # Check for existing progress to resume from
            resume_progress = task.get("progress")
            if resume_progress:
                self.logger.info(f"[SCAN] Found existing progress for task {task_id}: {resume_progress}")
                resume_level = resume_progress.get("level", 0)
                resume_coarse_row = resume_progress.get("coarse_row", 0)
                resume_coarse_col = resume_progress.get("coarse_col", 0)
                resume_subtile_row = resume_progress.get("subtile_row", 0)
                resume_subtile_col = resume_progress.get("subtile_col", 0)
                resume_tiles_completed = resume_progress.get("tiles_completed", 0)
                self.logger.info(f"[SCAN] Resuming from level {resume_level}, tile ({resume_coarse_row}, {resume_coarse_col}), subtile ({resume_subtile_row}, {resume_subtile_col})")
            else:
                self.logger.info(f"[SCAN] No previous progress found, starting from beginning")
                resume_level = 0
                resume_coarse_row = 0
                resume_coarse_col = 0
                resume_subtile_row = 0
                resume_subtile_col = 0
                resume_tiles_completed = 0
            
            start_lat, start_lon = task["start_coordinates"]
            width_km = task["range"]["width_km"]
            height_km = task["range"]["height_km"]
            tile_km = 5
            preferred_res = task.get("preferred_resolution", 10)
            if preferred_res >= 30:
                tile_km = 10
            elif preferred_res >= 10:
                tile_km = 5
            else:
                tile_km = 2
            grid_x = max(1, int(np.ceil(width_km / tile_km)))
            grid_y = max(1, int(np.ceil(height_km / tile_km)))
            MAX_TILES = 80
            if grid_x * grid_y > MAX_TILES:
                scale = (grid_x * grid_y / MAX_TILES) ** 0.5
                grid_x = max(1, int(np.ceil(grid_x / scale)))
                grid_y = max(1, int(np.ceil(grid_y / scale)))
            levels = [
                {"res": 8.0, "subtiles": 1},
                {"res": 4.0, "subtiles": 2},
                {"res": 2.0, "subtiles": 4},
                {"res": 1.0, "subtiles": 8}
            ]
            total_tiles = sum((grid_x * grid_y) * (level["subtiles"] ** 2) for level in levels)
            # Compute bounds for frontend compatibility
            if height_km >= 0:
                north_lat = start_lat + height_km / 2 / 111
                south_lat = start_lat - height_km / 2 / 111
            else:
                north_lat = start_lat
                south_lat = start_lat
            lats = np.linspace(north_lat, south_lat, grid_y + 1)
            mean_lat_rad = np.deg2rad((north_lat + south_lat) / 2)
            lon_scale = np.cos(mean_lat_rad)
            if lon_scale < 1e-6:
                lon_scale = 1e-6
            lons = np.linspace(start_lon, start_lon + width_km / (111 * lon_scale), grid_x + 1)
            # Add bounds for frontend: [[south_lat, west_lon], [north_lat, east_lon]]
            bounds = [[float(lats[-1]), float(lons[0])], [float(lats[0]), float(lons[-1])]]
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(frontend_backend_messenger.send_message({
                    "type": "grid_info", "grid_x": grid_x, "grid_y": grid_y, "total_tiles": total_tiles, "task_id": task_id, "bounds": bounds
                }))
            finally:
                loop.close()
            if height_km >= 0:
                north_lat = start_lat + height_km / 2 / 111
                south_lat = start_lat - height_km / 2 / 111
            else:
                north_lat = start_lat
                south_lat = start_lat
            lats = np.linspace(north_lat, south_lat, grid_y + 1)
            mean_lat_rad = np.deg2rad((north_lat + south_lat) / 2)
            lon_scale = np.cos(mean_lat_rad)
            if lon_scale < 1e-6:
                lon_scale = 1e-6
            lons = np.linspace(start_lon, start_lon + width_km / (111 * lon_scale), grid_x + 1)
            factory = LidarMapFactory()
            for level_idx, level in enumerate(levels):
                # Skip levels that have already been completed
                if level_idx < resume_level:
                    self.logger.info(f"[SCAN] Skipping completed level {level_idx}")
                    continue
                
                self.logger.info(f"[SCAN] Starting level {level_idx} (res={level['res']}, subtiles={level['subtiles']})")
                if stop_event.is_set():
                    self.logger.info(f"[SCAN] Stop event set for task_id={task_id}, breaking out of scan loop.")
                    break
                res = level["res"]
                subtiles_per_side = level["subtiles"]
                img_w = grid_x * subtiles_per_side
                img_h = grid_y * subtiles_per_side
                snapshot_img = Image.new("RGB", (img_w, img_h), color="#888888")
                # --- Patch: Accumulate elevation values for grayscale PNG ---
                elev_map = np.full((img_h, img_w), np.nan, dtype=np.float32)
                # --- Improvement: Make upload frequency configurable ---
                import os
                PROGRESSIVE_UPLOAD_EVERY = int(os.getenv("LIDAR_PROGRESSIVE_UPLOAD_EVERY", "100"))
                tiles_since_last_upload = 0
                # --- Improvement: Track georeferencing for metadata ---
                georef = {
                    "north_lat": float(north_lat),
                    "south_lat": float(south_lat),
                    "west_lon": float(start_lon),
                    "east_lon": float(lons[-1]),
                    "img_w": img_w,
                    "img_h": img_h,
                    "level": int(level_idx),
                    "res": float(res),
                    "subtiles_per_side": int(subtiles_per_side),
                    "grid_x": int(grid_x),
                    "grid_y": int(grid_y)
                }
                for coarse_row in range(grid_y):
                    real_coarse_row = coarse_row
                    for coarse_col in range(grid_x):
                        # Skip completed tiles if we're resuming at the same level
                        if level_idx == resume_level and coarse_row < resume_coarse_row:
                            if coarse_row == 0 and coarse_col == 0:  # Only log once
                                self.logger.info(f"[SCAN] Skipping completed rows 0-{resume_coarse_row-1} in level {level_idx}")
                            continue
                        if level_idx == resume_level and coarse_row == resume_coarse_row and coarse_col < resume_coarse_col:
                            if coarse_col == 0:  # Only log once
                                self.logger.info(f"[SCAN] Skipping completed cols 0-{resume_coarse_col-1} in row {coarse_row}, level {level_idx}")
                            continue
                            
                        tile_lat0 = lats[real_coarse_row]
                        tile_lon0 = lons[coarse_col]
                        tile_lat1 = lats[real_coarse_row+1]
                        tile_lon1 = lons[coarse_col+1]
                        for subtile_row in range(subtiles_per_side):
                            real_subtile_row = subtile_row
                            for subtile_col in range(subtiles_per_side):
                                # Skip completed subtiles if we're resuming at the same tile
                                if (level_idx == resume_level and coarse_row == resume_coarse_row and 
                                    coarse_col == resume_coarse_col and subtile_row < resume_subtile_row):
                                    continue
                                if (level_idx == resume_level and coarse_row == resume_coarse_row and 
                                    coarse_col == resume_coarse_col and subtile_row == resume_subtile_row and 
                                    subtile_col <= resume_subtile_col):
                                    continue
                                
                                # Log when we start processing after resume
                                if (level_idx == resume_level and coarse_row == resume_coarse_row and 
                                    coarse_col == resume_coarse_col and subtile_row == resume_subtile_row and 
                                    subtile_col == resume_subtile_col + 1):
                                    self.logger.info(f"[SCAN] Resuming scan processing at level {level_idx}, tile ({coarse_row}, {coarse_col}), subtile ({subtile_row}, {subtile_col})")
                                if stop_event.is_set():
                                    self.logger.info(f"[SCAN] Stop event set for task_id={task_id}, exiting inner scan loop.")
                                    return
                                
                                # Resource throttling: yield control periodically
                                tile_index_throttle = (coarse_row * grid_x * subtiles_per_side * subtiles_per_side + 
                                                     coarse_col * subtiles_per_side * subtiles_per_side + 
                                                     subtile_row * subtiles_per_side + subtile_col)
                                
                                if tile_index_throttle % self.batch_size == 0:
                                    # Yield control to allow other threads/processes
                                    time.sleep(self.tile_processing_delay)
                                    
                                    # Process queued WebSocket messages in batches
                                    self._flush_websocket_queue()
                                    
                                    # Check for stop event more frequently during yielding
                                    if stop_event.is_set():
                                        self.logger.info(f"[SCAN] Stop event detected during throttling for task_id={task_id}")
                                        return
                                frac_y0 = real_subtile_row / subtiles_per_side
                                frac_y1 = (real_subtile_row + 1) / subtiles_per_side
                                frac_x0 = subtile_col / subtiles_per_side
                                frac_x1 = (subtile_col + 1) / subtiles_per_side
                                subtile_lat0 = tile_lat0 + (tile_lat1 - tile_lat0) * frac_y0
                                subtile_lat1 = tile_lat0 + (tile_lat1 - tile_lat0) * frac_y1
                                subtile_lon0 = tile_lon0 + (tile_lon1 - tile_lon0) * frac_x0
                                subtile_lon1 = tile_lon0 + (tile_lon1 - tile_lon0) * frac_x1
                                cache_key = f"tasks/{task_id}/cache/subtile_data/level_{level_idx}/tile_{coarse_row}_{coarse_col}/subtile_{subtile_row}_{subtile_col}.json"
                                if blob_exists(bucket, cache_key):
                                    cached_bytes = safe_download_blob(bucket, cache_key, logger=self.logger)
                                    try:
                                        cached = json.loads(cached_bytes.decode("utf-8"))
                                    except Exception:
                                        cached = None
                                    if isinstance(cached, dict):
                                        elev = cached.get("elevation")
                                        color = cached.get("color")
                                        dataset = cached.get("dataset")
                                        lat = cached.get("lat")
                                        lon = cached.get("lon")
                                        if lat is None or lon is None:
                                            frac_y = (subtile_row + 0.5) / subtiles_per_side
                                            frac_x = (subtile_col + 0.5) / subtiles_per_side
                                            lat = tile_lat0 + (tile_lat1 - tile_lat0) * frac_y
                                            lon = tile_lon0 + (tile_lon1 - tile_lon0) * frac_x
                                            cached["lat"] = lat
                                            cached["lon"] = lon
                                            upload_blob(bucket, cache_key, json.dumps(cached).encode("utf-8"), content_type="application/json")
                                        subtile_lat0_out = tile_lat0 + (tile_lat1 - tile_lat0) * (subtile_row / subtiles_per_side)
                                        subtile_lat1_out = tile_lat0 + (tile_lat1 - tile_lat0) * ((subtile_row + 1) / subtiles_per_side)
                                        subtile_lon0_out = tile_lon0 + (tile_lon1 - tile_lon0) * (subtile_col / subtiles_per_side)
                                        subtile_lon1_out = tile_lon0 + (tile_lon1 - tile_lon0) * ((subtile_col + 1) / subtiles_per_side)
                                        if not all(k in cached for k in ["subtile_lat0","subtile_lat1","subtile_lon0","subtile_lon1"]):
                                            cached["subtile_lat0"] = subtile_lat0_out
                                            cached["subtile_lat1"] = subtile_lat1_out
                                            cached["subtile_lon0"] = subtile_lon0_out
                                            cached["subtile_lon1"] = subtile_lon1_out
                                            upload_blob(bucket, cache_key, json.dumps(cached).encode("utf-8"), content_type="application/json")
                                    else:
                                        elev = None
                                        color = None
                                        dataset = None
                                        frac_y = (subtile_row + 0.5) / subtiles_per_side
                                        frac_x = (subtile_col + 0.5) / subtiles_per_side
                                        lat = tile_lat0 + (tile_lat1 - tile_lat0) * frac_y
                                        lon = tile_lon0 + (tile_lon1 - tile_lon0) * frac_x
                                else:
                                    frac_y = (subtile_row + 0.5) / subtiles_per_side
                                    frac_x = (subtile_col + 0.5) / subtiles_per_side
                                    lat = tile_lat0 + (tile_lat1 - tile_lat0) * frac_y
                                    lon = tile_lon0 + (tile_lon1 - tile_lon0) * frac_x
                                    patch_size = 40 / subtiles_per_side
                                    patch_res = res
                                    patch = factory.get_patch(lat, lon, size_m=patch_size, preferred_resolution_m=patch_res, preferred_data_type="DSM")
                                    dataset = patch.source_dataset if patch else None
                                    elev = float(np.nanmean(patch.data)) if patch and patch.data is not None else 0
                                    color = self.elevation_to_color(elev)
                                    cache_data = {
                                        "elevation": elev if elev is not None else 0,
                                        "color": color,
                                        "dataset": dataset,
                                        "lat": lat,
                                        "lon": lon,
                                        "subtile_lat0": subtile_lat0,
                                        "subtile_lat1": subtile_lat1,
                                        "subtile_lon0": subtile_lon0,
                                        "subtile_lon1": subtile_lon1
                                    }
                                    upload_blob(bucket, cache_key, json.dumps(cache_data).encode("utf-8"), content_type="application/json")
                                # --- Patch: Write elevation value to elev_map for grayscale PNG ---
                                # Map subtile position to pixel in elev_map
                                px = coarse_col * subtiles_per_side + subtile_col
                                py = coarse_row * subtiles_per_side + subtile_row
                                if 0 <= py < img_h and 0 <= px < img_w:
                                    elev_map[py, px] = elev if elev is not None else np.nan
                                # Queue WebSocket message for batch processing
                                message = {
                                    "type": "lidar_tile",
                                    "coarse_row": coarse_row,
                                    "coarse_col": coarse_col,
                                    "subtile_row": subtile_row,
                                    "subtile_col": subtile_col,
                                    "subtiles_per_side": subtiles_per_side,
                                    "level": level_idx,
                                    "elevation": float(elev) if elev is not None else 0,
                                    "color": color,
                                    "dataset": dataset,
                                    "resolution": res,
                                    "lat": float(lat),
                                    "lon": float(lon),
                                    "subtile_lat0": float(subtile_lat0),
                                    "subtile_lat1": float(subtile_lat1),
                                    "subtile_lon0": float(subtile_lon0),
                                    "subtile_lon1": float(subtile_lon1),
                                    "task_id": task_id
                                }
                                self._queue_websocket_message(message)
                                # --- Progress tracking and update ---
                                # Calculate tile index for progress
                                tile_index = (
                                    level_idx * (grid_x * grid_y * subtiles_per_side * subtiles_per_side)
                                    + coarse_row * (grid_x * subtiles_per_side * subtiles_per_side)
                                    + coarse_col * (subtiles_per_side * subtiles_per_side)
                                    + subtile_row * subtiles_per_side
                                    + subtile_col
                                )
                                tiles_completed = tile_index + 1
                                progress_overall = 100.0 * tiles_completed / total_tiles
                                # Update task profile JSON in GCS
                                try:
                                    # Download latest task JSON (avoid race, but this is best-effort)
                                    task_bytes = safe_download_blob(bucket, task_blob_path, logger=self.logger)
                                    if task_bytes:
                                        task_profile = json.loads(task_bytes.decode("utf-8"))
                                    else:
                                        task_profile = {}
                                    # Update progress and grid info
                                    task_profile["progress"] = {
                                        "overall": progress_overall,
                                        "tiles_completed": tiles_completed,
                                        "total_tiles": total_tiles,
                                        "level": int(level_idx),
                                        "coarse_row": int(coarse_row),
                                        "coarse_col": int(coarse_col),
                                        "subtile_row": int(subtile_row),
                                        "subtile_col": int(subtile_col)
                                    }
                                    task_profile["grid_x"] = int(grid_x)
                                    task_profile["grid_y"] = int(grid_y)
                                    # Ensure levels is serializable (list of dicts with only serializable values)
                                    serializable_levels = []
                                    for lvl in levels:
                                        serializable_levels.append({
                                            "res": float(lvl["res"]),
                                            "subtiles": int(lvl["subtiles"])
                                        })
                                    task_profile["levels"] = serializable_levels
                                    # Optionally update status
                                    task_profile["status"] = "running"
                                    upload_blob(bucket, task_blob_path, json.dumps(task_profile).encode("utf-8"), content_type="application/json")
                                except Exception as e:
                                    self.logger.warning(f"[SCAN] Failed to update progress for {task_id}: {e}")
                # --- After all subtiles for this level, save PNG and metadata to GCS ---
                # Patch: Normalize elev_map and save as grayscale PNG
                valid = ~np.isnan(elev_map)
                if np.any(valid):
                    min_elev = np.nanmin(elev_map)
                    max_elev = np.nanmax(elev_map)
                    if max_elev > min_elev:
                        norm = (elev_map - min_elev) / (max_elev - min_elev)
                    else:
                        norm = np.zeros_like(elev_map)
                    img_arr = (255 * np.nan_to_num(norm)).astype(np.uint8)
                else:
                    img_arr = np.zeros_like(elev_map, dtype=np.uint8)
                img_gray = Image.fromarray(img_arr, mode='L')
                with BytesIO() as buf:
                    img_gray.save(buf, format="PNG")
                    buf.seek(0)
                    png_path = f"tasks/{task_id}/snapshots/level_{level_idx}_gray.png"
                    upload_blob(bucket, png_path, buf.read(), content_type="image/png")
                # --- New: Save color PNG using elevation_to_color with normalization ---
                if np.any(valid):
                    min_elev = np.nanmin(elev_map)
                    max_elev = np.nanmax(elev_map)
                else:
                    min_elev = 0
                    max_elev = 1
                color_img_arr = np.zeros((img_h, img_w, 3), dtype=np.uint8)
                for y in range(img_h):
                    for x in range(img_w):
                        elev = elev_map[y, x]
                        color = self.elevation_to_color(elev, min_elev, max_elev)
                        color_img_arr[y, x] = color
                img_color = Image.fromarray(color_img_arr, mode='RGB')
                with BytesIO() as buf:
                    img_color.save(buf, format="PNG")
                    buf.seek(0)
                    png_path = f"tasks/{task_id}/snapshots/level_{level_idx}_color.png"
                    upload_blob(bucket, png_path, buf.read(), content_type="image/png")
                meta_path = f"tasks/{task_id}/snapshots/level_{level_idx}_meta.json"
                upload_blob(bucket, meta_path, json.dumps(georef).encode("utf-8"), content_type="application/json")
                self.logger.info(f"[SCAN] Saved PNG snapshot and metadata for level {level_idx} to {png_path}")
                # Final flush of any remaining messages
                self._flush_websocket_queue()
                
                # Longer pause between levels to allow system recovery
                time.sleep(0.5)
            # End of for level_idx, level in enumerate(levels)

            # Final cleanup
            self._flush_websocket_queue()
            time.sleep(0.2)

            # --- Mark task as completed in upstream JSON ---
            try:
                task_bytes = safe_download_blob(bucket, task_blob_path, logger=self.logger)
                if task_bytes:
                    task_profile = json.loads(task_bytes.decode("utf-8"))
                else:
                    task_profile = {}
                import datetime
                task_profile["status"] = "completed"
                task_profile["completed_at"] = datetime.datetime.utcnow().isoformat() + "Z"
                upload_blob(bucket, task_blob_path, json.dumps(task_profile).encode("utf-8"), content_type="application/json")
                self.logger.info(f"[SCAN] Task {task_id} marked as completed.")
                # Also update upstream task_obj if available
                if self.parent_task_manager:
                    task_obj = self.parent_task_manager.get_task(task_id)
                    if task_obj:
                        task_obj.data["status"] = "completed"
                        task_obj.data["completed_at"] = task_profile["completed_at"]
                        task_obj.save()
                        self.logger.info(f"[SCAN] Upstream task_obj for {task_id} marked as completed.")
            except Exception as e:
                self.logger.warning(f"[SCAN] Failed to mark task {task_id} as completed: {e}")

        except Exception as e:
            self.logger.error(f"[SCAN] Exception during scan for task_id={task_id}: {e}")
            # Use new event loop in thread to avoid blocking
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(frontend_backend_messenger.send_message({
                    "type": "error", "message": f"Exception during scan: {e}", "task_id": task_id
                }))
            finally:
                loop.close()
            raise  # Re-raise to let _cleanup_session handle it

    async def stop_scan(self, task_id: str, on_stopped_callback=None):
        """Stop a running LiDAR scan session."""
        session_data = self.active_sessions.get(task_id)
        if not session_data:
            self.logger.warning(f"[SCAN] No active session found for task_id={task_id}")
            return False
        
        if on_stopped_callback:
            self.session_stopped_callbacks[task_id] = on_stopped_callback
        
        # Set stop event
        stop_event = session_data['stop_event']
        stop_event.set()
        
        # Cancel the background task
        task = session_data.get('task')
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                self.logger.info(f"[SCAN] Task {task_id} cancelled successfully")
        
        self.logger.info(f"[SCAN] Stop requested for task_id={task_id}")
        return True

    async def stop_all_scans(self):
        """Stop all active LiDAR scan sessions."""
        self.logger.info("[SCAN] Stopping all active lidar scan sessions.")
        tasks = []
        for task_id in list(self.active_sessions.keys()):
            tasks.append(self.stop_scan(task_id))
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        
        self.logger.info(f"[SCAN] Stopped {len(tasks)} active sessions")
    
    def get_active_sessions(self):
        """Get list of active session IDs."""
        return list(self.active_sessions.keys())
    
    def is_session_active(self, task_id: str):
        """Check if a session is currently active."""
        return task_id in self.active_sessions
    
    def get_session_info(self, task_id: str):
        """Get information about a specific session."""
        session_data = self.active_sessions.get(task_id)
        if not session_data:
            return None
        
        task = session_data.get('task')
        return {
            'task_id': task_id,
            'started_at': session_data.get('started_at'),
            'is_running': task and not task.done() if task else False,
            'is_cancelled': task.cancelled() if task else False,
            'exception': str(task.exception()) if task and task.exception() else None
        }
    
    def _queue_websocket_message(self, message):
        """Queue a WebSocket message for batch processing."""
        with self.ws_queue_lock:
            self.ws_message_queue.append(message)
    
    def _flush_websocket_queue(self):
        """Flush queued WebSocket messages in batches."""
        messages_to_send = []
        with self.ws_queue_lock:
            if self.ws_message_queue:
                messages_to_send = self.ws_message_queue[:self.websocket_batch_size]
                self.ws_message_queue = self.ws_message_queue[self.websocket_batch_size:]
        
        if messages_to_send:
            # Send messages in a separate thread to avoid blocking
            threading.Thread(
                target=self._send_websocket_messages_sync,
                args=(messages_to_send,),
                daemon=True
            ).start()
    
    def _send_websocket_messages_sync(self, messages):
        """Send WebSocket messages synchronously in a separate thread."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            for message in messages:
                try:
                    loop.run_until_complete(frontend_backend_messenger.send_message(message))
                except Exception as e:
                    self.logger.warning(f"[SCAN] Failed to send WebSocket message: {e}")
        finally:
            loop.close()
    
    def get_resource_stats(self):
        """Get current resource usage statistics."""
        return {
            'active_sessions': len(self.active_sessions),
            'max_concurrent_scans': self.max_concurrent_scans,
            'tile_processing_delay': self.tile_processing_delay,
            'batch_size': self.batch_size,
            'websocket_batch_size': self.websocket_batch_size,
            'queued_messages': len(self.ws_message_queue)
        }
    
    def __del__(self):
        """Cleanup thread pool on destruction."""
        if hasattr(self, 'scan_executor'):
            self.scan_executor.shutdown(wait=False)

    def elevation_to_color(self, elev, min_elev=None, max_elev=None):
        """
        Map elevation to an RGB tuple for color visualization.
        If min_elev/max_elev are not provided, use default range.
        """
        if min_elev is None or max_elev is None or min_elev == max_elev:
            min_elev, max_elev = 0, 1
        # Normalize elevation
        try:
            t = (float(elev) - min_elev) / (max_elev - min_elev)
        except Exception:
            t = 0.5
        t = max(0.0, min(1.0, t))
        # Simple colormap: blue (low) to magenta (high)
        r = int(255 * t)
        g = int(180 * (1 - t))
        b = int(255 * (1 - t))
        return [r, g, b]

# Only instantiate the lidar_scan_task_manager if this file is not being imported by tasks.py
# (to avoid circular import). The parent should pass the TaskManager instance explicitly.
lidar_scan_task_manager = None

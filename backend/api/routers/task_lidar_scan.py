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

# Delay import to avoid circular import
system_task_manager = None

class LidarScanTaskManager:
    def __init__(self, parent_task_manager=None):
        self.parent_task_manager = parent_task_manager
        self.active_sessions = {}  # task_id -> threading.Event
        self.session_stopped_callbacks = {}  # task_id -> callback
        self.logger = logging.getLogger("backend.api.routers.task_lidar_scan")

    async def start_scan(self, task_id: str):
        self.logger.info(f"[SCAN] start_scan called for task_id={task_id}")
        stop_event = threading.Event()
        self.active_sessions[task_id] = stop_event
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._run_scan_blocking, task_id, stop_event)

    def _run_scan_blocking(self, task_id: str, stop_event: threading.Event):
        try:
            bucket = get_gcs_bucket("re_archaeology")
            task_blob_path = f"tasks/{task_id}.json"
            self.logger.info(f"[SCAN] Attempting to download task definition from {task_blob_path}")
            try:
                task_bytes = safe_download_blob(bucket, task_blob_path, logger=self.logger)
            except Exception as e:
                self.logger.error(f"[SCAN] Error downloading task file from GCS: {e}")
                asyncio.run(frontend_backend_messenger.send_message({
                    "type": "error", "message": f"Error downloading task file from GCS: {e}", "task_id": task_id
                }))
                return
            if not task_bytes:
                self.logger.info(f"[SCAN] Task file not found in GCS: {task_id}")
                asyncio.run(frontend_backend_messenger.send_message({
                    "type": "error", "message": f"Task file not found in GCS: {task_id}", "task_id": task_id
                }))
                return
            try:
                task = json.loads(task_bytes.decode("utf-8"))
            except Exception as e:
                self.logger.error(f"[SCAN] Failed to parse task JSON for {task_id}: {e}")
                asyncio.run(frontend_backend_messenger.send_message({
                    "type": "error", "message": f"Failed to parse task JSON for {task_id}", "task_id": task_id
                }))
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
            asyncio.run(frontend_backend_messenger.send_message({
                "type": "grid_info", "grid_x": grid_x, "grid_y": grid_y, "total_tiles": total_tiles, "task_id": task_id, "bounds": bounds
            }))
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
                        tile_lat0 = lats[real_coarse_row]
                        tile_lon0 = lons[coarse_col]
                        tile_lat1 = lats[real_coarse_row+1]
                        tile_lon1 = lons[coarse_col+1]
                        for subtile_row in range(subtiles_per_side):
                            real_subtile_row = subtile_row
                            for subtile_col in range(subtiles_per_side):
                                if stop_event.is_set():
                                    self.logger.info(f"[SCAN] Stop event set for task_id={task_id}, exiting inner scan loop.")
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
                                asyncio.run(frontend_backend_messenger.send_message({
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
                                }))
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
                threading.Event().wait(0.002)
            threading.Event().wait(0.1)
        except Exception as e:
            self.logger.error(f"[SCAN] Exception during scan for task_id={task_id}: {e}")
            asyncio.run(frontend_backend_messenger.send_message({
                "type": "error", "message": f"Exception during scan: {e}", "task_id": task_id
            }))
        finally:
            self.logger.info(f"[SCAN] Cleaning up session for task_id={task_id}")
            self.active_sessions.pop(task_id, None)
            callback = self.session_stopped_callbacks.pop(task_id, None)
            if callback:
                try:
                    callback(task_id)
                except Exception as cb_exc:
                    self.logger.warning(f"[SCAN] Exception in session stopped callback for {task_id}: {cb_exc}")

    def stop_scan(self, task_id: str, on_stopped_callback=None):
        stop_event = self.active_sessions.get(task_id)
        if stop_event:
            if on_stopped_callback:
                self.session_stopped_callbacks[task_id] = on_stopped_callback
            stop_event.set()

    def stop_all_scans(self):
        self.logger.info("[SCAN] Stopping all active lidar scan sessions.")
        for task_id in list(self.active_sessions.keys()):
            self.stop_scan(task_id)

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

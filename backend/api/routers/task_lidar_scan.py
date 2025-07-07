import asyncio
import json
from backend.api.routers.messenger_websocket import frontend_backend_messenger
import numpy as np
from lidar_factory.factory import LidarMapFactory
from backend.utils.gcs_utils import get_gcs_bucket, upload_blob, download_blob, blob_exists
import logging

class LidarScanTaskManager:
    def __init__(self):
        self.active_sessions = {}  # task_id -> asyncio.Event
        self.logger = logging.getLogger("backend.api.routers.task_lidar_scan")

    async def start_scan(self, task_id: str):
        self.logger.info(f"[SCAN] start_scan called for task_id={task_id}")
        stop_event = asyncio.Event()
        self.active_sessions[task_id] = stop_event
        bucket = get_gcs_bucket("re_archaeology")
        task_blob_path = f"tasks/{task_id}.json"
        self.logger.info(f"[SCAN] Attempting to download task definition from {task_blob_path}")
        task_bytes = download_blob(bucket, task_blob_path)
        if not task_bytes:
            self.logger.error(f"[SCAN] Task file not found in GCS: {task_id}")
            await frontend_backend_messenger.send_message({
                "type": "error", "message": f"Task file not found in GCS: {task_id}", "task_id": task_id
            })
            return
        try:
            task = json.loads(task_bytes.decode("utf-8"))
        except Exception as e:
            self.logger.error(f"[SCAN] Failed to parse task JSON for {task_id}: {e}")
            await frontend_backend_messenger.send_message({
                "type": "error", "message": f"Failed to parse task JSON for {task_id}", "task_id": task_id
            })
            return
        self.logger.info(f"[SCAN] Loaded task: {task_id}, start_coordinates={task.get('start_coordinates')}, range={task.get('range')}")
        start_lat, start_lon = task["start_coordinates"]
        width_km = task["range"]["width_km"]
        height_km = task["range"]["height_km"]
        tile_km = 5
        # --- Dynamic grid sizing ---
        preferred_res = task.get("preferred_resolution", 10)
        if preferred_res >= 30:
            tile_km = 10
        elif preferred_res >= 10:
            tile_km = 5
        else:
            tile_km = 2
        # Use ceil to ensure full coverage of the scan rectangle
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
        self.logger.info(f"[SCAN] grid_x={grid_x}, grid_y={grid_y}, total_tiles={total_tiles}")
        await frontend_backend_messenger.send_message({
            "type": "grid_info", "grid_x": grid_x, "grid_y": grid_y, "total_tiles": total_tiles, "task_id": task_id
        })
        # Use grid_y+1 and grid_x+1 to ensure all tile edges are covered and tile bounds are valid
        lats = np.linspace(start_lat, start_lat + height_km / 111, grid_y + 1)
        lons = np.linspace(start_lon, start_lon + width_km / (111 * 0.7), grid_x + 1)
        factory = LidarMapFactory()
        bucket = get_gcs_bucket("re_archaeology")
        # Function to convert elevation to color
        def elevation_to_color(elev):
            if elev is None:
                return '#888888'
            if elev < 0: return '#006633'
            if elev < 10: return '#E5FFCC'
            if elev < 50: return '#662A00'
            if elev < 100: return '#D8D8D8'
            return '#F5F5F5'
        try:
            for level_idx, level in enumerate(levels):
                self.logger.info(f"[SCAN] Starting level {level_idx} (res={level['res']}, subtiles={level['subtiles']})")
                if stop_event.is_set():
                    self.logger.info(f"[SCAN] Stop event set for task_id={task_id}, breaking out of scan loop.")
                    break
                res = level["res"]
                subtiles_per_side = level["subtiles"]
                for coarse_row in range(grid_y):
                    for coarse_col in range(grid_x):
                        tile_lat0 = lats[coarse_row]
                        tile_lon0 = lons[coarse_col]
                        tile_lat1 = lats[coarse_row+1]
                        tile_lon1 = lons[coarse_col+1]
                        for subtile_row in range(subtiles_per_side):
                            for subtile_col in range(subtiles_per_side):
                                # GCS cache key for this subtile
                                cache_key = f"tasks/{task_id}/cache/subtile_data/level_{level_idx}/tile_{coarse_row}_{coarse_col}/subtile_{subtile_row}_{subtile_col}.json"
                                # Try to load from GCS cache
                                if blob_exists(bucket, cache_key):
                                    cached_bytes = download_blob(bucket, cache_key)
                                    try:
                                        cached = json.loads(cached_bytes.decode("utf-8"))
                                    except Exception:
                                        cached = None
                                    if isinstance(cached, dict):
                                        elev = cached.get("elevation")
                                        color = cached.get("color")
                                        dataset = cached.get("dataset")
                                    else:
                                        elev = None
                                        color = None
                                        dataset = None
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
                                    color = elevation_to_color(elev)
                                    cache_data = {
                                        "elevation": elev if elev is not None else 0,
                                        "color": color,
                                        "dataset": dataset
                                    }
                                    upload_blob(bucket, cache_key, json.dumps(cache_data).encode("utf-8"), content_type="application/json")
                                await frontend_backend_messenger.send_message({
                                    "type": "lidar_tile",
                                    "coarse_row": coarse_row,
                                    "coarse_col": coarse_col,
                                    "subtile_row": subtile_row,
                                    "subtile_col": subtile_col,
                                    "subtiles_per_side": subtiles_per_side,
                                    "level": level_idx,
                                    "elevation": elev if elev is not None else 0,
                                    "color": color,
                                    "dataset": dataset,
                                    "resolution": res,
                                    "task_id": task_id
                                })
                        await asyncio.sleep(0.002)
                await asyncio.sleep(0.1)
            self.logger.info(f"[SCAN] Finished all levels for task_id={task_id}, sending done message.")
            await frontend_backend_messenger.send_message({"type": "done", "task_id": task_id})
        except Exception as e:
            self.logger.error(f"[SCAN] Exception during scan for task_id={task_id}: {e}")
            await frontend_backend_messenger.send_message({
                "type": "error", "message": f"Exception during scan: {e}", "task_id": task_id
            })
        finally:
            self.logger.info(f"[SCAN] Cleaning up session for task_id={task_id}")
            self.active_sessions.pop(task_id, None)

    def stop_scan(self, task_id: str):
        stop_event = self.active_sessions.get(task_id)
        if stop_event:
            stop_event.set()

lidar_scan_task_manager = LidarScanTaskManager()

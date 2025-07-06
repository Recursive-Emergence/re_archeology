import json
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from pathlib import Path
import numpy as np
from lidar_factory.factory import LidarMapFactory
import os
import json as pyjson
from backend.utils.gcs_utils import get_gcs_bucket, upload_blob, download_blob, blob_exists
import time

router = APIRouter()

def elevation_to_color(elev):
    if elev is None:
        return '#888888'
    if elev < 0: return '#006633'
    if elev < 10: return '#E5FFCC'
    if elev < 50: return '#662A00'
    if elev < 100: return '#D8D8D8'
    return '#F5F5F5'

@router.websocket("/ws/demo-tiles")
async def ws_demo_tiles(websocket: WebSocket, task_id: str = Query(...)):
    print("WebSocket connection open", flush=True)
    await websocket.accept()
    try:
        print(f"[WS] Loading task file for task_id={task_id} ...", flush=True)
        task_path = Path(__file__).parent.parent.parent.parent / "data" / "tasks" / f"{task_id}.json"
        if not task_path.exists():
            print(f"[WS] Task file not found: {task_path}", flush=True)
            await websocket.send_json({"type": "error", "message": f"Task file not found: {task_id}"})
            await websocket.close(code=4004, reason="Task file not found")
            return
        with open(task_path) as f:
            task = json.load(f)
        print("[WS] Task loaded:", task, flush=True)
        start_lat, start_lon = task["start_coordinates"]
        width_km = task["range"]["width_km"]
        height_km = task["range"]["height_km"]
        # --- Dynamic grid sizing ---
        available_res = task.get("preferred_resolution", 10)  # or detect from data
        if available_res >= 30:
            tile_km = 10
        elif available_res >= 10:
            tile_km = 5
        else:
            tile_km = 2
        grid_x = max(1, round(width_km / tile_km))
        grid_y = max(1, round(height_km / tile_km))
        MAX_TILES = 80
        if grid_x * grid_y > MAX_TILES:
            scale = (grid_x * grid_y / MAX_TILES) ** 0.5
            grid_x = max(1, round(grid_x / scale))
            grid_y = max(1, round(grid_y / scale))
        print(f"[WS] Using grid_x={grid_x}, grid_y={grid_y} for region {width_km}x{height_km} km", flush=True)
        # Compute total number of tile messages for all levels
        levels = [
            {"res": 8.0, "subtiles": 1},
            {"res": 4.0, "subtiles": 2},
            {"res": 2.0, "subtiles": 4},
            {"res": 1.0, "subtiles": 8}
        ]
        total_tiles = 0
        for level in levels:
            subtiles = level["subtiles"]
            total_tiles += (grid_x * grid_y) * (subtiles ** 2)
        # Send grid info to frontend for dynamic grid rendering and progress
        await websocket.send_json({
            "type": "grid_info",
            "grid_x": grid_x,
            "grid_y": grid_y,
            "total_tiles": total_tiles
        })
        lats = np.linspace(start_lat, start_lat + height_km / 111, grid_y)
        lons = np.linspace(start_lon, start_lon + width_km / (111 * 0.7), grid_x)
        factory = LidarMapFactory()
        bucket = get_gcs_bucket("re_archaeology")
        # Progressive resolution levels (coarse to fine)
        levels = [
            {"res": 8.0, "subtiles": 1},
            {"res": 4.0, "subtiles": 2},
            {"res": 2.0, "subtiles": 4},
            {"res": 1.0, "subtiles": 8}
        ]

        async def heartbeat_task():
            try:
                while True:
                    await asyncio.sleep(1.0)
                    await websocket.send_json({"type": "heartbeat"})
            except Exception:
                pass  # Ignore errors if websocket closes

        heartbeat = asyncio.create_task(heartbeat_task())
        try:
            print(f"[WS] Starting progressive tile streaming loop ...", flush=True)
            for level_idx, level in enumerate(levels):
                res = level["res"]
                subtiles_per_side = level["subtiles"]
                print(f"[WS] Streaming level {level_idx} at {res}m, {subtiles_per_side}x{subtiles_per_side} subtiles per tile", flush=True)
                for coarse_row in range(grid_y):
                    for coarse_col in range(grid_x):
                        tile_lat0 = lats[coarse_row]
                        tile_lon0 = lons[coarse_col]
                        tile_lat1 = lats[coarse_row+1] if coarse_row+1 < grid_y else lats[coarse_row]
                        tile_lon1 = lons[coarse_col+1] if coarse_col+1 < grid_x else lons[coarse_col]
                        # Batch all subtiles for this tile
                        subtile_msgs = []
                        for subtile_row in range(subtiles_per_side):
                            for subtile_col in range(subtiles_per_side):
                                # Use legacy path for cache key
                                cache_key = f"tasks/{task_id}/cache/subtile_data/level_{level_idx}/tile_{coarse_row}_{coarse_col}/subtile_{subtile_row}_{subtile_col}.json"
                                # --- GCS cache read ---
                                if blob_exists(bucket, cache_key):
                                    cached_bytes = download_blob(bucket, cache_key)
                                    try:
                                        cached = pyjson.loads(cached_bytes.decode("utf-8"))
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
                                    # Interpolate lat/lon for subtile center
                                    frac_y = (subtile_row + 0.5) / subtiles_per_side
                                    frac_x = (subtile_col + 0.5) / subtiles_per_side
                                    lat = tile_lat0 + (tile_lat1 - tile_lat0) * frac_y
                                    lon = tile_lon0 + (tile_lon1 - tile_lon0) * frac_x
                                    patch_size = 40 / subtiles_per_side
                                    patch_res = res
                                    patch = factory.get_patch(lat, lon, size_m=patch_size, preferred_resolution_m=patch_res, preferred_data_type="DSM")
                                    dataset = patch.source_dataset if patch else None
                                    elev = float(np.nanmean(patch.data)) if patch and patch.data is not None else None
                                    color = elevation_to_color(elev)
                                    # Save to demo GCS cache as JSON bytes
                                    cache_data = {
                                        "elevation": elev if elev is not None else 0,
                                        "color": color,
                                        "dataset": dataset
                                    }
                                    upload_blob(bucket, cache_key, pyjson.dumps(cache_data).encode("utf-8"), content_type="application/json")
                                subtile_msgs.append({
                                    "type": "tile",
                                    "coarse_row": coarse_row,
                                    "coarse_col": coarse_col,
                                    "subtile_row": subtile_row,
                                    "subtile_col": subtile_col,
                                    "subtiles_per_side": subtiles_per_side,
                                    "level": level_idx,
                                    "elevation": elev if elev is not None else 0,
                                    "color": color,
                                    "resolution": res,
                                    "dataset": dataset
                                })
                        # Send all subtiles for this tile at once
                        for msg in subtile_msgs:
                            await websocket.send_json(msg)
                        await asyncio.sleep(0.002)
                await asyncio.sleep(0.1)
            await websocket.send_json({"type": "done"})
            print("[WS] All tiles sent.", flush=True)
        finally:
            heartbeat.cancel()
    except Exception as e:
        print(f"[WS] WebSocket error: {e}", flush=True)
        await websocket.close(code=1011, reason=str(e))
    finally:
        print("[WS] connection closed", flush=True)

        # Example: Save overlay/metadata to GCS for this task
        # (You can place this where you generate overlays or session metadata)
        # overlay_data = {"some": "data"}
        # overlay_blob_path = f"task_overlays/{task_id}/overlay_example.json"
        # bucket = get_gcs_bucket("re_archaeology")
        # upload_blob(bucket, overlay_blob_path, json.dumps(overlay_data).encode("utf-8"), content_type="application/json")
        #
        # To read it back:
        # data_bytes = download_blob(bucket, overlay_blob_path)
        # if data_bytes:
        #     loaded_overlay = json.loads(data_bytes.decode("utf-8"))

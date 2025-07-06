# Upgrade Plan: Progressive LiDAR Scan, Caching, and Visualization

## 1. Task-Centric Cache Organization
- All cache data (sightings, heatmaps, tiles, detection overlays) will be stored under a subfolder of the corresponding task in `data/tasks/{task_id}/cache/`.
- This replaces the old bitmap cache concept: all bitmap/heatmap/detection results are now session-based and task-scoped.
- Caches include:
  - Progressive LiDAR scan snapshots (multi-resolution heatmaps)
  - Detection overlays (e.g., structure detections, masks)
  - Tiled images for high-res/zoomed-in views
  - Metadata for cache management and frontend rendering

**Example Structure:**
```
data/tasks/{task_id}/
  cache/
    heatmap_20km.png
    heatmap_10km.png
    detection_overlay_10km.png
    tiles_2km/
      z{zoom}/x{col}/y{row}.png
    metadata.json
  ... (other task files)
```

## 2. Progressive Multi-Resolution LiDAR Scan & Detection
- Implement a scheduler that starts with a coarse grid and recursively subdivides for finer detail.
- Use a "hopping" or "picking" strategy: at each resolution level, select representative points spread across the region (not strictly row-by-row), so even the first snapshots provide a meaningful, global overview.
- After each scan pass, generate a full-region heatmap and cache it under the task's cache folder.
- Run detection overlays in parallel or after each scan pass, and cache overlays as images or masks.
- Always provide a snapshot for the user, interpolating missing data for a continuous visual.

## 3. Multi-Resolution Caching & Tiling
- Save each heatmap and detection overlay snapshot at its resolution in the task's cache folder.
- For high resolutions, split into map tiles and store in a `tiles_{resolution}/` subfolder.
- Store metadata for each cache (resolution, bounds, tile indices, timestamp, detection status).

## 4. Improved Elevation Heatmap Palette
- Use a perceptually meaningful color palette (e.g., `['006633', 'E5FFCC', '662A00', 'D8D8D8', 'F5F5F5']`).
- Allow palette customization and dynamic range adjustment based on the region.
- Detection overlays should use clear, non-conflicting colors for detected features.

## 5. API/Router Changes
- Remove old bitmap cache endpoints and logic.
- Add endpoints to:
  - Trigger progressive scan and detection for a region/task.
  - Fetch latest heatmap or detection overlay at a given resolution for a task.
  - Fetch individual tiles for high-res views.
  - Query available resolutions/tiles/overlays for a task.

## 6. Frontend Rendering
- Frontend should:
  - Intelligently request and display the latest available heatmap/overlay/tile for the current view/zoom.
  - Overlay detection results on top of elevation heatmaps.
  - Show loading/progress indicators as the scan and detection fill in.
  - Allow palette selection and display of elevation legends.
  - Support smooth transitions as new data arrives (progressive refinement).

## 7. Cache Management
- Implement cache eviction and cleanup policies per task.
- Optionally, allow recomputation or on-demand regeneration of missing tiles or overlays.

---

## Iterative Implementation Plan (Updated July 2025)

### Iteration 0: Minimal Real-Data Demo (COMPLETE)
- **Backend:**
  - Real-data task definition and minimal pipeline for elevation data.
  - Progressive scan, multi-resolution tiling, and smart caching (subtile JSONs).
  - Snapshot PNG endpoint for fast low-zoom rendering.
- **Frontend:**
  - Dynamic grid, progressive rendering, snapshot PNG as background, progress bar.
  - Robust WebSocket recovery and seamless grid display.
- **Goal:**
  - Fully coordinated, resumable, and scalable demo with real data and task-centric cache.

### Iteration 1: Remove Old Bitmap Cache & Refactor Backend Structure (COMPLETE)
- Legacy bitmap cache and demo heatmap code removed.
- All new caching and streaming is task/session-centric and real-data only.

### Iteration 2: Progressive LiDAR Scan, Snapshot Caching, and Smart Streaming (COMPLETE)
- Multi-resolution scan with hopping strategy, streaming tiles/subtiles at all levels.
- Each subtile cached as JSON for fast recovery and resumability.
- Snapshot PNG endpoint for each level.
- Frontend overlays live tiles on snapshot, with accurate progress bar.

### Iteration 3: Detection Overlay Generation & Caching (NEXT)
- **Backend:**
  - Swtich to cloud storage for application datas(currently under data/ and legacy lidar data), under unified cloud abstraction. 
  - Decouple detection logic from scan pipeline.
  - Allow detection overlays to be generated on-demand or in parallel, operating on cached subtiles or snapshots.
  - Cache overlays as images/masks in the same task-centric structure.
  - Add API endpoints to trigger and fetch overlays.
- **Frontend:**
  - Overlay detection results on elevation heatmaps.
  - UI for toggling overlays and viewing progress.

### Iteration 4: Multi-Resolution Tiling, Metadata, and Unified Query API (NEXT)
- Store high-res tiles in `tiles_{resolution}/` subfolders.
- Maintain `metadata.json` for available levels, overlays, and tile completeness.
- Add endpoints to query metadata and fetch tiles/overlays.
- Frontend queries backend for available data and renders accordingly.

### Iteration 5: Improved Palette, Visualization, and Modular Rendering (NEXT)
- Integrate perceptually meaningful color palettes and allow customization.
- Support dynamic range adjustment for elevation.
- Modular frontend rendering pipeline for heatmaps, overlays, and tiles at any zoom/resolution.
- Add palette selection and elevation legend display.

### Iteration 6: Cache Management, Cleanup, and On-Demand Regeneration (NEXT)
- Implement cache eviction, recomputation, and cleanup policies per task.
- Allow on-demand regeneration of missing or outdated tiles/overlays.

---

## ✅ IMPLEMENTED (as of July 2025)

- **Task-centric cache structure**: All progressive scan, tile, and overlay data is stored under `data/tasks/{task_id}/cache/`, with subfolders for subtile data, snapshots, and (optionally) tiles and overlays.
- **Progressive, multi-resolution LiDAR scan**: Backend streams tiles/subtiles at multiple resolutions, using a hopping scan strategy, and caches each subtile as a JSON file for fast recovery and resumability.
- **Snapshot PNG endpoint**: Backend can generate and serve a full-region PNG snapshot for any cached level, enabling fast low-zoom rendering on the frontend.
- **Frontend progressive rendering**: Frontend dynamically builds the grid from backend metadata, displays a snapshot PNG as a background, and overlays live tiles as they arrive, with a progress bar reflecting all levels and tiles.
- **WebSocket keepalive and recovery**: Robust keepalive logic and backend cache ensure frontend can reload or reconnect at any time and resume streaming from cached data.
- **Palette and color mapping**: Elevation color mapping is implemented and can be further improved for perceptual clarity.
- **Legacy bitmap cache and demo heatmap code removed**: All new caching and streaming is task/session-centric and real-data only.
- ✅ **Switched to unified Google Cloud Storage for all application data** (formerly under `data/` and legacy lidar data), using a single cloud abstraction and public GCS URLs for frontend tile access. All cache, scan, and overlay data now reside in the `re_archaeology` bucket, with robust backend and frontend coordination.

---

## 🔄 NEXT STEPS: INTEGRATION & OVERHAUL

### 1. Integrate with Legacy Discovery Modules
- **Goal:** Decouple LiDAR scan/progressive tiling from detection logic, so each can be triggered, cached, and visualized independently or in sequence.
- **Actions:**
  - Refactor legacy discovery/detection modules to operate on cached subtiles, snapshots, or tiles, rather than requiring a monolithic scan pipeline.
  - Add API endpoints to trigger detection overlays for a given task/region/resolution, and cache results in the same task-centric structure.
  - Ensure detection overlays can be generated on-demand or in parallel with scanning, and are visualized as overlays on the frontend.

### 2. Unified Metadata & Query API
- **Goal:** Provide a single API for the frontend to query available resolutions, overlays, and tile/snapshot status for any task.
- **Actions:**
  - Maintain a `metadata.json` in each task's cache folder, tracking available levels, overlays, and tile completeness.
  - Add endpoints to query this metadata and fetch available data for rendering or further processing.

### 3. Frontend Overhaul for Modular Rendering
- **Goal:** Allow the frontend to flexibly request and overlay heatmaps, detection masks, and tiles at any zoom/resolution.
- **Actions:**
  - Integrate snapshot/tile/overlay fetching into a unified rendering pipeline.
  - Support toggling overlays, palette selection, and legend display.
  - Add UI for triggering detection overlays and viewing their progress.

### 4. Cache Management & Cleanup
- **Goal:** Keep cache storage efficient and up-to-date.
- **Actions:**
  - Implement cache eviction, recomputation, and cleanup policies per task.
  - Allow on-demand regeneration of missing or outdated tiles/overlays.

---

## 🧩 STRATEGY GOING FORWARD
- **Progressive scan and detection should be loosely coupled:**
  - Scanning (tiling, caching, snapshotting) and detection (overlay generation) should be independent modules, communicating via the cache and metadata.
  - This enables flexible workflows: scan-only, detection-only, or combined, and supports future algorithm upgrades without breaking the pipeline.
- **All new features should use the unified task-centric cache and metadata model.**
- **Frontend should always query backend for available data, never assume cache state.**

---

By following this plan, the system will be robust, scalable, and easy to extend for new detection algorithms, visualization modes, or large-scale tasks.

// LiDAR subtile grid renderer using canvas overlay for performance
// Updated: robust map/canvas detection, improved debug, ES module export
import { getGcsSnapshotUrl } from './gcs-utils.js';
import { startScanningAnimation, updateAnimationProgress, moveSatelliteAnimationToTile } from './ui.js';

let lidarCanvas = null;
let lidarSubtiles = [];
let gridInfo = null;
let map = null;
let mapContainer = null;
let lidarSnapshotOverlay = null;

// Setup canvas overlay
function ensureCanvas() {
    if (!mapContainer) {
        mapContainer = document.getElementById('mapContainer');
        if (!mapContainer) {
            console.warn('[LIDAR_GRID] mapContainer not found');
            return;
        }
    }
    if (!lidarCanvas) {
        lidarCanvas = document.createElement('canvas');
        lidarCanvas.id = 'lidar-canvas';
        lidarCanvas.style.position = 'absolute';
        lidarCanvas.style.top = '0';
        lidarCanvas.style.left = '0';
        lidarCanvas.style.pointerEvents = 'none';
        lidarCanvas.style.zIndex = '2000';
        mapContainer.appendChild(lidarCanvas);
        if (window.DEBUG_LIDAR_GRID) console.log('[LIDAR_GRID] Canvas created and appended');
    } else if (!mapContainer.contains(lidarCanvas)) {
        mapContainer.appendChild(lidarCanvas);
        if (window.DEBUG_LIDAR_GRID) console.log('[LIDAR_GRID] Canvas re-appended');
    }
    resizeCanvas();
}

function resizeCanvas() {
    if (lidarCanvas && mapContainer) {
        const w = mapContainer.offsetWidth;
        const h = mapContainer.offsetHeight;
        lidarCanvas.width = w;
        lidarCanvas.height = h;
        if (window.DEBUG_LIDAR_GRID) console.log(`[LIDAR_GRID] Canvas resized: ${w}x${h}`);
    }
}

// Helper: check if subtileA fully covers subtileB
function subtileCovers(a, b) {
    return (
        a.subtile_lat0 <= b.subtile_lat0 &&
        a.subtile_lat1 >= b.subtile_lat1 &&
        a.subtile_lon0 <= b.subtile_lon0 &&
        a.subtile_lon1 >= b.subtile_lon1
    );
}

// Helper: compute area of a subtile
function subtileArea(subtile) {
    if (
        subtile.subtile_lat0 !== undefined &&
        subtile.subtile_lat1 !== undefined &&
        subtile.subtile_lon0 !== undefined &&
        subtile.subtile_lon1 !== undefined
    ) {
        return Math.abs((subtile.subtile_lat1 - subtile.subtile_lat0) * (subtile.subtile_lon1 - subtile.subtile_lon0));
    }
    return Infinity; // fallback: treat as very large
}

// Redraw all subtiles (with level and area sorting)
function redrawLidarCanvas() {
    if (!lidarCanvas || !map) {
        if (window.DEBUG_LIDAR_GRID) {
            console.warn('[LIDAR_GRID] redraw: missing canvas or map', {
                lidarCanvas,
                map,
                mapContainer,
                windowApp: window.app,
                windowAppMap: window.app && window.app.map,
                windowAppAlt: window.App,
                windowAppAltMap: window.App && window.App.map,
                windowReArch: window.reArchaeologyApp,
                windowReArchMap: window.reArchaeologyApp && window.reArchaeologyApp.map
            });
        }
        return;
    }
    const ctx = lidarCanvas.getContext('2d');
    ctx.clearRect(0, 0, lidarCanvas.width, lidarCanvas.height);
    // Sort by level (lowest first), then by area (largest first, smallest last)
    lidarSubtiles
        .slice()
        .sort((a, b) => {
            const la = a.level ?? 0, lb = b.level ?? 0;
            if (la !== lb) return la - lb;
            // For same level, draw smaller area last (on top)
            return subtileArea(b) - subtileArea(a);
        })
        .forEach((subtile, idx) => {
            if (window.DEBUG_LIDAR_GRID && idx < 10) {
                let pt0, pt1, pt2, pt3;
                if (typeof map.latLngToContainerPoint === 'function') {
                    pt0 = map.latLngToContainerPoint([subtile.subtile_lat0, subtile.subtile_lon0]);
                    pt1 = map.latLngToContainerPoint([subtile.subtile_lat0, subtile.subtile_lon1]);
                    pt2 = map.latLngToContainerPoint([subtile.subtile_lat1, subtile.subtile_lon1]);
                    pt3 = map.latLngToContainerPoint([subtile.subtile_lat1, subtile.subtile_lon0]);
                } else {
                    pt0 = pt1 = pt2 = pt3 = {x: NaN, y: NaN};
                }
                console.log(`[LIDAR_GRID] Subtile #${idx}:`, {
                    bounds: {
                        lat0: subtile.subtile_lat0,
                        lat1: subtile.subtile_lat1,
                        lon0: subtile.subtile_lon0,
                        lon1: subtile.subtile_lon1
                    },
                    projected: [pt0, pt1, pt2, pt3],
                    color: subtile.color,
                    level: subtile.level,
                    area: subtileArea(subtile)
                });
            }
            drawSubtile(subtile, ctx);
        });
}

// Draw a single subtile as a rectangle using bounds
function drawSubtile(subtile, ctx) {
    if (!map) return;
    if (
        subtile.subtile_lat0 !== undefined &&
        subtile.subtile_lat1 !== undefined &&
        subtile.subtile_lon0 !== undefined &&
        subtile.subtile_lon1 !== undefined
    ) {
        if (typeof map.latLngToContainerPoint !== 'function') {
            if (window.DEBUG_LIDAR_GRID) console.warn('[LIDAR_GRID] map.latLngToContainerPoint not available');
            return;
        }
        const pt0 = map.latLngToContainerPoint([subtile.subtile_lat0, subtile.subtile_lon0]);
        const pt1 = map.latLngToContainerPoint([subtile.subtile_lat0, subtile.subtile_lon1]);
        const pt2 = map.latLngToContainerPoint([subtile.subtile_lat1, subtile.subtile_lon1]);
        const pt3 = map.latLngToContainerPoint([subtile.subtile_lat1, subtile.subtile_lon0]);
        ctx.fillStyle = subtile.color;
        ctx.beginPath();
        ctx.moveTo(pt0.x, pt0.y);
        ctx.lineTo(pt1.x, pt1.y);
        ctx.lineTo(pt2.x, pt2.y);
        ctx.lineTo(pt3.x, pt3.y);
        ctx.closePath();
        ctx.fill();
    } else {
        // fallback: draw a square at center
        if (typeof map.latLngToContainerPoint !== 'function') return;
        const pt = map.latLngToContainerPoint([subtile.lat, subtile.lon]);
        ctx.fillStyle = subtile.color;
        ctx.fillRect(pt.x - subtile.sizePx/2, pt.y - subtile.sizePx/2, subtile.sizePx, subtile.sizePx);
    }
}

// Overlay color PNG snapshot using Leaflet imageOverlay for georeferenced alignment
function showLidarSnapshot(taskId, levelIdx, bounds) {
    console.debug('[LIDAR_GRID][DEBUG] showLidarSnapshot called', { taskId, levelIdx, bounds, map });
    if (!map) {
        const app = window.app || window.App || window.reArchaeologyApp;
        map = app && app.map;
        console.debug('[LIDAR_GRID][DEBUG] showLidarSnapshot: map resolved from global', { map });
    }
    if (!map || !bounds) {
        console.warn('[LIDAR_GRID][DEBUG] showLidarSnapshot: missing map or bounds', { map, bounds });
        return;
    }
    // Remove previous overlay if any
    if (lidarSnapshotOverlay && map.hasLayer && map.hasLayer(lidarSnapshotOverlay)) {
        console.debug('[LIDAR_GRID][DEBUG] Removing previous snapshot overlay', { lidarSnapshotOverlay });
        map.removeLayer(lidarSnapshotOverlay);
        lidarSnapshotOverlay = null;
    }
    // Use centralized GCS URL helper
    const pngUrl = getGcsSnapshotUrl(taskId, levelIdx);
    console.debug('[LIDAR_GRID][DEBUG] showLidarSnapshot: constructed pngUrl', { pngUrl });
    // Bounds: [[south_lat, west_lon], [north_lat, east_lon]]
    const southWest = L.latLng(bounds[0][0], bounds[0][1]);
    const northEast = L.latLng(bounds[1][0], bounds[1][1]);
    const imageBounds = L.latLngBounds(southWest, northEast);
    console.debug('[LIDAR_GRID][DEBUG] showLidarSnapshot: imageBounds', { imageBounds });
    try {
        lidarSnapshotOverlay = L.imageOverlay(pngUrl, imageBounds, {
            opacity: 1,
            interactive: false,
            zIndex: 1500
        });
        console.debug('[LIDAR_GRID][DEBUG] showLidarSnapshot: overlay created', { lidarSnapshotOverlay });
        lidarSnapshotOverlay.addTo(map);
        console.debug('[LIDAR_GRID][DEBUG] Added snapshot overlay', { pngUrl, imageBounds, overlay: lidarSnapshotOverlay, map });
    } catch (e) {
        console.error('[LIDAR_GRID][DEBUG] showLidarSnapshot: error adding overlay', e);
    }
}

function hideLidarSnapshot() {
    if (lidarSnapshotOverlay && map && map.hasLayer && map.hasLayer(lidarSnapshotOverlay)) {
        map.removeLayer(lidarSnapshotOverlay);
        if (window.DEBUG_LIDAR_GRID) console.log('[LIDAR_GRID] Snapshot overlay hidden');
        lidarSnapshotOverlay = null;
    }
}

// Try to load the highest available level snapshot, using meta.json for georeferenced bounds
async function showHighestAvailableLidarSnapshot(taskId, bounds, maxLevels = 4) {
    console.debug('[LIDAR_GRID][DEBUG] showHighestAvailableLidarSnapshot called', { taskId, bounds, maxLevels, map });
    if (!map || !bounds) {
        console.warn('[LIDAR_GRID][DEBUG] showHighestAvailableLidarSnapshot: missing map or bounds', { map, bounds });
        return;
    }
    console.debug('[LIDAR_GRID][DEBUG] Checking for highest available snapshot', { taskId, bounds, maxLevels });
    // Try from highest to lowest level
    for (let levelIdx = maxLevels - 1; levelIdx >= 0; levelIdx--) {
        const pngUrl = getGcsSnapshotUrl(taskId, levelIdx);
        const metaUrl = pngUrl.replace('_color.png', '_meta.json');
        try {
            console.debug(`[LIDAR_GRID][DEBUG] Checking snapshot for level ${levelIdx}:`, pngUrl);
            // Check if the image exists by attempting to fetch the header
            const resp = await fetch(pngUrl, { method: 'HEAD' });
            console.debug(`[LIDAR_GRID][DEBUG] HEAD response for level ${levelIdx}:`, resp.status, resp.ok, resp);
            if (resp.ok) {
                // Fetch meta.json for georeferenced bounds
                let overlayBounds = bounds;
                try {
                    const metaResp = await fetch(metaUrl);
                    if (metaResp.ok) {
                        const meta = await metaResp.json();
                        if (
                            meta.south_lat !== undefined && meta.north_lat !== undefined &&
                            meta.west_lon !== undefined && meta.east_lon !== undefined
                        ) {
                            overlayBounds = [
                                [meta.south_lat, meta.west_lon],
                                [meta.north_lat, meta.east_lon]
                            ];
                            console.debug(`[LIDAR_GRID][DEBUG] Using meta.json bounds for overlay:`, overlayBounds);
                        }
                    } else {
                        console.warn(`[LIDAR_GRID][DEBUG] Could not fetch meta.json for level ${levelIdx}:`, metaUrl);
                    }
                } catch (e) {
                    console.warn(`[LIDAR_GRID][DEBUG] Error fetching or parsing meta.json for level ${levelIdx}:`, e);
                }
                console.debug(`[LIDAR_GRID][DEBUG] Found snapshot at level ${levelIdx}, displaying.`);
                showLidarSnapshot(taskId, levelIdx, overlayBounds);
                return;
            }
        } catch (e) {
            console.warn(`[LIDAR_GRID][DEBUG] Error checking snapshot for level ${levelIdx}:`, e);
            // Ignore and try next lower level
        }
    }
    console.warn('[LIDAR_GRID][DEBUG] No snapshot found for any level');
    // If none found, do nothing
}

// Set grid info from backend
export function setLidarGridInfo(info, taskIdOverride) {
    console.debug('[LIDAR_GRID][DEBUG] setLidarGridInfo called', { info, taskIdOverride });
    gridInfo = info;
    lidarSubtiles = [];
    ensureCanvas();
    redrawLidarCanvas();
    console.debug('[LIDAR_GRID][DEBUG] setLidarGridInfo after redraw', { info });
    // Use override if provided, else fall back to window globals
    const taskId = taskIdOverride || window.currentTaskId || (window.reArchaeologyApp && window.reArchaeologyApp.currentTaskId);
    // Convert bounds object to array if needed
    let boundsArr = null;
    if (info.bounds && info.bounds.southwest && info.bounds.northeast) {
        boundsArr = [info.bounds.southwest, info.bounds.northeast];
    } else if (Array.isArray(info.bounds) && info.bounds.length === 2 && Array.isArray(info.bounds[0]) && Array.isArray(info.bounds[1])) {
        boundsArr = info.bounds;
    }
    console.debug('[LIDAR_GRID][DEBUG] setLidarGridInfo computed taskId and bounds', { taskId, bounds: boundsArr });
    if (taskId && boundsArr) {
        console.debug('[LIDAR_GRID][DEBUG] Calling showHighestAvailableLidarSnapshot', { taskId, bounds: boundsArr });
        showHighestAvailableLidarSnapshot(taskId, boundsArr);
        
        // Set scan area for satellite animation to use
        const app = window.app || window.App || window.reArchaeologyApp;
        if (app) {
            app.currentScanArea = {
                bounds: boundsArr,
                taskId: taskId
            };
            console.debug('[LIDAR_GRID][DEBUG] Set currentScanArea for satellite animation', app.currentScanArea);
        }
    } else {
        console.warn('[LIDAR_GRID][DEBUG] setLidarGridInfo: missing taskId or bounds', { taskId, info });
    }
}

// Render a subtile (called for each tile/subtile message)
export function renderLidarSubtile(obj) {
    // Use backend grid info if available
    let gridCols = obj.gridCols, gridRows = obj.gridRows;
    if (gridInfo) {
        gridCols = gridInfo.grid_x || gridCols;
        gridRows = gridInfo.grid_y || gridRows;
    }
    if (!gridRows || !gridCols) {
        if (window.DEBUG_LIDAR_GRID) console.warn('[LIDAR_GRID] No gridRows/gridCols');
        return;
    }
    if (!map) {
        // Try to get map instance from global app
        const app = window.app || window.App || window.reArchaeologyApp;
        map = app && app.map;
        mapContainer = document.getElementById('mapContainer');
        if (!map || !mapContainer) {
            if (window.DEBUG_LIDAR_GRID) console.warn('[LIDAR_GRID] No map or mapContainer');
            return;
        }
        ensureCanvas();
    }
    
    // Get app instance for animation
    const app = window.app || window.App || window.reArchaeologyApp;
    if (app) {
        // Start satellite animation if not already active
        if (!app.isScanning && !app.animationState?.isActive) {
            console.log('[LIDAR_GRID] Starting satellite animation for tiling');
            startScanningAnimation(app, 'satellite');
            app.isScanning = true;
        }
        
        // Update animation progress and draw beam to current tile
        const tileData = {
            center_lat: obj.lat,
            center_lon: obj.lon,
            subtile_lat0: obj.subtile_lat0,
            subtile_lat1: obj.subtile_lat1,
            subtile_lon0: obj.subtile_lon0,
            subtile_lon1: obj.subtile_lon1,
            tile_bounds: obj.subtile_lat0 !== undefined ? {
                north: obj.subtile_lat1,
                south: obj.subtile_lat0,
                east: obj.subtile_lon1,
                west: obj.subtile_lon0
            } : null
        };
        
        updateAnimationProgress(app, tileData);
        
        // Move satellite to the current tile/subtile being processed
        if (obj.coarse_row !== undefined && obj.coarse_col !== undefined) {
            const tileInfo = {
                gridRows: gridRows,
                gridCols: gridCols,
                coarseRow: obj.coarse_row,
                coarseCol: obj.coarse_col,
                subtiles: obj.subtiles_per_side || 1,
                subtileRow: obj.subtile_row || 0,
                subtileCol: obj.subtile_col || 0
            };
            moveSatelliteAnimationToTile(app, tileInfo);
        }
    }
    // If bounds are present, use them for seamless rendering
    const subtile = {
        lat: obj.lat,
        lon: obj.lon,
        color: obj.color || '#eee',
        subtile_lat0: obj.subtile_lat0,
        subtile_lat1: obj.subtile_lat1,
        subtile_lon0: obj.subtile_lon0,
        subtile_lon1: obj.subtile_lon1,
        level: obj.level ?? obj.zoom ?? obj.lod ?? 0 // try to get level/zoom/lod
    };
    // Remove any subtiles that are fully covered by this new subtile and are lower-res (lower level)
    lidarSubtiles = lidarSubtiles.filter(existing => {
        if (subtile.level > (existing.level ?? 0) && subtileCovers(subtile, existing)) {
            if (window.DEBUG_LIDAR_GRID) console.log('[LIDAR_GRID] Removing covered subtile', existing, 'by', subtile);
            return false;
        }
        return true;
    });
    if (window.DEBUG_LIDAR_GRID && lidarSubtiles.length < 1) {
        console.log('[LIDAR_GRID] First subtile received:', subtile);
    }
    lidarSubtiles.push(subtile);
    redrawLidarCanvas();
    if (lidarSnapshotOverlay) hideLidarSnapshot();
}

// Listen for map move/zoom and redraw
function setupMapListeners() {
    if (!map) {
        const app = window.app || window.App || window.reArchaeologyApp;
        map = app && app.map;
    }
    if (map && typeof map.on === 'function') {
        map.on('move zoom resize', function() {
            resizeCanvas();
            redrawLidarCanvas();
        });
        if (window.DEBUG_LIDAR_GRID) console.log('[LIDAR_GRID] Map listeners set up');
    } else if (window.DEBUG_LIDAR_GRID) {
        console.warn('[LIDAR_GRID] Map not ready for listeners');
    }
}

// Try to get map and container, retry if missing
function tryInitLidarGrid(retryCount = 0) {
    if (!map) {
        const app = window.app || window.App || window.reArchaeologyApp;
        map = app && app.map;
    }
    if (!mapContainer) {
        mapContainer = document.getElementById('mapContainer');
    }
    if (map && mapContainer) {
        ensureCanvas();
        setupMapListeners();
        if (window.DEBUG_LIDAR_GRID) console.log('[LIDAR_GRID] Map and container found, initialized.');
        redrawLidarCanvas();
    } else if (retryCount < 20) {
        if (window.DEBUG_LIDAR_GRID) console.log(`[LIDAR_GRID] Waiting for map/container... retry ${retryCount}`);
        setTimeout(() => tryInitLidarGrid(retryCount + 1), 500);
    } else {
        if (window.DEBUG_LIDAR_GRID) console.warn('[LIDAR_GRID] Map or container not found after retries.');
    }
}

// On module load, start trying to initialize
tryInitLidarGrid();

window.DEBUG_LIDAR_GRID = false;

// Stop satellite animation when scanning is complete
export function stopSatelliteAnimationIfComplete(taskId) {
    const app = window.app || window.App || window.reArchaeologyApp;
    if (app && app.isScanning && app.animationState?.isActive) {
        // Check if this is the current scanning task
        const currentTaskId = window.currentTaskId || (app && app.currentTaskId);
        if (currentTaskId === taskId) {
            console.log('[LIDAR_GRID] Stopping satellite animation for completed task:', taskId);
            if (typeof app.stopScanningAnimation === 'function') {
                app.stopScanningAnimation();
            }
            app.isScanning = false;
        }
    }
}

// For legacy support, attach to window (remove after migration)
window.setLidarGridInfo = setLidarGridInfo;
window.renderLidarSubtile = renderLidarSubtile;
window.stopSatelliteAnimationIfComplete = stopSatelliteAnimationIfComplete;

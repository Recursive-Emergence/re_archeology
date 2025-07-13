// LiDAR subtile grid renderer using canvas overlay for performance
// Updated: integrated with clean animation system
console.log('[LIDAR-GRID] Module starting to load...');

// Animation system instance
let animationSystem = null;

// Track initialization state
let isInitialized = false;

// Get animation system from global scope (loaded by main module loader)
const LidarAnimationSystem = window.LidarAnimationSystem;
const ANIMATION_CONFIG = window.LIDAR_ANIMATION_CONFIG || {
    Z_INDEX: {
        LIDAR_CANVAS: 1200,
        CACHED_OVERLAYS: 1100
    }
};

// Helper functions
function getGcsSnapshotUrl(taskId, levelIdx) {
    return `https://storage.googleapis.com/re_archaeology/tasks/${taskId}/snapshots/level_${levelIdx}_color.png`;
}

function initializeAnimationSystem(map) {
    if (!animationSystem && map && LidarAnimationSystem) {
        animationSystem = new LidarAnimationSystem(map);
        window.Logger?.debug('lidar', '[LIDAR-GRID] Animation system initialized');
    }
    return animationSystem;
}

console.log('[LIDAR-GRID] ES6 module loading with animation system integration...');

let lidarCanvas = null;
let lidarSubtiles = [];
let gridInfo = null;
let map = null;
let mapContainer = null;
let lidarSnapshotOverlays = new Map(); // taskId -> overlay
let lidarSnapshotOverlay = null; // Current active overlay
let snapshotAvailabilityCache = new Map(); // taskId -> { checked: boolean, highestLevel: number | null }

// Setup canvas overlay
function ensureCanvas() {
    if (!mapContainer) {
        mapContainer = document.getElementById('mapContainer');
        if (!mapContainer) {
            if (window.DEBUG_LIDAR_GRID && window.Logger) {
                window.Logger.warn('lidar', '[LIDAR_GRID] mapContainer not found');
            }
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
        lidarCanvas.style.zIndex = ANIMATION_CONFIG?.Z_INDEX?.LIDAR_CANVAS || 1200; // Use coordinated z-index with fallback
        mapContainer.appendChild(lidarCanvas);
        
        // Set global variables for GCS polling compatibility
        window.lidarCanvas = lidarCanvas;
        window.lidarContext = lidarCanvas.getContext('2d');
        
        if (window.DEBUG_LIDAR_GRID && window.Logger) {
            window.Logger.debug('lidar', '[LIDAR_GRID] Canvas created with z-index:', ANIMATION_CONFIG?.Z_INDEX?.LIDAR_CANVAS || 1200);
        }
    } else if (!mapContainer.contains(lidarCanvas)) {
        mapContainer.appendChild(lidarCanvas);
        if (window.DEBUG_LIDAR_GRID && window.Logger) {
            window.Logger.debug('lidar', '[LIDAR_GRID] Canvas re-appended');
        }
    }
    resizeCanvas();
}

function resizeCanvas() {
    if (lidarCanvas && mapContainer) {
        const w = mapContainer.offsetWidth;
        const h = mapContainer.offsetHeight;
        lidarCanvas.width = w;
        lidarCanvas.height = h;
        if (window.DEBUG_LIDAR_GRID && window.Logger) {
            window.Logger.debug('lidar', `[LIDAR_GRID] Canvas resized: ${w}x${h}`);
        }
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
        if (window.DEBUG_LIDAR_GRID && window.Logger) {
            window.Logger.warn('lidar', '[LIDAR_GRID] redraw: missing canvas or map', {
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
                if (window.DEBUG_LIDAR_GRID && window.Logger) {
                    window.Logger.debug('lidar', `[LIDAR_GRID] Subtile #${idx}:`, {
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
            if (window.DEBUG_LIDAR_GRID && window.Logger) {
                window.Logger.warn('lidar', '[LIDAR_GRID] map.latLngToContainerPoint not available');
            }
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
    if (!map) {
        const app = window.app || window.App || window.reArchaeologyApp;
        map = app && app.map;
    }
    if (!map || !bounds) {
        console.warn('[LIDAR_GRID] Cannot show snapshot: missing map or bounds');
        return;
    }
    
    // Remove previous overlay for this task if any
    const existingOverlay = lidarSnapshotOverlays.get(taskId);
    if (existingOverlay && map.hasLayer && map.hasLayer(existingOverlay)) {
        map.removeLayer(existingOverlay);
    }
    
    // Use centralized GCS URL helper
    const pngUrl = getGcsSnapshotUrl(taskId, levelIdx);
    
    // Bounds: [[south_lat, west_lon], [north_lat, east_lon]]
    const southWest = L.latLng(bounds[0][0], bounds[0][1]);
    const northEast = L.latLng(bounds[1][0], bounds[1][1]);
    const imageBounds = L.latLngBounds(southWest, northEast);
    
    try {
        const overlay = L.imageOverlay(pngUrl, imageBounds, {
            opacity: 0.75, // Slightly transparent for clean layering
            interactive: false,
            zIndex: ANIMATION_CONFIG?.Z_INDEX?.CACHED_OVERLAYS || 1100,
            className: 'cached-bitmap-overlay'
        });
        overlay.addTo(map);
        lidarSnapshotOverlays.set(taskId, overlay);
        // Only log successful additions, not every detail
        if (window.DEBUG_LIDAR_GRID) {
            console.log(`[LIDAR_GRID] Added snapshot level ${levelIdx} for task ${taskId.slice(0,8)}...`);
        }
    } catch (e) {
        console.error('[LIDAR_GRID] Error adding overlay:', e);
    }
}

function hideLidarSnapshot() {
    if (lidarSnapshotOverlay && map && map.hasLayer && map.hasLayer(lidarSnapshotOverlay)) {
        map.removeLayer(lidarSnapshotOverlay);
        if (window.DEBUG_LIDAR_GRID && window.Logger) {
            window.Logger.debug('lidar', '[LIDAR_GRID] Snapshot overlay hidden');
        }
        lidarSnapshotOverlay = null;
    }
}

// Try to load the highest available level snapshot, using meta.json for georeferenced bounds
async function showHighestAvailableLidarSnapshot(taskId, bounds, maxLevels = 4) {
    // Ensure we have the map reference
    if (!map) {
        const app = window.app || window.App || window.reArchaeologyApp;
        map = app && app.map;
    }
    
    if (!map || !bounds) {
        console.warn('[LIDAR_GRID] Cannot load snapshot: missing map or bounds');
        return;
    }

    // Check cache first
    const cached = snapshotAvailabilityCache.get(taskId);
    if (cached && cached.checked) {
        if (cached.highestLevel !== null) {
            // We know this task has snapshots, load the highest available
            const levelIdx = cached.highestLevel;
            const pngUrl = getGcsSnapshotUrl(taskId, levelIdx);
            const metaUrl = pngUrl.replace('_color.png', '_meta.json');
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
                    }
                }
            } catch (e) {
                // Use fallback bounds if meta.json fails
            }
            showLidarSnapshot(taskId, levelIdx, overlayBounds);
        }
        // If highestLevel is null, we know no snapshots exist, so don't try
        return;
    }

    // Not in cache, need to check availability
    let foundLevel = null;
    // Try from highest to lowest level
    for (let levelIdx = maxLevels - 1; levelIdx >= 0; levelIdx--) {
        const pngUrl = getGcsSnapshotUrl(taskId, levelIdx);
        const metaUrl = pngUrl.replace('_color.png', '_meta.json');
        try {
            // Check if the image exists by attempting to fetch the header
            const resp = await fetch(pngUrl, { method: 'HEAD' });
            if (resp.ok) {
                foundLevel = levelIdx;
                break; // Found the highest available level
            }
        } catch (e) {
            // Continue checking lower levels
        }
    }

    // Cache the result
    snapshotAvailabilityCache.set(taskId, { checked: true, highestLevel: foundLevel });

    if (foundLevel !== null) {
        const pngUrl = getGcsSnapshotUrl(taskId, foundLevel);
        const metaUrl = pngUrl.replace('_color.png', '_meta.json');
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
                }
            }
        } catch (e) {
            // Use fallback bounds if meta.json fails
        }
        showLidarSnapshot(taskId, foundLevel, overlayBounds);
        return foundLevel; // Return the highest level found
    }
    
    if (window.DEBUG_LIDAR_GRID) {
        console.debug(`[LIDAR_GRID][DEBUG] No snapshot found for task (normal for unscanned tasks)`);
    }
    return -1; // No snapshot found
}

// Detect highest available snapshot level for a task (without displaying it)
async function detectHighestSnapshotLevel(taskId, maxLevels = 4) {
    console.debug('[LIDAR_GRID][DEBUG] detectHighestSnapshotLevel called', { taskId, maxLevels });
    
    // Try from highest to lowest level
    for (let levelIdx = maxLevels - 1; levelIdx >= 0; levelIdx--) {
        const pngUrl = getGcsSnapshotUrl(taskId, levelIdx);
        try {
            console.debug(`[LIDAR_GRID][DEBUG] Checking snapshot availability for level ${levelIdx}:`, pngUrl);
            // Check if the image exists by attempting to fetch the header
            const resp = await fetch(pngUrl, { method: 'HEAD' });
            console.debug(`[LIDAR_GRID][DEBUG] HEAD response for level ${levelIdx}:`, resp.status, resp.ok);
            if (resp.ok) {
                console.debug(`[LIDAR_GRID][DEBUG] Found highest available snapshot at level ${levelIdx}`);
                return levelIdx;
            }
        } catch (e) {
            console.warn(`[LIDAR_GRID][DEBUG] Error checking snapshot for level ${levelIdx}:`, e);
            // Ignore and try next lower level
        }
    }
    if (window.DEBUG_LIDAR_GRID) {
        console.debug(`[LIDAR_GRID][DEBUG] No snapshot found for task (normal for unscanned tasks)`);
    }
    return -1; // No snapshot found
}

// Set grid info from backend
function setLidarGridInfo(info, taskIdOverride) {
    gridInfo = info;
    lidarSubtiles = [];
    ensureCanvas();
    redrawLidarCanvas();
    
    // Use override if provided, else fall back to window globals
    const taskId = taskIdOverride || window.currentTaskId || (window.reArchaeologyApp && window.reArchaeologyApp.currentTaskId);
    // Convert bounds object to array if needed
    let boundsArr = null;
    if (info.bounds && info.bounds.southwest && info.bounds.northeast) {
        boundsArr = [info.bounds.southwest, info.bounds.northeast];
    } else if (Array.isArray(info.bounds) && info.bounds.length === 2 && Array.isArray(info.bounds[0]) && Array.isArray(info.bounds[1])) {
        boundsArr = info.bounds;
    }
    
    if (taskId && boundsArr) {
        showHighestAvailableLidarSnapshot(taskId, boundsArr);
        
        // Set scan area for satellite animation to use
        const app = window.app || window.App || window.reArchaeologyApp;
        if (app) {
            app.currentScanArea = {
                bounds: boundsArr,
                taskId: taskId
            };
        }
    } else if (window.DEBUG_LIDAR_GRID) {
        console.warn('[LIDAR_GRID] setLidarGridInfo: missing taskId or bounds', { taskId, bounds: boundsArr });
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
        if (window.DEBUG_LIDAR_GRID) console.warn('[LIDAR_GRID] No gridRows/gridCols - using individual tile mode');
        // For GCS individual tiles, we don't need grid info - just render the single tile
        gridRows = 1;
        gridCols = 1;
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
    
    // Initialize animation system if needed
    const animation = initializeAnimationSystem(map);
    
    // Get app instance for coordination
    const app = window.app || window.App || window.reArchaeologyApp;
    if (app && animation) {
        // Start scanning animation if not already active (works for both WebSocket and GCS)
        if (!animation.getState().isActive) {
            if (window.DEBUG_LIDAR_GRID && window.Logger) {
                window.Logger.debug('lidar', '[LIDAR_GRID] Starting clean scanning animation');
            }
            animation.startScanning('satellite');
            app.isScanning = true;
        }
        
        // Prepare tile data for animation (works for both WebSocket and GCS tiles)
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
        
        // Trigger clean, synchronized scanning animation
        animation.animateTileScanning(tileData);
    }
    // If bounds are present, use them for seamless rendering
    const subtile = {
        lat: obj.lat,
        lon: obj.lon,
        color: obj.color || '#8B7355', // Use brownish terrain color instead of gray
        subtile_lat0: obj.subtile_lat0,
        subtile_lat1: obj.subtile_lat1,
        subtile_lon0: obj.subtile_lon0,
        subtile_lon1: obj.subtile_lon1,
        level: obj.level ?? obj.zoom ?? obj.lod ?? 0, // try to get level/zoom/lod
        sizePx: 4 // Default size for center-point tiles (GCS tiles)
    };
    
    // Convert color array to CSS color if needed
    if (Array.isArray(subtile.color)) {
        const [r, g, b] = subtile.color;
        subtile.color = `rgb(${r || 0}, ${g || 0}, ${b || 0})`;
    }
    // Remove any subtiles that are fully covered by this new subtile and are lower-res (lower level)
    lidarSubtiles = lidarSubtiles.filter(existing => {
        if (subtile.level > (existing.level ?? 0) && subtileCovers(subtile, existing)) {
            if (window.DEBUG_LIDAR_GRID && window.Logger) {
                window.Logger.debug('lidar', '[LIDAR_GRID] Removing covered subtile', existing, 'by', subtile);
            }
            return false;
        }
        return true;
    });
    if (window.DEBUG_LIDAR_GRID && lidarSubtiles.length < 1) {
        if (window.DEBUG_LIDAR_GRID && window.Logger) {
            window.Logger.debug('lidar', '[LIDAR_GRID] First subtile received:', subtile);
        }
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
        if (window.DEBUG_LIDAR_GRID && window.Logger) {
            window.Logger.debug('lidar', '[LIDAR_GRID] Map listeners set up');
        }
    } else if (window.DEBUG_LIDAR_GRID && window.Logger) {
        window.Logger.warn('lidar', '[LIDAR_GRID] Map not ready for listeners');
    }
}

// Try to get map and container, retry if missing
function tryInitLidarGrid(retryCount = 0) {
    // Don't retry if already initialized
    if (isInitialized) {
        return;
    }
    
    if (!map) {
        const app = window.app || window.App || window.reArchaeologyApp;
        map = app && app.map;
        
        if (window.DEBUG_LIDAR_GRID && window.Logger && retryCount % 5 === 0) {
            window.Logger.debug('lidar', `[LIDAR_GRID] Checking for map - app: ${!!app}, app.map: ${!!(app && app.map)}, window.reArchaeologyApp: ${!!window.reArchaeologyApp}`);
        }
    }
    if (!mapContainer) {
        mapContainer = document.getElementById('mapContainer');
    }
    
    // Check if both map and container are available
    if (map && mapContainer && mapContainer.offsetWidth > 0) {
        ensureCanvas();
        setupMapListeners();
        isInitialized = true;
        console.log('[LIDAR_GRID] Successfully initialized via polling');
        if (window.DEBUG_LIDAR_GRID && window.Logger) {
            window.Logger.debug('lidar', '[LIDAR_GRID] Map and container found, initialized.');
        }
        redrawLidarCanvas();
        return; // Successfully initialized
    } 
    
    // Continue retrying up to 30 times (15 seconds)
    if (retryCount < 30) {
        if (window.DEBUG_LIDAR_GRID && window.Logger) {
            window.Logger.debug('lidar', `[LIDAR_GRID] Waiting for map/container... retry ${retryCount} (map: ${!!map}, container: ${!!mapContainer}, containerWidth: ${mapContainer?.offsetWidth || 0})`);
        }
        setTimeout(() => tryInitLidarGrid(retryCount + 1), 500);
    } else {
        if (window.DEBUG_LIDAR_GRID && window.Logger) {
            window.Logger.warn('lidar', '[LIDAR_GRID] Map or container not found after retries.');
        }
    }
}

// Listen for map ready event
window.addEventListener('mapReady', (event) => {
    console.log('[LIDAR_GRID] Received mapReady event', event.detail);
    
    // Don't initialize again if already done
    if (isInitialized) {
        console.log('[LIDAR_GRID] Already initialized, ignoring mapReady event');
        return;
    }
    
    if (window.DEBUG_LIDAR_GRID && window.Logger) {
        window.Logger.debug('lidar', '[LIDAR_GRID] Received mapReady event');
    }
    map = event.detail.map;
    mapContainer = document.getElementById('mapContainer');
    if (map && mapContainer) {
        ensureCanvas();
        setupMapListeners();
        isInitialized = true;
        console.log('[LIDAR_GRID] Successfully initialized via mapReady event');
        if (window.DEBUG_LIDAR_GRID && window.Logger) {
            window.Logger.debug('lidar', '[LIDAR_GRID] Map and container found via event, initialized.');
        }
        redrawLidarCanvas();
    } else {
        console.error('[LIDAR_GRID] mapReady event received but missing map or container', { map: !!map, mapContainer: !!mapContainer });
    }
});

// On module load, start trying to initialize (fallback)
tryInitLidarGrid();

// Use centralized debug configuration - disable verbose logging
window.DEBUG_LIDAR_GRID = false;

// Stop satellite animation when scanning is complete
export function stopSatelliteAnimationIfComplete(taskId) {
    const app = window.app || window.App || window.reArchaeologyApp;
    if (app && app.isScanning && app.animationState?.isActive) {
        // Check if this is the current scanning task
        const currentTaskId = window.currentTaskId || (app && app.currentTaskId);
        if (currentTaskId === taskId) {
            if (window.DEBUG_LIDAR_GRID && window.Logger) {
                window.Logger.debug('lidar', '[LIDAR_GRID] Stopping satellite animation for completed task:', taskId);
            }
            if (typeof app.stopScanningAnimation === 'function') {
                app.stopScanningAnimation();
            }
            app.isScanning = false;
        }
    }
}

// Remove overlays for tasks that are no longer present
function removeObsoleteLidarSnapshotOverlays(currentTaskIds) {
    // For now, this is a placeholder since we're not tracking multiple overlays
    // In the future, this could track and remove overlays for deleted tasks
    // Only log when debug mode is enabled to reduce noise
    if (window.DEBUG_LIDAR_GRID) {
        console.debug('[LIDAR_GRID] removeObsoleteLidarSnapshotOverlays called with:', currentTaskIds.length, 'tasks');
    }
}

// For legacy support, attach to window (remove after migration)
console.log('[LIDAR-GRID] Exporting functions to window object');
window.setLidarGridInfo = setLidarGridInfo;
window.renderLidarSubtile = renderLidarSubtile;
window.stopSatelliteAnimationIfComplete = stopSatelliteAnimationIfComplete;
// Export the properly georeferenced snapshot function
window.showHighestAvailableLidarSnapshot = showHighestAvailableLidarSnapshot;
window.removeObsoleteLidarSnapshotOverlays = removeObsoleteLidarSnapshotOverlays;
window.detectHighestSnapshotLevel = detectHighestSnapshotLevel;
console.log('[LIDAR-GRID] Functions exported, showHighestAvailableLidarSnapshot available:', !!window.showHighestAvailableLidarSnapshot);

// Ensure global canvas variables are available for GCS polling
function ensureGlobalCanvasVariables() {
    if (!window.lidarCanvas) {
        const canvas = document.getElementById('lidar-canvas');
        if (canvas) {
            window.lidarCanvas = canvas;
            window.lidarContext = canvas.getContext('2d');
            console.log('[LIDAR-GRID] Global canvas variables initialized from existing canvas');
        }
    }
}

// Call immediately and periodically until canvas is available
ensureGlobalCanvasVariables();
const canvasCheckInterval = setInterval(() => {
    ensureGlobalCanvasVariables();
    if (window.lidarCanvas) {
        clearInterval(canvasCheckInterval);
        console.log('[LIDAR-GRID] Global canvas variables confirmed available');
    }
}, 1000);

// Trigger snapshot display for any existing tasks that were loaded before this module
function retrySnapshotDisplay(attempt = 1, maxAttempts = 10) {
    if (window.reArchaeologyApp && window.reArchaeologyApp.taskList) {
        try {
            window.reArchaeologyApp.taskList.renderTaskRectangles();
            if (window.DEBUG_LIDAR_GRID) {
                console.log('[LIDAR-GRID] Retried snapshot display for existing tasks');
            }
        } catch (error) {
            console.warn('[LIDAR-GRID] Error retrying snapshot display:', error);
        }
    } else if (attempt < maxAttempts) {
        // Retry with exponential backoff: 100ms, 200ms, 400ms, etc.
        const delay = 100 * Math.pow(2, attempt - 1);
        setTimeout(() => retrySnapshotDisplay(attempt + 1, maxAttempts), delay);
    } else if (window.DEBUG_LIDAR_GRID) {
        console.warn('[LIDAR-GRID] TaskList not available after retries');
    }
}

// Start the retry process
setTimeout(() => retrySnapshotDisplay(), 150);

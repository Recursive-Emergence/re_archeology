/**
 * GCS-Based Polling Service
 * 
 * Replaces WebSocket synchronization with simple HTTP polling of GCS progress files.
 * More scalable and simpler than real-time connections.
 */

export class GCSPollingService {
    constructor(options = {}) {
        this.pollingInterval = options.pollingInterval || 15000; // 15 seconds default
        this.activeTasks = new Set();
        this.lastCheckTimes = new Map(); // taskId -> timestamp
        this.progressCache = new Map(); // taskId -> progress data
        this.snapshotCache = new Map(); // taskId -> loaded snapshots
        
        console.log('[GCS-POLL] Service initialized with', this.pollingInterval, 'ms interval');
    }

    /**
     * Start polling a task for progress updates
     */
    startPolling(taskId) {
        if (this.activeTasks.has(taskId)) {
            console.log('[GCS-POLL] Already polling task', taskId);
            return;
        }

        this.activeTasks.add(taskId);
        console.log('[GCS-POLL] Started polling task', taskId);
        
        // Start immediate poll, then schedule recurring
        this.pollTask(taskId);
    }

    /**
     * Stop polling a specific task
     */
    stopPolling(taskId) {
        this.activeTasks.delete(taskId);
        this.lastCheckTimes.delete(taskId);
        this.stopLiveTilePolling(taskId);
        console.log('[GCS-POLL] Stopped polling task', taskId);
    }

    /**
     * Stop all polling activity
     */
    stopAllPolling() {
        this.activeTasks.clear();
        this.lastCheckTimes.clear();
        
        // Stop all live tile polling
        if (this.liveTilePollers) {
            this.liveTilePollers.clear();
        }
        
        console.log('[GCS-POLL] Stopped all polling');
    }

    /**
     * Poll a single task by discovering available snapshots
     */
    async pollTask(taskId) {
        if (!this.activeTasks.has(taskId)) {
            return; // Task was stopped
        }

        try {
            const progress = await this.discoverTaskProgress(taskId);
            
            if (progress) {
                await this.handleProgressUpdate(taskId, progress);
            } else {
                console.log('[GCS-POLL] No snapshots found for task', taskId, '- may be initializing');
            }
        } catch (error) {
            console.warn('[GCS-POLL] Error polling task', taskId, ':', error);
        }

        // Schedule next poll if task is still active
        if (this.activeTasks.has(taskId)) {
            setTimeout(() => this.pollTask(taskId), this.pollingInterval);
        }
    }

    /**
     * Discover task progress by checking available snapshot files
     */
    async discoverTaskProgress(taskId) {
        const levels = [];
        let lastActivity = null;
        
        // Check each level sequentially  
        for (let level = 0; level <= 3; level++) {
            const snapshotUrl = `https://storage.googleapis.com/re_archaeology/tasks/${taskId}/snapshots/level_${level}_color.png`;
            
            try {
                const response = await fetch(snapshotUrl, { method: 'HEAD' });
                if (response.ok) {
                    const lastModified = new Date(response.headers.get('Last-Modified'));
                    
                    levels.push({
                        level,
                        resolution: ['8m', '4m', '2m', '1m'][level],
                        status: 'completed',
                        timestamp: lastModified
                    });
                    
                    if (!lastActivity || lastModified > lastActivity) {
                        lastActivity = lastModified;
                    }
                } else {
                    // Level doesn't exist, stop checking higher levels
                    break;
                }
            } catch (e) {
                // Error checking this level, stop
                break;
            }
        }
        
        if (levels.length === 0) {
            return null; // No snapshots found
        }
        
        // Determine status based on task-list info if available, otherwise use timestamp
        let status = 'completed';
        
        // Check if task-list shows this task as running
        const app = window.app || window.reArchaeologyApp;
        if (app && app.taskList && app.taskList.tasks) {
            const taskFromList = app.taskList.tasks.find(t => t.id === taskId);
            if (taskFromList && taskFromList.status === 'running') {
                status = 'running';
            }
        }
        
        // Fallback to timestamp-based detection if not found in task list
        if (status === 'completed') {
            const now = new Date();
            const timeSinceLastActivity = lastActivity ? now - lastActivity : Infinity;
            const isScanning = timeSinceLastActivity < 30 * 60 * 1000; // Extended to 30 minutes for demo
            status = isScanning ? 'running' : 'completed';
        }
        
        return {
            taskId,
            levels,
            highest_level_completed: Math.max(...levels.map(l => l.level)),
            last_updated: lastActivity.toISOString(),
            status: status,
            completion_percentage: ((levels.length / 4) * 100).toFixed(1)
        };
    }

    /**
     * Handle progress update for a task
     */
    async handleProgressUpdate(taskId, progress) {
        const lastCheck = this.lastCheckTimes.get(taskId);
        const currentTime = new Date(progress.last_updated).getTime();
        
        // Store progress in cache
        this.progressCache.set(taskId, progress);
        
        // Check if there's new activity since last check
        if (!lastCheck || currentTime > lastCheck) {
            console.log('[GCS-POLL] New activity detected for task', taskId);
            
            // Update snapshot display
            await this.updateSnapshotDisplay(taskId, progress);
            
            // If task is actively running, start live tile polling
            if (progress.status === 'running') {
                this.startLiveTilePolling(taskId, progress);
            }
            
            // Update satellite animation
            this.updateSatelliteActivity(progress);
            
            // Update task list UI
            this.notifyTaskUpdate(taskId, progress);
            
            this.lastCheckTimes.set(taskId, currentTime);
        }
    }

    /**
     * Start polling for live tiles during active scanning
     */
    async startLiveTilePolling(taskId, progress) {
        // Don't start if already polling live tiles for this task
        if (this.liveTilePollers && this.liveTilePollers.has(taskId)) {
            return;
        }

        if (!this.liveTilePollers) {
            this.liveTilePollers = new Set();
        }

        this.liveTilePollers.add(taskId);
        console.log('[GCS-POLL] Starting live tile polling for task', taskId);

        // Poll for new tiles more frequently during active scanning
        this.pollLiveTiles(taskId, progress);
    }

    /**
     * Poll for new individual tiles during active scanning
     */
    async pollLiveTiles(taskId, progress) {
        if (!this.liveTilePollers || !this.liveTilePollers.has(taskId)) {
            return; // Stopped
        }

        // Polling silently to reduce console noise

        try {
            // Only check levels beyond what's already shown in snapshots
            const highestLevel = progress.highest_level_completed;
            const levelsToCheck = [];
            
            // Get the current snapshot level to avoid redundant polling
            const snapshotLevel = this.getCurrentSnapshotLevel(taskId);
            
            // Only poll for levels higher than the snapshot level
            // This avoids redundant tile loading since snapshots already show the overview
            const startLevel = Math.max(highestLevel, snapshotLevel + 1);
            
            if (startLevel <= 3) {
                levelsToCheck.push(startLevel);
                
                // Also check the next level if available
                const nextLevel = startLevel + 1;
                if (nextLevel <= 3) {
                    levelsToCheck.push(nextLevel);
                }
            }
            
            // Only log when actually checking new levels
            if (levelsToCheck.length > 0) {
                console.log('[GCS-POLL] Checking levels beyond snapshot:', levelsToCheck);
            }
            
            let totalNewTiles = 0;
            for (const level of levelsToCheck) {
                const newTiles = await this.discoverNewTiles(taskId, level);
                // Only log when significant new tiles are found
                if (newTiles.length > 10) {
                    console.log('[GCS-POLL] Level', level, 'found', newTiles.length, 'new tiles');
                }
                
                if (newTiles.length > 0) {
                    // Process new tiles
                    for (const tile of newTiles) {
                        await this.processNewTile(taskId, tile);
                    }
                    totalNewTiles += newTiles.length;
                }
            }
            
            if (totalNewTiles > 20) {
                console.log('[GCS-POLL] Processed', totalNewTiles, 'new tiles for task', taskId.slice(0, 8));
                
                // Update satellite animation to show activity
                const animationSystem = window.app?.lidarAnimationSystem;
                if (animationSystem) {
                    animationSystem.lastTileTime = Date.now();
                    animationSystem.updateSatelliteState();
                }
            }
            
        } catch (error) {
            console.warn('[GCS-POLL] Error polling live tiles for task', taskId, ':', error);
        }

        // Continue polling if task is still active
        if (this.liveTilePollers && this.liveTilePollers.has(taskId)) {
            setTimeout(() => this.pollLiveTiles(taskId, progress), 5000); // More frequent for live tiles
        }
    }

    /**
     * Discover new tiles that have been uploaded since last check
     */
    async discoverNewTiles(taskId, level) {
        const newTiles = [];
        const cacheKey = `${taskId}-${level}-tiles`;
        const knownTiles = this.tileCache?.get(cacheKey) || new Set();
        
        if (!this.tileCache) {
            this.tileCache = new Map();
        }

        // Discovery runs silently to reduce console noise

        // Get task info to determine actual grid size
        const app = window.app || window.App || window.reArchaeologyApp;
        const taskList = app?.taskList;
        const task = taskList?.tasks?.find(t => t.id === taskId);
        
        // Use actual task grid dimensions or reasonable defaults
        let maxRow = 5, maxCol = 5; // Fallback defaults
        
        if (task) {
            // Try different possible grid size fields
            maxRow = task.grid_rows || task.gridRows || task.grid_y || maxRow;
            maxCol = task.grid_cols || task.gridCols || task.grid_x || maxCol;
        }
        
        let checkedCount = 0;
        let foundCount = 0;
        
        // Calculate check limit based on grid size
        const checkLimit = Math.max(50, maxRow * maxCol * 2);

        // Check a more focused range first
        for (let row = 0; row < maxRow; row++) {
            for (let col = 0; col < maxCol; col++) {
                // For each level, check different subtile patterns based on resolution
                const maxSubtiles = level === 0 ? 1 : (level === 1 ? 2 : (level === 2 ? 4 : 8));
                
                for (let subRow = 0; subRow < maxSubtiles; subRow++) {
                    for (let subCol = 0; subCol < maxSubtiles; subCol++) {
                        const tileKey = `${level}-${row}-${col}-${subRow}-${subCol}`;
                        
                        if (knownTiles.has(tileKey)) {
                            continue; // Already processed
                        }

                        const tileUrl = `https://storage.googleapis.com/re_archaeology/tasks/${taskId}/cache/subtile_data/level_${level}/tile_${row}_${col}/subtile_${subRow}_${subCol}.json`;
                        checkedCount++;
                        
                        try {
                            const response = await fetch(tileUrl, { method: 'HEAD' });
                            if (response.ok) {
                                // New tile found - logged silently
                                knownTiles.add(tileKey);
                                foundCount++;
                                newTiles.push({
                                    url: tileUrl,
                                    level,
                                    row,
                                    col,
                                    subRow,
                                    subCol,
                                    key: tileKey
                                });
                            }
                        } catch (e) {
                            // Tile doesn't exist, continue
                        }
                        
                        // Limit the number of requests per discovery cycle
                        if (checkedCount >= checkLimit) {
                            break;
                        }
                    }
                    if (checkedCount >= checkLimit) break;
                }
                if (checkedCount >= checkLimit) break;
            }
            if (checkedCount >= checkLimit) break;
        }

        // Only log discovery results when significant number of tiles are found
        if (foundCount > 10) {
            console.log('[GCS-POLL] Found', foundCount, 'new tiles for level', level);
        }

        // Update cache
        this.tileCache.set(cacheKey, knownTiles);
        
        return newTiles;
    }

    /**
     * Process a newly discovered tile
     */
    async processNewTile(taskId, tileInfo) {
        try {
            // Processing tiles silently to reduce console noise
            
            // Fetch the actual tile data
            const response = await fetch(tileInfo.url);
            if (response.ok) {
                const tileData = await response.json();
                // Tile processing runs silently now that color issue is resolved
                
                // Validate tile data before rendering
                if (!this.validateTileData(tileData)) {
                    console.warn('[GCS-POLL] Invalid tile data, skipping:', tileInfo.key);
                    return;
                }
                
                // Add task identification
                tileData.task_id = taskId;
                tileData.tile_key = tileInfo.key;
                
                // Add level info from tile position  
                tileData.level = tileInfo.level;
                
                // Fix color if it's pure red (backend issue) - generate from elevation
                if (Array.isArray(tileData.color) && 
                    tileData.color[0] === 255 && tileData.color[1] === 0 && tileData.color[2] === 0 &&
                    typeof tileData.elevation === 'number') {
                    tileData.color = this.elevationToTerrainColor(tileData.elevation);
                }
                
                // Render the tile using existing system (renderLidarSubtile handles animation internally)
                if (window.renderLidarSubtile) {
                    window.renderLidarSubtile(tileData);
                } else {
                    console.warn('[GCS-POLL] renderLidarSubtile function not available');
                }
            } else {
                console.warn('[GCS-POLL] Failed to fetch tile data:', response.status);
            }
        } catch (error) {
            console.warn('[GCS-POLL] Error processing new tile:', error);
        }
    }

    /**
     * Validate tile data to ensure it has necessary fields
     */
    validateTileData(tileData) {
        // Check for required coordinate fields
        if (!tileData.lat || !tileData.lon) {
            console.warn('[GCS-POLL] Missing lat/lon coordinates in tile data');
            return false;
        }
        
        // Check for valid bounds (if available)
        if (tileData.subtile_lat0 !== undefined && tileData.subtile_lat1 !== undefined && 
            tileData.subtile_lon0 !== undefined && tileData.subtile_lon1 !== undefined) {
            if (isNaN(tileData.subtile_lat0) || isNaN(tileData.subtile_lat1) || 
                isNaN(tileData.subtile_lon0) || isNaN(tileData.subtile_lon1)) {
                console.warn('[GCS-POLL] Invalid bounds in tile data');
                return false;
            }
        }
        
        // Check for valid color data
        if (tileData.color) {
            if (Array.isArray(tileData.color)) {
                // RGB array should have 3 values
                if (tileData.color.length !== 3 || tileData.color.some(v => isNaN(v) || v < 0 || v > 255)) {
                    console.warn('[GCS-POLL] Invalid RGB color array in tile data');
                    // Don't reject, just use default color
                    delete tileData.color;
                }
            } else if (typeof tileData.color === 'string') {
                // Valid CSS color string
                if (!tileData.color.match(/^#[0-9A-Fa-f]{6}$|^#[0-9A-Fa-f]{3}$|^rgb\(|^rgba\(/)) {
                    console.warn('[GCS-POLL] Invalid CSS color string in tile data');
                    delete tileData.color;
                }
            }
        }
        
        return true;
    }

    /**
     * Convert elevation to terrain color using the same logic as map-visualization.js
     */
    elevationToTerrainColor(elevation) {
        // Normalize elevation to 0-1 range (approximate global range)
        // Typical elevation range: 0m (sea level) to 8848m (Everest)
        // For most terrain: 0m to 3000m is a reasonable range
        const minElev = 0;
        const maxElev = 1000; // Adjust based on typical terrain in area
        const normalized = Math.max(0, Math.min(1, (elevation - minElev) / (maxElev - minElev)));
        
        let r, g, b;
        
        if (normalized < 0.2) {
            // Deep blue to blue (low elevations)
            const t = normalized / 0.2;
            r = Math.floor(30 * t);
            g = Math.floor(100 * t);
            b = Math.floor(120 + 135 * t);
        } else if (normalized < 0.4) {
            // Blue to cyan
            const t = (normalized - 0.2) / 0.2;
            r = Math.floor(30);
            g = Math.floor(100 + 155 * t);
            b = 255;
        } else if (normalized < 0.6) {
            // Cyan to green
            const t = (normalized - 0.4) / 0.2;
            r = Math.floor(30 * (1 - t));
            g = 255;
            b = Math.floor(255 * (1 - t));
        } else if (normalized < 0.8) {
            // Green to yellow
            const t = (normalized - 0.6) / 0.2;
            r = Math.floor(255 * t);
            g = 255;
            b = 0;
        } else {
            // Yellow to red (high elevations)
            const t = (normalized - 0.8) / 0.2;
            r = 255;
            g = Math.floor(255 * (1 - t));
            b = 0;
        }
        
        return [r, g, b];
    }

    /**
     * Enhance tile data with proper bounds based on task info and tile position
     */
    enhanceTileDataWithBounds(tileData, tileInfo, taskId) {
        // Check if tile already has bounds - if so, don't override them
        if (tileData.subtile_lat0 !== undefined && tileData.subtile_lat1 !== undefined &&
            tileData.subtile_lon0 !== undefined && tileData.subtile_lon1 !== undefined) {
            // Tile already has bounds, just add level info
            tileData.level = tileInfo.level;
            console.log('[GCS-POLL] Tile already has bounds, using existing:', {
                bounds: [tileData.subtile_lat0, tileData.subtile_lon0, tileData.subtile_lat1, tileData.subtile_lon1],
                level: tileInfo.level
            });
            return;
        }

        // Only calculate bounds if they're missing
        const level = tileInfo.level;
        const resolutions = [8, 4, 2, 1]; // meters per pixel for levels 0-3
        const tileSizeM = resolutions[level] || 2; // fallback to 2m
        
        // Convert tile size from meters to degrees (approximate)
        const lat = tileData.lat;
        const tileSizeDegLat = tileSizeM / 111000; // ~111km per degree latitude
        const tileSizeDegLon = tileSizeM / (111000 * Math.cos(lat * Math.PI / 180)); // adjust for longitude
        
        // Calculate tile bounds centered on the tile coordinates
        const halfSizeLat = tileSizeDegLat / 2;
        const halfSizeLon = tileSizeDegLon / 2;
        
        tileData.subtile_lat0 = lat - halfSizeLat; // south
        tileData.subtile_lat1 = lat + halfSizeLat; // north  
        tileData.subtile_lon0 = tileData.lon - halfSizeLon; // west
        tileData.subtile_lon1 = tileData.lon + halfSizeLon; // east
        tileData.level = level;
        
        console.log('[GCS-POLL] Calculated bounds for tile missing bounds:', {
            center: [lat, tileData.lon],
            bounds: [tileData.subtile_lat0, tileData.subtile_lon0, tileData.subtile_lat1, tileData.subtile_lon1],
            level: level,
            tileSizeM: tileSizeM
        });
    }

    /**
     * Get the current snapshot level being displayed for a task
     */
    getCurrentSnapshotLevel(taskId) {
        // Check if there are active snapshot overlays for this task
        if (typeof window.lidarSnapshotOverlays !== 'undefined' && window.lidarSnapshotOverlays) {
            const overlay = window.lidarSnapshotOverlays.get(taskId);
            if (overlay && overlay._snapshotLevel !== undefined) {
                return overlay._snapshotLevel;
            }
        }
        
        // Fallback: detect from cached progress data
        const progress = this.progressCache.get(taskId);
        if (progress && progress.levels && progress.levels.length > 0) {
            // Return the highest completed level as the likely snapshot level
            return Math.max(...progress.levels.map(l => l.level));
        }
        
        // Default to -1 if no snapshot detected (will poll all levels)
        return -1;
    }

    /**
     * Stop live tile polling for a task
     */
    stopLiveTilePolling(taskId) {
        if (this.liveTilePollers) {
            this.liveTilePollers.delete(taskId);
            console.log('[GCS-POLL] Stopped live tile polling for task', taskId);
        }
    }

    /**
     * Update snapshot display based on progress
     */
    async updateSnapshotDisplay(taskId, progress) {
        const highestLevel = progress.highest_level_completed;
        
        if (highestLevel >= 0) {
            // Check current zoom to determine optimal level
            const app = window.app || window.App || window.reArchaeologyApp;
            const currentZoom = app?.map?.getZoom() || 12;
            const optimalLevel = this.getOptimalSnapshotLevel(currentZoom, progress.levels);
            
            // Load snapshot if we have it and it's not already loaded
            const cacheKey = `${taskId}-${optimalLevel}`;
            if (!this.snapshotCache.has(cacheKey)) {
                await this.loadSnapshot(taskId, optimalLevel);
                this.snapshotCache.set(cacheKey, true);
            }
        }
    }

    /**
     * Determine optimal snapshot level based on zoom and available levels
     */
    getOptimalSnapshotLevel(zoomLevel, levels) {
        const completedLevels = levels
            .filter(l => l.status === 'completed')
            .map(l => l.level)
            .sort((a, b) => b - a); // Highest first

        // Prefer highest resolution for high zoom levels
        if (zoomLevel >= 16 && completedLevels.includes(3)) return 3; // 1m
        if (zoomLevel >= 14 && completedLevels.includes(2)) return 2; // 2m  
        if (zoomLevel >= 12 && completedLevels.includes(1)) return 1; // 4m
        
        // Default to highest available level
        return completedLevels[0] || 0;
    }

    /**
     * Load snapshot overlay for a task and level
     */
    async loadSnapshot(taskId, level) {
        try {
            const snapshotUrl = `https://storage.googleapis.com/re_archaeology/tasks/${taskId}/snapshots/level_${level}_color.png`;
            const metaUrl = `https://storage.googleapis.com/re_archaeology/tasks/${taskId}/snapshots/level_${level}_meta.json`;
            
            // Check if snapshot exists
            const snapshotResponse = await fetch(snapshotUrl, { method: 'HEAD' });
            if (!snapshotResponse.ok) {
                console.log('[GCS-POLL] Snapshot not available yet for task', taskId, 'level', level);
                return;
            }

            // Load metadata for bounds
            let bounds = null;
            try {
                const metaResponse = await fetch(metaUrl);
                if (metaResponse.ok) {
                    const meta = await metaResponse.json();
                    if (meta.south_lat !== undefined && meta.north_lat !== undefined &&
                        meta.west_lon !== undefined && meta.east_lon !== undefined) {
                        bounds = [
                            [meta.south_lat, meta.west_lon],
                            [meta.north_lat, meta.east_lon]
                        ];
                    }
                }
            } catch (e) {
                console.warn('[GCS-POLL] Could not load metadata for task', taskId, 'level', level);
            }

            // Use existing snapshot loading system
            if (window.showLidarSnapshot && bounds) {
                window.showLidarSnapshot(taskId, level, bounds);
                console.log('[GCS-POLL] Loaded snapshot for task', taskId, 'level', level);
            }
            
        } catch (error) {
            console.error('[GCS-POLL] Error loading snapshot:', error);
        }
    }

    /**
     * Update satellite animation based on progress
     */
    updateSatelliteActivity(progress) {
        const app = window.app || window.App || window.reArchaeologyApp;
        const animationSystem = app?.lidarAnimationSystem;
        
        if (animationSystem) {
            const lastUpdate = new Date(progress.last_updated).getTime();
            const now = Date.now();
            const timeSinceUpdate = now - lastUpdate;
            
            // Show activity if updated within last 60 seconds
            if (timeSinceUpdate < 60000) {
                animationSystem.lastTileTime = lastUpdate;
                animationSystem.updateSatelliteState();
                
                // Brief beam animation to show activity
                if (timeSinceUpdate < 10000) { // Very recent activity
                    this.showActivityBeam();
                }
            }
        }
    }

    /**
     * Show brief beam animation for recent activity
     */
    showActivityBeam() {
        const app = window.app || window.App || window.reArchaeologyApp;
        const animationSystem = app?.lidarAnimationSystem;
        
        if (animationSystem && animationSystem.satelliteIcon) {
            // Create a brief beam effect at map center
            const map = app.map;
            if (map) {
                const center = map.getCenter();
                // Use existing beam animation with map center as target
                if (animationSystem.showScanBeam) {
                    animationSystem.showScanBeam(center.lat, center.lng);
                    setTimeout(() => {
                        animationSystem.hideScanBeam();
                    }, 1000);
                }
            }
        }
    }

    /**
     * Notify task list of progress updates
     */
    notifyTaskUpdate(taskId, progress) {
        // Dispatch custom event for task list to handle
        window.dispatchEvent(new CustomEvent('gcs-task-update', {
            detail: { taskId, progress }
        }));
    }

    /**
     * Get cached progress for a task
     */
    getTaskProgress(taskId) {
        return this.progressCache.get(taskId);
    }

    /**
     * Get all active tasks being polled
     */
    getActiveTasks() {
        return Array.from(this.activeTasks);
    }

    /**
     * Update polling interval for all tasks
     */
    setPollingInterval(intervalMs) {
        this.pollingInterval = intervalMs;
        console.log('[GCS-POLL] Updated polling interval to', intervalMs, 'ms');
    }

    /**
     * Debug function to manually check for tiles
     */
    async debugCheckTiles(taskId, level = 0) {
        console.log('[GCS-POLL-DEBUG] Manually checking tiles for task', taskId, 'level', level);
        
        // Try a few specific tile URLs to see what exists
        const testTiles = [
            { row: 0, col: 0, subRow: 0, subCol: 0 },
            { row: 0, col: 1, subRow: 0, subCol: 0 },
            { row: 1, col: 0, subRow: 0, subCol: 0 },
            { row: 0, col: 0, subRow: 1, subCol: 0 },
            { row: 0, col: 0, subRow: 0, subCol: 1 }
        ];

        for (const tile of testTiles) {
            const tileUrl = `https://storage.googleapis.com/re_archaeology/tasks/${taskId}/cache/subtile_data/level_${level}/tile_${tile.row}_${tile.col}/subtile_${tile.subRow}_${tile.subCol}.json`;
            
            try {
                const response = await fetch(tileUrl, { method: 'HEAD' });
                console.log('[GCS-POLL-DEBUG] Tile', `${tile.row}_${tile.col}_${tile.subRow}_${tile.subCol}`, response.ok ? 'EXISTS' : 'NOT FOUND', response.status);
                
                if (response.ok) {
                    // Try to fetch the actual data
                    const dataResponse = await fetch(tileUrl);
                    if (dataResponse.ok) {
                        const data = await dataResponse.json();
                        console.log('[GCS-POLL-DEBUG] Tile data sample:', data);
                    }
                }
            } catch (error) {
                console.log('[GCS-POLL-DEBUG] Error checking tile:', error);
            }
        }
    }
}

// Create global instance
export const gcsPollingService = new GCSPollingService();

// Make available globally for backward compatibility
if (typeof window !== 'undefined') {
    window.GCSPollingService = GCSPollingService;
    window.gcsPollingService = gcsPollingService;
}
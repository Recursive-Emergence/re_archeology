// WebSocket connection and message handling
let lidarResolutionFetched = false;

export function connectWebSocket(app) {
    try {
        if (app.websocket) {
            // console.log('🔌 Closing existing WebSocket connection'); // Suppressed for clean UI
            app.websocket.close();
            app.websocket = null;
        }
        const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${wsProtocol}//${window.location.host}/api/v1/ws/discovery`;
        // console.log('🔌 Connecting to WebSocket:', wsUrl); // Suppressed for clean UI
        app.websocket = new WebSocket(wsUrl);
        app.websocket.onopen = () => {
            // console.log('✅ WebSocket connected successfully'); // Suppressed for clean UI
            app.websocket.send(JSON.stringify({
                type: 'ping',
                timestamp: new Date().toISOString()
            }));
        };
        app.websocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(app, data);
            } catch (error) {
                // console.error('❌ WebSocket message error:', error); // Suppressed for clean UI
            }
        };
        app.websocket.onclose = (event) => {
            // console.log('🔌 WebSocket disconnected:', event.code, event.reason); // Suppressed for clean UI
            app.websocket = null;
            if (app.currentLidarSession) {
                setTimeout(() => connectWebSocket(app), 2000);
            }
        };
        app.websocket.onerror = (error) => {
            // console.error('❌ WebSocket error:', error); // Suppressed for clean UI
        };
    } catch (error) {
        // console.error('❌ Failed to connect WebSocket:', error); // Suppressed for clean UI
    }
}

export function handleWebSocketMessage(app, data) {
    if (window.Logger && data.type !== 'lidar_tile') {
        window.Logger.websocket('debug', `Message received: ${data.type}`, { keys: Object.keys(data) });
    }
    if (data.type === 'lidar_tile') {
        // Update resolution from actual tile data when first tile arrives
        if (!lidarResolutionFetched && data.actual_resolution) {
            lidarResolutionFetched = true;
            import('./map.js').then(({ updateScanAreaLabel }) => {
                updateScanAreaLabel(app, data.actual_resolution);
            }).catch(err => console.warn('Failed to import map functions:', err));
        }
    }
    if (data.type === 'patch_result') {
        app.handlePatchResult?.(data.patch || data);
    }
    if (data.type === 'detection_result') {
        app.handleDetectionResult?.(data);
    }
    switch (data.type) {
        case 'grid_info':
            // Always set grid info before any lidar_tile is rendered
            if (typeof window.setLidarGridInfo === 'function') {
                window.setLidarGridInfo(
                    { grid_x: data.grid_x, grid_y: data.grid_y, bounds: data.bounds },
                    window.currentTaskId || (window.reArchaeologyApp && window.reArchaeologyApp.currentTaskId)
                );
            }
            // Set currentScanArea from grid/task boundary if available
            if (data.bounds) {
                app.currentScanArea = { bounds: data.bounds };
                if (window.Logger) {
                    window.Logger.websocket('info', '[grid_info] Received bounds:', data.bounds);
                } else {
                    console.log('[grid_info] Received bounds:', data.bounds);
                }
            } else {
                // Optionally: compute bounds from grid origin/size if needed
                // app.currentScanArea = ...
            }
            break;
        case 'lidar_tile':
            // Start scanning animation if not already started
            if (!app.isScanning && !app.animationState?.isActive) {
                if (typeof app.startScanningAnimation === 'function') {
                    app.startScanningAnimation('satellite');
                }
                app.isScanning = true;
            }
            // Deduplicate: skip if this tile was already restored from cache
            if (typeof app.isTileRestored === 'function' && app.isTileRestored(data)) {
                // Optionally log: console.log('Skipping duplicate websocket tile', data);
                break;
            }
            app.handleLidarTileUpdate?.(data);
            break;
        case 'lidar_heatmap_tile':
            app.handleLidarHeatmapTileUpdate?.(data);
            break;
        case 'lidar_progress':
            // ...handle progress if needed...
            break;
        case 'session_completed':
        case 'session_complete':
        case 'lidar_completed':
            app.completeDetectionAnimation?.();
            break;
        case 'session_stopped':
            // Stop animations when session is stopped
            if (typeof app.stopScanningAnimation === 'function') {
                app.stopScanningAnimation();
            }
            app.isScanning = false;
            app.currentLidarSession = null;
            break;
        case 'session_failed':
        case 'lidar_error':
            // Stop animations when session fails
            if (typeof app.stopScanningAnimation === 'function') {
                app.stopScanningAnimation();
            }
            app.isScanning = false;
            app.currentLidarSession = null;
            break;
        case 'task_resumed':
            // Enable heatmap visualization for resumed task
            if (app.mapVisualization && typeof app.mapVisualization.enableHeatmapMode === 'function') {
                app.mapVisualization.enableHeatmapMode();
            }
            // Start scanning animation to show activity (with delay for proper initialization)
            if (!app.isScanning && !app.animationState?.isActive) {
                // Stop any existing animation first to prevent duplicates
                if (typeof app.stopScanningAnimation === 'function') {
                    app.stopScanningAnimation();
                }
                
                setTimeout(() => {
                    if (typeof app.startScanningAnimation === 'function' && 
                        !app.isScanning && !app.animationState?.isActive) {
                        app.startScanningAnimation('satellite');
                        app.isScanning = true;
                        app.currentLidarSession = data.session_id;
                    }
                }, 100);
            }
            
            // Immediately refresh task list to show updated status
            if (app.taskList && typeof app.taskList.loadTasks === 'function') {
                // Clear cache first to ensure fresh data
                if (app.taskList.taskService && typeof app.taskList.taskService.clearCache === 'function') {
                    app.taskList.taskService.clearCache();
                }
                setTimeout(() => app.taskList.loadTasks(), 150);
            }
            break;
        case 'session_start':
            // Handle session start, especially for restarted tasks
            if (data.restart) {
                // This is a restarted session, ensure satellite animation starts properly
                if (!app.isScanning && !app.animationState?.isActive) {
                    // Stop any existing animation first
                    if (typeof app.stopScanningAnimation === 'function') {
                        app.stopScanningAnimation();
                    }
                    
                    setTimeout(() => {
                        if (typeof app.startScanningAnimation === 'function' && 
                            !app.isScanning && !app.animationState?.isActive) {
                            app.startScanningAnimation('satellite');
                            app.isScanning = true;
                            app.currentLidarSession = data.session_id;
                        }
                    }, 300);
                }
                
                // Immediately refresh task list to show updated status
                if (app.taskList && typeof app.taskList.loadTasks === 'function') {
                    // Clear cache first to ensure fresh data
                    if (app.taskList.taskService && typeof app.taskList.taskService.clearCache === 'function') {
                        app.taskList.taskService.clearCache();
                    }
                    setTimeout(() => app.taskList.loadTasks(), 350);
                }
            }
            break;
        case 'task_paused':
            // Stop animations when task is paused
            if (typeof app.stopScanningAnimation === 'function') {
                app.stopScanningAnimation();
            }
            app.isScanning = false;
            app.currentLidarSession = null;
            
            // Handle task paused notification
            if (app.taskList && typeof app.taskList.loadTasks === 'function') {
                // Clear cache first to ensure fresh data
                if (app.taskList.taskService && typeof app.taskList.taskService.clearCache === 'function') {
                    app.taskList.taskService.clearCache();
                }
                app.taskList.loadTasks();
            }
            break;
        case 'task_aborted':
            // Stop animations when task is aborted
            if (typeof app.stopScanningAnimation === 'function') {
                app.stopScanningAnimation();
            }
            app.isScanning = false;
            app.currentLidarSession = null;
            
            // Handle task aborted notification
            if (app.taskList && typeof app.taskList.loadTasks === 'function') {
                // Clear cache first to ensure fresh data
                if (app.taskList.taskService && typeof app.taskList.taskService.clearCache === 'function') {
                    app.taskList.taskService.clearCache();
                }
                app.taskList.loadTasks();
            }
            break;
        case 'done':
            // Stop animation and reset scan state on backend 'done' message
            if (typeof app.stopScanningAnimation === 'function') {
                app.stopScanningAnimation();
            }
            app.isScanning = false;
            app.currentLidarSession = null;
            break;
        default:
            break;
    }
}

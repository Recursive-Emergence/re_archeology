// WebSocket connection and message handling
let lidarResolutionFetched = false;

/*
 * Smart Resume WebSocket Messages:
 * 
 * Frontend -> Backend:
 * {
 *   type: 'request_catchup',
 *   session_id: string,
 *   task_id: string,
 *   highest_snapshot_level: number,  // -1 if no snapshots found, 0-3 for levels
 *   resume_from_level: number,       // next level to scan (highest_snapshot_level + 1)
 *   timestamp: string
 * }
 * 
 * {
 *   type: 'resume_task',
 *   task_id: string,
 *   highest_snapshot_level: number,
 *   resume_from_level: number,
 *   timestamp: string
 * }
 * 
 * Backend should use resume_from_level to determine where to restart scanning
 * instead of starting from level 0.
 */

/**
 * Trigger comprehensive catch-up for running tasks after page refresh
 */
export function triggerCatchupForRunningTasks(app, runningTasks) {
    console.log('[WEBSOCKET] Triggering catch-up for running tasks:', runningTasks.map(t => t.id));
    
    runningTasks.forEach(async (task) => {
        // Set session info if available
        if (task.session_id || task.sessions?.scan) {
            app.currentLidarSession = task.session_id || task.sessions.scan;
        }
        
        // Detect highest available snapshot level for smart resume
        let highestSnapshotLevel = -1;
        if (window.detectHighestSnapshotLevel) {
            try {
                highestSnapshotLevel = await window.detectHighestSnapshotLevel(task.id);
                console.log(`[WEBSOCKET] Detected highest snapshot level for task ${task.id}: ${highestSnapshotLevel}`);
            } catch (err) {
                console.warn(`[WEBSOCKET] Failed to detect snapshot level for task ${task.id}:`, err);
            }
        }
        
        // Load cached bitmap for visual restoration
        if (app.loadCachedBitmapForTask) {
            app.loadCachedBitmapForTask(task.id).catch(err => 
                console.warn('[WEBSOCKET] Failed to load cached bitmap during catch-up:', err)
            );
        }
        
        // Load cached tiles for detailed restoration
        if (app.loadCachedTilesForTask && task.grid_x && task.grid_y) {
            const options = {
                gridX: task.grid_x,
                gridY: task.grid_y,
                levels: task.levels || undefined
            };
            app.loadCachedTilesForTask(task.id, options).catch(err => 
                console.warn('[WEBSOCKET] Failed to load cached tiles during catch-up:', err)
            );
        }
        
        // Send catch-up request with snapshot level information
        if (app.websocket && app.websocket.readyState === WebSocket.OPEN && app.currentLidarSession) {
            console.log('[WEBSOCKET] Sending smart catch-up request for session:', app.currentLidarSession);
            app.websocket.send(JSON.stringify({
                type: 'request_catchup',
                session_id: app.currentLidarSession,
                task_id: task.id,
                highest_snapshot_level: highestSnapshotLevel,
                resume_from_level: highestSnapshotLevel >= 0 ? highestSnapshotLevel + 1 : 0,
                timestamp: new Date().toISOString()
            }));
        }
    });
}

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
            
            // Request catch-up for any ongoing sessions with snapshot level detection
            if (app.currentLidarSession && app.currentTaskId) {
                console.log('[WEBSOCKET] Requesting catch-up for session:', app.currentLidarSession);
                
                // Try to detect highest snapshot level for smart resume
                if (window.detectHighestSnapshotLevel) {
                    window.detectHighestSnapshotLevel(app.currentTaskId).then(highestSnapshotLevel => {
                        console.log(`[WEBSOCKET] Detected highest snapshot level for reconnection: ${highestSnapshotLevel}`);
                        app.websocket.send(JSON.stringify({
                            type: 'request_catchup',
                            session_id: app.currentLidarSession,
                            task_id: app.currentTaskId,
                            highest_snapshot_level: highestSnapshotLevel,
                            resume_from_level: highestSnapshotLevel >= 0 ? highestSnapshotLevel + 1 : 0,
                            timestamp: new Date().toISOString()
                        }));
                    }).catch(err => {
                        console.warn('[WEBSOCKET] Failed to detect snapshot level on reconnect:', err);
                        // Fallback to basic catch-up request
                        app.websocket.send(JSON.stringify({
                            type: 'request_catchup',
                            session_id: app.currentLidarSession,
                            timestamp: new Date().toISOString()
                        }));
                    });
                } else {
                    // Fallback to basic catch-up request
                    app.websocket.send(JSON.stringify({
                        type: 'request_catchup',
                        session_id: app.currentLidarSession,
                        timestamp: new Date().toISOString()
                    }));
                }
            }
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
            // Also render the tile in the lidar grid with animation
            if (window.renderLidarSubtile) {
                window.renderLidarSubtile(data);
            }
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
            // Stop satellite animation when scanning completes
            if (typeof app.stopScanningAnimation === 'function') {
                app.stopScanningAnimation();
            }
            app.isScanning = false;
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
            
            // Trigger catch-up for resumed task
            if (data.task_id && app.loadCachedBitmapForTask) {
                console.log('[WEBSOCKET] Triggering catch-up for resumed task:', data.task_id);
                setTimeout(() => {
                    app.loadCachedBitmapForTask(data.task_id).catch(err => 
                        console.warn('[WEBSOCKET] Failed to catch-up bitmap for resumed task:', err)
                    );
                }, 200);
            }
            
            // Immediately refresh task list to show updated status (silent refresh)
            if (app.taskList && typeof app.taskList.backgroundRefresh === 'function') {
                setTimeout(() => app.taskList.backgroundRefresh(), 150);
            } else if (app.taskList && typeof app.taskList.loadTasks === 'function') {
                console.warn('[WEBSOCKET] Falling back to loadTasks for task_resumed');
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
                
                // Immediately refresh task list to show updated status (silent refresh)
                if (app.taskList && typeof app.taskList.backgroundRefresh === 'function') {
                    setTimeout(() => app.taskList.backgroundRefresh(), 350);
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
            
            // Handle task paused notification (silent refresh)
            if (app.taskList && typeof app.taskList.backgroundRefresh === 'function') {
                app.taskList.backgroundRefresh();
            }
            break;
        case 'task_aborted':
            // Stop animations when task is aborted
            if (typeof app.stopScanningAnimation === 'function') {
                app.stopScanningAnimation();
            }
            app.isScanning = false;
            app.currentLidarSession = null;
            
            // Handle task aborted notification (silent refresh)
            if (app.taskList && typeof app.taskList.backgroundRefresh === 'function') {
                app.taskList.backgroundRefresh();
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

/**
 * Smart resume function for individual tasks
 */
export async function smartResumeTask(app, taskId) {
    console.log('[WEBSOCKET] Smart resume for task:', taskId);
    
    try {
        // Detect highest available snapshot level
        let highestSnapshotLevel = -1;
        if (window.detectHighestSnapshotLevel) {
            highestSnapshotLevel = await window.detectHighestSnapshotLevel(taskId);
            console.log(`[WEBSOCKET] Detected highest snapshot level for task ${taskId}: ${highestSnapshotLevel}`);
        }
        
        // Load cached bitmap for visual restoration
        if (app.loadCachedBitmapForTask) {
            await app.loadCachedBitmapForTask(taskId);
        }
        
        // If WebSocket is connected, send smart resume request
        if (app.websocket && app.websocket.readyState === WebSocket.OPEN) {
            console.log('[WEBSOCKET] Sending smart resume request for task:', taskId);
            app.websocket.send(JSON.stringify({
                type: 'resume_task',
                task_id: taskId,
                highest_snapshot_level: highestSnapshotLevel,
                resume_from_level: highestSnapshotLevel >= 0 ? highestSnapshotLevel + 1 : 0,
                timestamp: new Date().toISOString()
            }));
            
            return {
                success: true,
                resumeFromLevel: highestSnapshotLevel >= 0 ? highestSnapshotLevel + 1 : 0,
                highestSnapshotLevel: highestSnapshotLevel
            };
        }
        
        return {
            success: false,
            error: 'WebSocket not connected'
        };
        
    } catch (error) {
        console.error('[WEBSOCKET] Failed to smart resume task:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Make catch-up functions available globally
window.triggerCatchupForRunningTasks = triggerCatchupForRunningTasks;
window.smartResumeTask = smartResumeTask;

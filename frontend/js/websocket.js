// WebSocket connection and message handling
let lidarResolutionFetched = false;

/*
 * Smart Resume WebSocket Messages:
 * 
 * Resume Strategy:
 * 1. Frontend loads snapshot overlay showing progress up to highest_snapshot_level
 * 2. Backend resumes scanning from resume_from_level (highest_snapshot_level + 1)
 * 3. Only NEW tiles beyond the snapshot are streamed to frontend
 * 4. No re-fetching of cached tiles that are already visible in snapshot
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
    
    // Show restoration status
    if (runningTasks.length > 0) {
        console.log(`[WEBSOCKET] 🔄 Restoring ${runningTasks.length} running task(s) after page refresh...`);
    }
    
    runningTasks.forEach(async (task) => {
        // Set session info if available
        if (task.session_id || task.sessions?.scan) {
            app.currentLidarSession = task.session_id || task.sessions.scan;
        }
        
        // Only perform restoration if websocket is connected
        let highestSnapshotLevel = -1;
        if (app.websocket && app.websocket.readyState === WebSocket.OPEN) {
            // Detect highest available snapshot level for smart resume
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
        }
        
        // Resume Strategy: Use snapshots + new streaming tiles
        // 1. Snapshot overlay shows the existing state up to highest_snapshot_level
        // 2. Backend will stream NEW tiles from resume_from_level onwards
        // 3. No need to re-fetch cached individual tiles from GCS
        if (window.Logger) {
            window.Logger.debug('websocket', `[WEBSOCKET] Resume strategy: snapshot overlay + new streaming tiles for task ${task.id}`);
        }
        
        // Send catch-up request with snapshot level information
        if (app.websocket && app.websocket.readyState === WebSocket.OPEN) {
            // Set session if available from task data
            if (task.session_id || task.sessions?.scan) {
                app.currentLidarSession = task.session_id || task.sessions.scan;
            }
            
            if (app.currentLidarSession) {
                console.log('[WEBSOCKET] Sending smart catch-up request for session:', app.currentLidarSession);
                app.websocket.send(JSON.stringify({
                    type: 'request_catchup',
                    session_id: app.currentLidarSession,
                    task_id: task.id,
                    highest_snapshot_level: highestSnapshotLevel,
                    resume_from_level: highestSnapshotLevel >= 0 ? highestSnapshotLevel + 1 : 0,
                    timestamp: new Date().toISOString()
                }));
            } else {
                console.log('[WEBSOCKET] No session ID available for catch-up request');
            }
        } else {
            console.warn('[WEBSOCKET] WebSocket not ready for catch-up request');
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
            console.log('✅ WebSocket connected successfully to', wsUrl);
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
                console.log('[WEBSOCKET] Message received:', data.type, data);
                handleWebSocketMessage(app, data);
            } catch (error) {
                console.error('❌ WebSocket message error:', error);
            }
        };
        app.websocket.onclose = (event) => {
            console.log('🔌 WebSocket disconnected:', event.code, event.reason);
            app.websocket = null;
            
            // Always attempt to reconnect (not just when session is active)
            // This ensures page refresh scenarios work properly
            setTimeout(() => {
                console.log('[WEBSOCKET] Attempting to reconnect...');
                connectWebSocket(app);
            }, 2000);
        };
        app.websocket.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
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
            // Animation now handled by LidarAnimationSystem in lidar-grid.js when tiles are received
            // Legacy animation system disabled to prevent duplicate satellites
            // if (!app.isScanning && !app.animationState?.isActive) {
            //     if (typeof app.startScanningAnimation === 'function') {
            //         app.startScanningAnimation('satellite');
            //     }
            //     app.isScanning = true;
            // }
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
                // Animation now handled by LidarAnimationSystem in lidar-grid.js
                // Legacy animation system disabled to prevent duplicate satellites
                // if (typeof app.stopScanningAnimation === 'function') {
                //     app.stopScanningAnimation();
                // }
                // setTimeout(() => {
                //     if (typeof app.startScanningAnimation === 'function' && 
                //         !app.isScanning && !app.animationState?.isActive) {
                //         app.startScanningAnimation('satellite');
                //         app.isScanning = true;
                //         app.currentLidarSession = data.session_id;
                //     }
                // }, 100);
                app.currentLidarSession = data.session_id;
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
                    // Animation now handled by LidarAnimationSystem in lidar-grid.js
                    // Legacy animation system disabled to prevent duplicate satellites
                    // if (typeof app.stopScanningAnimation === 'function') {
                    //     app.stopScanningAnimation();
                    // }
                    // setTimeout(() => {
                    //     if (typeof app.startScanningAnimation === 'function' && 
                    //         !app.isScanning && !app.animationState?.isActive) {
                    //         app.startScanningAnimation('satellite');
                    //         app.isScanning = true;
                    //         app.currentLidarSession = data.session_id;
                    //     }
                    // }, 300);
                    app.currentLidarSession = data.session_id;
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
        case 'catchup_response':
            // Backend confirmed catch-up for active session
            console.log('[WEBSOCKET] Catch-up response received:', data.message);
            if (data.status === 'active' && data.session_id) {
                app.currentLidarSession = data.session_id;
                console.log('[WEBSOCKET] Session restored:', data.session_id);
            }
            break;
        case 'task_resume_response':
            // Backend acknowledged task resume request
            console.log('[WEBSOCKET] Task resume response:', data.message);
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

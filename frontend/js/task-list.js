/**
 * Task List Component - Handles task display and navigation
 */
console.log('[TASK-LIST] Module loading...');

class TaskList {
    constructor(mapInstance) {
        this.map = mapInstance;
        this.taskService = new TaskService();
        this.tasks = [];
        this.taskRectangles = new Map();
        this.refreshInterval = null;
        this.currentlySelectedTask = null;
        this.isFirstLoad = true; // Track if this is the first load for auto-navigation
        this._rectangleZoomLevel = 3; // For cycling zoom on rectangle click
        this._rectangleZoomLevels = [3, 5, 7, 9, 11, 13];
        
        this.init();
    }

    init() {
        this.loadTasks();
        this.startAutoRefresh();
    }

    async loadTasks(showLoading = true) {
        if (showLoading) {
            this.showLoadingState();
        }
        try {
            // Clear cache before fetching to always get latest from backend
            this.taskService.clearCache();
            // Keep track of previous running tasks
            const previousRunningTasks = this.tasks ? this.tasks.filter(task => task.status === 'running') : [];
            // Remove minDecay filter to show all tasks
            this.tasks = await this.taskService.getTasks({ minDecay: 0 });
            
            this.renderTaskRectangles();
            this.renderTaskList(showLoading);
            
            // Check for newly running tasks and trigger appropriate actions
            const currentRunningTasks = this.tasks.filter(task => task.status === 'running');
            
            // Auto-navigate to running task if this is the first load (streamlined)
            if (this.isFirstLoad) {
                this.isFirstLoad = false;
                this.checkAndNavigateToRunningTaskFast();
            } else {
                // Check for newly running tasks (tasks that weren't running before but are now)
                const newlyRunningTasks = currentRunningTasks.filter(currentTask => 
                    !previousRunningTasks.some(prevTask => prevTask.id === currentTask.id)
                );
                
                if (newlyRunningTasks.length > 0) {
                    // Detected newly running tasks - starting visualization
                    
                    // Navigate to the first newly running task
                    const newlyRunningTask = newlyRunningTasks[0];
                    await this.navigateToTaskSmoothly(newlyRunningTask.id);
                    
                    // Animation now handled by LidarAnimationSystem in lidar-grid.js when tiles are received
                    // Legacy animation system disabled to prevent duplicate satellites
                    // if (window.reArchaeologyApp && !window.reArchaeologyApp.isScanning) {
                    //     if (typeof window.reArchaeologyApp.stopScanningAnimation === 'function') {
                    //         window.reArchaeologyApp.stopScanningAnimation();
                    //     }
                    //     setTimeout(() => {
                    //         if (typeof window.reArchaeologyApp.startScanningAnimation === 'function') {
                    //             window.reArchaeologyApp.startScanningAnimation('satellite');
                    //             window.reArchaeologyApp.isScanning = true;
                    //         }
                    //     }, 100);
                    // }
                }
            }
            
            // Always check and trigger visualization for running tasks
            // This ensures visualization works even if websocket messages are missed
            await this.triggerVisualizationForRunningTasks();
            
            // Start GCS polling for running tasks (replaced WebSocket system)
            if (currentRunningTasks.length > 0) {
                if (window.reArchaeologyApp && window.reArchaeologyApp.gcsPollingService) {
                    console.log('[TASK-LIST] Starting GCS polling for', currentRunningTasks.length, 'running tasks');
                    currentRunningTasks.forEach(task => {
                        window.reArchaeologyApp.gcsPollingService.startPolling(task.id);
                    });
                }
            }
        } catch (error) {
            this.showErrorState();
            console.error('Failed to load tasks:', error);
        }
    }

    showLoadingState() {
        const container = document.getElementById('taskListContainer');
        if (!container) return;
        // Remove all loading indicators from anywhere in the container
        container.querySelectorAll('.task-list-loading').forEach(el => el.remove());
        let header = container.querySelector('.task-count-header');
        let scrollArea = container.querySelector('.task-list-scroll');
        if (!header) {
            header = document.createElement('div');
            header.className = 'task-count-header';
            container.appendChild(header);
        }
        if (!scrollArea) {
            scrollArea = document.createElement('div');
            scrollArea.className = 'task-list-scroll';
            container.appendChild(scrollArea);
        }
        scrollArea.innerHTML = '<div class="task-list-loading">Loading tasks...</div>';
    }

    clearLoadingState() {
        const container = document.getElementById('taskListContainer');
        if (!container) return;
        
        const scrollArea = container.querySelector('.task-list-scroll');
        if (scrollArea) {
            scrollArea.querySelectorAll('.task-list-loading').forEach(el => el.remove());
        }
    }

    showErrorState() {
        const container = document.getElementById('taskListContainer');
        if (container) {
            container.innerHTML = `
                <div class="task-list-empty">
                    <h4>❌ Error Loading Tasks</h4>
                    <p>Unable to load task data. Please try again.</p>
                </div>
            `;
        }
    }

    renderTaskList(clearLoading = true) {
        const container = document.getElementById('taskListContainer');
        if (!container) return;
        
        // Only remove loading indicators if we're supposed to clear them
        if (clearLoading) {
            container.querySelectorAll('.task-list-loading').forEach(el => el.remove());
        }
        
        let header = container.querySelector('.task-count-header');
        let scrollArea = container.querySelector('.task-list-scroll');
        
        if (!header) {
            header = document.createElement('div');
            header.className = 'task-count-header';
            container.appendChild(header);
        }
        if (!scrollArea) {
            scrollArea = document.createElement('div');
            scrollArea.className = 'task-list-scroll';
            container.appendChild(scrollArea);
        }

        // Sort tasks: running first, then by updated_at (most recent first)
        const sortedTasks = [...this.tasks].sort((a, b) => {
            if (a.status === 'running' && b.status !== 'running') return -1;
            if (b.status === 'running' && a.status !== 'running') return 1;
            const aTime = new Date(a.updated_at || a.created_at).getTime();
            const bTime = new Date(b.updated_at || b.created_at).getTime();
            return bTime - aTime;
        });
        
        const runningCount = sortedTasks.filter(task => task.status === 'running').length;
        const statusText = runningCount > 0 ? ` (${runningCount} running)` : '';
        const newHeaderContent = `<span class="task-count">${this.tasks.length} tasks available${statusText}</span>`;
        
        // Only update header if content changed to avoid flickering
        if (header.innerHTML !== newHeaderContent) {
            header.innerHTML = newHeaderContent;
        }
        
        if (this.tasks.length === 0) {
            scrollArea.innerHTML = `<div class="task-list-empty"><h4>📋 No Tasks Found</h4><p>No archaeological survey tasks available.</p></div>`;
            return;
        }
        
        // Build the new content
        const newContent = sortedTasks.map(task => this.createTaskListItem(task)).join('');
        
        // Only update if content actually changed to prevent unnecessary DOM manipulation
        if (scrollArea.innerHTML !== newContent) {
            scrollArea.innerHTML = newContent;
            // Re-add click event listeners only when content changes
            scrollArea.querySelectorAll('.task-item').forEach(item => {
                item.onclick = () => {
                    this.navigateToTask(item.dataset.taskId);
                };
            });
        }
    }

    createTaskListItem(task) {
        const statusColor = this.taskService.getStatusColor(task.status);
        const statusText = this.taskService.getStatusText(task.status);
        const coordinates = this.taskService.formatCoordinates(task.start_coordinates);
        const findingsCount = task.findings ? task.findings.length : 0;
        const opacityValue = Math.max(0.3, task.decay_value);
        
        // Clean styling for running tasks - let CSS handle the visual indicators
        const runningClass = task.status === 'running' ? ' running' : '';

        return `
            <div class="task-item ${task.status}${runningClass}" 
                 data-task-id="${task.id}" 
                 style="border-left-color: ${statusColor}; opacity: ${opacityValue};">
                <div class="task-header">
                    <span class="task-id">${task.id.slice(0, 6)}</span>
                    <span class="task-status" style="color: ${statusColor};">
                        ${statusText}
                    </span>
                </div>
                <div class="task-details">
                    <div class="task-location">📍 ${coordinates}</div>
                    <div class="task-range">📏 ${task.range.width_km}×${task.range.height_km}km | 🔍 ${findingsCount}</div>
                </div>
                ${task.status === 'running' ? this.createProgressBar(task.progress) : ''}
            </div>
        `;
    }

    createProgressBar(progress) {
        const overall = progress.overall || 0;

        return `
            <div class="task-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${overall}%"></div>
                </div>
                <div class="progress-details">
                    <small>${overall.toFixed(0)}% complete</small>
                </div>
            </div>
        `;
    }

    renderTaskRectangles() {
        // Clear existing rectangles
        this.taskRectangles.forEach((rectangle, taskId) => {
            if (this.map && rectangle) {
                try {
                    this.map.removeLayer(rectangle);
                } catch (e) {}
            }
        });
        this.taskRectangles.clear();
        // Add new rectangles and show snapshots
        const currentTaskIds = [];
        for (const task of this.tasks) {
            const bounds = this.calculateTaskBounds(task);
            if (!bounds) {
                console.warn(`[TASK_LIST] No bounds available for task ${task.id}`);
                continue;
            }
            const rectangle = this.createTaskRectangle(task, bounds);
            if (rectangle && this.map) {
                try {
                    rectangle.addTo(this.map);
                    this.taskRectangles.set(task.id, rectangle);
                } catch (e) {
                    // Failed to add rectangle to map; skipping
                }
            } else if (!rectangle) {
                // Skipped rectangle for task due to missing or invalid bounds
            }
            
            // Show snapshot overlay for all tasks with bounds
            // Only load snapshots if we have an active websocket connection or the task is running
            const app = window.app || window.App || window.reArchaeologyApp;
            const hasActiveConnection = app && app.websocket;
            const isRunningTask = task.status === 'running' || task.status === 'scanning';
            
            if (bounds && window.showHighestAvailableLidarSnapshot && typeof window.showHighestAvailableLidarSnapshot === 'function' && (hasActiveConnection || isRunningTask)) {
                const boundsArray = [
                    [bounds[0][0], bounds[0][1]], // southwest
                    [bounds[1][0], bounds[1][1]]  // northeast
                ];
                try {
                    window.showHighestAvailableLidarSnapshot(task.id, boundsArray);
                } catch (error) {
                    console.warn('[TASK-LIST] Error calling showHighestAvailableLidarSnapshot:', error);
                }
            } else if (bounds && window.DEBUG_LIDAR_GRID && !hasActiveConnection && !isRunningTask) {
                // Skip snapshot loading during initial page load without active connection
                console.log('[TASK-LIST] Skipping snapshot check for task', task.id.slice(0,8), '- no active connection');
            }
            currentTaskIds.push(task.id);
        }
        // Remove overlays for tasks that are no longer present
        if (window.removeObsoleteLidarSnapshotOverlays) {
            window.removeObsoleteLidarSnapshotOverlays(currentTaskIds);
        }
    }

    /**
     * Calculate bounds from task coordinates and range.
     * 
     * COORDINATE SYSTEM: Based on empirical testing with lidar snapshot alignment:
     * - Latitude: start_coordinates represents the CENTER of the scan area
     * - Longitude: start_coordinates represents the WEST EDGE of the scan area
     * 
     * This hybrid approach aligns task rectangles with lidar snapshot overlays.
     */
    calculateTaskBounds(task) {
        // Use backend bounds if available
        if (task.bounds && Array.isArray(task.bounds) && task.bounds.length === 2) {
            return task.bounds;
        }
        
        // Calculate from start_coordinates and range
        if (task.start_coordinates && task.range) {
            const [lat, lon] = task.start_coordinates;
            const { width_km, height_km } = task.range;
            
            // Convert km to approximate degrees
            const latOffset = height_km / 111;
            const lonOffset = width_km / (111 * Math.cos(lat * Math.PI / 180));
            
            // Hybrid coordinate system: center latitude, west longitude
            return [
                [lat - latOffset / 2, lon], // Southwest: center latitude, west longitude
                [lat + latOffset / 2, lon + lonOffset]  // Northeast: center + offset, west + offset
            ];
        }
        
        return null;
    }

    createTaskRectangle(task, providedBounds = null) {
        // Use provided bounds or calculate from task data
        const bounds = providedBounds || this.calculateTaskBounds(task);
        if (!bounds) {
            return null;
        }
        
        // Extract dimensions for tooltip (if available)
        let actualWidth = null, actualHeight = null;
        if (task.range) {
            actualWidth = task.range.width_km;
            actualHeight = task.range.height_km;
        }
        const statusColor = this.taskService.getStatusColor(task.status);
        const opacity = Math.max(0.3, task.decay_value);
        const rectangle = L.rectangle(bounds, {
            color: statusColor,
            weight: task.status === 'running' ? 2 : 1,
            opacity: opacity,
            fillColor: statusColor,
            fillOpacity: opacity * 0.2,
            className: `task-rectangle task-${task.status}`,
            interactive: false,
            bubblingMouseEvents: false
        });
        // Add pulsing animation for running tasks
        if (task.status === 'running') {
            rectangle.getElement()?.classList.add('pulse');
        }
        return rectangle;
    }

    navigateToTask(taskId) {
        window.currentTaskId = taskId;
        if (window.reArchaeologyApp) window.reArchaeologyApp.currentTaskId = taskId;
        
        // Find the task in our cached data instead of making API call
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) {
            console.error('Task not found in cache:', taskId);
            return;
        }
        
        if (!this.map) {
            console.error('Map not available for navigation');
            return;
        }
        
        try {
            // Use cached task bounds for instant navigation
            const bounds = this.calculateTaskBounds(task);
            if (!bounds) {
                console.error('No bounds available for navigation to task:', task.id);
                return;
            }
            
            // Fast navigation with shorter duration
            this.map.flyToBounds(bounds, {
                padding: [50, 50],
                duration: 0.8  // Reduced from 1.5s
            });
            
            this.highlightTask(taskId);
        } catch (error) {
            console.error('Failed to navigate to task:', error);
        }
    }

    async navigateToTaskSmoothly(taskId) {
        window.currentTaskId = taskId;
        if (window.reArchaeologyApp) window.reArchaeologyApp.currentTaskId = taskId;
        try {
            const navData = await this.taskService.getTaskNavigation(taskId);
            if (this.map) {
                console.debug('[navigateToTaskSmoothly] navData:', navData);
                const targetBounds = L.latLngBounds([
                    navData.bounds.southwest,
                    navData.bounds.northeast
                ]);
                let paddingX = 100, paddingY = 100;
                const task = this.tasks.find(t => t.id === taskId);
                if (task && task.status === 'running') {
                    paddingX = 150;
                    paddingY = 150;
                }
                this.map.flyToBounds(targetBounds, {
                    padding: [paddingX, paddingY],
                    duration: 2.0,
                    easeLinearity: 0.25,
                    maxZoom: 14
                });
                setTimeout(async () => {
                    this.highlightTask(taskId);
                    const task = this.tasks.find(t => t.id === taskId);
                    if (task && window.reArchaeologyApp) {
                        const { width_km, height_km } = task.range;
                        const [lat, lon] = task.start_coordinates;
                        const { selectScanArea, updateScanAreaLabel } = await import('./map.js');
                        if (selectScanArea && typeof selectScanArea === 'function') {
                            await selectScanArea(window.reArchaeologyApp, lat, lon, null, width_km, height_km);
                            if (updateScanAreaLabel && window.reArchaeologyApp.currentResolution) {
                                updateScanAreaLabel(window.reArchaeologyApp);
                            }
                        }
                    }
                    if (window.reArchaeologyApp && typeof window.reArchaeologyApp.loadCachedBitmapForTask === 'function') {
                        await window.reArchaeologyApp.loadCachedBitmapForTask(taskId);
                    }
                    // Use navData as grid info for setLidarGridInfo
                    const gridInfo = navData;
                    try {
                        if (typeof window.setLidarGridInfo === 'function') {
                            window.setLidarGridInfo(gridInfo, taskId);
                        } else if (window.reArchaeologyApp && typeof window.reArchaeologyApp.setLidarGridInfo === 'function') {
                            window.reArchaeologyApp.setLidarGridInfo(gridInfo, taskId);
                        } else if (window.DEBUG_LIDAR_GRID) {
                            console.warn('[navigateToTaskSmoothly] No setLidarGridInfo function found!');
                        }
                    } catch (err) {
                        console.error('[navigateToTaskSmoothly] Error calling setLidarGridInfo:', err);
                    }
                }, 2100);
                if (window.reArchaeologyApp && typeof window.reArchaeologyApp.loadCachedBitmapForTask === 'function') {
                    setTimeout(async () => {
                        const task = this.tasks.find(t => t.id === taskId);
                        if (task) {
                            const { width_km, height_km } = task.range;
                            const [lat, lon] = task.start_coordinates;
                            const { selectScanArea, updateScanAreaLabel } = await import('./map.js');
                            if (selectScanArea && typeof selectScanArea === 'function') {
                                await selectScanArea(window.reArchaeologyApp, lat, lon, null, width_km, height_km);
                                if (updateScanAreaLabel && window.reArchaeologyApp.currentResolution) {
                                    updateScanAreaLabel(window.reArchaeologyApp);
                                }
                            }
                        }
                        await window.reArchaeologyApp.loadCachedBitmapForTask(taskId);
                        // Use navData as grid info for setLidarGridInfo
                        const gridInfo = navData;
                        try {
                            if (typeof window.setLidarGridInfo === 'function') {
                                window.setLidarGridInfo(gridInfo, taskId);
                            } else if (window.reArchaeologyApp && typeof window.reArchaeologyApp.setLidarGridInfo === 'function') {
                                window.reArchaeologyApp.setLidarGridInfo(gridInfo, taskId);
                            } else if (window.DEBUG_LIDAR_GRID) {
                                console.warn('[navigateToTaskSmoothly] (delayed) No setLidarGridInfo function found!');
                            }
                        } catch (err) {
                            console.error('[navigateToTaskSmoothly] (delayed) Error calling setLidarGridInfo:', err);
                        }
                    }, 500);
                }
            }
        } catch (error) {
            console.error('Failed to navigate to task smoothly:', error);
        }
    }

    highlightTask(taskId) {
        // Remove previous highlight
        this.taskRectangles.forEach((rectangle, id) => {
            const element = rectangle.getElement();
            if (element) {
                element.classList.remove('highlighted');
            }
        });

        // Update task list selection
        document.querySelectorAll('.task-item').forEach(item => {
            item.classList.remove('selected');
        });

        // Add highlight to selected task
        const rectangle = this.taskRectangles.get(taskId);
        if (rectangle) {
            const element = rectangle.getElement();
            if (element) {
                element.classList.add('highlighted');
            }
            
            // Don't automatically adjust map bounds during auto-navigation
            // The bounds should already be correct from the navigation
        }

        // Add selection to task list item
        const taskItem = document.querySelector(`[data-task-id="${taskId}"]`);
        if (taskItem) {
            taskItem.classList.add('selected');
            taskItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        this.currentlySelectedTask = taskId;
    }

    startAutoRefresh() {
        // Always clear any previous interval before starting a new one
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
        // Refresh tasks every 30 seconds, but only start after initial load is complete
        this.refreshInterval = setInterval(() => {
            // Don't refresh if we're in the middle of initial navigation
            if (!this.isFirstLoad) {
                // Background refresh without any UI updates to prevent flickering
                this.backgroundRefresh();
            }
        }, 30000);
    }

    async backgroundRefresh() {
        try {
            // Silent refresh - just update the data without any UI loading states
            this.taskService.clearCache();
            const previousRunningTasks = this.tasks ? this.tasks.filter(task => task.status === 'running') : [];
            this.tasks = await this.taskService.getTasks({ minDecay: 0 });
            
            // Update rectangles and UI silently
            this.renderTaskRectangles();
            this.renderTaskList(false); // Don't clear loading states
            
            // Handle running task logic without showing loading
            const currentRunningTasks = this.tasks.filter(task => task.status === 'running');
            const newlyRunningTasks = currentRunningTasks.filter(currentTask => 
                !previousRunningTasks.some(prevTask => prevTask.id === currentTask.id)
            );
            
            if (newlyRunningTasks.length > 0) {
                const newlyRunningTask = newlyRunningTasks[0];
                await this.navigateToTaskSmoothly(newlyRunningTask.id);
                
                // Animation now handled by LidarAnimationSystem in lidar-grid.js when tiles are received
                // Legacy animation system disabled to prevent duplicate satellites
                // if (window.reArchaeologyApp && !window.reArchaeologyApp.isScanning) {
                //     if (typeof window.reArchaeologyApp.stopScanningAnimation === 'function') {
                //         window.reArchaeologyApp.stopScanningAnimation();
                //     }
                //     setTimeout(() => {
                //         if (typeof window.reArchaeologyApp.startScanningAnimation === 'function') {
                //             window.reArchaeologyApp.startScanningAnimation('satellite');
                //             window.reArchaeologyApp.isScanning = true;
                //         }
                //     }, 100);
                // }
            }
            
            await this.triggerVisualizationForRunningTasks();
        } catch (error) {
            // Silent error handling - don't show error state during background refresh
            console.warn('Background refresh failed:', error);
        }
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    // Fast navigation for streamlined loading
    checkAndNavigateToRunningTaskFast() {
        const runningTasks = this.tasks.filter(task => task.status === 'running');
        
        if (runningTasks.length > 0) {
            const runningTask = runningTasks[0];
            console.log('[TASK-LIST] Fast navigation to running task:', runningTask.id);
            
            // Immediate navigation without delays
            if (window.reArchaeologyApp?.map) {
                // Navigate to task bounds with max zoom level of 7
                const task = runningTasks[0];
                const bounds = this.calculateTaskBounds(task);
                if (bounds) {
                    window.reArchaeologyApp.map.flyToBounds(bounds, {
                        padding: [50, 50],
                        maxZoom: 7,  // Limit zoom to 7 instead of full screen
                        duration: 0.8
                    });
                    console.log('[TASK-LIST] Immediately jumped to task area with zoom limit 7');
                } else {
                    // Fallback to center coordinates if bounds not available
                    window.reArchaeologyApp.map.setView([7.6, -67.2], 7);
                    console.log('[TASK-LIST] Fallback to center coordinates with zoom 7');
                }
            }
            
            // Enable heatmap mode immediately
            if (window.reArchaeologyApp?.mapVisualization?.enableHeatmapMode) {
                window.reArchaeologyApp.mapVisualization.enableHeatmapMode();
            }
        }
    }

    async checkAndNavigateToRunningTask() {
        // Find running tasks
        const runningTasks = this.tasks.filter(task => task.status === 'running');
        
        if (runningTasks.length > 0) {
            // Navigate to the first running task with a longer delay to allow map to fully settle
            const runningTask = runningTasks[0];
            console.log('Auto-navigating to running task:', runningTask.id);
            
            // Enable heatmap mode immediately for running tasks
            if (window.reArchaeologyApp?.mapVisualization?.enableHeatmapMode) {
                window.reArchaeologyApp.mapVisualization.enableHeatmapMode();
            }
            
            // Wait for map to be fully ready and any other initializations to complete
            setTimeout(async () => {
                await this.navigateToTaskSmoothly(runningTask.id);
                
                // Ensure visualization is triggered for running task
                await this.triggerVisualizationForRunningTasks();
            }, 1500);
        } else {
            // No running tasks, let the app decide whether to show discovered sites
            if (window.DEBUG_LIDAR_GRID) {
                console.log('No running tasks found');
            }
            if (window.reArchaeologyApp && typeof window.reArchaeologyApp.fitToDiscoveredSitesIfNeeded === 'function') {
                setTimeout(() => window.reArchaeologyApp.fitToDiscoveredSitesIfNeeded(), 1500);
            }
        }
    }

    /**
     * Check and trigger visualization for running tasks
     * This ensures that even if websocket messages are missed, running tasks get proper visualization
     */
    async triggerVisualizationForRunningTasks() {
        const runningTasks = this.tasks.filter(task => task.status === 'running');
        
        if (runningTasks.length > 0 && window.reArchaeologyApp) {
            // Only log when we first detect running tasks, not every time
            const taskIds = runningTasks.map(t => t.id);
            if (!this.lastRunningTaskIds || JSON.stringify(taskIds) !== JSON.stringify(this.lastRunningTaskIds)) {
                // Auto-navigating to running task (silent)
                this.lastRunningTaskIds = taskIds;
            }
            
            // Enable heatmap mode for running tasks
            if (window.reArchaeologyApp.mapVisualization && 
                typeof window.reArchaeologyApp.mapVisualization.enableHeatmapMode === 'function') {
                window.reArchaeologyApp.mapVisualization.enableHeatmapMode();
            }
            
            // Load cached bitmap for the first running task
            const runningTask = runningTasks[0];
            if (typeof window.reArchaeologyApp.loadCachedBitmapForTask === 'function') {
                try {
                    await window.reArchaeologyApp.loadCachedBitmapForTask(runningTask.id);
                    // Only log success if we haven't seen this task before
                    if (!this.loadedBitmapTasks?.has(runningTask.id)) {
                        // Loaded cached bitmap for running task (silent)
                        this.loadedBitmapTasks = this.loadedBitmapTasks || new Set();
                        this.loadedBitmapTasks.add(runningTask.id);
                    }
                } catch (error) {
                    console.warn('Failed to load cached bitmap for running task:', error);
                }
            }
            
            // Animation now handled by LidarAnimationSystem in lidar-grid.js when tiles are received
            // Legacy animation system disabled to prevent duplicate satellites
            // if (!window.reArchaeologyApp.isScanning) {
            //     if (typeof window.reArchaeologyApp.stopScanningAnimation === 'function') {
            //         window.reArchaeologyApp.stopScanningAnimation();
            //     }
            //     setTimeout(() => {
            //         if (typeof window.reArchaeologyApp.startScanningAnimation === 'function' && 
            //             !window.reArchaeologyApp.isScanning) {
            //             window.reArchaeologyApp.startScanningAnimation('satellite');
            //             window.reArchaeologyApp.isScanning = true;
            //         }
            //     }, 150);
            // }
            
            // Set session info
            if (runningTask.session_id || runningTask.sessions?.scan) {
                const newSessionId = runningTask.session_id || runningTask.sessions.scan;
                // Only log when session changes to avoid spam
                if (window.reArchaeologyApp.currentLidarSession !== newSessionId) {
                    window.reArchaeologyApp.currentLidarSession = newSessionId;
                    // Set current LiDAR session (silent)
                }
            }
        }
    }

    destroy() {
        this.stopAutoRefresh();
        this.taskRectangles.forEach(rectangle => {
            if (this.map) {
                this.map.removeLayer(rectangle);
            }
        });
        this.taskRectangles.clear();
    }
}

// Export the class
window.TaskList = TaskList;
console.log('[TASK-LIST] TaskList class exported to window.TaskList');

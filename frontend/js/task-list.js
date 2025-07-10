/**
 * Task List Component - Handles task display and navigation
 */
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

    async loadTasks() {
        // Only show loading if no tasks are present
        if (!this.tasks || this.tasks.length === 0) {
            this.showLoadingState();
        }
        try {
            // Only clear cache on first load, not every refresh
            if (this.isFirstLoad) {
                this.taskService.clearCache();
            }
            const previousRunningTasks = this.tasks ? this.tasks.filter(task => task.status === 'running') : [];
            this.tasks = await this.taskService.getTasks({ minDecay: 0 });
            this.clearLoadingState();
            this.renderTaskRectangles();
            this.renderTaskList();
            const currentRunningTasks = this.tasks.filter(task => task.status === 'running');
            if (this.isFirstLoad) {
                this.isFirstLoad = false;
                await this.checkAndNavigateToRunningTask();
            } else {
                const newlyRunningTasks = currentRunningTasks.filter(currentTask =>
                    !previousRunningTasks.some(prevTask => prevTask.id === currentTask.id)
                );
                if (newlyRunningTasks.length > 0) {
                    const newlyRunningTask = newlyRunningTasks[0];
                    await this.navigateToTaskSmoothly(newlyRunningTask.id);
                    if (window.reArchaeologyApp && !window.reArchaeologyApp.isScanning) {
                        if (typeof window.reArchaeologyApp.stopScanningAnimation === 'function') {
                            window.reArchaeologyApp.stopScanningAnimation();
                        }
                        setTimeout(() => {
                            if (typeof window.reArchaeologyApp.startScanningAnimation === 'function') {
                                window.reArchaeologyApp.startScanningAnimation('satellite');
                                window.reArchaeologyApp.isScanning = true;
                            }
                        }, 100);
                    }
                }
            }
            await this.triggerVisualizationForRunningTasks();
        } catch (error) {
            // Only show error if there are no tasks already displayed
            if (!this.tasks || this.tasks.length === 0) {
                this.showErrorState();
            } else {
                this.clearLoadingState();
            }
            console.error('Failed to load tasks:', error);
        }
    }

    showLoadingState() {
        const container = document.getElementById('taskListContainer');
        if (!container) return;
        // Only show a loading indicator if the list is empty
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
        // Remove any previous loading indicators before adding a new one
        scrollArea.querySelectorAll('.task-list-loading').forEach(el => el.remove());
        // Only show loading if there are no tasks currently displayed
        if (!scrollArea.querySelector('.task-item')) {
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'task-list-loading';
            loadingDiv.textContent = 'Loading tasks...';
            scrollArea.appendChild(loadingDiv);
        }
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

    renderTaskList() {
        const container = document.getElementById('taskListContainer');
        if (!container) return;
        // Ensure header and scrollArea exist
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
        // Remove all loading indicators and empty messages before updating
        scrollArea.querySelectorAll('.task-list-loading, .task-list-empty').forEach(el => el.remove());

        // Sort tasks by status and creation time
        const sortedTasks = [...this.tasks].sort((a, b) => {
            const statusPriority = { 'running': 0, 'completed': 1, 'failed': 2, 'pending': 3 };
            const priorityA = statusPriority[a.status] || 4;
            const priorityB = statusPriority[b.status] || 4;
            if (priorityA !== priorityB) return priorityA - priorityB;
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });

        // Build a map of current DOM items
        const domItems = {};
        scrollArea.querySelectorAll('.task-item').forEach(item => {
            domItems[item.dataset.taskId] = item;
        });
        // Track which tasks are still present
        const seen = new Set();
        // Add or update items in correct order
        let lastNode = null;
        for (const task of sortedTasks) {
            let item = domItems[task.id];
            const html = this.createTaskListItem(task).trim();
            if (item) {
                // Update if changed
                if (item.outerHTML !== html) {
                    const temp = document.createElement('div');
                    temp.innerHTML = html;
                    const newItem = temp.firstChild;
                    item.replaceWith(newItem);
                    item = newItem;
                }
                seen.add(task.id);
            } else {
                // Insert new item in order
                const temp = document.createElement('div');
                temp.innerHTML = html;
                const newItem = temp.firstChild;
                if (lastNode && lastNode.nextSibling) {
                    scrollArea.insertBefore(newItem, lastNode.nextSibling);
                } else {
                    scrollArea.appendChild(newItem);
                }
                item = newItem;
            }
            lastNode = item;
        }
        // Remove items not in the new list
        for (const id in domItems) {
            if (!seen.has(id)) {
                domItems[id].remove();
            }
        }
        // Update header with task count
        const runningCount = sortedTasks.filter(t => t.status === 'running').length;
        const totalCount = sortedTasks.length;
        header.innerHTML = `<span class="task-count">${totalCount} Tasks${runningCount > 0 ? ` (${runningCount} running)` : ''}</span>`;

        // If no items, show empty message
        if (sortedTasks.length === 0) {
            scrollArea.innerHTML = `<div class="task-list-empty"><h4>📋 No Tasks Found</h4><p>No archaeological survey tasks available.</p></div>`;
        }
        // Re-attach click listeners
        scrollArea.querySelectorAll('.task-item').forEach(item => {
            item.onclick = () => {
                this.navigateToTask(item.dataset.taskId);
            };
        });
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
            // Always compute bounds using the same logic as createTaskRectangle
            let bounds = null;
            if (task.bounds && Array.isArray(task.bounds) && task.bounds.length === 2) {
                bounds = task.bounds;
            } else if (task.start_coordinates && task.range) {
                const [lat, lon] = task.start_coordinates;
                const { width_km, height_km } = task.range || {};
                if (typeof lat === 'number' && typeof lon === 'number' && typeof width_km === 'number' && typeof height_km === 'number') {
                    const latOffset = height_km / 111;
                    const lonOffset = width_km / (111 * Math.cos(lat * Math.PI / 180));
                    bounds = [
                        [lat - latOffset / 2, lon - lonOffset / 2], // Southwest
                        [lat + latOffset / 2, lon + lonOffset / 2]  // Northeast
                    ];
                }
            } else {
                // No bounds, start_coordinates, or range for task; skipping overlay and rectangle
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
            // Show overlay for each task with available bounds
            if (window.showHighestAvailableLidarSnapshot) {
                window.showHighestAvailableLidarSnapshot(task.id, bounds);
            }
            currentTaskIds.push(task.id);
        }
        // Remove overlays for tasks that are no longer present
        if (window.removeObsoleteLidarSnapshotOverlays) {
            window.removeObsoleteLidarSnapshotOverlays(currentTaskIds);
        }
    }

    createTaskRectangle(task, backendBounds = null) {
        // Use backend bounds if available, else fallback to center-based calculation
        let bounds = null;
        let actualWidth = null, actualHeight = null;
        if (backendBounds && Array.isArray(backendBounds) && backendBounds.length === 2) {
            bounds = backendBounds;
        } else if (task.bounds && Array.isArray(task.bounds) && task.bounds.length === 2) {
            bounds = task.bounds;
        } else if (task.start_coordinates && task.range) {
            const [lat, lon] = task.start_coordinates;
            const { width_km, height_km } = task.range;
            actualWidth = width_km;
            actualHeight = height_km;
            const latOffset = actualHeight / 111;
            const lonOffset = actualWidth / (111 * Math.cos(lat * Math.PI / 180));
            bounds = [
                [lat - latOffset / 2, lon - lonOffset / 2], // Southwest
                [lat + latOffset / 2, lon + lonOffset / 2]  // Northeast
            ];
        } else {
            // If neither bounds nor start_coordinates/range are available, skip
            return null;
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
            interactive: true,
            bubblingMouseEvents: false
        });
        // Add pulsing animation for running tasks
        if (task.status === 'running') {
            rectangle.getElement()?.classList.add('pulse');
        }
        // Add click handler for navigation
        rectangle.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            if (this.map) {
                const bounds = rectangle.getBounds();
                const center = bounds.getCenter();
                let idx = this._rectangleZoomLevels.indexOf(this._rectangleZoomLevel);
                idx = (idx + 1) % this._rectangleZoomLevels.length;
                this._rectangleZoomLevel = this._rectangleZoomLevels[idx];
                this.map.setView(center, this._rectangleZoomLevel, { animate: true });
            }
        });
        // Add tooltip
        const tooltipContent = `
            <div class="task-tooltip">
                <strong>Task ${task.id.slice(0, 8)}</strong><br>
                Status: ${this.taskService.getStatusText(task.status)}<br>
                Findings: ${task.findings ? task.findings.length : 0}<br>
                Requested: ${task.range && task.range.width_km && task.range.height_km ? `${task.range.width_km}×${task.range.height_km} km` : ''}
                ${task.status === 'running' && actualWidth && actualHeight ? `<br>Scanning: ${actualWidth.toFixed(1)}×${actualHeight.toFixed(1)} km` : ''}
            </div>
        `;
        rectangle.bindTooltip(tooltipContent, {
            sticky: true,
            direction: 'top'
        });
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
            let bounds;
            if (task.bounds && Array.isArray(task.bounds)) {
                bounds = task.bounds;
            } else {
                // Calculate bounds from task data
                const [lat, lon] = task.start_coordinates;
                const { width_km, height_km } = task.range;
                const latOffset = height_km / 111;
                const lonOffset = width_km / (111 * Math.cos(lat * Math.PI / 180));
                bounds = [
                    [lat - latOffset / 2, lon - lonOffset / 2], // Southwest
                    [lat + latOffset / 2, lon + lonOffset / 2]  // Northeast
                ];
            }
            
            // Fast navigation with shorter duration
            this.map.flyToBounds(bounds, {
                padding: [50, 50],
                duration: 0.8  // Reduced from 1.5s
            });
            
            this.highlightTask(taskId);
            
            // Load bitmap and set grid info in background (non-blocking)
            setTimeout(() => {
                // Load cached bitmap without blocking
                if (window.reArchaeologyApp?.loadCachedBitmapForTask) {
                    window.reArchaeologyApp.loadCachedBitmapForTask(taskId).catch(err => 
                        console.warn('Failed to load cached bitmap:', err)
                    );
                }
                
                // Set grid info using cached task data
                if (window.setLidarGridInfo || window.reArchaeologyApp?.setLidarGridInfo) {
                    const gridInfo = {
                        bounds: { southwest: bounds[0], northeast: bounds[1] },
                        grid_x: task.grid_x || 10,
                        grid_y: task.grid_y || 10,
                        levels: task.levels || []
                    };
                    
                    if (window.setLidarGridInfo) {
                        window.setLidarGridInfo(gridInfo, taskId);
                    } else if (window.reArchaeologyApp?.setLidarGridInfo) {
                        window.reArchaeologyApp.setLidarGridInfo(gridInfo, taskId);
                    }
                }
            }, 100); // Small delay to allow map animation to start
            
        } catch (error) {
            console.error('Failed to navigate to task:', error);
        }
    }

    navigateToTaskSmoothly(taskId) {
        window.currentTaskId = taskId;
        if (window.reArchaeologyApp) window.reArchaeologyApp.currentTaskId = taskId;
        
        // Find the task in our cached data
        const task = this.tasks.find(t => t.id === taskId);
        if (!task || !this.map) {
            console.error('Task not found or map unavailable:', taskId);
            return;
        }
        
        try {
            // Calculate bounds from cached task data
            let bounds;
            if (task.bounds && Array.isArray(task.bounds)) {
                bounds = task.bounds;
            } else {
                const [lat, lon] = task.start_coordinates;
                const { width_km, height_km } = task.range;
                const latOffset = height_km / 111;
                const lonOffset = width_km / (111 * Math.cos(lat * Math.PI / 180));
                bounds = [
                    [lat - latOffset / 2, lon - lonOffset / 2],
                    [lat + latOffset / 2, lon + lonOffset / 2]
                ];
            }
            
            const targetBounds = L.latLngBounds(bounds);
            let paddingX = 100, paddingY = 100;
            if (task.status === 'running') {
                paddingX = 150;
                paddingY = 150;
            }
            
            this.map.flyToBounds(targetBounds, {
                padding: [paddingX, paddingY],
                duration: 1.2,  // Reduced from 2.0s
                easeLinearity: 0.25,
                maxZoom: 14
            });
            
            // Immediate highlight
            setTimeout(() => {
                this.highlightTask(taskId);
                
                // Background tasks (non-blocking)
                this._handleSmoothNavigationBackground(task, taskId, bounds);
            }, 300);
            
        } catch (error) {
            console.error('Failed to navigate to task smoothly:', error);
        }
    }
    
    async _handleSmoothNavigationBackground(task, taskId, bounds) {
        try {
            // Set scan area if needed
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
            
            // Load cached bitmap
            if (window.reArchaeologyApp?.loadCachedBitmapForTask) {
                await window.reArchaeologyApp.loadCachedBitmapForTask(taskId);
            }
            
            // Set grid info
            const gridInfo = {
                bounds: { southwest: bounds[0], northeast: bounds[1] },
                grid_x: task.grid_x || 10,
                grid_y: task.grid_y || 10,
                levels: task.levels || []
            };
            
            if (window.setLidarGridInfo) {
                window.setLidarGridInfo(gridInfo, taskId);
            } else if (window.reArchaeologyApp?.setLidarGridInfo) {
                window.reArchaeologyApp.setLidarGridInfo(gridInfo, taskId);
            }
            
        } catch (error) {
            console.warn('Background navigation tasks failed:', error);
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
                this.loadTasks();
            }
        }, 30000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
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
            console.log('No running tasks found');
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
            
            // Start scanning animation if not already active
            if (!window.reArchaeologyApp.isScanning) {
                // Stop any existing animation first to prevent duplicates
                if (typeof window.reArchaeologyApp.stopScanningAnimation === 'function') {
                    window.reArchaeologyApp.stopScanningAnimation();
                }
                
                // Start new animation after a short delay
                setTimeout(() => {
                    if (typeof window.reArchaeologyApp.startScanningAnimation === 'function' && 
                        !window.reArchaeologyApp.isScanning) {
                        window.reArchaeologyApp.startScanningAnimation('satellite');
                        window.reArchaeologyApp.isScanning = true;
                        // Started scanning animation for running tasks (silent)
                    }
                }, 150);
            }
            
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

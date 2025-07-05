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
        try {
            this.showLoadingState();
            
            // Keep track of previous running tasks
            const previousRunningTasks = this.tasks ? this.tasks.filter(task => task.status === 'running') : [];
            
            this.tasks = await this.taskService.getTasks({ minDecay: 0.1 });
            this.renderTaskRectangles();
            this.renderTaskList();
            
            // Check for newly running tasks and trigger appropriate actions
            const currentRunningTasks = this.tasks.filter(task => task.status === 'running');
            
            // Auto-navigate to running task if this is the first load
            if (this.isFirstLoad) {
                this.isFirstLoad = false;
                await this.checkAndNavigateToRunningTask();
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
                    
                    // Trigger scanning visualization if not already active
                    if (window.reArchaeologyApp && !window.reArchaeologyApp.isScanning) {
                        // Stop any existing animation first to prevent duplicates
                        if (typeof window.reArchaeologyApp.stopScanningAnimation === 'function') {
                            window.reArchaeologyApp.stopScanningAnimation();
                        }
                        
                        // Start new animation after a short delay
                        setTimeout(() => {
                            if (typeof window.reArchaeologyApp.startScanningAnimation === 'function') {
                                window.reArchaeologyApp.startScanningAnimation('satellite');
                                window.reArchaeologyApp.isScanning = true;
                                // Started scanning animation for newly running task
                            }
                        }, 100);
                    }
                }
            }
            
            // Always check and trigger visualization for running tasks
            // This ensures visualization works even if websocket messages are missed
            await this.triggerVisualizationForRunningTasks();
        } catch (error) {
            console.error('Failed to load tasks:', error);
            this.showErrorState();
        }
    }

    showLoadingState() {
        const container = document.getElementById('taskListContainer');
        if (container) {
            container.innerHTML = '<div class="task-list-loading">Loading tasks...</div>';
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

        if (this.tasks.length === 0) {
            container.innerHTML = `
                <div class="task-list-empty">
                    <h4>📋 No Tasks Found</h4>
                    <p>No archaeological survey tasks available.</p>
                </div>
            `;
            return;
        }

        // Sort tasks: running first, then by updated_at (most recent first)
        const sortedTasks = [...this.tasks].sort((a, b) => {
            // Running tasks always come first
            if (a.status === 'running' && b.status !== 'running') return -1;
            if (b.status === 'running' && a.status !== 'running') return 1;
            
            // If both are running or both are not running, sort by updated_at
            const aTime = new Date(a.updated_at || a.created_at).getTime();
            const bTime = new Date(b.updated_at || b.created_at).getTime();
            return bTime - aTime; // Most recent first
        });

        const runningCount = sortedTasks.filter(task => task.status === 'running').length;
        const statusText = runningCount > 0 ? ` (${runningCount} running)` : '';

        container.innerHTML = `
            <div class="task-count-header">
                <span class="task-count">${this.tasks.length} tasks available${statusText}</span>
            </div>
            <div class="task-list-scroll">
                ${sortedTasks.map(task => this.createTaskListItem(task)).join('')}
            </div>
        `;

        // Add click event listeners to task items
        container.querySelectorAll('.task-item').forEach(item => {
            item.addEventListener('click', () => {
                const taskId = item.dataset.taskId;
                this.navigateToTask(taskId);
            });
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
                } catch (e) {
                    // Rectangle might already be removed
                }
            }
        });
        this.taskRectangles.clear();

        // Add new rectangles
        this.tasks.forEach(task => {
            const rectangle = this.createTaskRectangle(task);
            if (rectangle && this.map) {
                try {
                    rectangle.addTo(this.map);
                    this.taskRectangles.set(task.id, rectangle);
                } catch (e) {
                    console.warn('Failed to add rectangle to map:', e);
                }
            }
        });

        // No verbose logging - tasks are being rendered silently
    }

    createTaskRectangle(task) {
        if (!task.start_coordinates || !task.range) return null;

        const [lat, lon] = task.start_coordinates;
        const { width_km, height_km } = task.range;
        
        // For running tasks, show actual scanning area
        // Backend now supports both rectangular and circular scan areas
        let actualWidth, actualHeight;
        if (task.status === 'running') {
            // If the task was started with rectangular parameters, the backend will
            // respect those dimensions. Otherwise, it uses circular logic.
            actualWidth = width_km;
            actualHeight = height_km;
        } else {
            // For non-running tasks, show original requested dimensions
            actualWidth = width_km;
            actualHeight = height_km;
        }
        
        // Convert km to approximate degrees
        const latOffset = actualHeight / 111; // ~111 km per degree latitude
        const lonOffset = actualWidth / (111 * Math.cos(lat * Math.PI / 180)); // Adjust for latitude

        const bounds = [
            [lat - latOffset / 2, lon - lonOffset / 2], // Southwest
            [lat + latOffset / 2, lon + lonOffset / 2]  // Northeast
        ];

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
            // --- Custom: Cycle zoom on rectangle click ---
            if (this.map) {
                // Get center of rectangle
                const bounds = rectangle.getBounds();
                const center = bounds.getCenter();
                // Cycle zoom level
                let idx = this._rectangleZoomLevels.indexOf(this._rectangleZoomLevel);
                idx = (idx + 1) % this._rectangleZoomLevels.length;
                this._rectangleZoomLevel = this._rectangleZoomLevels[idx];
                this.map.setView(center, this._rectangleZoomLevel, { animate: true });
            }
            // Do NOT call navigateToTask here to avoid conflicting map animations
        });

        // Add tooltip
        const tooltipContent = `
            <div class="task-tooltip">
                <strong>Task ${task.id.slice(0, 8)}</strong><br>
                Status: ${this.taskService.getStatusText(task.status)}<br>
                Findings: ${task.findings ? task.findings.length : 0}<br>
                Requested: ${task.range.width_km}×${task.range.height_km} km
                ${task.status === 'running' ? `<br>Scanning: ${actualWidth.toFixed(1)}×${actualHeight.toFixed(1)} km` : ''}
            </div>
        `;
        
        rectangle.bindTooltip(tooltipContent, {
            sticky: true,
            direction: 'top'
        });

        return rectangle;
    }

    async navigateToTask(taskId) {
        try {
            const navData = await this.taskService.getTaskNavigation(taskId);
            
            if (this.map) {
                // Animate to task location
                this.map.flyToBounds([
                    navData.bounds.southwest,
                    navData.bounds.northeast
                ], {
                    padding: [50, 50],
                    duration: 1.5
                });

                // Highlight the selected task
                this.highlightTask(taskId);
                
                // Load cached bitmap for this task
                if (window.reArchaeologyApp && typeof window.reArchaeologyApp.loadCachedBitmapForTask === 'function') {
                    await window.reArchaeologyApp.loadCachedBitmapForTask(taskId);
                }
            }
        } catch (error) {
            console.error('Failed to navigate to task:', error);
        }
    }

    async navigateToTaskSmoothly(taskId) {
        try {
            const navData = await this.taskService.getTaskNavigation(taskId);
            
            if (this.map) {
                // Calculate target bounds with proper padding for the scanning area
                const targetBounds = L.latLngBounds([
                    navData.bounds.southwest,
                    navData.bounds.northeast
                ]);
                
                // Find the task to get its actual scanning dimensions
                const task = this.tasks.find(t => t.id === taskId);
                let paddingX = 100, paddingY = 100;
                
                if (task && task.status === 'running') {
                    // For running tasks, show more context around the scanning area
                    paddingX = 150;
                    paddingY = 150;
                }
                
                // Single smooth animation to the scanning area with appropriate zoom level
                this.map.flyToBounds(targetBounds, {
                    padding: [paddingX, paddingY],
                    duration: 2.0,
                    easeLinearity: 0.25,
                    maxZoom: 14 // Prevent zooming too close
                });

                // Highlight the selected task after navigation completes
                setTimeout(async () => {
                    this.highlightTask(taskId);
                    
                    // Set up scan area with task's rectangular dimensions
                    const task = this.tasks.find(t => t.id === taskId);
                    if (task && window.reArchaeologyApp) {
                        const { width_km, height_km } = task.range;
                        const [lat, lon] = task.start_coordinates;
                        
                        // Import the selectScanArea function dynamically
                        const { selectScanArea, updateScanAreaLabel } = await import('./map.js');
                        if (selectScanArea && typeof selectScanArea === 'function') {
                            await selectScanArea(window.reArchaeologyApp, lat, lon, null, width_km, height_km);
                            
                            // Update scan area label with current resolution if available
                            if (updateScanAreaLabel && window.reArchaeologyApp.currentResolution) {
                                updateScanAreaLabel(window.reArchaeologyApp);
                            }
                        }
                    }
                    
                    // Load cached bitmap for this task
                    if (window.reArchaeologyApp && typeof window.reArchaeologyApp.loadCachedBitmapForTask === 'function') {
                        await window.reArchaeologyApp.loadCachedBitmapForTask(taskId);
                    }
                }, 2100);
                
                // Load cached bitmap for this task immediately
                if (window.reArchaeologyApp && typeof window.reArchaeologyApp.loadCachedBitmapForTask === 'function') {
                    // Load after navigation starts
                    setTimeout(async () => {
                        // Set up scan area first
                        const task = this.tasks.find(t => t.id === taskId);
                        if (task) {
                            const { width_km, height_km } = task.range;
                            const [lat, lon] = task.start_coordinates;
                            
                            // Import the selectScanArea function dynamically
                            const { selectScanArea, updateScanAreaLabel } = await import('./map.js');
                            if (selectScanArea && typeof selectScanArea === 'function') {
                                await selectScanArea(window.reArchaeologyApp, lat, lon, null, width_km, height_km);
                                
                                // Update scan area label with current resolution if available
                                if (updateScanAreaLabel && window.reArchaeologyApp.currentResolution) {
                                    updateScanAreaLabel(window.reArchaeologyApp);
                                }
                            }
                        }
                        
                        await window.reArchaeologyApp.loadCachedBitmapForTask(taskId);
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

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
        
        this.init();
    }

    init() {
        this.loadTasks();
        this.startAutoRefresh();
    }

    async loadTasks() {
        try {
            this.showLoadingState();
            this.tasks = await this.taskService.getTasks({ minDecay: 0.1 });
            this.renderTaskRectangles();
            this.renderTaskList();
            
            // Auto-navigate to running task if this is the first load
            if (this.isFirstLoad) {
                this.isFirstLoad = false;
                await this.checkAndNavigateToRunningTask();
            }
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

        container.innerHTML = `
            <div class="task-count-header">
                <span class="task-count">${this.tasks.length} tasks available</span>
            </div>
            <div class="task-list-scroll">
                ${this.tasks.map(task => this.createTaskListItem(task)).join('')}
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
        
        // Add running indicator for active tasks
        const runningIndicator = task.status === 'running' ? 
            '<span class="running-indicator">🔄</span>' : '';

        return `
            <div class="task-item ${task.status}" 
                 data-task-id="${task.id}" 
                 style="border-left-color: ${statusColor}; opacity: ${opacityValue};">
                <div class="task-header">
                    <span class="task-id">${task.id.slice(0, 6)}</span>
                    <span class="task-status" style="color: ${statusColor};">
                        ${runningIndicator}${statusText}
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

        console.log(`Rendered ${this.taskRectangles.size} task rectangles`);
    }

    createTaskRectangle(task) {
        if (!task.start_coordinates || !task.range) return null;

        const [lat, lon] = task.start_coordinates;
        const { width_km, height_km } = task.range;
        
        // For running tasks, show the actual LiDAR scanning boundary
        // Backend converts rectangular task to square scanning area using max dimension as radius
        let actualWidth, actualHeight;
        if (task.status === 'running') {
            // Backend uses: radius_km = max(width_km, height_km) / 2
            // Then creates square: area_width_m = area_height_m = 2 * radius_m
            const radius_km = Math.max(width_km, height_km) / 2;
            const scanning_dimension = radius_km * 2; // This is the actual square size being scanned
            actualWidth = scanning_dimension;
            actualHeight = scanning_dimension;
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
            this.navigateToTask(task.id);
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
                setTimeout(() => {
                    this.highlightTask(taskId);
                }, 2100);
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
            
            // Wait for map to be fully ready and any other initializations to complete
            setTimeout(async () => {
                await this.navigateToTaskSmoothly(runningTask.id);
            }, 1500);
        } else {
            // No running tasks, let the app decide whether to show discovered sites
            console.log('No running tasks found');
            if (window.reArchaeologyApp && typeof window.reArchaeologyApp.fitToDiscoveredSitesIfNeeded === 'function') {
                setTimeout(() => window.reArchaeologyApp.fitToDiscoveredSitesIfNeeded(), 1500);
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

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

        return `
            <div class="task-item ${task.status}" 
                 data-task-id="${task.id}" 
                 style="border-left-color: ${statusColor}; opacity: ${opacityValue};">
                <div class="task-header">
                    <span class="task-id">${task.id.slice(0, 6)}</span>
                    <span class="task-status" style="color: ${statusColor};">${statusText}</span>
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
        this.taskRectangles.forEach(rectangle => {
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
        
        // Convert km to approximate degrees
        const latOffset = height_km / 111; // ~111 km per degree latitude
        const lonOffset = width_km / (111 * Math.cos(lat * Math.PI / 180)); // Adjust for latitude

        const bounds = [
            [lat - latOffset / 2, lon - lonOffset / 2], // Southwest
            [lat + latOffset / 2, lon + lonOffset / 2]  // Northeast
        ];

        const statusColor = this.taskService.getStatusColor(task.status);
        const opacity = Math.max(0.3, task.decay_value);

        const rectangle = L.rectangle(bounds, {
            color: statusColor,
            weight: 1, // Thinner border
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
        rectangle.bindTooltip(`
            <div class="task-tooltip">
                <strong>Task ${task.id.slice(0, 8)}</strong><br>
                Status: ${this.taskService.getStatusText(task.status)}<br>
                Findings: ${task.findings ? task.findings.length : 0}<br>
                Range: ${task.range.width_km}×${task.range.height_km} km
            </div>
        `, {
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
            
            // Ensure rectangle is visible on map
            if (this.map && rectangle.getBounds) {
                const bounds = rectangle.getBounds();
                if (bounds && !this.map.getBounds().intersects(bounds)) {
                    this.map.fitBounds(bounds, { padding: [50, 50] });
                }
            }
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
        // Refresh tasks every 30 seconds
        this.refreshInterval = setInterval(() => {
            this.loadTasks();
        }, 30000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
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

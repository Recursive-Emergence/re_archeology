/**
 * Background Tasks Service for RE-Archaeology Framework
 * Handles task monitoring and WebSocket updates
 */

class BackgroundTasksService {
    constructor() {
        this.baseUrl = '/api/background-tasks';
        this.tasks = [];
        this.websocket = null;
        this.reconnectInterval = null;
        this.activeTasks = 0;
        
        this.initializeWebSocket();
    }

    initializeWebSocket() {
        if (!authService.isAuthenticated()) {
            return;
        }

        const userId = authService.currentUser?.user_id;
        if (!userId) {
            return;
        }

        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/api/background-tasks/ws/${userId}`;
            
            this.websocket = new WebSocket(wsUrl);

            this.websocket.onopen = () => {
                console.log('WebSocket connected for background tasks');
                if (this.reconnectInterval) {
                    clearInterval(this.reconnectInterval);
                    this.reconnectInterval = null;
                }
            };

            this.websocket.onmessage = (event) => {
                const message = JSON.parse(event.data);
                this.handleWebSocketMessage(message);
            };

            this.websocket.onclose = () => {
                console.log('WebSocket disconnected');
                this.scheduleReconnect();
            };

            this.websocket.onerror = (error) => {
                console.error('WebSocket error:', error);
            };

            // Send ping every 30 seconds to keep connection alive
            setInterval(() => {
                if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                    this.websocket.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000);

        } catch (error) {
            console.error('Failed to initialize WebSocket:', error);
        }
    }

    scheduleReconnect() {
        if (this.reconnectInterval) return;

        this.reconnectInterval = setInterval(() => {
            if (authService.isAuthenticated()) {
                this.initializeWebSocket();
            }
        }, 5000);
    }

    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'task_progress':
                this.updateTaskProgress(message.task_id, message.progress, message.current_step);
                break;
            case 'task_completed':
                this.handleTaskCompleted(message.task_id, message.result);
                break;
            case 'task_failed':
                this.handleTaskFailed(message.task_id, message.error);
                break;
            case 'task_cancelled':
                this.handleTaskCancelled(message.task_id);
                break;
            case 'pong':
                // Heartbeat response
                break;
            default:
                console.log('Unknown WebSocket message type:', message.type);
        }
    }

    async startTask(taskType, entityType, entityId = null, parameters = null) {
        if (!authService.requireAuth()) {
            return null;
        }

        try {
            const response = await fetch(`${this.baseUrl}/start`, {
                method: 'POST',
                headers: authService.getAuthHeaders(),
                body: JSON.stringify({
                    task_type: taskType,
                    entity_type: entityType,
                    entity_id: entityId,
                    parameters: parameters
                })
            });

            if (response.ok) {
                const data = await response.json();
                this.updateActiveTasksCount();
                this.refreshTasks();
                return data;
            } else {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Failed to start task');
            }
        } catch (error) {
            console.error('Start task error:', error);
            this.showError('Failed to start task: ' + error.message);
            return null;
        }
    }

    async getTasks(statusFilter = null) {
        if (!authService.isAuthenticated()) {
            return [];
        }

        try {
            let url = `${this.baseUrl}/`;
            if (statusFilter) {
                url += `?status_filter=${statusFilter}`;
            }

            const response = await fetch(url, {
                headers: authService.getAuthHeaders()
            });

            if (response.ok) {
                const tasks = await response.json();
                this.tasks = tasks;
                this.updateActiveTasksCount();
                return tasks;
            } else {
                throw new Error('Failed to get tasks');
            }
        } catch (error) {
            console.error('Get tasks error:', error);
            return [];
        }
    }

    async getTask(taskId) {
        if (!authService.isAuthenticated()) {
            return null;
        }

        try {
            const response = await fetch(`${this.baseUrl}/${taskId}`, {
                headers: authService.getAuthHeaders()
            });

            if (response.ok) {
                return await response.json();
            } else {
                throw new Error('Failed to get task details');
            }
        } catch (error) {
            console.error('Get task error:', error);
            return null;
        }
    }

    async cancelTask(taskId) {
        if (!authService.requireAuth()) {
            return false;
        }

        try {
            const response = await fetch(`${this.baseUrl}/${taskId}`, {
                method: 'DELETE',
                headers: authService.getAuthHeaders()
            });

            if (response.ok) {
                this.refreshTasks();
                return true;
            } else {
                throw new Error('Failed to cancel task');
            }
        } catch (error) {
            console.error('Cancel task error:', error);
            this.showError('Failed to cancel task: ' + error.message);
            return false;
        }
    }

    updateTaskProgress(taskId, progress, currentStep) {
        // Update task in local array
        const task = this.tasks.find(t => t.task_id === taskId);
        if (task) {
            task.metadata = task.metadata || {};
            task.metadata.progress = progress;
            task.metadata.current_step = currentStep;
            task.status = 'RUNNING';
        }

        // Update UI if tasks modal is open
        this.updateTaskDisplay(taskId);
        
        // Show notification for significant progress
        if (progress === 100) {
            this.showNotification(`Task "${currentStep}" completed`, 'success');
        }
    }

    handleTaskCompleted(taskId, result) {
        // Update task in local array
        const task = this.tasks.find(t => t.task_id === taskId);
        if (task) {
            task.status = 'COMPLETED';
            task.metadata = task.metadata || {};
            task.metadata.result = result;
        }

        this.updateTaskDisplay(taskId);
        this.updateActiveTasksCount();
        this.showNotification('Task completed successfully!', 'success');
    }

    handleTaskFailed(taskId, error) {
        // Update task in local array
        const task = this.tasks.find(t => t.task_id === taskId);
        if (task) {
            task.status = 'FAILED';
            task.metadata = task.metadata || {};
            task.metadata.error = error;
        }

        this.updateTaskDisplay(taskId);
        this.updateActiveTasksCount();
        this.showNotification('Task failed: ' + error, 'error');
    }

    handleTaskCancelled(taskId) {
        // Update task in local array
        const task = this.tasks.find(t => t.task_id === taskId);
        if (task) {
            task.status = 'CANCELLED';
        }

        this.updateTaskDisplay(taskId);
        this.updateActiveTasksCount();
        this.showNotification('Task cancelled', 'info');
    }

    updateActiveTasksCount() {
        this.activeTasks = this.tasks.filter(t => 
            t.status === 'PENDING' || t.status === 'RUNNING'
        ).length;

        const countElement = document.getElementById('activeTasksCount');
        if (countElement) {
            countElement.textContent = this.activeTasks;
        }
    }

    updateTaskDisplay(taskId) {
        const taskElement = document.getElementById(`task-${taskId}`);
        if (taskElement) {
            const task = this.tasks.find(t => t.task_id === taskId);
            if (task) {
                const taskHtml = this.createTaskElement(task);
                taskElement.outerHTML = taskHtml;
            }
        }
    }

    async refreshTasks() {
        await this.getTasks();
        this.displayTasks();
    }

    displayTasks() {
        const container = document.getElementById('backgroundTasksList');
        if (!container) return;

        if (this.tasks.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted py-4">
                    <i class="fas fa-tasks fa-2x mb-3"></i>
                    <p>No background tasks found.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.tasks.map(task => this.createTaskElement(task)).join('');
    }

    createTaskElement(task) {
        const statusClass = this.getStatusClass(task.status);
        const progress = task.metadata?.progress || 0;
        const currentStep = task.metadata?.current_step || '';
        
        return `
            <div id="task-${task.task_id}" class="card mb-3">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <h6 class="card-title">${task.task_type.replace('_', ' ').toUpperCase()}</h6>
                            <p class="card-text text-muted">${task.entity_type} ${task.entity_id || ''}</p>
                            <small class="text-muted">Started: ${new Date(task.created_at).toLocaleString()}</small>
                        </div>
                        <div>
                            <span class="badge ${statusClass}">${task.status}</span>
                            ${task.status === 'RUNNING' || task.status === 'PENDING' ? 
                                `<button class="btn btn-sm btn-outline-danger ms-2" onclick="backgroundTasksService.cancelTask('${task.task_id}')">
                                    <i class="fas fa-times"></i>
                                </button>` : ''
                            }
                        </div>
                    </div>
                    
                    ${task.status === 'RUNNING' ? `
                        <div class="mt-2">
                            <div class="progress mb-2">
                                <div class="progress-bar" role="progressbar" style="width: ${progress}%" 
                                     aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"></div>
                            </div>
                            <small class="text-muted">${currentStep}</small>
                        </div>
                    ` : ''}
                    
                    ${task.status === 'COMPLETED' && task.metadata?.result ? `
                        <div class="mt-2">
                            <button class="btn btn-sm btn-outline-primary" onclick="backgroundTasksService.showTaskResult('${task.task_id}')">
                                View Results
                            </button>
                        </div>
                    ` : ''}
                    
                    ${task.status === 'FAILED' && task.metadata?.error ? `
                        <div class="mt-2 text-danger">
                            <small>Error: ${task.metadata.error}</small>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    getStatusClass(status) {
        const classes = {
            'PENDING': 'bg-secondary',
            'RUNNING': 'bg-primary',
            'COMPLETED': 'bg-success',
            'FAILED': 'bg-danger',
            'CANCELLED': 'bg-warning'
        };
        return classes[status] || 'bg-secondary';
    }

    showTaskResult(taskId) {
        const task = this.tasks.find(t => t.task_id === taskId);
        if (task && task.metadata?.result) {
            // Create a modal or display to show the result
            alert(JSON.stringify(task.metadata.result, null, 2));
        }
    }

    showError(message) {
        // Simple notification - could be enhanced with a proper notification system
        console.error(message);
        alert(message);
    }

    showNotification(message, type = 'info') {
        // Simple notification - could be enhanced with a proper notification system
        console.log(`${type}: ${message}`);
        
        // Show browser notification if permitted
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('RE-Archaeology Tasks', {
                body: message,
                icon: '/favicon.ico'
            });
        }
    }

    /**
     * Check if we're running in development mode without backend
     */
    isDevMode() {
        return window.location.hostname === 'localhost' && 
               !window.RE_ARCHAEOLOGY_CONFIG?.enableBackend;
    }

    /**
     * Get active background tasks
     */
    async getActiveTasks() {
        try {
            // Skip API call if we're in development mode
            if (this.isDevMode()) {
                console.log('Development mode: Returning mock task data');
                return this.getMockTasks();
            }
            
            // Try to fetch from API
            try {
                const response = await fetch(`${this.baseUrl}/active`, {
                    headers: authService && authService.isAuthenticated() ? 
                        authService.getAuthHeaders() : {}
                });

                if (response.ok) {
                    const tasks = await response.json();
                    this.tasks = tasks;
                    return tasks;
                }
            } catch (error) {
                console.warn('API not available, using mock task data');
            }
            
            return this.getMockTasks();
        } catch (error) {
            console.error('Error fetching active tasks:', error);
            return [];
        }
    }

    /**
     * Get mock tasks for development
     */
    getMockTasks() {
        return [
            {
                id: 'task-1',
                title: 'Spatial Analysis - Site A',
                status: 'RUNNING',
                progress: 45,
                type: 'SPATIAL_ANALYSIS',
                created_at: new Date().toISOString()
            },
            {
                id: 'task-2',
                title: 'Satellite Imagery Processing',
                status: 'PENDING',
                progress: 0,
                type: 'IMAGE_PROCESSING',
                created_at: new Date().toISOString()
            }
        ];
    }
}

// Global background tasks service instance
const backgroundTasksService = new BackgroundTasksService();

// Background tasks related functions for the UI
function showBackgroundTasks() {
    backgroundTasksService.refreshTasks();
    const modal = new bootstrap.Modal(document.getElementById('backgroundTasksModal'));
    modal.show();
}

function refreshBackgroundTasks() {
    backgroundTasksService.refreshTasks();
}

function filterTasks() {
    const statusFilter = document.getElementById('taskStatusFilter').value;
    backgroundTasksService.getTasks(statusFilter || null).then(() => {
        backgroundTasksService.displayTasks();
    });
}

// Initialize background tasks service
document.addEventListener('DOMContentLoaded', () => {
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    
    // Initialize WebSocket when user is authenticated
    if (authService.isAuthenticated()) {
        backgroundTasksService.initializeWebSocket();
        backgroundTasksService.refreshTasks();
    }
});

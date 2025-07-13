/**
 * Task Service - Handles API calls for task management
 */
console.log('[TASK-SERVICE] Module loading...');

class TaskService {
    constructor() {
        this.baseUrl = window.AppConfig.apiBase;
        this.cache = new Map();
        this.cacheTimeout = 30000; // 30 seconds
    }

    /**
     * Fetch all tasks from the API
     * @param {Object} options - Optional filters
     * @returns {Promise<Array>} Array of task objects
     */
    async getTasks(options = {}) {
        try {
            const params = new URLSearchParams();
            
            if (options.status) {
                params.append('status', options.status);
            }
            
            if (options.minDecay !== undefined) {
                params.append('min_decay', options.minDecay);
            }

            const cacheKey = `tasks_${params.toString()}`;
            
            // Check cache first
            if (this.cache.has(cacheKey)) {
                const cached = this.cache.get(cacheKey);
                if (Date.now() - cached.timestamp < this.cacheTimeout) {
                    return cached.data;
                }
            }

            const url = `${this.baseUrl}/tasks${params.toString() ? '?' + params.toString() : ''}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch tasks: ${response.status}`);
            }

            const tasks = await response.json();
            
            // Cache the result
            this.cache.set(cacheKey, {
                data: tasks,
                timestamp: Date.now()
            });

            return tasks;
        } catch (error) {
            console.error('Error fetching tasks:', error);
            throw error;
        }
    }

    /**
     * Get a specific task by ID
     * @param {string} taskId - Task ID
     * @returns {Promise<Object>} Task object
     */
    async getTask(taskId) {
        try {
            const response = await fetch(`${this.baseUrl}/tasks/${taskId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch task ${taskId}: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`Error fetching task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Get navigation data for a task
     * @param {string} taskId - Task ID
     * @returns {Promise<Object>} Navigation data
     */
    async getTaskNavigation(taskId) {
        try {
            const response = await fetch(`${this.baseUrl}/tasks/${taskId}/navigate`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error(`Failed to get navigation for task ${taskId}: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`Error getting navigation for task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }

    /**
     * Get formatted coordinates string
     * @param {Array} coordinates - [lat, lon]
     * @returns {string} Formatted coordinates
     */
    formatCoordinates(coordinates) {
        if (!coordinates || coordinates.length !== 2) {
            return 'Unknown Location';
        }
        
        const [lat, lon] = coordinates;
        const latStr = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`;
        const lonStr = `${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
        
        return `${latStr}, ${lonStr}`;
    }

    /**
     * Get status color for task
     * @param {string} status - Task status
     * @returns {string} CSS color value
     */
    getStatusColor(status) {
        const colors = {
            'running': '#4CAF50',     // Green
            'completed': '#2196F3',   // Blue
            'paused': '#FF9800',      // Orange
            'aborted': '#F44336',     // Red
            'stopped': '#9E9E9E',     // Gray
            'pending': '#FFEB3B'      // Yellow
        };
        return colors[status] || '#9E9E9E';
    }

    /**
     * Get human-readable status text
     * @param {string} status - Task status
     * @returns {string} Human-readable status
     */
    getStatusText(status) {
        const statusTexts = {
            'running': 'Running',
            'completed': 'Completed',
            'paused': 'Paused',
            'aborted': 'Aborted',
            'stopped': 'Stopped',
            'pending': 'Pending'
        };
        return statusTexts[status] || status;
    }

    /**
     * Calculate time ago from timestamp
     * @param {string} timestamp - ISO timestamp
     * @returns {string} Human-readable time ago
     */
    getTimeAgo(timestamp) {
        try {
            const now = new Date();
            const then = new Date(timestamp);
            const diffMs = now - then;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHours / 24);

            if (diffDays > 0) {
                return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
            } else if (diffHours > 0) {
                return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
            } else if (diffMins > 0) {
                return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
            } else {
                return 'Just now';
            }
        } catch (error) {
            return 'Unknown time';
        }
    }
}

// Export the service
window.TaskService = TaskService;
console.log('[TASK-SERVICE] TaskService class exported to window.TaskService');

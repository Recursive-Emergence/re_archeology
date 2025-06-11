/**
 * Discovery API Client
 * Handles communication with the windmill discovery backend
 */

class DiscoveryAPI {
    constructor(baseUrl = '') {
        this.baseUrl = baseUrl;
        this.websocket = null;
        this.callbacks = new Map();
    }

    /**
     * Connect to the WebSocket for real-time updates
     */
    async connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        
        // Use unified API endpoint
        const apiBase = window.AppConfig ? window.AppConfig.apiBase : '/api/v1';
        const baseUrl = apiBase.replace('/api/v1', ''); // Get base URL without API path
        
        const wsUrl = baseUrl ? 
            `${protocol}//${new URL(baseUrl).host}${apiBase}/ws/discovery` :
            `${protocol}//${window.location.host}/api/v1/ws/discovery`;
        
        console.log('Attempting to connect to unified WebSocket:', wsUrl);
        
        return new Promise((resolve, reject) => {
            this.websocket = new WebSocket(wsUrl);
            
            this.websocket.onopen = () => {
                console.log('WebSocket connected successfully to unified API');
                this.wasConnected = true;
                resolve();
            };
            
            this.websocket.onerror = (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            };
            
            this.websocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            };
            
            this.websocket.onclose = () => {
                console.log('WebSocket disconnected');
                this.triggerCallback('disconnect');
                
                // Only auto-reconnect if the connection was previously successful
                if (this.wasConnected) {
                    setTimeout(() => {
                        this.connectWebSocket().catch(console.error);
                    }, 3000);
                }
            };
        });
    }

    /**
     * Handle incoming WebSocket messages
     */
    handleMessage(data) {
        console.log('Received WebSocket message:', data.type, data);
        switch (data.type) {
            case 'session_started':
                this.triggerCallback('sessionStarted', data.session);
                break;
            case 'patch_scanned':
                this.triggerCallback('patchUpdate', data.patch);
                break;
            case 'progress_update':
                this.triggerCallback('progressUpdate', data.data);
                break;
            case 'session_progress':
                this.triggerCallback('progressUpdate', data.progress);
                break;
            case 'session_completed':
                this.triggerCallback('sessionCompleted', data.session);
                break;
            case 'kernel_ready':
                this.triggerCallback('kernelReady', data);
                break;
            case 'error':
                this.triggerCallback('error', data.message);
                break;
            default:
                console.warn('Unknown message type:', data.type);
        }
    }

    /**
     * Register a callback for specific events
     */
    on(event, callback) {
        if (!this.callbacks.has(event)) {
            this.callbacks.set(event, []);
        }
        this.callbacks.get(event).push(callback);
    }

    /**
     * Remove a callback
     */
    off(event, callback) {
        if (this.callbacks.has(event)) {
            const callbacks = this.callbacks.get(event);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    /**
     * Trigger callbacks for an event
     */
    triggerCallback(event, data) {
        if (this.callbacks.has(event)) {
            this.callbacks.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Callback error for event ${event}:`, error);
                }
            });
        }
    }

    /**
     * Start a discovery session using unified API
     */
    async startDiscovery(config) {
        const apiBase = window.AppConfig ? window.AppConfig.apiBase : '/api/v1';
        
        try {
            const response = await fetch(`${apiBase}/discovery/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(config)
            });
            
            if (!response.ok) {
                throw new Error(`Failed to start discovery: ${response.statusText}`);
            }
            
            return response.json();
        } catch (error) {
            console.error('Failed to start discovery session:', error);
            throw error;
        }
    }

    /**
     * Stop a discovery session using unified API
     */
    async stopDiscovery(sessionId) {
        const apiBase = window.AppConfig ? window.AppConfig.apiBase : '/api/v1';
        
        try {
            const response = await fetch(`${apiBase}/discovery/stop/${sessionId}`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error(`Failed to stop discovery: ${response.statusText}`);
            }
            
            return response.json();
        } catch (error) {
            console.error('Failed to stop discovery session:', error);
            throw error;
        }
    }

    /**
     * Get session information via unified API
     */
    async getSession(sessionId) {
        const apiBase = window.AppConfig ? window.AppConfig.apiBase : '/api/v1';
        
        const response = await fetch(`${apiBase}/discovery/session/${sessionId}`);
        if (!response.ok) {
            throw new Error(`Failed to get session: ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get all active sessions via unified API
     */
    async getActiveSessions() {
        const apiBase = window.AppConfig ? window.AppConfig.apiBase : '/api/v1';
        
        const response = await fetch(`${apiBase}/discovery/sessions`);
        if (!response.ok) {
            throw new Error(`Failed to get sessions: ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get discovery system status
     */
    async getDiscoveryStatus() {
        const apiBase = window.AppConfig ? window.AppConfig.apiBase : '/api/v1';
        
        const response = await fetch(`${apiBase}/discovery/status`);
        if (!response.ok) {
            throw new Error(`Failed to get discovery status: ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get patch data for a session
     */
    async getSessionPatches(sessionId) {
        const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/patches`);
        if (!response.ok) {
            throw new Error(`Failed to get patches: ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get detailed patch information
     */
    async getPatchDetails(patchId) {
        const response = await fetch(`${this.baseUrl}/api/patches/${patchId}`);
        if (!response.ok) {
            throw new Error(`Failed to get patch details: ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Export session results
     */
    async exportSessionResults(sessionId, format = 'json') {
        const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/export?format=${format}`);
        if (!response.ok) {
            throw new Error(`Failed to export results: ${response.statusText}`);
        }
        
        if (format === 'json') {
            return response.json();
        } else {
            return response.blob();
        }
    }

    /**
     * Get system status
     */
    async getSystemStatus() {
        const response = await fetch(`${this.baseUrl}/api/status`);
        if (!response.ok) {
            throw new Error(`Failed to get system status: ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Validate detection parameters
     */
    async validateConfig(config) {
        const response = await fetch(`${this.baseUrl}/api/validate-config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(config),
        });
        
        if (!response.ok) {
            throw new Error(`Failed to validate config: ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get available detection modes
     */
    async getDetectionModes() {
        const response = await fetch(`${this.baseUrl}/api/detection-modes`);
        if (!response.ok) {
            throw new Error(`Failed to get detection modes: ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get list of cached kernels
     */
    async listKernels() {
        const response = await fetch(`${this.baseUrl}/api/kernels`);
        if (!response.ok) {
            throw new Error(`Failed to list kernels: ${response.status}`);
        }
        return response.json();
    }

    /**
     * Clear kernel cache
     */
    async clearKernels(confirm = false) {
        const response = await fetch(`${this.baseUrl}/api/kernels/clear`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ confirm })
        });
        if (!response.ok) {
            throw new Error(`Failed to clear kernels: ${response.status}`);
        }
        return response.json();
    }

    /**
     * Force retrain kernels for next discovery session
     */
    async forceRetrain() {
        const response = await fetch(`${this.baseUrl}/api/kernels/retrain`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error(`Failed to force retrain: ${response.status}`);
        }
        return response.json();
    }

    /**
     * Close WebSocket connection
     */
    disconnect() {
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
    }

    /**
     * Check if WebSocket is connected
     */
    isConnected() {
        return this.websocket && this.websocket.readyState === WebSocket.OPEN;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DiscoveryAPI;
} else {
    window.DiscoveryAPI = DiscoveryAPI;
}

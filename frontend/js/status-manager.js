/**
 * Enhanced Status Manager for Discovery Application
 * 
 * Provides centralized status management, reliable WebSocket handling,
 * and comprehensive progress tracking with automatic recovery.
 */

class StatusManager {
    constructor() {
        this.state = {
            connection: 'disconnected', // disconnected, connecting, connected, error
            session: null,
            scanning: false,
            progress: {
                current: 0,
                total: 0,
                percentage: 0,
                rate: 0, // patches per second
                eta: null // estimated time remaining
            },
            statistics: {
                totalPatches: 0,
                positiveDetections: 0,
                highConfidenceDetections: 0,
                averageConfidence: 0,
                scanStartTime: null,
                lastUpdateTime: null
            },
            errors: [],
            lastHeartbeat: null
        };
        
        this.callbacks = new Map();
        this.websocket = null;
        this.api = null; // Will be initialized when needed
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000; // Start with 1 second
        this.heartbeatInterval = null;
        this.statusUpdateInterval = null;
        this.retryTimeouts = new Set();
        
        // Performance tracking
        this.performanceMetrics = {
            connectionLatency: 0,
            messagesSent: 0,
            messagesReceived: 0,
            reconnections: 0,
            totalErrors: 0
        };
        
        this.setupPerformanceMonitoring();
        this.initializeStatusUpdates();
    }
    
    /**
     * Initialize WebSocket connection with enhanced reliability
     */
    async connect(baseUrl = '') {
        this.updateState({ connection: 'connecting' });
        
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        
        // Use unified API endpoint
        const apiBase = window.AppConfig ? window.AppConfig.apiBase : '/api/v1';
        const apiBaseUrl = baseUrl || (window.AppConfig ? window.AppConfig.apiBase.replace('/api/v1', '') : '');
        
        const wsUrl = apiBaseUrl ? 
            `${protocol}//${new URL(apiBaseUrl).host}${apiBase}/ws/discovery` :
            `${protocol}//${window.location.host}/api/v1/ws/discovery`;
        
        console.log('🔗 Establishing WebSocket connection to unified API:', wsUrl);
        
        try {
            await this.establishConnection(wsUrl);
            this.onConnectionSuccess();
        } catch (error) {
            this.onConnectionError(error);
            throw error;
        }
    }
    
    /**
     * Establish WebSocket connection with timeout and error handling
     */
    establishConnection(wsUrl) {
        return new Promise((resolve, reject) => {
            const connectionTimeout = setTimeout(() => {
                if (this.websocket) {
                    this.websocket.close();
                }
                reject(new Error('Connection timeout after 10 seconds'));
            }, 10000);
            
            this.websocket = new WebSocket(wsUrl);
            
            this.websocket.onopen = () => {
                clearTimeout(connectionTimeout);
                resolve();
            };
            
            this.websocket.onerror = (error) => {
                clearTimeout(connectionTimeout);
                reject(new Error(`WebSocket connection failed: ${error.message || 'Unknown error'}`));
            };
            
            this.websocket.onmessage = (event) => {
                this.handleMessage(event);
            };
            
            this.websocket.onclose = (event) => {
                this.handleDisconnection(event);
            };
        });
    }
    
    /**
     * Handle successful connection
     */
    onConnectionSuccess() {
        console.log('✅ WebSocket connected successfully');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.performanceMetrics.reconnections++;
        
        this.updateState({ 
            connection: 'connected',
            lastHeartbeat: Date.now()
        });
        
        this.startHeartbeat();
        this.triggerCallback('connectionEstablished');
    }
    
    /**
     * Handle connection error
     */
    onConnectionError(error) {
        console.error('❌ WebSocket connection failed:', error.message);
        this.performanceMetrics.totalErrors++;
        
        this.updateState({ 
            connection: 'error',
            errors: [...this.state.errors, {
                type: 'connection',
                message: error.message,
                timestamp: Date.now()
            }]
        });
        
        this.triggerCallback('connectionFailed', error);
        
        // Don't immediately schedule reconnection if this is the first attempt
        if (this.reconnectAttempts === 0) {
            console.log('🔄 Initial connection failed, will retry once');
            this.scheduleReconnection();
        }
    }
    
    /**
     * Handle incoming WebSocket messages with comprehensive error handling
     */
    handleMessage(event) {
        try {
            const data = JSON.parse(event.data);
            this.performanceMetrics.messagesReceived++;
            
            // Update last heartbeat for any message
            this.updateState({ lastHeartbeat: Date.now() });
            
            console.log('📨 Received message:', data.type, data);
            
            switch (data.type) {
                case 'heartbeat':
                case 'pong':
                    this.handleHeartbeat(data);
                    break;
                    
                case 'session_started':
                    this.handleSessionStarted(data);
                    break;
                    
                case 'patch_scanning':
                    this.handlePatchScanning(data);
                    break;
                    
                case 'patch_loaded':
                    this.handlePatchLoaded(data);
                    break;
                    
                case 'patch_result':
                case 'patch_scanned':
                    this.handlePatchResult(data);
                    break;
                    
                case 'session_progress':
                case 'progress_update':
                    this.handleProgressUpdate(data);
                    break;
                    
                case 'session_completed':
                    this.handleSessionCompleted(data);
                    break;
                    
                case 'session_error':
                case 'error':
                    this.handleError(data);
                    break;
                    
                case 'session_stopped':
                    this.handleSessionStopped(data);
                    break;
                    
                case 'kernel_ready':
                    this.handleKernelReady(data);
                    break;
                    
                default:
                    console.warn('⚠️ Unknown message type:', data.type);
                    this.triggerCallback('unknownMessage', data);
            }
            
        } catch (error) {
            console.error('❌ Failed to parse WebSocket message:', error, event.data);
            this.performanceMetrics.totalErrors++;
            this.addError('message_parse', `Failed to parse message: ${error.message}`);
        }
    }
    
    /**
     * Handle session started
     */
    handleSessionStarted(data) {
        const session = data.session || data;
        this.updateState({
            session: session,
            scanning: true,
            statistics: {
                ...this.state.statistics,
                scanStartTime: Date.now(),
                lastUpdateTime: Date.now()
            }
        });
        
        this.triggerCallback('sessionStarted', session);
        this.startProgressTracking();
    }
    
    /**
     * Handle patch scanning updates
     */
    handlePatchScanning(data) {
        this.triggerCallback('patchScanning', data);
    }
    
    /**
     * Handle patch loaded updates
     */
    handlePatchLoaded(data) {
        this.triggerCallback('patchLoaded', data);
    }
    
    /**
     * Handle patch result with enhanced tracking
     */
    handlePatchResult(data) {
        const patch = data.patch || data;
        
        // Update statistics
        const stats = { ...this.state.statistics };
        stats.totalPatches++;
        stats.lastUpdateTime = Date.now();
        
        if (patch.is_positive) {
            stats.positiveDetections++;
            if (patch.confidence >= 0.8) {
                stats.highConfidenceDetections++;
            }
        }
        
        // Calculate average confidence
        if (stats.totalPatches > 0) {
            const totalConfidence = (stats.averageConfidence * (stats.totalPatches - 1)) + (patch.confidence || 0);
            stats.averageConfidence = totalConfidence / stats.totalPatches;
        }
        
        this.updateState({ statistics: stats });
        this.triggerCallback('patchResult', patch);
        this.updateProcessingRate();
    }
    
    /**
     * Handle progress updates with ETA calculation
     */
    handleProgressUpdate(data) {
        const progressData = data.progress || data.data || data;
        
        const progress = {
            current: progressData.processed_patches || progressData.processed || this.state.progress.current,
            total: progressData.total_patches || progressData.total || this.state.progress.total,
            percentage: 0,
            rate: this.state.progress.rate,
            eta: null
        };
        
        if (progress.total > 0) {
            progress.percentage = (progress.current / progress.total) * 100;
            
            // Calculate ETA
            if (progress.rate > 0 && progress.current < progress.total) {
                const remainingPatches = progress.total - progress.current;
                progress.eta = Math.ceil(remainingPatches / progress.rate);
            }
        }
        
        this.updateState({ progress });
        this.triggerCallback('progressUpdate', progress);
    }
    
    /**
     * Handle session completion
     */
    handleSessionCompleted(data) {
        const session = data.session || data;
        const completionTime = Date.now();
        const duration = this.state.statistics.scanStartTime ? 
            completionTime - this.state.statistics.scanStartTime : 0;
        
        this.updateState({
            session: { ...this.state.session, ...session, completionTime, duration },
            scanning: false,
            progress: { ...this.state.progress, percentage: 100 }
        });
        
        this.stopProgressTracking();
        this.triggerCallback('sessionCompleted', { ...session, duration });
    }
    
    /**
     * Handle session stopped
     */
    handleSessionStopped(data) {
        this.updateState({
            scanning: false,
            session: null
        });
        
        this.stopProgressTracking();
        this.triggerCallback('sessionStopped', data);
    }
    
    /**
     * Handle kernel ready messages
     */
    handleKernelReady(data) {
        console.log('📦 Kernel ready:', data);
        this.triggerCallback('kernelReady', data);
    }
    
    /**
     * Handle errors with categorization
     */
    handleError(data) {
        const error = {
            type: data.error_type || 'session',
            message: data.error || data.message || 'Unknown error',
            timestamp: Date.now(),
            sessionId: data.session_id || this.state.session?.session_id
        };
        
        this.addError(error.type, error.message);
        this.triggerCallback('error', error);
        
        // If session error, stop scanning
        if (error.type === 'session' || data.type === 'session_error') {
            this.updateState({ scanning: false });
            this.stopProgressTracking();
        }
    }
    
    /**
     * Handle heartbeat responses
     */
    handleHeartbeat(data) {
        const now = Date.now();
        if (data.timestamp) {
            this.performanceMetrics.connectionLatency = now - new Date(data.timestamp).getTime();
        }
        
        // Send pong response to keep connection alive
        this.sendMessage({
            type: 'pong',
            timestamp: new Date().toISOString()
        });
        
        this.triggerCallback('heartbeat', { latency: this.performanceMetrics.connectionLatency });
    }
    
    /**
     * Handle disconnection with automatic reconnection
     */
    handleDisconnection(event) {
        console.log('🔌 WebSocket disconnected:', event.code, event.reason);
        
        this.updateState({ 
            connection: 'disconnected',
            scanning: false
        });
        
        this.stopHeartbeat();
        this.stopProgressTracking();
        this.triggerCallback('disconnected', { code: event.code, reason: event.reason });
        
        // Only auto-reconnect if it wasn't a clean close
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnection();
        }
    }
    
    /**
     * Schedule reconnection with exponential backoff
     */
    scheduleReconnection() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ Max reconnection attempts reached');
            this.updateState({ connection: 'error' });
            this.triggerCallback('reconnectionFailed');
            return;
        }
        
        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
        
        console.log(`🔄 Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
        
        const timeout = setTimeout(() => {
            this.retryTimeouts.delete(timeout);
            this.attemptReconnection();
        }, delay);
        
        this.retryTimeouts.add(timeout);
        this.triggerCallback('reconnectionScheduled', { attempt: this.reconnectAttempts, delay });
    }
    
    /**
     * Attempt reconnection
     */
    async attemptReconnection() {
        try {
            await this.connect();
        } catch (error) {
            console.error(`❌ Reconnection attempt ${this.reconnectAttempts} failed:`, error.message);
            this.scheduleReconnection();
        }
    }
    
    /**
     * Start heartbeat monitoring
     */
    startHeartbeat() {
        this.stopHeartbeat();
        
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected()) {
                this.sendMessage({ type: 'ping', timestamp: new Date().toISOString() });
                
                // Check if we've missed heartbeats (extended timeout for discovery)
                const timeSinceLastHeartbeat = Date.now() - this.state.lastHeartbeat;
                if (timeSinceLastHeartbeat > 120000) { // 120 seconds (extended for discovery)
                    console.warn('⚠️ Heartbeat timeout, connection may be stale');
                    this.websocket.close();
                }
            }
        }, 30000); // Send heartbeat every 30 seconds
    }
    
    /**
     * Stop heartbeat monitoring
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    
    /**
     * Start progress tracking
     */
    startProgressTracking() {
        this.stopProgressTracking();
        
        this.statusUpdateInterval = setInterval(() => {
            this.updateProcessingRate();
            this.triggerCallback('statusUpdate', this.getStatus());
        }, 2000); // Update every 2 seconds
    }
    
    /**
     * Stop progress tracking
     */
    stopProgressTracking() {
        if (this.statusUpdateInterval) {
            clearInterval(this.statusUpdateInterval);
            this.statusUpdateInterval = null;
        }
    }
    
    /**
     * Update processing rate calculation
     */
    updateProcessingRate() {
        const now = Date.now();
        const timeDiff = now - this.state.statistics.scanStartTime;
        
        if (timeDiff > 0 && this.state.statistics.totalPatches > 0) {
            this.state.progress.rate = (this.state.statistics.totalPatches / timeDiff) * 1000; // patches per second
        }
    }
    
    /**
     * Send message through WebSocket with error handling
     */
    sendMessage(message) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        try {
            this.websocket.send(JSON.stringify(message));
            this.performanceMetrics.messagesSent++;
            return true;
        } catch (error) {
            console.error('❌ Failed to send message:', error);
            this.performanceMetrics.totalErrors++;
            this.addError('send', `Failed to send message: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Start discovery session using unified API
     */
    async startDiscovery(config) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        try {
            // Use the DiscoveryAPI to start session via REST API
            if (!this.api) {
                this.api = new DiscoveryAPI();
            }
            
            const result = await this.api.startDiscovery(config);
            console.log('🚀 Discovery session started via unified API:', result);
            
            return result;
        } catch (error) {
            console.error('Failed to start discovery session:', error);
            throw error;
        }
    }
    
    /**
     * Stop discovery session using unified API
     */
    async stopDiscovery(sessionId = null) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }
        
        try {
            if (!this.api) {
                this.api = new DiscoveryAPI();
            }
            
            const targetSessionId = sessionId || this.state.session?.session_id;
            if (!targetSessionId) {
                throw new Error('No active session to stop');
            }
            
            const result = await this.api.stopDiscovery(targetSessionId);
            console.log('⏹️ Discovery session stopped via unified API:', result);
            
            return result;
        } catch (error) {
            console.error('Failed to stop discovery session:', error);
            throw error;
        }
    }
    
    /**
     * Check if WebSocket is connected
     */
    isConnected() {
        return this.websocket && this.websocket.readyState === WebSocket.OPEN;
    }
    
    /**
     * Get current status
     */
    getStatus() {
        return {
            ...this.state,
            performance: this.performanceMetrics,
            uptime: this.state.statistics.scanStartTime ? 
                Date.now() - this.state.statistics.scanStartTime : 0
        };
    }
    
    /**
     * Add error to error log
     */
    addError(type, message) {
        const error = {
            type,
            message,
            timestamp: Date.now()
        };
        
        this.updateState({
            errors: [...this.state.errors.slice(-9), error] // Keep last 10 errors
        });
    }
    
    /**
     * Clear errors
     */
    clearErrors() {
        this.updateState({ errors: [] });
    }
    
    /**
     * Update state and notify subscribers
     */
    updateState(updates) {
        const previousState = { ...this.state };
        this.state = { ...this.state, ...updates };
        this.triggerCallback('stateChanged', { previous: previousState, current: this.state });
    }
    
    /**
     * Register event callback
     */
    on(event, callback) {
        if (!this.callbacks.has(event)) {
            this.callbacks.set(event, []);
        }
        this.callbacks.get(event).push(callback);
    }
    
    /**
     * Remove event callback
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
    triggerCallback(event, data = null) {
        if (this.callbacks.has(event)) {
            this.callbacks.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`❌ Callback error for event ${event}:`, error);
                }
            });
        }
    }
    
    /**
     * Setup performance monitoring
     */
    setupPerformanceMonitoring() {
        // Monitor WebSocket performance
        setInterval(() => {
            if (this.isConnected()) {
                const stats = {
                    connectionLatency: this.performanceMetrics.connectionLatency,
                    messagesSent: this.performanceMetrics.messagesSent,
                    messagesReceived: this.performanceMetrics.messagesReceived,
                    errorRate: this.performanceMetrics.totalErrors / (this.performanceMetrics.messagesSent + this.performanceMetrics.messagesReceived || 1)
                };
                
                this.triggerCallback('performanceUpdate', stats);
            }
        }, 10000); // Every 10 seconds
    }
    
    /**
     * Initialize status update system
     */
    initializeStatusUpdates() {
        // Periodic status broadcasts
        setInterval(() => {
            this.triggerCallback('periodicUpdate', this.getStatus());
        }, 5000); // Every 5 seconds
    }
    
    /**
     * Disconnect and cleanup
     */
    disconnect() {
        console.log('🔌 Disconnecting WebSocket...');
        
        // Clear all timeouts
        this.retryTimeouts.forEach(timeout => clearTimeout(timeout));
        this.retryTimeouts.clear();
        
        this.stopHeartbeat();
        this.stopProgressTracking();
        
        if (this.websocket) {
            this.websocket.close(1000, 'Client disconnect');
            this.websocket = null;
        }
        
        this.updateState({ 
            connection: 'disconnected',
            scanning: false
        });
        
        this.triggerCallback('manualDisconnect');
    }
    
    /**
     * Get list of cached kernels
     */
    async listKernels() {
        if (!this.api) {
            this.api = new DiscoveryAPI();
        }
        return await this.api.listKernels();
    }
    
    /**
     * Clear kernel cache
     */
    async clearKernels(confirm = false) {
        if (!this.api) {
            this.api = new DiscoveryAPI();
        }
        return await this.api.clearKernels(confirm);
    }
    
    /**
     * Force retrain kernels
     */
    async forceRetrain() {
        if (!this.api) {
            this.api = new DiscoveryAPI();
        }
        return await this.api.forceRetrain();
    }
    
    /**
     * Reset all state
     */
    reset() {
        this.disconnect();
        
        this.state = {
            connection: 'disconnected',
            session: null,
            scanning: false,
            progress: {
                current: 0,
                total: 0,
                percentage: 0,
                rate: 0,
                eta: null
            },
            statistics: {
                totalPatches: 0,
                positiveDetections: 0,
                highConfidenceDetections: 0,
                averageConfidence: 0,
                scanStartTime: null,
                lastUpdateTime: null
            },
            errors: [],
            lastHeartbeat: null
        };
        
        this.reconnectAttempts = 0;
        this.performanceMetrics = {
            connectionLatency: 0,
            messagesSent: 0,
            messagesReceived: 0,
            reconnections: 0,
            totalErrors: 0
        };
        
        this.triggerCallback('reset');
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StatusManager;
} else {
    window.StatusManager = StatusManager;
}

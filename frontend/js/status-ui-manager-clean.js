/**
 * Status UI Manager for Discovery Application
 * 
 * Provides comprehensive UI status display with real-time updates,
 * progress visualization, and detailed system information.
 */

class StatusUIManager {
    constructor(statusManager) {
        this.statusManager = statusManager;
        this.elements = {};
        this.charts = new Map();
        this.animations = new Map();
        this.updateTimers = new Set();
        
        this.initializeElements();
        this.setupEventListeners();
        this.bindStatusEvents();
    }
    
    /**
     * Initialize UI elements
     */
    initializeElements() {
        // Main status display elements
        this.elements = {
            // Connection status
            connectionStatus: document.getElementById('connectionStatus'),
            connectionDot: document.querySelector('.connection-dot'),
            connectionText: document.querySelector('#connectionStatus span'),
            
            // Session status
            sessionStatus: document.getElementById('sessionStatus'),
            processedPatches: document.getElementById('processedPatches'),
            totalDetections: document.getElementById('totalDetections'),
            highConfidenceDetections: document.getElementById('highConfidenceDetections'),
            
            // Progress display
            progressOverlay: document.getElementById('progressOverlay'),
            progressText: document.getElementById('progressText'),
            progressBar: document.querySelector('.progress-bar'),
            progressFill: document.querySelector('.progress-fill'),
            
            // Control buttons - removed lidarScanBtn
            startScanBtn: document.getElementById('startScanBtn'),
            stopScanBtn: document.getElementById('stopScanBtn'),
            clearResultsBtn: document.getElementById('clearResultsBtn'),
            
            // Status containers
            statusContainer: document.querySelector('.status-container'),
            detailedStatus: document.getElementById('detailedStatus'),
            errorIndicator: document.querySelector('.error-indicator'),
            
            // Charts and visualizations
            progressChart: document.getElementById('progressChart'),
            statisticsChart: document.getElementById('statisticsChart'),
            performanceChart: document.getElementById('performanceChart')
        };
        
        this.createAdvancedStatusPanels();
        this.createFloatingStatusWidget();
        this.createProgressIndicator();
    }
    
    /**
     * Create advanced status panels for detailed information
     */
    createAdvancedStatusPanels() {
        // Create detailed status panel if it doesn't exist
        if (!this.elements.detailedStatus) {
            const detailedPanel = document.createElement('div');
            detailedPanel.id = 'detailedStatus';
            detailedPanel.className = 'detailed-status-panel hidden';
            detailedPanel.innerHTML = `
                <h3>Detailed Status Information</h3>
                <div class="status-sections">
                    <div class="section connection-section">
                        <h4>Connection Status</h4>
                        <div class="connection-details">
                            <div class="detail-item">
                                <span class="label">WebSocket:</span>
                                <span class="value" id="wsStatus">Disconnected</span>
                            </div>
                            <div class="detail-item">
                                <span class="label">Latency:</span>
                                <span class="value" id="latencyValue">-</span>
                            </div>
                            <div class="detail-item">
                                <span class="label">Reconnects:</span>
                                <span class="value" id="reconnectCount">0</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="section session-section">
                        <h4>Session Information</h4>
                        <div class="session-details">
                            <div class="detail-item">
                                <span class="label">Session ID:</span>
                                <span class="value" id="sessionId">None</span>
                            </div>
                            <div class="detail-item">
                                <span class="label">Start Time:</span>
                                <span class="value" id="sessionStartTime">-</span>
                            </div>
                            <div class="detail-item">
                                <span class="label">Duration:</span>
                                <span class="value" id="sessionDuration">-</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="section performance-section">
                        <h4>Performance Metrics</h4>
                        <div class="performance-details">
                            <div class="detail-item">
                                <span class="label">Processing Rate:</span>
                                <span class="value" id="processingRate">- patches/sec</span>
                            </div>
                            <div class="detail-item">
                                <span class="label">Memory Usage:</span>
                                <span class="value" id="memoryUsage">-</span>
                            </div>
                            <div class="detail-item">
                                <span class="label">ETA:</span>
                                <span class="value" id="etaValue">-</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="section error-section">
                        <h4>Error Log</h4>
                        <div class="error-log" id="errorLog">
                            <div class="no-errors">No errors reported</div>
                        </div>
                    </div>
                </div>
                <button class="close-btn" onclick="this.parentElement.classList.add('hidden')">×</button>
            `;
            
            document.body.appendChild(detailedPanel);
            this.elements.detailedStatus = detailedPanel;
        }
    }
    
    /**
     * Create floating status widget for always-visible status
     */
    createFloatingStatusWidget() {
        const widget = document.createElement('div');
        widget.className = 'floating-status-widget';
        widget.innerHTML = `
            <div class="widget-header">
                <span class="widget-title">Status</span>
                <button class="widget-toggle" onclick="this.parentElement.parentElement.classList.toggle('minimized')">_</button>
            </div>
            <div class="widget-content">
                <div class="status-item">
                    <span class="status-dot" id="floatingConnectionDot"></span>
                    <span id="floatingConnectionText">Disconnected</span>
                </div>
                <div class="status-item">
                    <span class="label">Progress:</span>
                    <span id="floatingProgress">0%</span>
                </div>
                <div class="status-item">
                    <span class="label">Detections:</span>
                    <span id="floatingDetections">0</span>
                </div>
            </div>
        `;
        
        document.body.appendChild(widget);
        
        // Make it draggable
        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };
        
        const header = widget.querySelector('.widget-header');
        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            dragOffset.x = e.clientX - widget.offsetLeft;
            dragOffset.y = e.clientY - widget.offsetTop;
            widget.style.zIndex = '10000';
        });
        
        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                widget.style.left = (e.clientX - dragOffset.x) + 'px';
                widget.style.top = (e.clientY - dragOffset.y) + 'px';
            }
        });
        
        document.addEventListener('mouseup', () => {
            isDragging = false;
            widget.style.zIndex = '1000';
        });
    }
    
    /**
     * Create progress indicator with enhanced visualization
     */
    createProgressIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'enhanced-progress-indicator';
        indicator.innerHTML = `
            <div class="progress-header">
                <span class="progress-title">Detection Progress</span>
                <span class="progress-percentage">0%</span>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill"></div>
                    <div class="progress-bar-text">Waiting to start...</div>
                </div>
            </div>
            <div class="progress-details">
                <div class="detail">
                    <span class="label">Processed:</span>
                    <span class="value" id="processedCount">0</span>
                </div>
                <div class="detail">
                    <span class="label">Total:</span>
                    <span class="value" id="totalCount">0</span>
                </div>
                <div class="detail">
                    <span class="label">Rate:</span>
                    <span class="value" id="processingRateDetail">0/sec</span>
                </div>
                <div class="detail">
                    <span class="label">ETA:</span>
                    <span class="value" id="etaDetail">-</span>
                </div>
            </div>
        `;
        
        // Add smooth animations
        indicator.addEventListener('transitionend', () => {
            // Add any completion effects here
        });
        
        // Insert before the map
        const mapContainer = document.querySelector('.map-container');
        if (mapContainer) {
            mapContainer.insertBefore(indicator, mapContainer.firstChild);
        }
    }
    
    /**
     * Setup event listeners for UI interactions
     */
    setupEventListeners() {
        // Detection button event listeners
        if (this.elements.startScanBtn) {
            this.elements.startScanBtn.addEventListener('click', () => {
                this.handleStartScan();
            });
        }
        
        if (this.elements.stopScanBtn) {
            this.elements.stopScanBtn.addEventListener('click', () => {
                this.handleStopScan();
            });
        }
        
        if (this.elements.clearResultsBtn) {
            this.elements.clearResultsBtn.addEventListener('click', () => {
                this.handleClearResults();
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case 's':
                        e.preventDefault();
                        if (!this.statusManager.state.scanning) {
                            this.handleStartScan();
                        }
                        break;
                    case 'q':
                        e.preventDefault();
                        if (this.statusManager.state.scanning) {
                            this.handleStopScan();
                        }
                        break;
                    case 'd':
                        e.preventDefault();
                        this.toggleDetailedPanel();
                        break;
                }
            }
        });
        
        // Window events
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
        
        window.addEventListener('resize', () => {
            this.handleResize();
        });
    }
    
    /**
     * Bind status manager events
     */
    bindStatusEvents() {
        if (!this.statusManager) return;
        
        // Connection events
        this.statusManager.on('connection', (status) => {
            this.updateConnectionStatus(status);
        });
        
        // Session events
        this.statusManager.on('session', (session) => {
            this.updateSessionStatus(session);
        });
        
        // Progress events
        this.statusManager.on('progress', (progress) => {
            this.updateProgress(progress);
        });
        
        // Statistics events
        this.statusManager.on('statistics', (stats) => {
            this.updateStatistics(stats);
        });
        
        // Error events
        this.statusManager.on('error', (error) => {
            this.handleError(error);
        });
        
        // Performance events
        this.statusManager.on('performance', (metrics) => {
            this.updatePerformanceMetrics(metrics);
        });
    }
    
    /**
     * Update connection status display
     */
    updateConnectionStatus(status) {
        const { connection, connectionDot, connectionText } = this.elements;
        const floatingDot = document.getElementById('floatingConnectionDot');
        const floatingText = document.getElementById('floatingConnectionText');
        
        if (connection) {
            connection.className = `connection-status ${status}`;
        }
        
        if (connectionDot) {
            connectionDot.className = `connection-dot ${status}`;
        }
        
        if (floatingDot) {
            floatingDot.className = `status-dot ${status}`;
        }
        
        const statusText = this.getStatusText(status);
        if (connectionText) connectionText.textContent = statusText;
        if (floatingText) floatingText.textContent = statusText;
        
        // Update detailed status
        const wsStatus = document.getElementById('wsStatus');
        if (wsStatus) {
            wsStatus.textContent = statusText;
            wsStatus.className = status;
        }
    }
    
    /**
     * Get human-readable status text
     */
    getStatusText(status) {
        const statusMap = {
            'connected': 'Connected',
            'connecting': 'Connecting...',
            'disconnected': 'Disconnected',
            'error': 'Connection Error',
            'reconnecting': 'Reconnecting...'
        };
        
        return statusMap[status] || status;
    }
    
    /**
     * Update session status display
     */
    updateSessionStatus(status) {
        // Implementation here
    }
    
    /**
     * Update button states based on scanning status
     */
    updateButtonStates(isScanning) {
        if (this.elements.startScanBtn) {
            this.elements.startScanBtn.disabled = isScanning;
            this.elements.startScanBtn.textContent = isScanning ? 'Scanning...' : 'Start Detection';
        }
        
        if (this.elements.stopScanBtn) {
            this.elements.stopScanBtn.disabled = !isScanning;
        }
    }
    
    /**
     * Update progress display
     */
    updateProgress(progress) {
        // Implementation here
    }
    
    /**
     * Update statistics display
     */
    updateStatistics() {
        // Implementation here
    }
    
    /**
     * Update performance metrics display
     */
    updatePerformanceMetrics(metrics) {
        // Implementation here
    }
    
    /**
     * Handle start scan button click
     */
    handleStartScan() {
        console.log('🔍 Start detection clicked');
        if (this.statusManager && typeof this.statusManager.startDetection === 'function') {
            this.statusManager.startDetection();
        } else {
            console.warn('⚠️ Status manager or startDetection method not available');
        }
    }
    
    /**
     * Handle stop scan button click
     */
    handleStopScan() {
        console.log('⏹️ Stop detection clicked');
        if (this.statusManager && typeof this.statusManager.stopDetection === 'function') {
            this.statusManager.stopDetection();
        }
    }
    
    /**
     * Handle clear results button click
     */
    handleClearResults() {
        console.log('🗑️ Clear results clicked');
        if (this.statusManager && typeof this.statusManager.clearResults === 'function') {
            this.statusManager.clearResults();
        }
    }
    
    /**
     * Handle errors
     */
    handleError(error) {
        console.error('❌ Status UI Error:', error);
        
        // Update error indicator
        this.updateErrorIndicator(true);
        
        // Log to error panel
        this.logEvent(`Error: ${error.message || error}`, 'error');
    }
    
    /**
     * Update error indicator
     */
    updateErrorIndicator(hasErrors) {
        if (this.elements.errorIndicator) {
            this.elements.errorIndicator.classList.toggle('has-errors', hasErrors);
        }
    }
    
    /**
     * Toggle detailed status panel
     */
    toggleDetailedPanel() {
        if (this.elements.detailedStatus) {
            this.elements.detailedStatus.classList.toggle('hidden');
        }
    }
    
    /**
     * Log event to the event log
     */
    logEvent(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ${message}`);
        
        // Could add to UI log here if needed
    }
    
    /**
     * Handle window resize
     */
    handleResize() {
        // Responsive adjustments if needed
    }
    
    /**
     * Cleanup resources
     */
    cleanup() {
        // Clear all timers
        this.updateTimers.forEach(timer => clearTimeout(timer));
        this.updateTimers.clear();
        
        // Clear animations
        this.animations.clear();
        
        // Clear charts
        this.charts.clear();
    }
}

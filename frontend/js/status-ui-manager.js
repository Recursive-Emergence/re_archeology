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
            progressFill: document.getElementById('progressFill'),
            progressDetails: document.getElementById('progressDetails'),
            
            // Control buttons
            lidarScanBtn: document.getElementById('lidarScanBtn'),
            startScanBtn: document.getElementById('startScanBtn'),
            stopScanBtn: document.getElementById('stopScanBtn'),
            clearResultsBtn: document.getElementById('clearResultsBtn'),
            
            // Toast notifications
            toast: document.getElementById('toast'),
            toastMessage: document.getElementById('toastMessage')
        };
        
        this.createAdvancedStatusPanels();
    }
    
    /**
     * Create advanced status panels
     */
    createAdvancedStatusPanels() {
        // Create detailed status panel
        const detailedStatusPanel = this.createElement('div', {
            id: 'detailedStatusPanel',
            className: 'detailed-status-panel',
            innerHTML: `
                <div class="status-panel-header">
                    <h3>📊 System Status</h3>
                    <button class="btn-small toggle-panel" onclick="window.statusUI.toggleDetailedPanel()">
                        <span id="panelToggleIcon">▼</span>
                    </button>
                </div>
                <div class="status-panel-content" id="statusPanelContent">
                    <div class="status-grid">
                        <div class="status-card">
                            <h4>🔗 Connection</h4>
                            <div class="metric">
                                <label>Status:</label>
                                <span id="detailedConnectionStatus">Disconnected</span>
                            </div>
                            <div class="metric">
                                <label>Latency:</label>
                                <span id="connectionLatency">--</span>
                            </div>
                            <div class="metric">
                                <label>Reconnects:</label>
                                <span id="reconnectionCount">0</span>
                            </div>
                        </div>
                        
                        <div class="status-card">
                            <h4>📈 Performance</h4>
                            <div class="metric">
                                <label>Processing Rate:</label>
                                <span id="processingRate">-- patches/sec</span>
                            </div>
                            <div class="metric">
                                <label>ETA:</label>
                                <span id="estimatedTime">--</span>
                            </div>
                            <div class="metric">
                                <label>Uptime:</label>
                                <span id="sessionUptime">--</span>
                            </div>
                        </div>
                        
                        <div class="status-card">
                            <h4>🎯 Detection Stats</h4>
                            <div class="metric">
                                <label>Success Rate:</label>
                                <span id="detectionRate">--%</span>
                            </div>
                            <div class="metric">
                                <label>Avg Confidence:</label>
                                <span id="averageConfidence">--%</span>
                            </div>
                            <div class="metric">
                                <label>Quality Score:</label>
                                <span id="qualityScore">--</span>
                            </div>
                        </div>
                        
                        <div class="status-card">
                            <h4>⚠️ System Health</h4>
                            <div class="metric">
                                <label>Messages Sent:</label>
                                <span id="messagesSent">0</span>
                            </div>
                            <div class="metric">
                                <label>Messages Received:</label>
                                <span id="messagesReceived">0</span>
                            </div>
                            <div class="metric">
                                <label>Error Rate:</label>
                                <span id="errorRate">0%</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="progress-charts">
                        <div class="chart-container">
                            <h4>📊 Progress Timeline</h4>
                            <canvas id="progressChart" width="300" height="100"></canvas>
                        </div>
                        <div class="chart-container">
                            <h4>🎯 Detection Distribution</h4>
                            <canvas id="detectionChart" width="300" height="100"></canvas>
                        </div>
                    </div>
                    
                    <div class="error-log" id="errorLog">
                        <h4>📋 Recent Events</h4>
                        <div class="error-list" id="errorList">
                            <div class="error-item info">System initialized</div>
                        </div>
                    </div>
                </div>
            `
        });
        
        // Insert the panel into the sidebar (disabled for now to avoid duplication)
        // const sidebar = document.querySelector('.sidebar');
        // if (sidebar) {
        //     sidebar.appendChild(detailedStatusPanel);
        // }
        
        // Create floating status widget (disabled to avoid duplication)
        // this.createFloatingStatusWidget();
        
        // Create progress indicator overlay (disabled to avoid duplication)
        // this.createProgressIndicator();
    }
    
    /**
     * Create floating status widget
     */
    createFloatingStatusWidget() {
        const widget = this.createElement('div', {
            id: 'floatingStatusWidget',
            className: 'floating-status-widget',
            innerHTML: `
                <div class="widget-header">
                    <span class="widget-title">Status</span>
                    <div class="widget-indicators">
                        <div class="indicator" id="connectionIndicator" title="Connection"></div>
                        <div class="indicator" id="scanningIndicator" title="Scanning"></div>
                        <div class="indicator" id="errorIndicator" title="Errors"></div>
                    </div>
                </div>
                <div class="widget-content">
                    <div class="widget-metric">
                        <span class="metric-value" id="widgetProgress">0%</span>
                        <span class="metric-label">Progress</span>
                    </div>
                    <div class="widget-metric">
                        <span class="metric-value" id="widgetDetections">0</span>
                        <span class="metric-label">Detections</span>
                    </div>
                </div>
            `
        });
        
        document.body.appendChild(widget);
        
        // Make widget draggable
        this.makeDraggable(widget);
    }
    
    /**
     * Create enhanced progress indicator
     */
    createProgressIndicator() {
        const indicator = this.createElement('div', {
            id: 'enhancedProgressIndicator',
            className: 'enhanced-progress-indicator',
            innerHTML: `
                <div class="progress-ring-container">
                    <svg class="progress-ring" width="80" height="80">
                        <circle class="progress-ring-track" cx="40" cy="40" r="35" />
                        <circle class="progress-ring-fill" cx="40" cy="40" r="35" />
                    </svg>
                    <div class="progress-text">
                        <span class="progress-percentage">0%</span>
                        <span class="progress-label">Scanning</span>
                    </div>
                </div>
                <div class="progress-stats">
                    <div class="stat">
                        <span class="stat-value" id="currentPatch">0</span>
                        <span class="stat-label">Current</span>
                    </div>
                    <div class="stat">
                        <span class="stat-value" id="totalPatches">0</span>
                        <span class="stat-label">Total</span>
                    </div>
                    <div class="stat">
                        <span class="stat-value" id="patchesPerSecond">0</span>
                        <span class="stat-label">Rate</span>
                    </div>
                </div>
            `
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
        // Button state management
        if (this.elements.lidarScanBtn) {
            console.log('✅ LiDAR tiling button found, adding event listener');
            this.elements.lidarScanBtn.addEventListener('click', () => {
                console.log('�️ LiDAR tiling button clicked!');
                this.handleLidarScan();
            });
        } else {
            console.error('❌ LiDAR tiling button not found');
        }
        
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
                        } else {
                            this.handleStopScan();
                        }
                        break;
                    case 'r':
                        e.preventDefault();
                        this.handleClearResults();
                        break;
                    case 'd':
                        e.preventDefault();
                        this.toggleDetailedPanel();
                        break;
                }
            }
        });
        
        // Window visibility change handling
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.pauseAnimations();
            } else {
                this.resumeAnimations();
            }
        });
    }
    
    /**
     * Bind status manager events
     */
    bindStatusEvents() {
        // Connection events
        this.statusManager.on('connectionEstablished', () => {
            this.updateConnectionStatus('connected');
            this.showToast('Connected to discovery server', 'success');
            this.logEvent('Connection established', 'success');
        });
        
        this.statusManager.on('connectionFailed', (error) => {
            this.updateConnectionStatus('error');
            this.showToast(`Connection failed: ${error.message}`, 'error');
            this.logEvent(`Connection failed: ${error.message}`, 'error');
        });
        
        this.statusManager.on('disconnected', (data) => {
            this.updateConnectionStatus('disconnected');
            this.showToast('Disconnected from server', 'warning');
            this.logEvent(`Disconnected (Code: ${data.code})`, 'warning');
        });
        
        this.statusManager.on('reconnectionScheduled', (data) => {
            this.showToast(`Reconnecting... (Attempt ${data.attempt})`, 'info');
            this.logEvent(`Reconnection scheduled (attempt ${data.attempt})`, 'info');
        });
        
        // Session events
        this.statusManager.on('sessionStarted', (session) => {
            this.updateSessionStatus('scanning');
            this.showProgressOverlay(true);
            this.showToast('Discovery scan started', 'success');
            this.logEvent(`Session started: ${session.session_id}`, 'success');
            this.startProgressAnimation();
        });
        
        this.statusManager.on('sessionCompleted', (session) => {
            this.updateSessionStatus('completed');
            this.showProgressOverlay(false);
            this.showToast(`Scan completed! Found ${session.positive_detections} structures`, 'success');
            this.logEvent(`Session completed in ${this.formatDuration(session.duration)}`, 'success');
            this.stopProgressAnimation();
        });
        
        this.statusManager.on('sessionStopped', () => {
            this.updateSessionStatus('stopped');
            this.showProgressOverlay(false);
            this.showToast('Scan stopped', 'info');
            this.logEvent('Session stopped by user', 'info');
            this.stopProgressAnimation();
        });
        
        // Progress events
        this.statusManager.on('progressUpdate', (progress) => {
            this.updateProgress(progress);
        });
        
        this.statusManager.on('patchResult', (patch) => {
            this.updateStatistics();
            this.flashDetectionIndicator(patch.is_positive);
        });
        
        // Error events
        this.statusManager.on('error', (error) => {
            this.showToast(error.message, 'error');
            this.logEvent(error.message, 'error');
            this.updateErrorIndicator(true);
        });
        
        // Performance events
        this.statusManager.on('performanceUpdate', (stats) => {
            this.updatePerformanceMetrics(stats);
        });
        
        // State change events
        this.statusManager.on('stateChanged', (data) => {
            this.updateAllDisplays();
        });
        
        // Periodic updates
        this.statusManager.on('periodicUpdate', (status) => {
            this.updateDetailedStatus(status);
        });
    }
    
    /**
     * Update connection status display
     */
    updateConnectionStatus(status) {
        const statusMap = {
            'connected': { class: 'connected', text: 'Connected', color: '#00ff88' },
            'connecting': { class: 'connecting', text: 'Connecting...', color: '#ffaa00' },
            'disconnected': { class: 'disconnected', text: 'Disconnected', color: '#ff4444' },
            'error': { class: 'error', text: 'Error', color: '#ff4444' }
        };
        
        const config = statusMap[status] || statusMap.disconnected;
        
        if (this.elements.connectionStatus) {
            this.elements.connectionStatus.className = `connection-status ${config.class}`;
        }
        
        if (this.elements.connectionText) {
            this.elements.connectionText.textContent = config.text;
        }
        
        if (this.elements.connectionDot) {
            this.elements.connectionDot.style.backgroundColor = config.color;
        }
        
        // Update detailed status
        const detailedStatus = document.getElementById('detailedConnectionStatus');
        if (detailedStatus) {
            detailedStatus.textContent = config.text;
            detailedStatus.className = `status-value ${config.class}`;
        }
        
        // Update floating widget
        const connectionIndicator = document.getElementById('connectionIndicator');
        if (connectionIndicator) {
            connectionIndicator.className = `indicator ${config.class}`;
        }
    }
    
    /**
     * Update session status
     */
    updateSessionStatus(status) {
        const statusText = {
            'idle': 'Idle',
            'scanning': 'Scanning',
            'completed': 'Completed',
            'stopped': 'Stopped',
            'error': 'Error'
        };
        
        if (this.elements.sessionStatus) {
            this.elements.sessionStatus.textContent = statusText[status] || status;
            this.elements.sessionStatus.className = `status-value ${status}`;
        }
        
        // Update button states
        this.updateButtonStates(status === 'scanning');
        
        // Update floating widget scanning indicator
        const scanningIndicator = document.getElementById('scanningIndicator');
        if (scanningIndicator) {
            scanningIndicator.className = `indicator ${status === 'scanning' ? 'active' : 'inactive'}`;
        }
    }
    
    /**
     * Update button states
     */
    updateButtonStates(isScanning) {
        if (this.elements.startScanBtn) {
            this.elements.startScanBtn.disabled = isScanning || !this.statusManager.isConnected();
        }
        
        if (this.elements.stopScanBtn) {
            this.elements.stopScanBtn.disabled = !isScanning;
        }
        
        if (this.elements.clearResultsBtn) {
            this.elements.clearResultsBtn.disabled = isScanning;
        }
    }
    
    /**
     * Update progress display
     */
    updateProgress(progress) {
        const percentage = Math.round(progress.percentage);
        
        // Update progress bar
        if (this.elements.progressFill) {
            this.elements.progressFill.style.width = `${percentage}%`;
        }
        
        // Update progress text
        if (this.elements.progressText) {
            this.elements.progressText.textContent = 
                `Scanning... ${progress.current}/${progress.total} patches (${percentage}%)`;
        }
        
        // Update progress details with ETA
        if (this.elements.progressDetails) {
            let details = `Processing rate: ${progress.rate.toFixed(1)} patches/sec`;
            if (progress.eta) {
                details += ` • ETA: ${this.formatDuration(progress.eta * 1000)}`;
            }
            this.elements.progressDetails.textContent = details;
        }
        
        // Update circular progress indicator
        const progressRing = document.querySelector('.progress-ring-fill');
        if (progressRing) {
            const circumference = 2 * Math.PI * 35;
            const offset = circumference - (percentage / 100) * circumference;
            progressRing.style.strokeDasharray = circumference;
            progressRing.style.strokeDashoffset = offset;
        }
        
        const progressPercentage = document.querySelector('.progress-percentage');
        if (progressPercentage) {
            progressPercentage.textContent = `${percentage}%`;
        }
        
        // Update enhanced progress stats
        const currentPatch = document.getElementById('currentPatch');
        const totalPatches = document.getElementById('totalPatches');
        const patchesPerSecond = document.getElementById('patchesPerSecond');
        
        if (currentPatch) currentPatch.textContent = progress.current;
        if (totalPatches) totalPatches.textContent = progress.total;
        if (patchesPerSecond) patchesPerSecond.textContent = progress.rate.toFixed(1);
        
        // Update floating widget
        const widgetProgress = document.getElementById('widgetProgress');
        if (widgetProgress) {
            widgetProgress.textContent = `${percentage}%`;
        }
    }
    
    /**
     * Update statistics display
     */
    updateStatistics() {
        const stats = this.statusManager.state.statistics;
        console.log('📊 StatusUIManager updating statistics:', stats);
        
        if (this.elements.processedPatches) {
            this.elements.processedPatches.textContent = stats.totalPatches;
            console.log('✅ Updated processedPatches to:', stats.totalPatches);
        } else {
            console.warn('❌ processedPatches element not found');
        }
        
        if (this.elements.totalDetections) {
            this.elements.totalDetections.textContent = stats.positiveDetections;
            console.log('✅ Updated totalDetections to:', stats.positiveDetections);
        } else {
            console.warn('❌ totalDetections element not found');
        }
        
        if (this.elements.highConfidenceDetections) {
            this.elements.highConfidenceDetections.textContent = stats.highConfidenceDetections;
            console.log('✅ Updated highConfidenceDetections to:', stats.highConfidenceDetections);
        } else {
            console.warn('❌ highConfidenceDetections element not found');
        }
        
        // Update floating widget
        const widgetDetections = document.getElementById('widgetDetections');
        if (widgetDetections) {
            widgetDetections.textContent = stats.positiveDetections;
        }
        
        // Update detailed statistics
        const detectionRate = document.getElementById('detectionRate');
        const averageConfidence = document.getElementById('averageConfidence');
        const qualityScore = document.getElementById('qualityScore');
        
        if (detectionRate && stats.totalPatches > 0) {
            const rate = (stats.positiveDetections / stats.totalPatches) * 100;
            detectionRate.textContent = `${rate.toFixed(1)}%`;
        }
        
        if (averageConfidence) {
            averageConfidence.textContent = `${(stats.averageConfidence * 100).toFixed(1)}%`;
        }
        
        if (qualityScore && stats.totalPatches > 0) {
            const quality = (stats.highConfidenceDetections / stats.totalPatches) * 100;
            qualityScore.textContent = `${quality.toFixed(1)}%`;
        }
    }
    
    /**
     * Update performance metrics
     */
    updatePerformanceMetrics(metrics) {
        const connectionLatency = document.getElementById('connectionLatency');
        const messagesSent = document.getElementById('messagesSent');
        const messagesReceived = document.getElementById('messagesReceived');
        const errorRate = document.getElementById('errorRate');
        const processingRate = document.getElementById('processingRate');
        
        if (connectionLatency) {
            connectionLatency.textContent = `${metrics.connectionLatency}ms`;
        }
        
        if (messagesSent) {
            messagesSent.textContent = this.statusManager.performanceMetrics.messagesSent;
        }
        
        if (messagesReceived) {
            messagesReceived.textContent = this.statusManager.performanceMetrics.messagesReceived;
        }
        
        if (errorRate) {
            errorRate.textContent = `${(metrics.errorRate * 100).toFixed(1)}%`;
        }
        
        if (processingRate) {
            const rate = this.statusManager.state.progress.rate;
            processingRate.textContent = `${rate.toFixed(1)} patches/sec`;
        }
        
        // Update reconnection count
        const reconnectionCount = document.getElementById('reconnectionCount');
        if (reconnectionCount) {
            reconnectionCount.textContent = this.statusManager.performanceMetrics.reconnections;
        }
    }
    
    /**
     * Update detailed status panel
     */
    updateDetailedStatus(status) {
        // Update uptime
        const sessionUptime = document.getElementById('sessionUptime');
        if (sessionUptime && status.statistics.scanStartTime) {
            const uptime = Date.now() - status.statistics.scanStartTime;
            sessionUptime.textContent = this.formatDuration(uptime);
        }
        
        // Update ETA
        const estimatedTime = document.getElementById('estimatedTime');
        if (estimatedTime) {
            if (status.progress.eta) {
                estimatedTime.textContent = this.formatDuration(status.progress.eta * 1000);
            } else {
                estimatedTime.textContent = '--';
            }
        }
    }
    
    /**
     * Show/hide progress overlay
     */
    showProgressOverlay(show) {
        if (this.elements.progressOverlay) {
            this.elements.progressOverlay.style.display = show ? 'block' : 'none';
        }
        
        const enhancedIndicator = document.getElementById('enhancedProgressIndicator');
        if (enhancedIndicator) {
            enhancedIndicator.style.display = show ? 'flex' : 'none';
        }
    }
    
    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        if (!this.elements.toast || !this.elements.toastMessage) return;
        
        this.elements.toastMessage.textContent = message;
        this.elements.toast.className = `toast ${type} show`;
        
        // Auto-hide after delay based on type
        const delay = type === 'error' ? 5000 : 3000;
        setTimeout(() => {
            this.elements.toast.classList.remove('show');
        }, delay);
    }
    
    /**
     * Log event to error log panel
     */
    logEvent(message, type = 'info') {
        const errorList = document.getElementById('errorList');
        if (!errorList) return;
        
        const eventItem = this.createElement('div', {
            className: `error-item ${type}`,
            innerHTML: `
                <span class="event-time">${new Date().toLocaleTimeString()}</span>
                <span class="event-message">${message}</span>
            `
        });
        
        errorList.insertBefore(eventItem, errorList.firstChild);
        
        // Keep only last 20 events
        while (errorList.children.length > 20) {
            errorList.removeChild(errorList.lastChild);
        }
    }
    
    /**
     * Flash detection indicator
     */
    flashDetectionIndicator(isPositive) {
        const indicator = document.getElementById('scanningIndicator');
        if (!indicator) return;
        
        const originalClass = indicator.className;
        indicator.className = `indicator ${isPositive ? 'positive-flash' : 'scan-flash'}`;
        
        setTimeout(() => {
            indicator.className = originalClass;
        }, 200);
    }
    
    /**
     * Update error indicator
     */
    updateErrorIndicator(hasErrors) {
        const errorIndicator = document.getElementById('errorIndicator');
        if (errorIndicator) {
            errorIndicator.className = `indicator ${hasErrors ? 'error' : 'inactive'}`;
        }
    }
    
    /**
     * Toggle detailed status panel
     */
    toggleDetailedPanel() {
        const panel = document.getElementById('statusPanelContent');
        const icon = document.getElementById('panelToggleIcon');
        
        if (!panel || !icon) return;
        
        const isVisible = panel.style.display !== 'none';
        panel.style.display = isVisible ? 'none' : 'block';
        icon.textContent = isVisible ? '▶' : '▼';
    }
    
    /**
     * Start progress animation
     */
    startProgressAnimation() {
        const progressRing = document.querySelector('.progress-ring-fill');
        if (progressRing) {
            progressRing.classList.add('animated');
        }
    }
    
    /**
     * Stop progress animation
     */
    stopProgressAnimation() {
        const progressRing = document.querySelector('.progress-ring-fill');
        if (progressRing) {
            progressRing.classList.remove('animated');
        }
    }
    
    /**
     * Pause animations when window is hidden
     */
    pauseAnimations() {
        this.animations.forEach((animation, element) => {
            if (animation.pause) {
                animation.pause();
            }
        });
    }
    
    /**
     * Resume animations when window is visible
     */
    resumeAnimations() {
        this.animations.forEach((animation, element) => {
            if (animation.play) {
                animation.play();
            }
        });
    }
    
    /**
     * Update all displays
     */
    updateAllDisplays() {
        const state = this.statusManager.state;
        
        this.updateConnectionStatus(state.connection);
        this.updateSessionStatus(state.scanning ? 'scanning' : 'idle');
        this.updateProgress(state.progress);
        this.updateStatistics();
        this.updateButtonStates(state.scanning);
    }
    
    /**
     * Handle start scan button click
     */
    handleStartScan() {
        // This will be called by the main application
        if (window.unifiedApp && window.unifiedApp.startScan) {
            window.unifiedApp.startScan();
        } else {
            console.error('❌ Unified app not found or startScan method not available');
        }
    }
    
    /**
     * Handle stop scan button click
     */
    handleStopScan() {
        if (window.unifiedApp && window.unifiedApp.stopScan) {
            window.unifiedApp.stopScan();
        } else {
            console.error('❌ Unified app not found or stopScan method not available');
        }
    }
    
    /**
     * Handle clear results button click
     */
    handleClearResults() {
        if (window.unifiedApp && window.unifiedApp.clearResults) {
            window.unifiedApp.clearResults();
        } else {
            console.error('❌ Unified app not found or clearResults method not available');
        }
    }
    
    /**
     * Handle LiDAR tiling button click (now supports pause/resume)
     */
    handleLidarScan() {
        console.log('🔧 handleLidarScan called');
        
        const btn = this.elements.lidarScanBtn;
        const currentState = btn?.getAttribute('data-state') || 'idle';
        
        console.log(`🎯 Current LiDAR state: ${currentState}`);
        
        if (window.unifiedApp) {
            switch (currentState) {
                case 'idle':
                case 'completed':
                    console.log('🗂️ Starting new LiDAR tiling session');
                    this.updateLidarButtonState('running', 0, '0/0');
                    if (window.unifiedApp.startLidarScan) {
                        window.unifiedApp.startLidarScan();
                    } else {
                        console.error('❌ startLidarScan method not available');
                        this.updateLidarButtonState('idle', 0, 'Error');
                    }
                    break;
                    
                case 'running':
                    console.log('⏸️ Pausing LiDAR tiling');
                    this.updateLidarButtonState('paused', 0, 'Paused');
                    if (window.unifiedApp.pauseLidarScan) {
                        window.unifiedApp.pauseLidarScan();
                    } else {
                        console.warn('⚠️ pauseLidarScan method not available');
                    }
                    break;
                    
                case 'paused':
                    console.log('▶️ Resuming LiDAR tiling');
                    this.updateLidarButtonState('running', 0, 'Resuming...');
                    if (window.unifiedApp.resumeLidarScan) {
                        window.unifiedApp.resumeLidarScan();
                    } else {
                        console.warn('⚠️ resumeLidarScan method not available');
                    }
                    break;
                    
                default:
                    console.warn('⚠️ Unknown LiDAR state:', currentState);
                    this.updateLidarButtonState('idle', 0, '');
            }
        } else {
            console.error('❌ Unified app not found');
            this.updateLidarButtonState('idle', 0, 'Error');
        }
    }
    
    /**
     * Update LiDAR button visual state
     */
    updateLidarButtonState(state, progress = 0, statusText = '') {
        const btn = this.elements.lidarScanBtn;
        if (!btn) return;
        
        // Update button state attribute
        btn.setAttribute('data-state', state);
        
        // Update progress bar
        btn.style.setProperty('--progress', `${Math.round(progress * 100)}%`);
        
        // Update text content
        const textSpan = btn.querySelector('.btn-text');
        const statusSpan = btn.querySelector('.btn-status');
        
        if (textSpan) {
            // Update span content if spans exist
            switch (state) {
                case 'idle':
                    textSpan.textContent = 'LiDAR Tiling';
                    break;
                case 'running':
                    textSpan.textContent = 'Pause Tiling';
                    break;
                case 'paused':
                    textSpan.textContent = 'Resume Tiling';
                    break;
                case 'completed':
                    textSpan.textContent = 'Tiling Complete';
                    break;
                default:
                    textSpan.textContent = 'LiDAR Tiling';
            }
        } else {
            // Fallback: update button text directly if spans don't exist
            switch (state) {
                case 'idle':
                    btn.textContent = '🗂️ LiDAR Tiling';
                    break;
                case 'running':
                    btn.textContent = '⏸️ Pause Tiling';
                    break;
                case 'paused':
                    btn.textContent = '▶️ Resume Tiling';
                    break;
                case 'completed':
                    btn.textContent = '✅ Tiling Complete';
                    break;
                default:
                    btn.textContent = '🗂️ LiDAR Tiling';
            }
        }
        
        if (statusSpan) {
            statusSpan.textContent = statusText;
        } else if (statusText && !textSpan) {
            // If no spans exist, append status to button text
            const currentText = btn.textContent;
            if (statusText && !currentText.includes(statusText)) {
                btn.textContent = `${currentText} ${statusText}`;
            }
        }
        
        console.log(`🎨 LiDAR button state updated: ${state} (${Math.round(progress * 100)}%)`);
    }

    /**
     * Update LiDAR progress with visual feedback
     */
    updateLidarProgress(current, total, statusMessage = '') {
        const progress = total > 0 ? current / total : 0;
        const progressText = `${current}/${total}`;
        
        // Update button if it's in running state
        const btn = this.elements.lidarScanBtn;
        if (btn && btn.getAttribute('data-state') === 'running') {
            this.updateLidarButtonState('running', progress, progressText);
        }
        
        // Update any progress displays
        const progressElements = document.querySelectorAll('.lidar-progress');
        progressElements.forEach(el => {
            el.style.width = `${Math.round(progress * 100)}%`;
        });
        
        console.log(`📊 LiDAR progress: ${progressText} (${Math.round(progress * 100)}%)`);
    }

    /**
     * Utility: Create DOM element
     */
    createElement(tag, options = {}) {
        const element = document.createElement(tag);
        
        if (options.id) element.id = options.id;
        if (options.className) element.className = options.className;
        if (options.innerHTML) element.innerHTML = options.innerHTML;
        
        return element;
    }
    
    /**
     * Utility: Make element draggable
     */
    makeDraggable(element) {
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;
        
        element.addEventListener('mousedown', (e) => {
            if (e.target.closest('.widget-header')) {
                initialX = e.clientX - xOffset;
                initialY = e.clientY - yOffset;
                isDragging = true;
            }
        });
        
        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                xOffset = currentX;
                yOffset = currentY;
                
                element.style.transform = `translate(${currentX}px, ${currentY}px)`;
            }
        });
        
        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }
    
    /**
     * Utility: Format duration
     */
    formatDuration(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }
    
    /**
     * Cleanup and destroy
     */
    destroy() {
        // Clear all timers
        this.updateTimers.forEach(timer => clearTimeout(timer));
        this.updateTimers.clear();
        
        // Clear animations
        this.animations.clear();
        
        // Remove event listeners
        this.statusManager.callbacks.clear();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StatusUIManager;
} else {
    window.StatusUIManager = StatusUIManager;
}

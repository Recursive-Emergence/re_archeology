/**
 * UI Manager
 * Handles user interface updates, controls, and visual state management
 */

class UIManager extends EventEmitter {
    constructor() {
        super();
        this.isInitialized = false;
    }
    
    async init() {
        console.log('🎨 Initializing UI manager...');
        
        // Setup UI controls and event handlers
        this.setupDiscoveryControls();
        this.setupCollapsiblePanels();
        this.initializeConnectionStatus();
        this.populateDiscoveryPanelContent();
        
        this.isInitialized = true;
        console.log('✅ UI manager initialized');
    }
    
    setupDiscoveryControls() {
        // Setup button event handlers
        const startBtn = document.getElementById('startScanBtn');
        const stopBtn = document.getElementById('stopScanBtn');
        const clearBtn = document.getElementById('clearResultsBtn');
        
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                this.emit('startScan');
            });
        }
        
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                this.emit('stopScan');
            });
        }
        
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.emit('clearResults');
            });
        }
        
        // Initialize button states
        this.updateDiscoveryButtons('idle');
    }
    
    setupCollapsiblePanels() {
        // Setup collapsible control groups
        const collapsibleGroups = document.querySelectorAll('.control-group[data-collapsible="true"]');
        collapsibleGroups.forEach((group, index) => {
            const header = group.querySelector('h3');
            if (header) {
                header.addEventListener('click', () => {
                    this.toggleControlGroup(group);
                });
                
                // Collapse some panels by default for cleaner UI
                if (index > 1) {
                    this.collapseControlGroup(group);
                }
            }
        });
    }
    
    populateDiscoveryPanelContent() {
        // Populate Region Selection
        const regionGroup = document.querySelector('.control-group[data-collapsible="true"]:nth-child(1)');
        if (regionGroup) {
            regionGroup.innerHTML = `
                <h3 onclick="toggleControlGroup(this.parentElement)">
                    🌍 Region Selection
                    <span class="toggle-icon">▼</span>
                </h3>
                <div class="control-content">
                    <div class="input-group">
                        <label for="centerLat">Center Latitude</label>
                        <input type="number" id="centerLat" value="52.4751" step="0.000001" min="-90" max="90">
                    </div>
                    <div class="input-group">
                        <label for="centerLon">Center Longitude</label>
                        <input type="number" id="centerLon" value="4.8156" step="0.000001" min="-180" max="180">
                    </div>
                    <div class="input-group">
                        <label for="scanRadius">Scan Radius (km)</label>
                        <input type="number" id="scanRadius" value="2" step="0.1" min="0.1" max="50">
                    </div>
                </div>
            `;
        }
        
        // Populate Detection Settings
        const detectionGroup = document.querySelector('.control-group[data-collapsible="true"]:nth-child(2)');
        if (detectionGroup) {
            detectionGroup.innerHTML = `
                <h3 onclick="toggleControlGroup(this.parentElement)">
                    ⚙️ Detection Settings
                    <span class="toggle-icon">▼</span>
                </h3>
                <div class="control-content">
                    <div class="input-group">
                        <label for="patchSize">Patch Size (m)</label>
                        <select id="patchSize">
                            <option value="20">20m × 20m</option>
                            <option value="40" selected>40m × 40m</option>
                            <option value="60">60m × 60m</option>
                            <option value="80">80m × 80m</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label for="confidenceThreshold">Confidence Threshold</label>
                        <select id="confidenceThreshold">
                            <option value="0.3">Low (30%)</option>
                            <option value="0.5">Medium (50%)</option>
                            <option value="0.7" selected>High (70%)</option>
                            <option value="0.8">Very High (80%)</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label for="maxPatches">Max Patches</label>
                        <select id="maxPatches">
                            <option value="50">50 patches</option>
                            <option value="100" selected>100 patches</option>
                            <option value="200">200 patches</option>
                            <option value="500">500 patches</option>
                        </select>
                    </div>
                </div>
            `;
        }
        
        // Populate Action Buttons
        const actionGroup = document.querySelector('.control-group:nth-child(3)');
        if (actionGroup) {
            actionGroup.innerHTML = `
                <h3>🚀 Discovery Actions</h3>
                <div class="button-grid">
                    <button id="startScanBtn" class="btn" disabled>Start Discovery Scan</button>
                    <button id="stopScanBtn" class="btn btn-stop" disabled>Stop</button>
                    <button id="clearResultsBtn" class="btn btn-secondary">Clear</button>
                    <button id="testConnectionBtn" class="btn btn-test">Test Connection</button>
                </div>
            `;
        }
        
        // Populate Visualization Options
        const vizGroup = document.querySelector('.control-group[data-collapsible="true"]:last-child');
        if (vizGroup) {
            vizGroup.innerHTML = `
                <h3 onclick="toggleControlGroup(this.parentElement)">
                    👁️ Visualization
                    <span class="toggle-icon">▼</span>
                </h3>
                <div class="control-content">
                    <div class="input-group">
                        <label for="showElevation">
                            <input type="checkbox" id="showElevation" checked> Show Elevation Data
                        </label>
                    </div>
                    <div class="input-group">
                        <label for="showConfidence">
                            <input type="checkbox" id="showConfidence" checked> Show Confidence Scores
                        </label>
                    </div>
                    <div class="input-group">
                        <label for="animateDetections">
                            <input type="checkbox" id="animateDetections" checked> Animate New Detections
                        </label>
                    </div>
                </div>
            `;
        }
        
        // Populate Status Items
        const statusSection = document.querySelector('.discovery-status');
        if (statusSection) {
            statusSection.innerHTML = `
                <div class="status-item">
                    <span>Status:</span>
                    <span class="status-value" id="sessionStatus">Idle</span>
                </div>
                <div class="status-item">
                    <span>Progress:</span>
                    <span class="status-value" id="scanningStatusIndicator">Ready</span>
                </div>
                <div class="status-item">
                    <span>Processed:</span>
                    <span class="status-value" id="processedPatches">0</span>
                </div>
                <div class="status-item">
                    <span>Detections:</span>
                    <span class="status-value" id="totalDetections">0</span>
                </div>
                <div class="status-item">
                    <span>High Confidence:</span>
                    <span class="status-value" id="highConfidenceDetections">0</span>
                </div>
            `;
        }
        
        // Re-setup controls after populating content
        this.setupDiscoveryControls();
    }
    
    initializeConnectionStatus() {
        const connectionStatus = document.getElementById('connectionStatus');
        if (connectionStatus) {
            this.updateConnectionStatus(false);
        }
    }
    
    toggleControlGroup(group) {
        const content = group.querySelector('.control-content');
        const toggleIcon = group.querySelector('.toggle-icon');
        
        if (group.classList.contains('collapsed')) {
            this.expandControlGroup(group);
        } else {
            this.collapseControlGroup(group);
        }
    }
    
    collapseControlGroup(group) {
        const content = group.querySelector('.control-content');
        const toggleIcon = group.querySelector('.toggle-icon');
        
        group.classList.add('collapsed');
        if (content) content.style.maxHeight = '0';
        if (toggleIcon) toggleIcon.textContent = '▶';
    }
    
    expandControlGroup(group) {
        const content = group.querySelector('.control-content');
        const toggleIcon = group.querySelector('.toggle-icon');
        
        group.classList.remove('collapsed');
        if (content) content.style.maxHeight = 'none';
        if (toggleIcon) toggleIcon.textContent = '▼';
    }
    
    updateConnectionStatus(isConnected) {
        const connectionStatus = document.getElementById('connectionStatus');
        if (!connectionStatus) return;
        
        if (isConnected) {
            connectionStatus.className = 'connection-status connected';
            connectionStatus.innerHTML = `
                <div class="connection-dot"></div>
                <span>Connected</span>
            `;
        } else {
            connectionStatus.className = 'connection-status disconnected';
            connectionStatus.innerHTML = `
                <div class="connection-dot"></div>
                <span>Disconnected</span>
            `;
        }
    }
    
    updateDiscoveryStatus(status) {
        const sessionStatus = document.getElementById('sessionStatus');
        const statusIndicator = document.getElementById('scanningStatusIndicator');
        
        switch (status) {
            case 'connecting':
                if (sessionStatus) sessionStatus.textContent = 'Connecting';
                if (statusIndicator) statusIndicator.textContent = 'Establishing connection...';
                this.updateDiscoveryButtons('connecting');
                break;
                
            case 'connected':
                if (sessionStatus) sessionStatus.textContent = 'Connected';
                if (statusIndicator) statusIndicator.textContent = 'Ready to scan';
                this.updateDiscoveryButtons('connected');
                this.updateConnectionStatus(true);
                break;
                
            case 'scanning':
                if (sessionStatus) sessionStatus.textContent = 'Scanning';
                if (statusIndicator) statusIndicator.textContent = 'Initializing scan...';
                this.updateDiscoveryButtons('scanning');
                break;
                
            case 'completed':
                if (sessionStatus) sessionStatus.textContent = 'Completed';
                if (statusIndicator) statusIndicator.textContent = 'Scan completed';
                this.updateDiscoveryButtons('completed');
                break;
                
            case 'error':
                if (sessionStatus) sessionStatus.textContent = 'Error';
                if (statusIndicator) statusIndicator.textContent = 'Connection error';
                this.updateDiscoveryButtons('error');
                this.updateConnectionStatus(false);
                break;
                
            case 'idle':
            default:
                if (sessionStatus) sessionStatus.textContent = 'Idle';
                if (statusIndicator) statusIndicator.textContent = 'Ready';
                this.updateDiscoveryButtons('idle');
                break;
        }
    }
    
    updateDiscoveryButtons(status) {
        const startBtn = document.getElementById('startScanBtn');
        const stopBtn = document.getElementById('stopScanBtn');
        const clearBtn = document.getElementById('clearResultsBtn');
        const testBtn = document.getElementById('testConnectionBtn');
        
        if (!startBtn || !stopBtn || !clearBtn || !testBtn) return;
        
        switch (status) {
            case 'connecting':
                startBtn.disabled = true;
                stopBtn.disabled = true;
                clearBtn.disabled = false;
                testBtn.disabled = true;
                testBtn.textContent = 'Connecting...';
                break;
                
            case 'connected':
                startBtn.disabled = false;
                stopBtn.disabled = true;
                clearBtn.disabled = false;
                testBtn.disabled = false;
                testBtn.textContent = 'Test Connection';
                break;
                
            case 'scanning':
                startBtn.disabled = true;
                stopBtn.disabled = false;
                clearBtn.disabled = true;
                testBtn.disabled = true;
                break;
                
            case 'completed':
                startBtn.disabled = false;
                stopBtn.disabled = true;
                clearBtn.disabled = false;
                testBtn.disabled = false;
                break;
                
            case 'error':
                startBtn.disabled = true;
                stopBtn.disabled = true;
                clearBtn.disabled = false;
                testBtn.disabled = false;
                testBtn.textContent = 'Retry Connection';
                break;
                
            case 'idle':
            default:
                startBtn.disabled = true;
                stopBtn.disabled = true;
                clearBtn.disabled = false;
                testBtn.disabled = false;
                testBtn.textContent = 'Test Connection';
                break;
        }
    }
    
    updateDetectionCounters(stats) {
        const processedElement = document.getElementById('processedPatches');
        const detectionsElement = document.getElementById('totalDetections');
        const highConfidenceElement = document.getElementById('highConfidenceDetections');
        
        if (processedElement) processedElement.textContent = stats.processedPatches || 0;
        if (detectionsElement) detectionsElement.textContent = stats.totalDetections || 0;
        if (highConfidenceElement) highConfidenceElement.textContent = stats.highConfidenceDetections || 0;
    }
    
    updateScanProgress(progress) {
        const statusIndicator = document.getElementById('scanningStatusIndicator');
        if (statusIndicator && progress) {
            const { current, total, percentage, message } = progress;
            statusIndicator.textContent = `Scanning: ${percentage}% (${current}/${total}) • ${message || 'Processing...'}`;
        }
    }
    
    updateHeaderUser(user) {
        // Could add user info to header if needed
        const taskIndicator = document.querySelector('.task-indicator');
        if (taskIndicator && user) {
            taskIndicator.textContent = `Welcome, ${user.name?.split(' ')[0] || 'Explorer'}`;
        }
    }
    
    clearHeaderUser() {
        const taskIndicator = document.querySelector('.task-indicator');
        if (taskIndicator) {
            taskIndicator.textContent = '';
        }
    }
    
    showError(message, duration = 5000) {
        // Create error notification
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(255, 68, 68, 0.9);
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            border: 1px solid #ff4444;
            z-index: 10000;
            max-width: 300px;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(10px);
        `;
        errorDiv.textContent = message;
        
        document.body.appendChild(errorDiv);
        
        // Auto-remove after duration
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.remove();
            }
        }, duration);
    }
    
    showSuccess(message, duration = 3000) {
        // Create success notification
        const successDiv = document.createElement('div');
        successDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 255, 136, 0.9);
            color: #000;
            padding: 12px 16px;
            border-radius: 8px;
            border: 1px solid #00ff88;
            z-index: 10000;
            max-width: 300px;
            font-size: 14px;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(10px);
        `;
        successDiv.textContent = message;
        
        document.body.appendChild(successDiv);
        
        // Auto-remove after duration
        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.remove();
            }
        }, duration);
    }
    
    // Public API
    isReady() {
        return this.isInitialized;
    }
}

// Make available globally
window.UIManager = UIManager;

// Global helper function for backwards compatibility
window.toggleControlGroup = function(headerElement) {
    const controlGroup = headerElement.parentElement;
    const content = controlGroup.querySelector('.control-content');
    const toggleIcon = headerElement.querySelector('.toggle-icon');
    
    if (controlGroup.classList.contains('collapsed')) {
        controlGroup.classList.remove('collapsed');
        if (content) content.style.maxHeight = 'none';
        if (toggleIcon) toggleIcon.textContent = '▼';
    } else {
        controlGroup.classList.add('collapsed');
        if (content) content.style.maxHeight = '0';
        if (toggleIcon) toggleIcon.textContent = '▶';
    }
};

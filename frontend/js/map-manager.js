/**
 * Map Manager
 * Handles Leaflet map operations, patch visualization, and geographic interactions
 */

class MapManager extends EventEmitter {
    constructor() {
        super();
        this.map = null;
        this.patches = new Map();
        this.scanAreaCircle = null;
        this.scanAreaRectangle = null;
        this.layers = {};
        this.patchVisualization = null;
        
        // New compact controls
        this.compactControls = {
            scanControl: null,  // Only scan control now - LiDAR auto-loaded
            settingsPanel: null
        };
        this.controlsVisible = true;
        
        // Operation states
        this.operationStates = {
            scan: 'stopped'  // Only track scan state - LiDAR auto-loaded
        };
        
        // Initialization state tracking
        this.initialized = false;
        this.scanAreaInitialized = false;
        
        // Initialize compact controls object
        this.compactControls = {};
        
        // Throttle control updates to prevent excessive redraws
        this.updateControlsThrottled = this.throttle(this.updateControlPositions.bind(this), 16); // ~60fps
    }
    
    // Utility function to throttle function calls
    throttle(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    init(existingMap = null) {
        if (this.initialized) {
            console.log('ℹ️ MapManager already initialized, skipping');
            return;
        }
        
        console.log('🗺️ MapManager.init() called with existingMap:', existingMap ? 'PROVIDED' : 'NULL');
        console.log('🗺️ Current this.map state:', this.map ? 'EXISTS' : 'NULL');
        
        if (existingMap) {
            console.log('📍 Using provided map instance');
            this.map = existingMap;
            
            // Verify the map is properly initialized
            if (!this.map.getContainer()) {
                console.error('❌ Provided map has no container');
                throw new Error('Invalid map instance provided');
            }
            
            console.log('✅ Map instance assigned successfully');
            
            // Ensure dragging and other interactions are enabled
            try {
                if (this.map.dragging && !this.map.dragging.enabled()) {
                    this.map.dragging.enable();
                    console.log('✅ Map dragging enabled');
                }
                if (this.map.doubleClickZoom && !this.map.doubleClickZoom.enabled()) {
                    this.map.doubleClickZoom.enable();
                    console.log('✅ Double-click zoom enabled');
                }
                if (this.map.scrollWheelZoom && !this.map.scrollWheelZoom.enabled()) {
                    this.map.scrollWheelZoom.enable();
                    console.log('✅ Scroll wheel zoom enabled');
                }
            } catch (interactionError) {
                console.warn('⚠️ Error enabling map interactions:', interactionError);
            }
        } else if (!this.map) {
            console.error('❌ No map provided to MapManager - MapManager requires an existing map instance');
            throw new Error('MapManager requires an existing map instance - do not create maps independently');
        } else {
            console.log('📍 Using existing map instance from previous initialization');
        }
        
        // Verify map is ready before proceeding
        if (!this.map || !this.map.getContainer()) {
            console.error('❌ Map initialization failed - map or container is null');
            console.error('   this.map:', this.map);
            console.error('   container:', this.map ? this.map.getContainer() : 'N/A');
            throw new Error('Map is not properly initialized');
        }
        
        console.log('✅ Map validation passed, proceeding with component initialization');
        
        // Always initialize these components
        this.initScanArea();
        this.initPatchVisualization();
        this.setupMapEvents();
        this.initCompactControls();
        this.setupKeyboardShortcuts();
        
        this.initialized = true;
        console.log('✅ MapManager initialization completed');
    }
    
    // MapManager no longer creates its own maps - it only manages existing ones
    
    initScanArea(retryCount = 0) {
        if (!this.map) {
            console.error('❌ Cannot initialize scan area: map is null');
            return;
        }
        
        if (this.scanAreaInitialized) {
            console.log('ℹ️ Scan area already initialized, skipping');
            return;
        }
        
        // Wait for map to be fully ready before adding layers
        this.map.whenReady(() => {
            // Add extra delay to ensure renderer is fully initialized
            setTimeout(() => {
                try {
                    // Enhanced map readiness validation
                    if (!this.map || !this.map.getContainer()) {
                        throw new Error('Map instance or container not available');
                    }
                    
                    // Wait for map to be fully loaded and renderer ready
                    if (!this.map._loaded) {
                        throw new Error('Map not fully loaded yet');
                    }
                    
                    // Check if map has a renderer ready for vector layers
                    if (!this.map._renderer && !this.map.getRenderer) {
                        throw new Error('Map renderer not initialized');
                    }
                    
                    // Ensure the map's renderer pane exists or create it
                    const container = this.map.getContainer();
                    let overlayPane = this.map.getPane('overlayPane');
                    if (!overlayPane) {
                        console.log('⚠️ Overlay pane missing, attempting to create map panes...');
                        try {
                            // Force pane creation by triggering map initialization
                            this.map._initPanes();
                            overlayPane = this.map.getPane('overlayPane');
                            if (!overlayPane) {
                                throw new Error('Could not create overlay pane');
                            }
                            console.log('✅ Successfully created overlay pane');
                        } catch (paneError) {
                            throw new Error('Map overlay pane not ready and could not be created: ' + paneError.message);
                        }
                    }
                    
                    console.log('✅ Map and renderer validation passed - proceeding with scan area creation');
                    
                    // Add visible scan area RECTANGLE with proper square proportions
                    // At Amsterdam latitude (52.5°), adjust longitude to make a proper square
                    const centerLat = 52.4751;
                    const centerLon = 4.8156;
                    const latDelta = 0.005; // Half of 0.01 degree latitude
                    // Calculate longitude adjustment factor for Earth's curvature at this latitude
                    const latRad = centerLat * Math.PI / 180;
                    const lonAdjustment = 1 / Math.cos(latRad);
                    const lonDelta = latDelta * lonAdjustment;
                    
                    this.scanAreaRectangle = L.rectangle([
                        [centerLat - latDelta, centerLon - lonDelta], // Southwest
                        [centerLat + latDelta, centerLon + lonDelta]  // Northeast
                    ], {
                        color: '#00ff88',           // Bright green
                        fillColor: 'transparent',
                        fillOpacity: 0,
                        weight: 2,                  // Thin but visible border
                        opacity: 1.0,               // Full opacity
                        className: 'scan-area-rectangle'
                    }).addTo(this.map);
                    
                    // Apply zoom-invariant styling after adding to map
                    setTimeout(() => {
                        if (this.scanAreaRectangle) {
                            this.applyZoomInvariantStyling(this.scanAreaRectangle);
                            // Ensure compact controls are positioned on the initial rectangle
                            this.updateControlPositions();
                        }
                    }, 100);
                    
                    // Remove the old circle reference
                    this.scanAreaCircle = this.scanAreaRectangle;
                    
                    // Initial control positioning (important for initial display)
                    setTimeout(() => {
                        this.updateControlPositions();
                        // Set initialization flag only after everything is complete
                        this.scanAreaInitialized = true;
                        console.log('✅ Scan area square fully initialized with compact controls');
                    }, 200);
                } catch (error) {
                    console.error('❌ Failed to initialize scan area:', error);
                    // Only retry if we haven't hit the limit
                    if (retryCount < 3) {
                        setTimeout(() => {
                            try {
                                if (this.map && this.map.getContainer()) {
                                    console.log(`🔄 Retrying scan area initialization ${retryCount + 1}/3...`);
                                    this.initScanArea(retryCount + 1);
                                } else {
                                    console.error('❌ Map still not available for retry');
                                }
                            } catch (retryError) {
                                console.error('❌ Scan area retry also failed:', retryError);
                            }
                        }, 5000); // Increased retry delay to 5 seconds
                    } else {
                        console.error('❌ Max retries reached for scan area initialization');
                    }
                }
            }, 5000); // Increased initial delay to 5 seconds to match map initialization
        });
    }

    // Utility method to apply zoom-invariant styling to rectangles
    applyZoomInvariantStyling(layer) {
        const element = layer.getElement();
        if (element) {
            element.style.vectorEffect = 'non-scaling-stroke';
            element.setAttribute('vector-effect', 'non-scaling-stroke');
        }
    }

    initCompactControls() {
        // Create container for compact controls
        const controlContainer = L.DomUtil.create('div', 'compact-controls-container');
        controlContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1000;
        `;
        
        // Create scan control (detection only - LiDAR automatically loaded)
        this.compactControls.scanControl = this.createCompactControl('scan', {
            icon: '🔍',
            symbol: '🎯',
            title: 'Detection Scan (Auto-loads LiDAR)',
            position: 'left',  // Position on the left like previous LiDAR controls
            actions: ['play', 'pause', 'stop'],
            status: 'Ready'
        });
        
        controlContainer.appendChild(this.compactControls.scanControl);
        
        this.map.getContainer().appendChild(controlContainer);
        
        // Initial positioning - use setTimeout to ensure proper rendering
        setTimeout(() => {
            this.updateControlPositions();
        }, 200);
        
        console.log('✅ Compact controls initialized and positioned');
    }
    
    createCompactControl(type, options) {
        const control = L.DomUtil.create('div', `compact-control compact-control-${type}`);
        const isLeft = options.position === 'left';
        
        control.style.cssText = `
            position: absolute;
            background: rgba(26, 26, 26, 0.95);
            border: 1px solid rgba(0, 255, 136, 0.3);
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 11px;
            color: #ffffff;
            pointer-events: auto;
            backdrop-filter: blur(10px);
            min-width: 160px;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s ease;
            box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
            z-index: 1001;
            visibility: hidden;
            white-space: nowrap;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        `;
        
        // Layout: [connection status] [symbol] [actions] [progress/status] [panel toggle]
        const items = [];
        
        // Connection status indicator (integrated status bar)
        items.push(`
            <div class="connection-indicator" style="display: flex; align-items: center; gap: 3px; margin-right: 6px;">
                <div class="connection-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #ff4444; transition: all 0.3s;"></div>
                <span class="connection-text" style="font-size: 9px; color: #aaa;">Offline</span>
            </div>
        `);
        
        // Control symbol and title
        items.push(`<span class="control-symbol" style="color: #00ff88; font-size: 14px; margin-right: 4px;" title="${options.title}">${options.symbol}</span>`);
        
        // Action buttons (play/pause/stop)
        items.push(`<button class="control-btn control-play" data-action="play" style="background: none; border: none; color: #00ff88; font-size: 12px; padding: 2px 4px; cursor: pointer; border-radius: 2px; display: inline-block;" title="Start Detection">▶️</button>`);
        items.push(`<button class="control-btn control-pause" data-action="pause" style="background: none; border: none; color: #ffaa00; font-size: 12px; padding: 2px 4px; cursor: pointer; border-radius: 2px; display: none;" title="Pause">⏸️</button>`);
        items.push(`<button class="control-btn control-stop" data-action="stop" style="background: none; border: none; color: #ff4444; font-size: 12px; padding: 2px 4px; cursor: pointer; border-radius: 2px;" title="Stop">⏹️</button>`);
        
        // Operation status with progress
        items.push(`<span class="control-status" style="color: #00ff88; font-size: 10px; margin-left: 6px; margin-right: 6px;">${options.status}</span>`);
        
        // Panel toggle button (replaces unused settings)
        items.push(`<button class="control-btn control-panel" data-action="panel" style="background: none; border: none; color: #888; font-size: 12px; padding: 2px 4px; cursor: pointer; border-radius: 2px;" title="Toggle Discovery Panel (Ctrl+D)">📋</button>`);
        
        control.innerHTML = items.join('');
        
        // Store references for later updates
        control.connectionDot = control.querySelector('.connection-dot');
        control.connectionText = control.querySelector('.connection-text');
        control.statusSpan = control.querySelector('.control-status');
        
        // Add hover effects for buttons
        const buttons = control.querySelectorAll('.control-btn');
        buttons.forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                btn.style.transform = 'scale(1.1)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.backgroundColor = 'transparent';
                btn.style.transform = 'scale(1)';
            });
        });
        
        // Add event listeners
        control.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = e.target.dataset.action;
            if (action) {
                this.handleCompactControlAction(type, action);
            }
        });
        
        // Prevent map interactions
        L.DomEvent.disableClickPropagation(control);
        L.DomEvent.disableScrollPropagation(control);
        
        console.log(`✅ Created ${type} compact control with integrated status`);
        return control;
    }
    
    updateControlPositions() {
        if (!this.scanAreaRectangle || !this.compactControls.scanControl) {
            console.warn('⚠️ Cannot update control positions - missing elements');
            return;
        }
        
        // Only show controls at zoom level 8 or higher (lowered from 10 for better visibility)
        const currentZoom = this.map.getZoom();
        if (currentZoom < 8) {
            this.compactControls.scanControl.style.visibility = 'hidden';
            return;
        }
        
        try {
            const bounds = this.scanAreaRectangle.getBounds();
            const northWest = bounds.getNorthWest();
            
            // Convert geographic coordinates to screen coordinates
            const topLeft = this.map.latLngToContainerPoint(northWest);
            
            // Get container dimensions for boundary checking
            const mapContainer = this.map.getContainer();
            const containerWidth = mapContainer.clientWidth;
            const containerHeight = mapContainer.clientHeight;
            
            // Ensure controls stay within map bounds with some padding
            const controlHeight = 35;
            const controlOffset = 5;
            const scanControlWidth = 160; // Updated width
            
            // Position scan control OUTSIDE the rectangle at top-left corner
            let leftX = Math.max(controlOffset, Math.min(topLeft.x, containerWidth - scanControlWidth - controlOffset));
            let leftY = Math.max(controlOffset, topLeft.y - controlHeight - 8); // 8px gap above rectangle
            
            // Ensure control doesn't go off the top of the screen
            if (leftY < controlOffset) {
                leftY = topLeft.y + 8; // Position below the rectangle if no room above
            }
            
            this.compactControls.scanControl.style.left = `${leftX}px`;
            this.compactControls.scanControl.style.top = `${leftY}px`;
            this.compactControls.scanControl.style.right = 'auto';
            this.compactControls.scanControl.style.visibility = 'visible';
            this.compactControls.scanControl.style.position = 'absolute';
            
            // Only log positioning occasionally for debugging (every 50th call)
            if (!this._positionLogCounter) this._positionLogCounter = 0;
            this._positionLogCounter++;
            if (this._positionLogCounter % 50 === 0) {
                console.log(`📍 Detection control positioned - zoom: ${currentZoom} (logged every 50 updates)`);
            }
        } catch (error) {
            console.error('❌ Error positioning controls:', error);
        }
    }
    
    handleCompactControlAction(type, action) {
        if (action === 'panel') {
            // Toggle discovery panel
            this.toggleDiscoveryPanel();
        } else if (action === 'play') {
            if (this.operationStates[type] === 'paused') {
                // Resume operation
                this.operationStates[type] = 'running';
                this.emit(`${type}Resume`);
                this.updateControlStatus(type, 'Running', null);
                this.updateControlButtons(type);
            } else if (this.operationStates[type] === 'stopped') {
                // Start new operation
                this.operationStates[type] = 'running';
                this.emit(`${type}Start`);
                this.updateControlStatus(type, 'Running', 0);
                this.updateControlButtons(type);
                
                // Inherit actions from old control panel
                if (type === 'scan') {
                    // Trigger the same start scan action as the old panel
                    this.triggerOldPanelAction('startScanBtn');
                } else if (type === 'lidar') {
                    // LiDAR tiling controls removed - now auto-loaded during detection
                    console.log('🗂️ LiDAR controls removed - data auto-loaded during detection');
                }
            }
        } else if (action === 'pause') {
            if (this.operationStates[type] === 'running') {
                this.operationStates[type] = 'paused';
                this.emit(`${type}Pause`);
                this.updateControlStatus(type, 'Paused', null);
                this.updateControlButtons(type);
            }
        } else if (action === 'stop') {
            this.operationStates[type] = 'stopped';
            this.emit(`${type}Stop`);
            this.updateControlStatus(type, 'Stopped', null);
            this.updateControlButtons(type);
            
            // Inherit actions from old control panel
            if (type === 'scan') {
                this.triggerOldPanelAction('stopScanBtn');
            }
            
            // Re-enable controls and range movement
            setTimeout(() => {
                this.updateControlStatus(type, 'Ready', null);
                this.updateControlButtons(type);
            }, 2000);
        }
    }
    
    // Helper to trigger actions from old control panel
    triggerOldPanelAction(buttonId) {
        const button = document.getElementById(buttonId);
        if (button) {
            button.click();
            console.log(`🔗 Triggered old panel action: ${buttonId}`);
        }
    }
    
    // Update control buttons based on current state
    updateControlButtons(type) {
        const control = this.compactControls.scanControl; // Only scan control now
        if (!control) return;
        
        const playBtn = control.querySelector('.control-play');
        const pauseBtn = control.querySelector('.control-pause');
        const stopBtn = control.querySelector('.control-stop');
        
        const state = this.operationStates[type];
        
        if (state === 'running') {
            if (playBtn) playBtn.style.display = 'none';
            if (pauseBtn) pauseBtn.style.display = 'inline-block';
            if (stopBtn) stopBtn.style.display = 'inline-block';
        } else if (state === 'paused') {
            if (playBtn) playBtn.style.display = 'inline-block';
            if (pauseBtn) pauseBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'inline-block';
        } else { // stopped
            if (playBtn) playBtn.style.display = 'inline-block';
            if (pauseBtn) pauseBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'inline-block';
        }
    }
    
    updateControlStatus(type, status, percentage = null) {
        const control = this.compactControls.scanControl; // Only scan control now
        const statusEl = control.querySelector('.control-status');
        
        if (statusEl) {
            let displayText = status;
            if (percentage !== null && percentage > 0) {
                displayText = `${status} ${percentage}%`;
            }
            statusEl.textContent = displayText;
            statusEl.style.color = status === 'Running' ? '#ffaa00' : (status === 'Stopped' ? '#ff4444' : '#00ff88');
        }
    }
    
    // Method to update connection status in compact controls
    updateConnectionStatus(isConnected, statusText = null) {
        if (!this.compactControls.scanControl) return;
        
        const connectionDot = this.compactControls.scanControl.connectionDot;
        const connectionText = this.compactControls.scanControl.connectionText;
        
        if (connectionDot && connectionText) {
            if (isConnected) {
                connectionDot.style.background = '#00ff88';
                connectionText.textContent = statusText || 'Online';
                connectionText.style.color = '#00ff88';
            } else {
                connectionDot.style.background = '#ff4444';
                connectionText.textContent = statusText || 'Offline';
                connectionText.style.color = '#ff4444';
            }
        }
    }
    
    // Method to update operation status in compact controls
    updateControlStatus(type, status, progress = null) {
        const control = this.compactControls[type + 'Control'];
        if (!control || !control.statusSpan) return;
        
        let statusText = status;
        if (progress !== null) {
            statusText += ` (${progress}%)`;
        }
        
        control.statusSpan.textContent = statusText;
        
        // Update status color based on state
        if (status.includes('Running') || status.includes('Active')) {
            control.statusSpan.style.color = '#00ff88';
        } else if (status.includes('Paused')) {
            control.statusSpan.style.color = '#ffaa00';
        } else if (status.includes('Error') || status.includes('Failed')) {
            control.statusSpan.style.color = '#ff4444';
        } else {
            control.statusSpan.style.color = '#888';
        }
    }
    
    showSettingsPanel(type) {
        // Hide any existing panel
        this.hideSettingsPanel();
        
        // Create settings panel
        this.compactControls.settingsPanel = this.createSettingsPanel(type);
        this.map.getContainer().appendChild(this.compactControls.settingsPanel);
    }
    
    hideSettingsPanel() {
        if (this.compactControls.settingsPanel) {
            this.compactControls.settingsPanel.remove();
            this.compactControls.settingsPanel = null;
        }
    }
    
    createSettingsPanel(type) {
        const panel = L.DomUtil.create('div', 'settings-panel');
        panel.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(26, 26, 26, 0.98);
            border: 1px solid rgba(0, 255, 136, 0.5);
            border-radius: 8px;
            padding: 16px;
            min-width: 300px;
            max-width: 400px;
            color: #ffffff;
            pointer-events: auto;
            backdrop-filter: blur(15px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
            z-index: 2000;
        `;
        
        if (type === 'lidar') {
            panel.innerHTML = `
                <h3 style="margin: 0 0 12px 0; color: #00ff88; font-size: 14px;">🌍 LiDAR & Region Settings</h3>
                <div class="setting-group">
                    <label style="display: block; margin-bottom: 4px; font-size: 12px;">Center Latitude</label>
                    <input type="number" id="centerLat" value="52.4751" step="0.000001" style="width: 100%; padding: 4px; background: rgba(64, 64, 64, 0.8); border: 1px solid #555; border-radius: 3px; color: #fff;">
                </div>
                <div class="setting-group" style="margin-top: 8px;">
                    <label style="display: block; margin-bottom: 4px; font-size: 12px;">Center Longitude</label>
                    <input type="number" id="centerLon" value="4.8156" step="0.000001" style="width: 100%; padding: 4px; background: rgba(64, 64, 64, 0.8); border: 1px solid #555; border-radius: 3px; color: #fff;">
                </div>
                <div class="setting-group" style="margin-top: 8px;">
                    <label style="display: block; margin-bottom: 4px; font-size: 12px;">Scan Radius (km)</label>
                    <input type="number" id="scanRadius" value="2" step="0.1" min="0.1" max="50" style="width: 100%; padding: 4px; background: rgba(64, 64, 64, 0.8); border: 1px solid #555; border-radius: 3px; color: #fff;">
                </div>
                <div style="margin-top: 12px; text-align: right;">
                    <button onclick="if(window.app && window.app.map) window.app.map.hideSettingsPanel(); else if(window.unifiedApp && window.unifiedApp.map) window.unifiedApp.map.hideSettingsPanel();" style="background: #444; border: 1px solid #666; color: #fff; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;">Close</button>
                </div>
            `;
        } else {
            panel.innerHTML = `
                <h3 style="margin: 0 0 12px 0; color: #00ff88; font-size: 14px;">🎯 Detection Settings</h3>
                <div class="setting-group">
                    <label style="display: block; margin-bottom: 4px; font-size: 12px;">Patch Size (m)</label>
                    <select id="patchSize" style="width: 100%; padding: 4px; background: rgba(64, 64, 64, 0.8); border: 1px solid #555; border-radius: 3px; color: #fff;">
                        <option value="20">20m × 20m</option>
                        <option value="40" selected>40m × 40m</option>
                        <option value="60">60m × 60m</option>
                        <option value="80">80m × 80m</option>
                    </select>
                </div>
                <div class="setting-group" style="margin-top: 8px;">
                    <label style="display: block; margin-bottom: 4px; font-size: 12px;">Confidence Threshold</label>
                    <select id="confidenceThreshold" style="width: 100%; padding: 4px; background: rgba(64, 64, 64, 0.8); border: 1px solid #555; border-radius: 3px; color: #fff;">
                        <option value="0.3">Low (30%)</option>
                        <option value="0.5">Medium (50%)</option>
                        <option value="0.7" selected>High (70%)</option>
                        <option value="0.8">Very High (80%)</option>
                    </select>
                </div>
                <div class="setting-group" style="margin-top: 8px;">
                    <label style="display: block; margin-bottom: 4px; font-size: 12px;">Max Patches</label>
                    <select id="maxPatches" style="width: 100%; padding: 4px; background: rgba(64, 64, 64, 0.8); border: 1px solid #555; border-radius: 3px; color: #fff;">
                        <option value="50">50 patches</option>
                        <option value="100" selected>100 patches</option>
                        <option value="200">200 patches</option>
                        <option value="500">500 patches</option>
                    </select>
                </div>
                <div style="margin-top: 12px; text-align: right;">
                    <button onclick="if(window.app && window.app.map) window.app.map.hideSettingsPanel(); else if(window.unifiedApp && window.unifiedApp.map) window.unifiedApp.map.hideSettingsPanel();" style="background: #444; border: 1px solid #666; color: #fff; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;">Close</button>
                </div>
            `;
        }
        
        // Prevent map interactions
        L.DomEvent.disableClickPropagation(panel);
        L.DomEvent.disableScrollPropagation(panel);
         return panel;
    }
    
    initPatchVisualization() {
        // Initialize patch visualization system if available
        if (typeof PatchVisualization !== 'undefined') {
            this.patchVisualization = new PatchVisualization();
            console.log('✅ Patch visualization initialized');
        } else {
            console.warn('⚠️ PatchVisualization not available');
        }
    }
    
    setupMapEvents() {
        // Track mouse position for distinguishing clicks from drags
        let mouseDownTime = 0;
        let mouseDownPos = null;
        let isDragging = false;
        
        // Track mouse down for drag detection
        this.map.on('mousedown', (e) => {
            mouseDownTime = Date.now();
            mouseDownPos = { x: e.containerPoint.x, y: e.containerPoint.y };
            isDragging = false;
        });
        
        // Track mouse movement to detect dragging
        this.map.on('mousemove', (e) => {
            if (mouseDownPos && !isDragging) {
                const currentPos = { x: e.containerPoint.x, y: e.containerPoint.y };
                const distance = Math.sqrt(
                    Math.pow(currentPos.x - mouseDownPos.x, 2) + 
                    Math.pow(currentPos.y - mouseDownPos.y, 2)
                );
                // If mouse moved more than 5 pixels, consider it dragging
                if (distance > 5) {
                    isDragging = true;
                }
            }
        });
        
        // Handle map clicks for setting scan center (only for actual clicks, not drags)
        // Require Ctrl+Click for region selection to avoid interfering with normal map usage
        this.map.on('click', (e) => {
            // Prevent moving range during operations
            if (this.operationStates.lidar === 'running' || this.operationStates.scan === 'running') {
                console.log('⚠️ Cannot move detection area while operations are running');
                return;
            }
            
            // Check if this was a drag operation (ignore if so)
            const clickTime = Date.now();
            const timeDiff = clickTime - mouseDownTime;
            
            // Only respond to quick clicks (not long holds or drags)
            if (isDragging || timeDiff > 500) {
                isDragging = false;
                mouseDownPos = null;
                return;
            }
            
            // Require Ctrl+Click for region selection to avoid interfering with normal map navigation
            if (!e.originalEvent.ctrlKey && !e.originalEvent.metaKey) {
                isDragging = false;
                mouseDownPos = null;
                return;
            }
            
            const { lat, lng } = e.latlng;
            this.updateScanArea({ lat, lon: lng, radius: 2 });
            
            // Emit area selected event
            this.emit('areaSelected', {
                north: lat + 0.02,
                south: lat - 0.02,
                east: lng + 0.02,
                west: lng - 0.02
            });
            
            console.log('🎯 Scan area updated via Ctrl+Click');
            
            // Reset tracking
            isDragging = false;
            mouseDownPos = null;
        });
        
        // Reset drag tracking on mouse up
        this.map.on('mouseup', () => {
            // Small delay to ensure click event fires first
            setTimeout(() => {
                isDragging = false;
                mouseDownPos = null;
            }, 10);
        });
        
        // Handle map zoom/pan for performance optimization and control updates
        // Use multiple events to ensure controls always update
        const updateControls = () => {
            requestAnimationFrame(() => {
                this.optimizePatchDisplay();
                this.updateControlsThrottled();
            });
        };
        
        this.map.on('zoomend', updateControls);
        this.map.on('moveend', updateControls);
        this.map.on('zoom', updateControls);        // During zoom
        this.map.on('move', updateControls);        // During pan
        this.map.on('viewreset', updateControls);   // On major view changes
        this.map.on('resize', updateControls);      // On window resize
        
        // Reapply zoom-invariant styling after zoom to ensure border stays thin
        this.map.on('zoomend', () => {
            if (this.scanAreaRectangle) {
                setTimeout(() => {
                    this.applyZoomInvariantStyling(this.scanAreaRectangle);
                }, 10);
            }
        });
        
        // Continuous update during interactions for smoothness
        let isInteracting = false;
        let animationId = null;
        
        const startContinuousUpdate = () => {
            if (!isInteracting) {
                isInteracting = true;
                const continuousUpdate = () => {
                    if (isInteracting) {
                        this.updateControlsThrottled();
                        animationId = requestAnimationFrame(continuousUpdate);
                    }
                };
                continuousUpdate();
            }
        };
        
        const stopContinuousUpdate = () => {
            isInteracting = false;
            if (animationId) {
                cancelAnimationFrame(animationId);
                animationId = null;
            }
            // Final update when interaction stops
            setTimeout(() => this.updateControlPositions(), 50);
        };
        
        this.map.on('zoomstart', startContinuousUpdate);
        this.map.on('movestart', startContinuousUpdate);
        this.map.on('zoomend', stopContinuousUpdate);
        this.map.on('moveend', stopContinuousUpdate);
    }
    
    updateScanArea(area) {
        if (!area) return;
        
        if (!this.scanAreaRectangle) {
            console.warn('⚠️ Scan area not ready yet, attempting to initialize...');
            // Try to initialize scan area if not done yet
            if (!this.scanAreaInitialized) {
                this.initScanArea();
                // Queue the update for after initialization
                setTimeout(() => {
                    this.updateScanArea(area);
                }, 6000); // Wait for initialization to complete
                return;
            } else {
                console.warn('⚠️ Cannot update scan area: scanAreaRectangle is null but initialization flag is set');
                return;
            }
        }
        
        const { lat, lon, radius } = area;
        const radiusMeters = radius * 1000; // Convert km to meters
        
        // Calculate rectangle bounds from center and radius
        const latMPerDeg = 111320;
        const lonMPerDeg = 111320 * Math.cos(lat * Math.PI / 180);
        const latDelta = radiusMeters / latMPerDeg;
        const lonDelta = radiusMeters / lonMPerDeg;
        
        const bounds = [
            [lat - latDelta, lon - lonDelta], // southwest
            [lat + latDelta, lon + lonDelta]  // northeast
        ];
        
        // Update scan area rectangle
        this.scanAreaRectangle.setBounds(bounds);
        
        // Update compact control positions
        this.updateControlPositions();
    }
    
    // Get current scan area bounds in the format expected by the backend
    getCurrentScanBounds() {
        if (!this.scanAreaRectangle) return null;
        
        const bounds = this.scanAreaRectangle.getBounds();
        return {
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest(),
            // Also calculate center and radius for compatibility
            center_lat: bounds.getCenter().lat,
            center_lon: bounds.getCenter().lng,
            radius_km: this.calculateRadiusFromBounds(bounds)
        };
    }
    
    // Calculate radius in km from rectangular bounds
    calculateRadiusFromBounds(bounds) {
        const latDiff = bounds.getNorth() - bounds.getSouth();
        const lonDiff = bounds.getEast() - bounds.getWest();
        
        // Convert to meters and take average of lat/lon distances
        const latKm = latDiff * 111.32;
        const lonKm = lonDiff * 111.32 * Math.cos(bounds.getCenter().lat * Math.PI / 180);
        
        // Return half the average dimension as radius
        return Math.max(latKm, lonKm) / 2;
    }

    optimizePatchDisplay() {
        // Placeholder for patch display optimization based on zoom
        const zoom = this.map.getZoom();
        if (zoom < 12) {
            // Could hide/simplify patches at low zoom for performance
        }
    }
    
    // Hide controls during scanning operations
    hideCompactControlsDuringOperation() {
        // LiDAR control removed - only handle scan control
        if (this.compactControls.scanControl) {
            this.compactControls.scanControl.style.opacity = '0.3';
            this.compactControls.scanControl.style.pointerEvents = 'none';
        }
        // Hide settings panel if open
        this.hideSettingsPanel();
    }
    
    // Show controls after operations complete
    showCompactControlsAfterOperation() {
        // LiDAR control removed - only handle scan control
        if (this.compactControls.scanControl) {
            this.compactControls.scanControl.style.opacity = '1';
            this.compactControls.scanControl.style.pointerEvents = 'auto';
        }
    }
    
    // Additional methods for patch management
    addPatch(patch) {
        this.patches.set(patch.id, patch);
        if (this.patchVisualization) {
            this.patchVisualization.addPatch(patch);
        }
    }
    
    clearPatches() {
        this.patches.clear();
        if (this.patchVisualization) {
            this.patchVisualization.clearPatches();
        }
   }
    
    // Method to toggle discovery panel
    toggleDiscoveryPanel() {
        const panel = document.querySelector('.discovery-panel');
        if (panel) {
            const isVisible = panel.style.display !== 'none';
            panel.style.display = isVisible ? 'none' : 'block';
            console.log(`🎛️ Discovery panel ${isVisible ? 'hidden' : 'shown'}`);
        } else {
            console.warn('⚠️ Discovery panel not found');
        }
    }
    
    // Initialize keyboard shortcuts
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + D: Toggle discovery panel
            if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                e.preventDefault();
                this.toggleDiscoveryPanel();
            }
            
            // Escape: Hide settings panel
            if (e.key === 'Escape') {
                this.hideSettingsPanel();
            }
        });
    }
    
    // Debug method to test control visibility
    debugCompactControls() {
        console.log('🔧 Debug: Compact controls status');
        console.log('Scan control:', this.compactControls.scanControl);
        console.log('Map container:', this.map.getContainer());
        console.log('Current zoom level:', this.map.getZoom());
        console.log('Operation states:', this.operationStates);
        
        // LiDAR control removed - only debug scan control
        
        if (this.compactControls.scanControl) {
            console.log('Scan position:', {
                left: this.compactControls.scanControl.style.left,
                right: this.compactControls.scanControl.style.right,
                top: this.compactControls.scanControl.style.top,
                visibility: this.compactControls.scanControl.style.visibility
            });
        }
        
        // Check rectangle bounds
        if (this.scanAreaRectangle) {
            console.log('Rectangle bounds:', this.scanAreaRectangle.getBounds());
        }
        
        // Force update positions
        this.updateControlPositions();
    }
}

// Make available globally
window.MapManager = MapManager;

/**
 * Simple Legacy App - Clean implementation for sliding window LiDAR tiling
 */

class UnifiedREArchaeologyApp {
    constructor() {
        this.statusManager = new StatusManager();
        this.mapInstance = null;
        this.isScanning = false;
        this.currentLidarSessionId = null;
        this.patches = new Map();
        this.currentSession = null;
        this.selectedArea = null;
    }

    async init() {
        try {
            this.initMap();
            this.setupStatusCallbacks();
            
            try {
                await this.statusManager.connect();
            } catch (error) {
                // Backend connection will retry automatically
            }
            
            this.initControls();
            
            // Initialize compact controls after map is ready            
            if (this.mapManager && this.mapInstance) {
                this.setupCompactControlEvents();
                // Note: updateScanArea is now called in finishMapSetup after proper initialization
            }
            
            if (typeof StatusUIManager !== 'undefined') {
                this.statusUI = new StatusUIManager(this.statusManager);
            }
            
            this.updateButtonStates();
            this.updateConnectionStatus();
            
            if (typeof window !== 'undefined') {
                window.debugReset = () => this.forceResetScanningState();
                window.app = this; // Make app globally available for compact controls
            }
        } catch (error) {
            console.error('Failed to initialize app:', error);
        }
    }

    initMap() {
        // Clean up existing map
        if (this.mapVisualization) {
            try {
                this.mapVisualization.destroy();
            } catch (error) {
                console.warn('Error cleaning up existing map:', error);
            }
            this.mapVisualization = null;
            this.mapInstance = null;
        }
        
        if (typeof MapVisualization === 'undefined') {
            console.error('MapVisualization class not found!');
            throw new Error('MapVisualization class not defined');
        }
        
        // Initialize MapVisualization first
        this.mapVisualization = new MapVisualization('map', {
            center: [52.4751, 4.8156],
            zoom: 13
        });
        
        // Check if map was initialized successfully
        if (!this.mapVisualization.map) {
            // Retry initialization if it failed
            console.warn('⚠️ Map not ready immediately, retrying...');
            setTimeout(() => {
                if (!this.mapVisualization.map && this.mapVisualization.initError) {
                    console.log('🔄 Retrying map initialization...');
                    try {
                        this.mapVisualization.initMap();
                        // Setup event handlers only if map was created successfully
                        if (this.mapVisualization.map) {
                            this.mapVisualization.setupEventHandlers();
                        }
                    } catch (retryError) {
                        console.error('❌ Map retry failed:', retryError);
                        throw retryError;
                    }
                }
                this.finishMapSetup();
            }, 100);
        } else {
            this.finishMapSetup();
        }
    }
    
    finishMapSetup() {
        this.mapInstance = this.mapVisualization.map;
        console.log('✅ MapVisualization created, map instance:', this.mapInstance ? 'EXISTS' : 'NULL');
        console.log('✅ Map container _leaflet_id:', document.getElementById('map')?._leaflet_id);
        console.log('🎯 Map interaction tip: Use Ctrl+Click to select scan areas, drag to pan normally');
        
        if (!this.mapInstance) {
            console.error('❌ Map instance is null after initialization');
            throw new Error('Failed to create map instance');
        }
        
        // Initialize MapManager with the existing map instance
        console.log('🗺️ Initializing MapManager with compact controls...');
        if (!this.mapManager) {
            this.mapManager = new MapManager();
            console.log('🗺️ Passing existing map to MapManager...');
            // Initialize with the existing map instance
            this.mapManager.init(this.mapInstance);
            console.log('✅ MapManager initialized with existing map');
        }
        
        // Setup compact control events if available
        if (this.mapManager && this.mapInstance) {
            this.setupCompactControlEvents();
        }
        
        // Update scan area after MapManager is fully initialized
        setTimeout(() => {
            if (this.mapManager && this.mapManager.updateScanArea) {
                this.mapManager.updateScanArea({ lat: 52.4751, lon: 4.8156, radius: 2 });
            }
        }, 500);
        
        // Delay setupDefaultScanArea to ensure map is fully ready
        setTimeout(() => {
            this.setupDefaultScanArea();
        }, 1200); // Increased delay to ensure map coordinate system is ready
        
        if (this.mapInstance) {
            this.mapInstance.on('click', (e) => {
                // Require Ctrl+Click for region selection to avoid interfering with map dragging
                if (!this.isScanning && (!this.selectedArea || !this.selectedArea.isLocked) && 
                    (e.originalEvent.ctrlKey || e.originalEvent.metaKey)) {
                    this.selectScanArea(e.latlng.lat, e.latlng.lng);
                    console.log('🎯 Scan area selected via Ctrl+Click');
                }
            });
            
            this.mapInstance.on('zoomend', () => {
                this.refreshSelectionRectangle();
            });
            
            this.mapInstance.on('moveend', () => {
                this.refreshSelectionRectangle();
            });
            
            setTimeout(() => {
                this.selectScanArea(52.4751, 4.8156);
            }, 1000);
        } else {
            console.error('Failed to get map instance');
        }
    }

    setupStatusCallbacks() {
        this.statusManager.on('connectionEstablished', () => {
            this.updateConnectionStatus(true);
            this.updateButtonStates();
        });

        this.statusManager.on('disconnected', () => {
            this.updateConnectionStatus(false);
            this.updateButtonStates();
        });

        this.statusManager.on('sessionStarted', (data) => {
            this.isScanning = true;
            this.lockScanArea();
            this.updateButtonStates();
        });

        this.statusManager.on('sessionCompleted', () => {
            this.isScanning = false;
            this.unlockScanArea();
            this.updateButtonStates();
        });

        this.statusManager.on('patchResult', (patch) => {
            this.handlePatch(patch);
        });
        
        this.statusManager.on('lidarTile', (tileData) => {
            this.handleLidarTile(tileData);
        });
        
        this.statusManager.on('lidarProgress', (progressData) => {
            // LiDAR progress is now handled transparently by the backend
            console.log('📊 LiDAR loading progress:', progressData);
        });
        
        this.statusManager.on('lidarCompleted', (data) => {
            this.isScanning = false;
            this.currentLidarSessionId = null;
            this.unlockScanArea();
            
            console.log('✅ LiDAR loading completed');
            this.updateButtonStates();
        });
        
        this.statusManager.on('lidarError', (error) => {
            console.error('❌ LiDAR tiling error:', error.message);
            this.isScanning = false;
            this.currentLidarSessionId = null; // Clear session ID
            this.unlockScanArea(); // Unlock the area if there's an error
            
            this.updateButtonStates();
        });
        
        console.log('✅ Status callbacks registered');
    }

    updateConnectionStatus(isConnected = null) {
        // Auto-detect connection status if not provided
        if (isConnected === null) {
            isConnected = this.statusManager?.isConnected() || false;
        }
        
        console.log(`🔧 Updating connection status to: ${isConnected ? 'Connected' : 'Disconnected'}`);
        
        const connectionStatus = document.getElementById('connectionStatus');
        if (connectionStatus) {
            connectionStatus.className = `connection-status ${isConnected ? 'connected' : 'disconnected'}`;
            const statusText = connectionStatus.querySelector('span');
            if (statusText) {
                statusText.textContent = isConnected ? 'Connected' : 'Disconnected';
            }
        }
        
        const detailedStatus = document.getElementById('detailedConnectionStatus');
        if (detailedStatus) {
            detailedStatus.textContent = isConnected ? 'Connected' : 'Disconnected';
        }
    }

    handlePatch(patch) {
        // Use MapVisualization to display patch with LiDAR data
        if (this.mapVisualization && this.mapVisualization.addPatch) {
            this.mapVisualization.addPatch(patch);
        }
        
        // Store patch
        this.patches.set(patch.patch_id, patch);
    }

    handleLidarTile(tileData) {
        // Use MapVisualization to display LiDAR tile
        if (this.mapVisualization && this.mapVisualization.addLidarTile) {
            this.mapVisualization.addLidarTile(tileData);
        }
        
        // Store tile data
        this.patches.set(tileData.tile_id, tileData);
    }

    initControls() {
        // Start button
        const startBtn = document.getElementById('startScanBtn');
        if (startBtn) {
            startBtn.addEventListener('click', () => this.startScan());
        }

        // Stop button  
        const stopBtn = document.getElementById('stopScanBtn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => this.stopScan());
        }

        // Clear button
        const clearBtn = document.getElementById('clearResultsBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearResults());
        }
    }

    setupDefaultScanArea() {
        const defaultLat = 52.4751;
        const defaultLon = 4.8156;
        const defaultRadiusKm = 1.0;
        
        this.selectScanArea(defaultLat, defaultLon, defaultRadiusKm);
        
        const centerLatInput = document.getElementById('centerLat');
        const centerLonInput = document.getElementById('centerLon');
        const radiusInput = document.getElementById('scanRadius');
        
        if (centerLatInput) centerLatInput.value = defaultLat.toFixed(6);
        if (centerLonInput) centerLonInput.value = defaultLon.toFixed(6);
        if (radiusInput) radiusInput.value = defaultRadiusKm.toFixed(1);
    }

    selectScanArea(lat, lon, radiusKm = null) {
        // Always delegate to MapManager if it exists - it handles the scan area display
        if (this.mapManager) {
            console.log('📍 Delegating scan area to MapManager (no duplicate rectangle)');
            this.mapManager.updateScanArea({ lat, lon, radius: radiusKm || 1 });
            
            // Only set our local selectedArea for data reference (no visual rectangle)
            const radiusValue = radiusKm || 1;
            const radius = radiusValue * 1000; // Convert to meters
            const latDelta = radius / 111320;
            const lonDelta = radius / (111320 * Math.cos(lat * Math.PI / 180));
            
            this.selectedArea = {
                lat, 
                lon, 
                radius: radiusValue,
                bounds: [
                    [lat - latDelta, lon - lonDelta], // southwest
                    [lat + latDelta, lon + lonDelta]  // northeast
                ],
                rectangle: this.mapManager.scanAreaRectangle, // Reference to manager's rectangle
                isLocked: false
            };
            
            console.log('✅ selectedArea data set (visual handled by MapManager)');
            this.updateButtonStates();
            return;
        }
        
        // Only create our own rectangle if MapManager doesn't exist (fallback mode)
        console.log('⚠️ MapManager not available, creating fallback rectangle');
        
        // Clear existing area
        if (this.selectedArea && this.selectedArea.rectangle && this.mapInstance) {
            this.mapInstance.removeLayer(this.selectedArea.rectangle);
        }

        // Get radius from parameter or UI
        const radiusValue = radiusKm || parseFloat(document.getElementById('scanRadius')?.value || 1);
        const radius = radiusValue * 1000; // Convert to meters
        
        // Calculate rectangle bounds using proper geographic calculations
        const latDelta = radius / 111320; // More precise conversion
        const lonDelta = radius / (111320 * Math.cos(lat * Math.PI / 180));
        
        // Create bounds for rectangle (southwest and northeast corners)
        const bounds = [
            [lat - latDelta, lon - lonDelta], // Southwest corner
            [lat + latDelta, lon + lonDelta]  // Northeast corner
        ];

        // Store area data
        this.selectedArea = {
            center: { lat, lon },
            bounds: bounds,
            radius: radius,
            rectangle: null,
            isLocked: false // Track if area is locked during scanning
        };
        
        // Create rectangle with geographic bounds (will scale properly with zoom)
        if (this.mapInstance) {
            // Wait for map to be ready before adding layers
            this.mapInstance.whenReady(() => {
                // Add extra delay to ensure renderer and coordinate system are ready
                setTimeout(() => {
                    try {
                        // Validate map state before proceeding
                        if (!this.mapInstance || !this.mapInstance.getContainer()) {
                            throw new Error('Map instance not properly initialized');
                        }
                        
                        // Test coordinate operations with better validation
                        // Comprehensive coordinate system validation
                        try {
                            if (!this.mapInstance || !this.mapInstance.getContainer()) {
                                throw new Error('Map instance not available');
                            }
                            
                            const center = this.mapInstance.getCenter();
                            const zoom = this.mapInstance.getZoom();
                            
                            // Verify we got valid coordinate results
                            if (!center || typeof center.lat !== 'number' || typeof center.lng !== 'number' || 
                                typeof zoom !== 'number') {
                                throw new Error('Map coordinate system returned invalid values');
                            }
                            
                            console.log('✅ Map coordinate system verified for scan area');
                        } catch (coordError) {
                            throw new Error('Map coordinate system not ready: ' + coordError.message);
                        }
                        
                        this.selectedArea.rectangle = L.rectangle(bounds, {
                            color: '#00ff88',
                            weight: 3,
                            opacity: 0.8,
                            fillOpacity: 0, // No fill - border only
                            interactive: !this.isScanning, // Lock during scanning
                            pane: 'overlayPane' // Ensure proper layering
                        }).addTo(this.mapInstance);
                        
                        // Add click handler only when not scanning
                        if (!this.isScanning) {
                            this.selectedArea.rectangle.on('click', (e) => {
                                if (!this.selectedArea.isLocked) {
                                    // Allow repositioning when not locked
                                    this.selectScanArea(e.latlng.lat, e.latlng.lng, radiusValue);
                                }
                            });
                        }
                        
                        // Ensure rectangle stays on top and updates with zoom
                        this.selectedArea.rectangle.bringToFront();
                        console.log('✅ Scan area rectangle created successfully');
                    } catch (error) {
                        console.error('❌ Failed to create scan area rectangle:', error);
                        // Retry with exponential backoff
                        setTimeout(() => {
                            try {
                                if (this.mapInstance && this.mapInstance.getContainer()) {
                                    console.log('🔄 Retrying scan area rectangle creation...');
                                    this.selectScanArea(lat, lon, radiusKm);
                                } else {
                                    console.error('❌ Map still not available for rectangle creation');
                                }
                            } catch (retryError) {
                                console.error('❌ Scan area rectangle retry failed:', retryError);
                            }
                        }, 3000); // Increased retry delay
                    }
                }, 2000); // Increased initial delay
            });
        }

        this.updateButtonStates();
    }

    /**
     * Refresh the selection rectangle to ensure it stays visible and properly scaled
     */
    refreshSelectionRectangle() {
        if (this.selectedArea && this.selectedArea.rectangle && this.mapInstance) {
            // Update rectangle style based on scanning state
            const isLocked = this.isScanning || this.selectedArea.isLocked;
            
            this.selectedArea.rectangle.setStyle({
                color: isLocked ? '#ff8800' : '#00ff88', // Orange when locked, green when unlocked
                weight: isLocked ? 4 : 3,
                opacity: isLocked ? 1.0 : 0.8,
                fillOpacity: 0, // Remove fill - border only
                interactive: !isLocked
            });
            
            // Update the bounds to ensure proper scaling with zoom
            // Leaflet rectangles should automatically scale with zoom since they use geographic coordinates
            // Force a redraw by bringing to front
            this.selectedArea.rectangle.bringToFront();
            
            // Update locked state
            this.selectedArea.isLocked = isLocked;
        }
    }

    async startScan() {
        if (this.isScanning) {
            return;
        }
        
        try {
            // Clear previous visualizations
            if (this.mapVisualization && this.mapVisualization.clearPatches) {
                this.mapVisualization.clearPatches();
            }
            if (this.mapVisualization && this.mapVisualization.clearLidarHeatmap) {
                this.mapVisualization.clearLidarHeatmap();
            }
            
            if (!this.selectedArea) {
                if (this.mapInstance) {
                    const center = this.mapInstance.getCenter();
                    this.selectScanArea(center.lat, center.lng);
                } else {
                    this.selectScanArea(52.4751, 4.8156);
                }
            }

            console.log('🚀 Starting detection with automatic LiDAR loading...');
            
            // Detection config with automatic LiDAR integration (handled by backend)
            const config = {
                method: 'G2_dutch_windmill',
                patch_size: parseInt(document.getElementById('patchSize')?.value || '64'),
                sliding_step: parseInt(document.getElementById('slidingStep')?.value || '1'),
                use_bounds: true,
                north_lat: this.selectedArea.bounds[1][0],
                south_lat: this.selectedArea.bounds[0][0], 
                east_lon: this.selectedArea.bounds[1][1],
                west_lon: this.selectedArea.bounds[0][1],
                // LiDAR is automatically loaded by backend during detection
                auto_load_lidar: true,
                lidar_tile_size: 64,
                lidar_data_type: 'DSM',
                streaming_mode: true
            };

            console.log('🎯 Detection config with backend LiDAR auto-loading:', config);
            
            await this.statusManager.startDiscovery(config);
            this.isScanning = true;
            this.updateButtonStates();
            
            console.log('✅ Detection started with backend LiDAR auto-loading');
            
        } catch (error) {
            console.error('Failed to start integrated scan:', error);
            this.isScanning = false;
            this.updateButtonStates();
        }
    }

    async stopScan() {
        if (!this.isScanning) return;
        
        try {
            await this.statusManager.stopDiscovery();
            this.isScanning = false;
            this.updateButtonStates();
        } catch (error) {
            console.error('Failed to stop scan:', error);
        }
    }

    async startLidarScan() {
        if (this.isScanning) {
            return;
        }
        
        try {
            if (this.mapVisualization && this.mapVisualization.clearLidarHeatmap) {
                this.mapVisualization.clearLidarHeatmap();
            }
            
            if (!this.selectedArea) {
                let centerLat, centerLon;
                
                if (this.mapInstance) {
                    const center = this.mapInstance.getCenter();
                    centerLat = center.lat;
                    centerLon = center.lng;
                } else {
                    centerLat = 52.4751;
                    centerLon = 4.8156;
                    console.log('📍 Using default coordinates:', centerLat, centerLon);
                }
                
                // Use a proper radius for LiDAR tiling (2km default)
                const defaultRadius = parseFloat(document.getElementById('scanRadius')?.value || 2);
                this.selectScanArea(centerLat, centerLon, defaultRadius);
                console.log(`📏 Created default scan area with ${defaultRadius}km radius`);
            }

            // Double-check we have valid selectedArea with bounds
            if (!this.selectedArea || !this.selectedArea.bounds || !Array.isArray(this.selectedArea.bounds) || this.selectedArea.bounds.length < 2) {
                console.error('❌ Invalid selectedArea after setup:', this.selectedArea);
                throw new Error('Invalid scan area configuration - bounds not properly set');
            }

            // Get scan config for LiDAR streaming using exact rectangle bounds
            let scanBounds;
            
            // If MapManager exists, use its current rectangle bounds for precision
            if (this.mapManager && this.mapManager.getCurrentScanBounds) {
                scanBounds = this.mapManager.getCurrentScanBounds();
                console.log('🎯 Using MapManager bounds for LiDAR scan:', scanBounds);
            } else {
                // Fallback to selectedArea bounds
                scanBounds = {
                    north: this.selectedArea.bounds[1][0],  // northeast lat
                    south: this.selectedArea.bounds[0][0],  // southwest lat
                    east: this.selectedArea.bounds[1][1],   // northeast lon
                    west: this.selectedArea.bounds[0][1],   // southwest lon
                    center_lat: (this.selectedArea.bounds[0][0] + this.selectedArea.bounds[1][0]) / 2,
                    center_lon: (this.selectedArea.bounds[0][1] + this.selectedArea.bounds[1][1]) / 2,
                    radius_km: this.calculateRadius()
                };
                console.log('🎯 Using selectedArea bounds for LiDAR scan:', scanBounds);
            }
            
            const config = {
                // Use exact rectangle bounds instead of center+radius
                north: scanBounds.north,
                south: scanBounds.south,
                east: scanBounds.east,
                west: scanBounds.west,
                // Also include center and radius for backward compatibility
                center_lat: scanBounds.center_lat,
                center_lon: scanBounds.center_lon,
                radius_km: scanBounds.radius_km,
                tile_size_m: 64, // Default tile size since controls removed
                data_type: 'DSM', // Default data type since controls removed
                streaming_mode: true // Default streaming mode since controls removed
            };
            
            console.log('🎯 Final LiDAR scan config:', {
                bounds: `N:${config.north.toFixed(6)} S:${config.south.toFixed(6)} E:${config.east.toFixed(6)} W:${config.west.toFixed(6)}`,
                center: [config.center_lat.toFixed(6), config.center_lon.toFixed(6)],
                radius_km: config.radius_km.toFixed(3)
            });
            console.log('🌐 API base URL:', this.statusManager.apiBaseUrl);
            
            // Get API base URL with fallback
            const apiBaseUrl = this.statusManager.apiBaseUrl || (window.AppConfig ? window.AppConfig.apiBase : '/api/v1');
            const fullUrl = `${apiBaseUrl}/discovery/lidar-scan`;
            console.log('🔗 Full URL:', fullUrl);

            // Start LiDAR tiling via API
            const response = await fetch(fullUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(config)
            });

            console.log('📡 Response status:', response.status);

            if (!response.ok) {
                throw new Error(`LiDAR tiling failed: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('✅ LiDAR tiling started:', result);
            
            // Store session ID for pause/resume
            this.currentLidarSessionId = result.session_id;
            
            this.isScanning = true;
            this.lockScanArea(); // Lock the area when LiDAR tiling starts
            
            // Update button to running state
            if (this.statusUI && this.statusUI.updateLidarButtonState) {
                this.statusUI.updateLidarButtonState('running', 0, '0/0');
            }
            
            this.updateButtonStates();
            
        } catch (error) {
            console.error('❌ Failed to start LiDAR tiling:', error);
            this.isScanning = false;
            this.unlockScanArea(); // Unlock area if start fails
            
            // Reset button to idle state on error
            if (this.statusUI && this.statusUI.updateLidarButtonState) {
                this.statusUI.updateLidarButtonState('idle', 0, 'Error');
            }
            
            this.updateButtonStates();
        }
    }

    /**
     * Pause LiDAR tiling session
     */
    async pauseLidarScan() {
        if (!this.isScanning || !this.currentLidarSessionId) {
            console.log('⚠️ No active LiDAR session to pause');
            return;
        }
        
        try {
            console.log('⏸️ Pausing LiDAR tiling...');
            console.log('🔧 Current session ID:', this.currentLidarSessionId);
            
            if (!this.currentLidarSessionId) {
                console.error('❌ No active LiDAR session to pause');
                return;
            }
            
            // Update UI state
            if (this.statusUI && this.statusUI.updateLidarButtonState) {
                this.statusUI.updateLidarButtonState('paused', 0, 'Paused');
            }
            
            // Call backend pause endpoint with session_id
            const apiBaseUrl = this.statusManager.apiBaseUrl || '/api/v1';
            const requestData = { session_id: this.currentLidarSessionId };
            console.log('📡 Sending pause request:', requestData);
            
            const response = await fetch(`${apiBaseUrl}/discovery/pause-lidar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });
            
            console.log('📡 Pause response status:', response.status);
            
            if (response.ok) {
                const result = await response.json();
                console.log('✅ LiDAR tiling paused:', result);
            } else {
                const errorText = await response.text();
                console.error('❌ Pause request failed:', response.status, errorText);
                throw new Error(`Failed to pause: ${response.statusText}`);
            }
            
        } catch (error) {
            console.error('❌ Failed to pause LiDAR tiling:', error);
        }
    }
    
    /**
     * Resume LiDAR tiling session
     */
    async resumeLidarScan() {
        if (!this.isScanning || !this.currentLidarSessionId) {
            console.log('⚠️ No paused LiDAR session to resume');
            return;
        }
        
        try {
            console.log('▶️ Resuming LiDAR tiling...');
            console.log('🔧 Current session ID:', this.currentLidarSessionId);
            
            if (!this.currentLidarSessionId) {
                console.error('❌ No active LiDAR session to resume');
                return;
            }
            
            // Update UI state
            if (this.statusUI && this.statusUI.updateLidarButtonState) {
                this.statusUI.updateLidarButtonState('running', 0, 'Resuming...');
            }
            
            // Call backend resume endpoint with session_id
            const apiBaseUrl = this.statusManager.apiBaseUrl || '/api/v1';
            const requestData = { session_id: this.currentLidarSessionId };
            console.log('📡 Sending resume request:', requestData);
            
            const response = await fetch(`${apiBaseUrl}/discovery/resume-lidar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });
            
            console.log('📡 Resume response status:', response.status);
            
            if (response.ok) {
                const result = await response.json();
                console.log('✅ LiDAR tiling resumed:', result);
            } else {
                const errorText = await response.text();
                console.error('❌ Resume request failed:', response.status, errorText);
                throw new Error(`Failed to resume: ${response.statusText}`);
            }
            
        } catch (error) {
            console.error('❌ Failed to resume LiDAR tiling:', error);
        }
    }

    /**
     * Stop LiDAR tiling session
     */
    async stopLidarScan() {
        if (!this.currentLidarSessionId) {
            console.log('⚠️ No active LiDAR session to stop');
            return;
        }
        
        try {
            console.log('⏹️ Stopping LiDAR tiling...');
            console.log('🔧 Current session ID:', this.currentLidarSessionId);
            
            // Update UI state
            if (this.statusUI && this.statusUI.updateLidarButtonState) {
                this.statusUI.updateLidarButtonState('stopping', 0, 'Stopping...');
            }
            
            // Call backend stop endpoint with session_id
            const apiBaseUrl = this.statusManager.apiBaseUrl || '/api/v1';
            const requestData = { session_id: this.currentLidarSessionId };
            console.log('📡 Sending stop request:', requestData);
            
            const response = await fetch(`${apiBaseUrl}/discovery/stop-lidar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });
            
            console.log('📡 Stop response status:', response.status);
            
            if (response.ok) {
                const result = await response.json();
                console.log('✅ LiDAR tiling stopped:', result);
                
                // Clear session
                this.currentLidarSessionId = null;
                this.isScanning = false;
                
                // Update UI
                if (this.statusUI && this.statusUI.updateLidarButtonState) {
                    this.statusUI.updateLidarButtonState('idle', 0, 'Stopped');
                }
                
                this.updateButtonStates();
            } else {
                const errorText = await response.text();
                console.error('❌ Stop request failed:', response.status, errorText);
                throw new Error(`Failed to stop: ${response.statusText}`);
            }
            
        } catch (error) {
            console.error('❌ Failed to stop LiDAR tiling:', error);
            
            // Force reset UI on error
            this.currentLidarSessionId = null;
            this.isScanning = false;
            if (this.statusUI && this.statusUI.updateLidarButtonState) {
                this.statusUI.updateLidarButtonState('idle', 0, 'Error');
            }
            this.updateButtonStates();
        }
    }

    calculateRadius() {
        if (!this.selectedArea) return 2; // Default 2km
        
        const bounds = this.selectedArea.bounds;
        const latDiff = Math.abs(bounds[0][0] - bounds[1][0]);
        const lonDiff = Math.abs(bounds[0][1] - bounds[1][1]);
        
        // Convert degrees to km (approximate)
        const latKm = latDiff * 111.32; // 1 degree lat ≈ 111.32 km
        const lonKm = lonDiff * 111.32 * Math.cos(bounds[0][0] * Math.PI / 180);
        
        return Math.max(latKm, lonKm) / 2; // Radius is half the max dimension
    }

    clearResults() {
        // Clear patches
        if (this.mapVisualization && this.mapVisualization.clearPatches) {
            this.mapVisualization.clearPatches();
        }
        
        // Clear selected area
        if (this.selectedArea && this.selectedArea.rectangle) {
            this.mapInstance.removeLayer(this.selectedArea.rectangle);
        }
        this.selectedArea = null;
        
        // Reset scanning state
        this.isScanning = false;
        
        // Clear data
        this.patches.clear();
        this.updateButtonStates();
        
        console.log('🧹 Cleared');
    }

    updateButtonStates() {
        const startBtn = document.getElementById('startScanBtn');
        const stopBtn = document.getElementById('stopScanBtn');
        
        const isConnected = this.statusManager?.isConnected() || false;
        
        if (startBtn) {
            startBtn.disabled = this.isScanning || !isConnected;
        }
        if (stopBtn) {
            stopBtn.disabled = !this.isScanning;
        }
    }

    /**
     * Lock the scan area during active scanning
     */
    lockScanArea() {
        if (this.selectedArea) {
            this.selectedArea.isLocked = true;
            this.refreshSelectionRectangle();
            console.log('🔒 Scan area locked for tiling session');
        }
    }

    /**
     * Unlock the scan area after scanning completes
     */
    unlockScanArea() {
        if (this.selectedArea) {
            this.selectedArea.isLocked = false;
            this.refreshSelectionRectangle();
            console.log('🔓 Scan area unlocked - ready for new selection');
        }
    }

    /**
     * Force reset scanning state (for debugging stuck states)
     */
    forceResetScanningState() {
        console.log('🔄 Force resetting scanning state...');
        this.isScanning = false;
        this.unlockScanArea();
        this.updateButtonStates();
        console.log('✅ Scanning state reset complete');
    }

    // Setup compact control events integration
    setupCompactControlEvents() {
        if (!this.mapManager) return;
        
        // Detection events only (LiDAR events removed)
        this.mapManager.on('scanStart', () => {
            console.log('� Detection started from compact control');
            this.startScan();
        });
        
        // Detection scan events
        this.mapManager.on('scanPause', () => {
            console.log('🔍 Detection scan paused from compact control');
            this.stopScan(); // Use existing stop method for pause
        });
        
        this.mapManager.on('scanResume', () => {
            console.log('🔍 Detection scan resumed from compact control');
            this.startScan(); // Use existing start method for resume
        });
        
        this.mapManager.on('scanStop', () => {
            console.log('🔍 Detection scan stopped from compact control');
            this.stopScan();
        });
        
        // Area selection from compact controls
        this.mapManager.on('areaSelected', (bounds) => {
            const centerLat = (bounds.north + bounds.south) / 2;
            const centerLon = (bounds.east + bounds.west) / 2;
            if (!this.isScanning && (!this.selectedArea || !this.selectedArea.isLocked)) {
                this.selectScanArea(centerLat, centerLon);
            }
        });
    }
}

// Initialize when DOM ready
document.addEventListener('DOMContentLoaded', async () => {
    try {
        window.app = new UnifiedREArchaeologyApp();
        await window.app.init();
    } catch (error) {
        console.error('Failed to start app:', error);
    }
});

// Cleanup on page unload to prevent map reinitialization errors
window.addEventListener('beforeunload', () => {
    if (window.app && window.app.mapVisualization) {
        try {
            window.app.mapVisualization.destroy();
        } catch (error) {
            console.warn('Error during cleanup:', error);
        }
    }
});

// Also handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden && window.app && window.app.mapVisualization) {
        console.log('🔄 Page hidden, preparing for potential reload...');
    }
});

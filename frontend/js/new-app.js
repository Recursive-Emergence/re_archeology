/**
 * RE-Archaeology Application
 * Clean, streamlined implementation focused on LiDAR scanning with proper resolution detection
 */

class REArchaeologyApp {
    constructor() {
        // Core components
        this.map = null;
        this.mapVisualization = null;
        this.websocket = null;
        
        // Scan state
        this.scanAreaRectangle = null;
        this.scanAreaLabel = null;
        this.selectedArea = null;
        this.isScanning = false;
        
        // Session management
        this.currentLidarSession = null;
        
        // UI elements
        this.scanningIcon = null;
        this.resolutionBadge = null;
        this.satelliteBeam = null;
        
        // Animation state
        this.animationState = null;
        
        // Data layers
        this.layers = {
            patches: null,
            detections: null,
            animations: null
        };
        this.patches = new Map();
        
        window.Logger?.app('info', 'RE-Archaeology App initialized');
    }

    // ========================================
    // INITIALIZATION
    // ========================================

    async init() {
        try {
            window.Logger?.app('info', 'Starting application initialization...');
            
            await this.waitForDOM();
            this.initializeMap();
            this.initializeLayers();
            this.setupDefaultScanArea();
            this.setupEventListeners();
            this.updateScanButtonText(false);
            
            window.Logger?.app('info', 'Application initialized successfully');
            
        } catch (error) {
            console.error('❌ Application initialization failed:', error);
            throw error;
        }
    }

    async waitForDOM() {
        if (document.readyState !== 'complete') {
            await new Promise(resolve => {
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', resolve);
                } else {
                    resolve();
                }
            });
        }
    }

    initializeMap() {
        window.Logger?.map('info', 'Initializing map...');
        
        const container = document.getElementById('mapContainer');
        if (!container) {
            throw new Error('Map container not found');
        }

        // Clean up existing map
        this.cleanupExistingMap(container);
        
        // Ensure container has dimensions
        container.style.cssText = 'width: 100%; height: 100vh; min-height: 100vh;';
        container.offsetHeight; // Force layout
        
        if (!container.offsetWidth || !container.offsetHeight) {
            throw new Error('Map container has no dimensions');
        }

        // Create Leaflet map
        this.map = L.map(container, {
            center: [52.4751, 4.8156],
            zoom: 13,
            zoomControl: true,
            attributionControl: true
        });

        this.addBaseLayers();
        this.setupMapEvents();
        
        console.log('✅ Map initialization complete');
    }

    cleanupExistingMap(container) {
        if (container._leaflet_id) {
            if (container._leaflet_map?.remove) {
                container._leaflet_map.remove();
            }
            while (container.firstChild) {
                container.removeChild(container.firstChild);
            }
            delete container._leaflet_id;
            delete container._leaflet_map;
        }
    }

    addBaseLayers() {
        // Satellite layer (default)
        const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles © Esri',
            maxZoom: 19
        }).addTo(this.map);
        
        // Street layer
        const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        });
        
        // Terrain layer
        const terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenTopoMap contributors',
            maxZoom: 17
        });

        // Layer control
        L.control.layers({
            '🛰️ Satellite': satellite,
            '🗺️ Street': street,
            '🏔️ Terrain': terrain
        }, {}, {
            position: 'topright',
            collapsed: false
        }).addTo(this.map);

        // Scale control
        L.control.scale({
            position: 'bottomleft',
            imperial: false
        }).addTo(this.map);
    }

    initializeLayers() {
        console.log('🔧 Initializing layer groups...');
        
        this.layers.patches = L.layerGroup().addTo(this.map);
        this.layers.detections = L.layerGroup().addTo(this.map);
        this.layers.animations = L.layerGroup().addTo(this.map);
    }

    setupMapEvents() {
        // Ctrl+Click for scan area selection
        this.map.on('click', (e) => {
            if (e.originalEvent.ctrlKey && !this.isScanning) {
                console.log('🎯 Ctrl+Click detected, setting scan area');
                this.selectScanArea(e.latlng.lat, e.latlng.lng);
            }
        });
    }

    setupDefaultScanArea() {
        this.selectScanArea(52.4751, 4.8156, 1.0);
    }

    setupEventListeners() {
        document.getElementById('startLidarScanBtn')?.addEventListener('click', () => this.startLidarScan());
        document.getElementById('stopLidarScanBtn')?.addEventListener('click', () => this.stopLidarScan());
        document.getElementById('clearLidarScanBtn')?.addEventListener('click', () => this.clearLidarScan());
        
        document.getElementById('enableDetection')?.addEventListener('change', (e) => {
            this.updateScanButtonText(e.target.checked);
        });
    }

    // ========================================
    // SCAN AREA MANAGEMENT
    // ========================================

    selectScanArea(lat, lon, radiusKm = 1) {
        console.log('🎯 Setting scan area:', { lat, lon, radiusKm });
        
        // Clear existing area
        if (this.scanAreaRectangle) {
            this.map.removeLayer(this.scanAreaRectangle);
        }
        if (this.scanAreaLabel) {
            this.map.removeLayer(this.scanAreaLabel);
        }

        // Calculate bounds
        const bounds = this.calculateAreaBounds(lat, lon, radiusKm);
        
        // Create rectangle
        this.scanAreaRectangle = L.rectangle(bounds, {
            color: '#00ff88',
            weight: this.calculateOptimalBorderWeight(),
            fillOpacity: 0,
            fill: false,
            opacity: 0.9,
            interactive: false
        }).addTo(this.map);

        // Add scan area label
        const scanLabel = L.marker([lat, lon], {
            icon: L.divIcon({
                className: 'scan-area-label',
                html: `<div style="
                    background: rgba(0, 0, 0, 0.8); 
                    color: #00ff88; 
                    padding: 4px 8px; 
                    border-radius: 12px; 
                    font-size: 11px; 
                    font-weight: 600;
                    border: 1px solid #00ff88;
                    backdrop-filter: blur(4px);
                    white-space: nowrap;
                    transform: translateY(-10px);
                ">📡 Scan Area (${radiusKm}km)</div>`,
                iconSize: [80, 20],
                iconAnchor: [40, 10]
            }),
            interactive: false
        }).addTo(this.map);
        
        // Store label reference
        this.scanAreaLabel = scanLabel;

        // Update border on zoom
        const updateBorder = () => {
            if (this.scanAreaRectangle) {
                this.scanAreaRectangle.setStyle({ 
                    weight: this.calculateOptimalBorderWeight(),
                    color: '#00ff88',
                    opacity: 0.9 
                });
            }
        };
        
        this.map.off('zoomend', this.updateScanAreaBorder);
        this.map.on('zoomend', updateBorder);
        this.updateScanAreaBorder = updateBorder;

        // Store area data
        this.selectedArea = { lat, lon, radius: radiusKm, bounds };
        this.updateButtonStates();
    }

    calculateAreaBounds(lat, lon, radiusKm) {
        const radiusInDegreesLat = radiusKm / 111.32;
        const radiusInDegreesLon = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
        
        return [
            [lat - radiusInDegreesLat, lon - radiusInDegreesLon],
            [lat + radiusInDegreesLat, lon + radiusInDegreesLon]
        ];
    }

    calculateOptimalBorderWeight() {
        const zoom = this.map.getZoom();
        if (zoom >= 16) return 3;
        if (zoom >= 14) return 2.5;
        if (zoom >= 12) return 2;
        return 1.5;
    }

    zoomToScanArea() {
        if (!this.selectedArea?.bounds) {
            console.warn('⚠️ No scan area selected for zooming');
            return;
        }

        const bounds = L.latLngBounds(this.selectedArea.bounds);
        this.map.fitBounds(bounds, {
            padding: [50, 50],
            maxZoom: 16,
            animate: true,
            duration: 1.0
        });
    }

    // ========================================
    // LIDAR SCANNING
    // ========================================

    async startLidarScan() {
        if (!this.selectedArea) {
            alert('Please select a scan area first by Ctrl+clicking on the map.');
            return;
        }

        const enableDetection = document.getElementById('enableDetection')?.checked || false;
        const structureType = document.getElementById('structureType')?.value || 'windmill';
        
        console.log('🛰️ Starting LiDAR scan:', { enableDetection, structureType });

        try {
            // Zoom to area and start UI
            this.zoomToScanArea();
            
            setTimeout(async () => {
                const config = this.buildScanConfig(enableDetection, structureType);
                
                // Start scan UI with initial estimate
                this.startScanUI();
                
                // Start backend scan
                const result = await this.startBackendScan(config);
                this.currentLidarSession = result.session_id;
                
                // Update with actual resolution from backend
                if (result.actual_resolution) {
                    this.updateResolutionDisplay(result.actual_resolution);
                    this.updateAnimationForResolution(result.actual_resolution, result.is_high_resolution);
                }
                
                this.connectWebSocket();
                console.log('✅ LiDAR scan started successfully');
                
            }, 500);
            
        } catch (error) {
            console.error('❌ Failed to start LiDAR scan:', error);
            alert('Failed to start LiDAR scan: ' + error.message);
            this.cleanupAfterStop();
        }
    }

    buildScanConfig(enableDetection, structureType) {
        const scanParams = this.calculateScanParameters();
        
        return {
            center_lat: this.selectedArea.lat,
            center_lon: this.selectedArea.lon,
            radius_km: this.selectedArea.radius,
            tile_size_m: scanParams.tileSize,
            heatmap_mode: true,
            streaming_mode: true,
            prefer_high_resolution: scanParams.requestHighRes,
            enable_detection: enableDetection,
            structure_type: structureType
        };
    }

    calculateScanParameters() {
        const zoomLevel = this.map.getZoom();
        const areaKm = this.selectedArea.radius;
        
        // Initial estimates - will be corrected by backend actual_resolution
        if (zoomLevel >= 16 || areaKm <= 0.5) {
            return { tileSize: 32, requestHighRes: true };
        } else if (zoomLevel >= 14 || areaKm <= 2) {
            return { tileSize: 64, requestHighRes: false };
        } else {
            return { tileSize: 128, requestHighRes: false };
        }
    }

    async startBackendScan(config) {
        const response = await fetch(`${window.AppConfig.apiBase}/discovery/lidar-scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Backend scan failed: ${response.statusText} - ${errorText}`);
        }
        
        return await response.json();
    }

    async stopLidarScan() {
        console.log('🛑 Stopping LiDAR scan...');
        
        try {
            if (this.currentLidarSession) {
                await this.stopLidarSession();
            }
            
            if (this.mapVisualization) {
                this.mapVisualization.disableHeatmapMode();
            }
            
        } catch (error) {
            console.error('❌ Failed to stop LiDAR scan:', error);
        } finally {
            this.cleanupAfterStop();
        }
    }

    async stopLidarSession() {
        if (!this.currentLidarSession) return;
        
        const response = await fetch(`${window.AppConfig.apiBase}/discovery/stop/${this.currentLidarSession}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('✅ LiDAR session stopped:', result.message);
        }
    }

    async clearLidarScan() {
        console.log('🧹 Clearing LiDAR scan results...');
        
        await this.stopLidarScan();
        
        // Clear visualization
        if (this.mapVisualization) {
            this.mapVisualization.clearElevationData();
            this.mapVisualization.clearLidarHeatmap();
        }
        
        // Clear layers
        Object.values(this.layers).forEach(layer => layer.clearLayers());
        this.patches.clear();
        
        // Reset sessions
        this.currentLidarSession = null;
    }

    // ========================================
    // UI MANAGEMENT
    // ========================================

    startScanUI() {
        // Start scanning animation without resolution badge
        this.startScanningAnimation('satellite'); // Conservative default
        this.updateLidarScanButtonStates(true);
        
        // Lock scan area
        if (this.scanAreaRectangle) {
            this.scanAreaRectangle.setStyle({
                color: '#00ff88',
                weight: this.calculateOptimalBorderWeight(),
                interactive: false
            });
        }
        
        // Initialize visualization
        this.initializeMapVisualization();
        if (this.mapVisualization) {
            this.mapVisualization.enableHeatmapMode();
        }
    }

    cleanupAfterStop() {
        this.isScanning = false;
        this.currentLidarSession = null;
        this.stopScanningAnimation();
        this.updateButtonStates();
        
        // Reset scan area
        if (this.scanAreaRectangle) {
            this.scanAreaRectangle.setStyle({
                color: '#00ff88',
                weight: this.calculateOptimalBorderWeight(),
                interactive: false
            });
        }
    }

    updateScanButtonText(detectionEnabled) {
        const scanButton = document.getElementById('startLidarScanBtn');
        if (scanButton) {
            scanButton.textContent = detectionEnabled ? 'Scan & Detect' : 'Scan';
        }
    }

    updateLidarScanButtonStates(isRunning) {
        const startBtn = document.getElementById('startLidarScanBtn');
        const stopBtn = document.getElementById('stopLidarScanBtn');
        
        if (startBtn && stopBtn) {
            startBtn.disabled = isRunning || !this.selectedArea;
            stopBtn.disabled = !isRunning;
            
            if (isRunning) {
                startBtn.textContent = 'Scanning...';
            } else {
                const enableDetection = document.getElementById('enableDetection')?.checked || false;
                this.updateScanButtonText(enableDetection);
            }
        }
    }

    updateButtonStates() {
        this.updateLidarScanButtonStates(this.currentLidarSession !== null);
    }

    // ========================================
    // RESOLUTION DETECTION & ANIMATION
    // ========================================

    updateResolutionDisplay(actualResolution) {
        if (actualResolution && actualResolution !== 'Determining...') {
            // Just log the resolution, don't show badge
            console.log(`📊 LiDAR resolution detected: ${actualResolution}`);
        }
    }

    updateAnimationForResolution(actualResolution, isHighResolution = null) {
        if (!this.animationState || !actualResolution) return;
        
        // Use backend-provided flag as the single source of truth
        const isHighRes = isHighResolution !== null ? isHighResolution : false; // Conservative fallback
        const newIconType = isHighRes ? 'airplane' : 'satellite';
        
        console.log(`🔄 Resolution update: "${actualResolution}" -> ${isHighRes ? 'HIGH-RES' : 'LOW-RES'} -> ${newIconType.toUpperCase()}`);
        console.log(`   - Backend provided is_high_resolution: ${isHighResolution}`);
        
        if (this.animationState.iconType !== newIconType) {
            console.log(`🔄 Switching icon from ${this.animationState.iconType} to ${newIconType}`);
            
            this.animationState.iconType = newIconType;
            this.animationState.actualResolution = actualResolution;
            
            // Update the visual icon immediately
            if (this.scanningIcon) {
                this.scanningIcon.innerHTML = isHighRes ? '✈️' : '🛰️';
                this.scanningIcon.className = `scanning-icon ${newIconType}`;
                this.scanningIcon.style.fontSize = isHighRes ? '32px' : '28px';
            }
        }
    }

    /**
     * This method is no longer used - backend provides the authoritative is_high_resolution flag
     * Keeping for backward compatibility only
     */
    isHighResolutionData(actualResolution) {
        console.log(`⚠️ Using fallback resolution detection - backend should provide is_high_resolution flag`);
        return false; // Always default to satellite when backend flag is missing
    }

    // ========================================
    // ANIMATION SYSTEM
    // ========================================

    startScanningAnimation(iconType = 'satellite') {
        this.stopScanningAnimation();
        
        console.log(`🛰️ Starting ${iconType} static animation`);
        
        // Create static icon positioned at top-center of map
        const scanIcon = document.createElement('div');
        scanIcon.className = `scanning-icon ${iconType}`;
        scanIcon.innerHTML = iconType === 'airplane' ? '✈️' : '🛰️';
        scanIcon.style.cssText = `
            position: absolute;
            top: 15px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 1500;
            pointer-events: none;
            font-size: ${iconType === 'airplane' ? '32px' : '28px'};
            filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 8px rgba(0, 255, 136, 0.6));
            transition: all 0.3s ease;
            opacity: 1;
            background: transparent;
            padding: 8px;
            border-radius: 0;
            border: none;
            box-shadow: none;
        `;
        
        this.map.getContainer().appendChild(scanIcon);
        this.scanningIcon = scanIcon;
        
        // Initialize animation state
        this.animationState = {
            tileCount: 0,
            startTime: Date.now(),
            isActive: true,
            iconType: iconType,
            isProcessingTile: false
        };
        
        // Start subtle idle animation
        this.startIdleAnimation(scanIcon);
    }

    startIdleAnimation(iconElement) {
        const pulseAnimation = () => {
            if (!this.scanningIcon || !this.animationState?.isActive) return;
            
            // Gentle pulsing when idle
            if (!this.animationState.isProcessingTile) {
                iconElement.style.transform = 'translateX(-50%) scale(1.1)';
                iconElement.style.opacity = '0.9';
                
                setTimeout(() => {
                    if (this.scanningIcon && this.animationState?.isActive) {
                        iconElement.style.transform = 'translateX(-50%) scale(1)';
                        iconElement.style.opacity = '0.8';
                    }
                }, 800);
            }
            
            if (this.animationState?.isActive) {
                setTimeout(pulseAnimation, 2000);
            }
        };
        
        setTimeout(pulseAnimation, 1000);
    }

    animateScanningIcon(iconElement) {
        // This method is now replaced by the simpler startIdleAnimation
        // Keep for backward compatibility but redirect to idle animation
        this.startIdleAnimation(iconElement);
    }

    stopScanningAnimation() {
        if (this.animationState) {
            this.animationState.isActive = false;
        }
        
        if (this.scanningIcon) {
            this.scanningIcon.style.opacity = '0';
            setTimeout(() => {
                if (this.scanningIcon && this.scanningIcon.parentNode) {
                    this.scanningIcon.parentNode.removeChild(this.scanningIcon);
                }
            }, 200);
            this.scanningIcon = null;
        }
        
        // Clean up orphaned icons
        const mapContainer = this.map?.getContainer();
        if (mapContainer) {
            const orphanedIcons = mapContainer.querySelectorAll('.scanning-icon');
            orphanedIcons.forEach(icon => {
                if (icon.parentNode) icon.parentNode.removeChild(icon);
            });
        }
        
        this.clearSatelliteBeam();
        this.animationState = null;
    }

    updateAnimationProgress(tileData) {
        if (!this.animationState?.isActive) return;
        
        this.animationState.tileCount++;
        
        // Extract tile center
        let tileCenterLat, tileCenterLon;
        if (tileData?.tile_bounds) {
            const bounds = tileData.tile_bounds;
            tileCenterLat = (bounds.north + bounds.south) / 2;
            tileCenterLon = (bounds.east + bounds.west) / 2;
        } else if (tileData?.center_lat && tileData?.center_lon) {
            tileCenterLat = tileData.center_lat;
            tileCenterLon = tileData.center_lon;
        }
        
        if (tileCenterLat && tileCenterLon) {
            this.animationState.isProcessingTile = true;
            this.drawSatelliteBeam(L.latLng(tileCenterLat, tileCenterLon));
            
            // Blink the icon when processing
            if (this.scanningIcon) {
                this.scanningIcon.classList.add('processing');
                this.scanningIcon.style.transform = 'translateX(-50%) scale(1.3)';
                this.scanningIcon.style.filter = 'drop-shadow(0 3px 6px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 15px rgba(255, 255, 255, 1))';
            }
            
            // Clear after delay
            setTimeout(() => {
                this.clearSatelliteBeam();
                this.animationState.isProcessingTile = false;
                
                if (this.scanningIcon) {
                    this.scanningIcon.classList.remove('processing');
                    this.scanningIcon.style.transform = 'translateX(-50%) scale(1)';
                    this.scanningIcon.style.filter = 'drop-shadow(0 3px 6px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 8px rgba(0, 255, 136, 0.6))';
                }
            }, 1200);
        }
    }

    drawSatelliteBeam(targetLatLng) {
        if (!this.map || !this.scanningIcon || !targetLatLng) return;
        
        if (this.satelliteBeam) {
            this.map.removeLayer(this.satelliteBeam);
        }
        
        // Get icon position from its fixed location at top-center
        const mapContainer = this.map.getContainer();
        
        // Icon is positioned at top: 15px, left: 50% (center)
        const iconCenterX = mapContainer.offsetWidth / 2;
        const iconCenterY = 15 + 25; // top + padding/icon height estimate
        
        const iconLatLng = this.map.containerPointToLatLng([iconCenterX, iconCenterY]);
        
        this.satelliteBeam = L.polyline([iconLatLng, targetLatLng], {
            color: '#00ff88',
            weight: 4,
            opacity: 0.9,
            dashArray: '10, 6',
            interactive: false,
            className: 'lidar-beam'
        }).addTo(this.map);
        
        // Add pulsing animation to the beam
        if (this.satelliteBeam) {
            const beamElement = this.satelliteBeam.getElement();
            if (beamElement) {
                beamElement.style.animation = 'pulse-beam 0.8s ease-in-out infinite alternate';
                beamElement.style.filter = 'drop-shadow(0 0 4px rgba(0, 255, 136, 0.6))';
            }
        }
    }

    clearSatelliteBeam() {
        if (this.satelliteBeam) {
            this.map.removeLayer(this.satelliteBeam);
            this.satelliteBeam = null;
        }
    }

    // ========================================
    // RESOLUTION BADGE
    // ========================================

    showResolutionBadge(resolution) {
        this.hideResolutionBadge();
        
        const badge = document.createElement('div');
        badge.className = 'lidar-resolution-badge';
        badge.innerHTML = `LiDAR: ${resolution}`;
        
        this.map.getContainer().appendChild(badge);
        this.resolutionBadge = badge;
    }

    hideResolutionBadge() {
        if (this.resolutionBadge) {
            this.resolutionBadge.remove();
            this.resolutionBadge = null;
        }
    }

    // ========================================
    // WEBSOCKET & MESSAGE HANDLING
    // ========================================

    connectWebSocket() {
        try {
            const wsUrl = `ws://${window.location.host}/api/v1/ws/discovery`;
            console.log('🔌 Connecting to WebSocket:', wsUrl);
            this.websocket = new WebSocket(wsUrl);
            
            this.websocket.onopen = () => {
                console.log('✅ WebSocket connected');
            };
            
            this.websocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (error) {
                    console.error('❌ Failed to parse WebSocket message:', error);
                }
            };
            
            this.websocket.onclose = () => {
                console.log('🔌 WebSocket disconnected');
                this.websocket = null;
                
                // Reconnect if session active
                if (this.currentLidarSession) {
                    setTimeout(() => this.connectWebSocket(), 3000);
                }
            };
            
            this.websocket.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
            };
            
        } catch (error) {
            console.error('❌ Failed to connect WebSocket:', error);
        }
    }

    handleWebSocketMessage(data) {
        // Use logger for reduced console noise
        if (window.Logger) {
            window.Logger.websocket('debug', `Message received: ${data.type}`, { keys: Object.keys(data) });
            
            if (data.type === 'lidar_tile') {
                window.Logger.lidar('debug', 'Tile data', {
                    actual_resolution: data.actual_resolution,
                    is_high_resolution: data.is_high_resolution,
                    source_dataset: data.source_dataset
                });
            }
        }
        
        switch (data.type) {
            case 'lidar_tile':
                window.Logger?.lidar('debug', 'Processing tile update');
                this.handleLidarTileUpdate(data);
                break;
                
            case 'lidar_heatmap_tile':
                this.handleLidarHeatmapTileUpdate(data);
                break;
                
            case 'lidar_progress':
                this.handleLidarProgressUpdate(data);
                break;
                
            case 'session_completed':
            case 'session_complete':
            case 'lidar_completed':
                this.handleSessionComplete(data);
                break;
                
            case 'session_stopped':
                this.handleSessionStopped(data);
                break;
                
            case 'session_failed':
            case 'lidar_error':
                this.handleSessionFailed(data);
                break;
                
            case 'error':
                console.error('❌ WebSocket error:', data.message);
                break;
                
            default:
                console.log('📨 Unknown message type:', data.type);
        }
    }

    handleLidarTileUpdate(data) {
        // Use logger for reduced console noise
        if (window.Logger) {
            window.Logger.lidar('debug', 'Tile update', {
                tile_id: data.tile_id,
                actual_resolution: data.actual_resolution,
                is_high_resolution: data.is_high_resolution,
                has_animation_state: !!this.animationState
            });
        }
        
        // Update resolution on first tile
        if (data.actual_resolution && !this.animationState?.actualResolution) {
            window.Logger?.lidar('info', `First tile resolution: ${data.actual_resolution} (high_res: ${data.is_high_resolution})`);
            this.updateResolutionDisplay(data.actual_resolution);
            this.updateAnimationForResolution(data.actual_resolution, data.is_high_resolution);
        } else if (!data.actual_resolution) {
            window.Logger?.lidar('warn', 'No actual_resolution in tile data');
        }
        
        this.updateAnimationProgress(data);
        
        if (this.mapVisualization?.heatmapMode) {
            this.mapVisualization.addLidarHeatmapTile(data);
        }
    }

    handleLidarHeatmapTileUpdate(data) {
        console.log('🔥 LiDAR heatmap tile update');
        
        // Update resolution on first tile
        if (data.tile_data?.actual_resolution && !this.animationState?.actualResolution) {
            console.log(`🔄 Processing heatmap resolution: ${data.tile_data.actual_resolution}`);
            this.updateResolutionDisplay(data.tile_data.actual_resolution);
            this.updateAnimationForResolution(data.tile_data.actual_resolution, data.tile_data.is_high_resolution);
        }
        
        if (data.tile_data) {
            this.updateAnimationProgress(data.tile_data);
        }
        
        if (this.mapVisualization?.heatmapMode && data.tile_data) {
            this.mapVisualization.addLidarHeatmapTile(data.tile_data);
        }
    }

    handleLidarProgressUpdate(data) {
        console.log('📊 LiDAR progress update');
        
        // Update resolution if available
        if (data.actual_resolution && !this.animationState?.actualResolution) {
            this.updateResolutionDisplay(data.actual_resolution);
            this.updateAnimationForResolution(data.actual_resolution, data.is_high_resolution);
        }
        
        // Log progress
        if (data.session_id === this.currentLidarSession) {
            const progress = data.progress_percent || 0;
            console.log(`📊 Scan progress: ${progress.toFixed(1)}%`);
        }
    }

    handleSessionComplete(data) {
        console.log('✅ Session completed:', data.session_id);
        
        if (data.session_id === this.currentLidarSession) {
            this.currentLidarSession = null;
            this.stopScanningAnimation();
        }
    }

    handleSessionStopped(data) {
        console.log('🛑 Session stopped:', data.session_id);
        
        if (data.session_id === this.currentLidarSession) {
            this.currentLidarSession = null;
            this.cleanupAfterStop();
        }
    }

    handleSessionFailed(data) {
        console.log('❌ Session failed:', data.session_id);
        
        if (data.session_id === this.currentLidarSession) {
            this.currentLidarSession = null;
            this.cleanupAfterStop();
            alert('LiDAR scan failed: ' + (data.message || 'Unknown error'));
        }
    }

    // ========================================
    // MAP VISUALIZATION
    // ========================================

    initializeMapVisualization() {
        if (window.MapVisualization) {
            try {
                this.mapVisualization = new window.MapVisualization(this.map);
                console.log('✅ MapVisualization initialized');
            } catch (error) {
                console.error('❌ Failed to initialize MapVisualization:', error);
                this.mapVisualization = null;
            }
        } else {
            console.warn('⚠️ MapVisualization not available');
        }
    }
}

// ========================================
// APPLICATION STARTUP
// ========================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('🌟 Starting RE-Archaeology Framework...');
        
        window.reApp = new REArchaeologyApp();
        await window.reApp.init();
        
        console.log('🎉 Application started successfully!');
        
    } catch (error) {
        console.error('💥 Application startup failed:', error);
        
        document.body.innerHTML = `
            <div style="padding: 40px; text-align: center; font-family: Arial, sans-serif;">
                <h1 style="color: #dc3545;">⚠️ Application Error</h1>
                <p>Failed to initialize the RE-Archaeology application.</p>
                <p><strong>Error:</strong> ${error.message}</p>
                <p>Please refresh the page or contact support.</p>
                <button onclick="location.reload()" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    🔄 Reload Page
                </button>
            </div>
        `;
    }
});

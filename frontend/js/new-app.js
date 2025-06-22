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
        
        // Authentication state
        this.currentUser = null;
        this.accessToken = null;
        
        // UI elements
        this.scanningIcon = null;
        this.resolutionBadge = null;
        this.satelliteBeam = null;
        
        // Animation state
        this.animationState = null;
        
        // Detection UX state (pure frontend animation)
        this.detectionActive = false;
        this.detectionLens = null;
        this.detectionOverlay = null;
        this.detectionStepSize = 2; // Default 2 meters per step (customizable: 1m, 2m, etc.)
        this.detectionStepInterval = 800; // Slower 800ms between steps for better visibility
        
        // Current scanning position
        this.currentScanPosition = { row: 0, col: 0 };
        this.scanGrid = null;
        this.scanAnimationId = null;
        
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

            // Parse URL for lat/lon params and center if present
            this.handleUrlCoordinates();

            this.setupDefaultScanArea();
            this.setupEventListeners();
            // Set initial scan button text based on the default checkbox state
            const enableDetection = document.getElementById('enableDetection')?.checked || false;
            this.updateScanButtonText(enableDetection);
            // Initialize detection overlay
            this.initializeDetectionOverlay();
            // Initialize authentication
            await this.initializeAuth();
            window.Logger?.app('info', 'Application initialized successfully');
        } catch (error) {
            console.error('❌ Application initialization failed:', error);
            throw error;
        }
    }

    // Handle URL lat/lon params and browser navigation
    handleUrlCoordinates() {
        const params = new URLSearchParams(window.location.search);
        const lat = parseFloat(params.get('lat'));
        const lon = parseFloat(params.get('lon'));
        const valid = !isNaN(lat) && !isNaN(lon);
        if (valid) {
            this.selectScanArea(lat, lon, 1.0);
            this.map.setView([lat, lon], 13, { animate: true });
        }
        // Listen for browser navigation (back/forward)
        window.addEventListener('popstate', () => {
            const params = new URLSearchParams(window.location.search);
            const lat = parseFloat(params.get('lat'));
            const lon = parseFloat(params.get('lon'));
            if (!isNaN(lat) && !isNaN(lon)) {
                this.selectScanArea(lat, lon, 1.0);
                this.map.setView([lat, lon], 13, { animate: true });
            }
        });
    }

    // Update URL with new coordinates (no reload)
    updateUrlWithCoordinates(lat, lon) {
        const url = new URL(window.location.href);
        url.searchParams.set('lat', lat);
        url.searchParams.set('lon', lon);
        window.history.pushState({}, '', url);
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
        
        window.Logger?.map('info', 'Map initialization complete');
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
        window.Logger?.map('info', 'Initializing layer groups...');
        
        this.layers.patches = L.layerGroup().addTo(this.map);
        this.layers.detections = L.layerGroup().addTo(this.map);
        this.layers.animations = L.layerGroup().addTo(this.map);
    }

    setupMapEvents() {
        // Ctrl+Click for scan area selection
        this.map.on('click', (e) => {
            if (e.originalEvent.ctrlKey && !this.isScanning) {
                window.Logger?.map('info', 'Ctrl+Click detected, setting scan area');
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

        // Chat form event listener
        document.getElementById('chat-input-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleChatSubmit();
        });
    }

    // ========================================
    // MAP VISUALIZATION INITIALIZATION
    // ========================================

    initializeMapVisualization() {
        if (!this.mapVisualization && window.MapVisualization) {
            window.Logger?.app('info', 'Initializing MapVisualization...');
            this.mapVisualization = new window.MapVisualization(this.map);
            window.Logger?.app('info', 'MapVisualization initialized successfully');
        } else if (!window.MapVisualization) {
            window.Logger?.app('error', 'MapVisualization class not available');
            console.error('❌ MapVisualization class not found - scanning will not work properly');
        } else {
            window.Logger?.app('debug', 'MapVisualization already initialized');
        }
    }

    // ========================================
    // SCAN AREA MANAGEMENT
    // ========================================

    selectScanArea(lat, lon, radiusKm = 1) {
        window.Logger?.map('info', 'Setting scan area', { lat, lon, radiusKm });
        
        // Clear existing area
        if (this.scanAreaRectangle) {
            this.map.removeLayer(this.scanAreaRectangle);
        }
        if (this.scanAreaLabel) {
            this.map.removeLayer(this.scanAreaLabel);
        }

        // Calculate bounds
        const bounds = this.calculateAreaBounds(lat, lon, radiusKm);
        const radiusInDegreesLat = radiusKm / 111.32;
        
        // Create rectangle
        this.scanAreaRectangle = L.rectangle(bounds, {
            color: '#00ff88',
            weight: this.calculateOptimalBorderWeight(),
            fillOpacity: 0,
            fill: false,
            opacity: 0.9,
            interactive: false
        }).addTo(this.map);

        // Add scan area label at the bottom rim of the selected area
        const bottomRimLat = lat - radiusInDegreesLat; // Bottom edge of the scan area
        const scanLabel = L.marker([bottomRimLat, lon], {
            icon: L.divIcon({
                className: 'scan-area-label',
                html: `<div id="scan-area-label-text" style="
                    background: rgba(0, 0, 0, 0.85); 
                    color: #00ff88; 
                    padding: 6px 12px; 
                    border-radius: 16px; 
                    font-size: 11px; 
                    font-weight: 600;
                    border: 1px solid #00ff88;
                    backdrop-filter: blur(6px);
                    white-space: nowrap;
                    transform: translateY(100%);
                    text-align: center;
                    box-shadow: 0 2px 8px rgba(0, 255, 136, 0.3);
                    min-width: 120px;
                    max-width: 200px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                ">📡 Scan Area (${radiusKm}km)</div>`,
                iconSize: [200, 30],
                iconAnchor: [100, 0]
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
        // Update URL with new coordinates
        this.updateUrlWithCoordinates(lat, lon);
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

    updateScanAreaLabel(resolution = null) {
        if (!this.scanAreaLabel) return;
        
        const radiusKm = this.selectedArea?.radius || 1;
        let labelText = `📡 Scan Area (${radiusKm}km)`;
        
        if (resolution && resolution !== 'Determining...') {
            labelText += ` • Res: ${resolution} `;
        }
        
        // Update the label content
        const labelElement = document.getElementById('scan-area-label-text');
        if (labelElement) {
            labelElement.innerHTML = labelText;
        }
    }

    // ========================================
    // LIDAR SCANNING
    // ========================================

    async startLidarScan() {
        window.Logger?.lidar('info', 'Starting LiDAR scan...');
        
        if (!this.selectedArea) {
            window.Logger?.lidar('warn', 'No scan area selected');
            alert('Please select a scan area first by Ctrl+clicking on the map.');
            return;
        }

        const enableDetection = document.getElementById('enableDetection')?.checked || false;
        const structureType = document.getElementById('structureType')?.value || 'windmill';
        
        window.Logger?.lidar('info', 'Scan configuration', { enableDetection, structureType, selectedArea: this.selectedArea });
        
        console.log('🛰️ Starting LiDAR scan:', { enableDetection, structureType, selectedArea: this.selectedArea });

        try {
            // Zoom to area and start UI
            this.zoomToScanArea();
            
            setTimeout(async () => {
                window.Logger?.lidar('debug', 'Building scan configuration...');
                const config = this.buildScanConfig(enableDetection, structureType);
                window.Logger?.lidar('debug', 'Scan config built', config);
                
                // Start scan UI
                window.Logger?.lidar('debug', 'Starting scan UI...');
                this.startScanUI();
                
                // Start backend scan
                window.Logger?.lidar('info', 'Starting backend scan...');
                const result = await this.startBackendScan(config);
                window.Logger?.lidar('info', 'Backend scan started', { session_id: result.session_id });
                this.currentLidarSession = result.session_id;
                
                // Update with actual resolution from backend
                if (result.actual_resolution) {
                    this.updateResolutionDisplay(result.actual_resolution);
                    this.updateAnimationForResolution(result.actual_resolution, result.is_high_resolution);
                }
                
                console.log('🔌 Connecting WebSocket...');
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
        window.Logger?.lidar('info', 'Clearing LiDAR scan results...');
        
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
        
        // Reset scan area label to original state
        this.updateScanAreaLabel();
    }

    // ========================================
    // UI MANAGEMENT
    // ========================================

    startScanUI() {
        // Start scanning animation without resolution badge
        this.startScanningAnimation('satellite'); // Conservative default
        this.updateLidarScanButtonStates(true);
        
        // Start detection animation if enabled
        const enableDetection = document.getElementById('enableDetection')?.checked || false;
        if (enableDetection) {
            this.startDetectionAnimation();
        }
        
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
        this.stopDetectionAnimation();
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
    // DETECTION ANIMATION - PURE UX SYSTEM
    // ========================================
    //
    // This is a pure frontend UX animation system that creates a visual 
    // "sliding lens" effect moving systematically across the scan area.
    // 
    // Features:
    // - Typewriter-style movement: left-to-right, then down
    // - Configurable step size: 1m, 2m, 4m, 8m (default: 2m)
    // - Configurable speed: 100ms - 500ms intervals (default: 300ms)  
    // - Visual effects: pulse, flash, celebration on completion
    // - Structure-specific lens emojis (windmill, tower, mound, generic)
    // - No backend integration - pure visual animation
    // 
    // Usage:
    // - app.setDetectionMode('precise')  // 1m steps, 500ms interval
    // - app.setDetectionMode('standard') // 2m steps, 300ms interval  
    // - app.setDetectionMode('rapid')    // 4m steps, 150ms interval
    // - app.setDetectionMode('coarse')   // 8m steps, 100ms interval
    // 
    // Or customize directly:
    // - app.setDetectionStepSize(1.5)    // 1.5 meter steps
    // - app.setDetectionStepInterval(250) // 250ms between steps
    //
    // ========================================

    initializeDetectionOverlay() {
        this.detectionOverlay = document.getElementById('detectionOverlay');
        this.detectionProgress = document.getElementById('detectionProgress');
        this.detectionProfileText = document.getElementById('detectionProfileText');
    }

    startDetectionAnimation() {
        if (!this.detectionOverlay) {
            this.initializeDetectionOverlay();
        }

        const enableDetection = document.getElementById('enableDetection')?.checked || false;
        if (!enableDetection) return;

        this.detectionActive = true;
        
        // Show detection overlay (but hide the noisy progress text)
        this.detectionOverlay.classList.add('active');
        // Note: Removed detectionProgress.classList.add('active') to hide the text badge
        
        // Initialize scanning grid for systematic movement (pure UX)
        this.initializeScanningGrid();
        
        // Start the scanning animation (typewriter style: left-to-right, then down)
        this.startScanningMovement();
        
        window.Logger?.app('info', 'Pure UX detection animation started - typewriter pattern', { 
            structureType, 
            stepSize: this.detectionStepSize + 'm',
            interval: this.detectionStepInterval + 'ms',
            mode: 'typewriter'
        });
    }

    stopDetectionAnimation() {
        this.detectionActive = false;
        
        // Hide detection overlay
        if (this.detectionOverlay) {
            this.detectionOverlay.classList.remove('active');
            // Note: Progress text badge was already hidden in startDetectionAnimation
        }
        
        // Stop animation and remove lens
        if (this.scanAnimationId) {
            clearTimeout(this.scanAnimationId);
            this.scanAnimationId = null;
        }
        
        if (this.detectionLens && this.detectionLens.parentNode) {
            this.detectionLens.remove();
            this.detectionLens = null;
        }
        
        // Reset scanning state
        this.currentScanPosition = { row: 0, col: 0 };
        this.scanGrid = null;
        
        window.Logger?.app('info', 'Detection animation stopped');
    }

    updateDetectionProfileText(structureType) {
        if (!this.detectionProfileText) return;
        
        const profileTexts = {
            'windmill': 'Analyzing Windmill Structures',
            'tower': 'Analyzing Tower Structures', 
            'mound': 'Analyzing Archaeological Mounds',
            'generic': 'Analyzing Generic Structures'
        };
        
        this.detectionProfileText.textContent = profileTexts[structureType] || 'Analyzing Structures';
    }

    // Initialize scanning grid for typewriter-style movement
    initializeScanningGrid() {
        if (!this.map || !this.selectedArea) return;
        
        const bounds = this.selectedArea.bounds;
        const stepSizeMeters = this.detectionStepSize; // Configurable: 1m, 2m, etc.
        
        // Convert step size from meters to degrees
        const latStepDegrees = stepSizeMeters / 111320; // ~111,320 meters per degree lat
        const avgLat = (bounds[0][0] + bounds[1][0]) / 2;
        const lngStepDegrees = stepSizeMeters / (111320 * Math.cos(avgLat * Math.PI / 180));
        
        // Calculate grid dimensions - FIXED: ensure we cover the full area
        const latRange = bounds[1][0] - bounds[0][0];
        const lngRange = bounds[1][1] - bounds[0][1];
        const cols = Math.max(3, Math.ceil(lngRange / lngStepDegrees)); // Minimum 3 columns
        const rows = Math.max(3, Math.ceil(latRange / latStepDegrees)); // Minimum 3 rows
        
        this.scanGrid = {
            bounds: bounds,
            stepSizeMeters: stepSizeMeters,
            latStepDegrees: latStepDegrees,
            lngStepDegrees: lngStepDegrees,
            cols: cols,
            rows: rows,
            totalSteps: cols * rows
        };
        
        // Reset scan position to top-left (0,0)
        this.currentScanPosition = { row: 0, col: 0 };
        
        window.Logger?.app('debug', `Scanning grid initialized: ${cols}x${rows} = ${this.scanGrid.totalSteps} steps (${stepSizeMeters}m each)`);
        window.Logger?.app('debug', `Scan area bounds: N:${bounds[1][0].toFixed(6)}, S:${bounds[0][0].toFixed(6)}, E:${bounds[1][1].toFixed(6)}, W:${bounds[0][1].toFixed(6)}`);
    }
    
    // Start the typewriter-style scanning movement
    startScanningMovement() {
        if (!this.detectionActive || !this.scanGrid) return;
        
        // Create or update detection lens
        this.createDetectionLens();
        
        // Start the scanning animation
        this.moveToNextScanPosition();
    }
    
    // Create the visual detection lens
    createDetectionLens() {
        // Remove existing lens
        if (this.detectionLens && this.detectionLens.parentNode) {
            this.detectionLens.remove();
        }
        
        // Choose lens emoji based on structure type
        const structureType = document.getElementById('structureType')?.value || 'windmill';
        const lensEmoji = this.getDetectorEmoji(structureType);
        
        // Create lens element
        this.detectionLens = document.createElement('div');
        this.detectionLens.className = 'detection-lens';
        this.detectionLens.textContent = lensEmoji;
        this.detectionLens.style.cssText = `
            position: absolute;
            font-size: 28px;
            z-index: 1400;
            pointer-events: none;
            transition: all ${this.detectionStepInterval * 0.8}ms ease-in-out;
            opacity: 0.85;
            filter: drop-shadow(0 0 12px rgba(0, 255, 136, 0.8)) drop-shadow(0 0 4px rgba(255, 255, 255, 0.6));
            transform: scale(1);
            background: radial-gradient(circle, rgba(0, 255, 136, 0.15) 0%, transparent 70%);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: pulse 2s infinite ease-in-out;
        `;
        
        // Add CSS animation for pulse effect
        if (!document.getElementById('lens-pulse-style')) {
            const style = document.createElement('style');
            style.id = 'lens-pulse-style';
            style.textContent = `
                @keyframes pulse {
                    0%, 100% { 
                        transform: scale(1);
                        box-shadow: 0 0 20px rgba(0, 255, 136, 0.3);
                    }
                    50% { 
                        transform: scale(1.1);
                        box-shadow: 0 0 30px rgba(0, 255, 136, 0.5);
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        // Add to detection overlay
        this.detectionOverlay.appendChild(this.detectionLens);
        
        window.Logger?.app('debug', 'Detection lens created with enhanced styling');
    }
    
    // Move lens to next position in typewriter pattern
    moveToNextScanPosition() {
        if (!this.detectionActive || !this.scanGrid || !this.detectionLens) return;
        
        const { row, col } = this.currentScanPosition;
        
        // Check if scanning is complete
        if (row >= this.scanGrid.rows) {
            window.Logger?.app('info', 'Scanning animation completed');
            this.completeScanningAnimation();
            return;
        }
        
        // Calculate position at center of current grid cell
        const latRange = this.scanGrid.bounds[1][0] - this.scanGrid.bounds[0][0];
        const lngRange = this.scanGrid.bounds[1][1] - this.scanGrid.bounds[0][1];
        
        // Calculate step sizes for grid cells
        const latStepSize = latRange / this.scanGrid.rows;
        const lngStepSize = lngRange / this.scanGrid.cols;
        
        // Position at CENTER of current grid cell
        // Start from north-west corner and move to center of first cell
        const lat = this.scanGrid.bounds[1][0] - (row + 0.5) * latStepSize; // North to South, center of cell
        const lng = this.scanGrid.bounds[0][1] + (col + 0.5) * lngStepSize; // West to East, center of cell
        
        // Convert to screen coordinates
        const screenPoint = this.map.latLngToContainerPoint([lat, lng]);
        
        // Move lens to new position with smooth transition
        this.detectionLens.style.left = (screenPoint.x ) + 'px'; // Center the 40px lens
        this.detectionLens.style.top = (screenPoint.y ) + 'px';
        
        // Enhanced visual feedback for row changes
        const isNewRow = col === 0 && row > 0;
        if (isNewRow) {
            // Make lens more prominent when starting a new row
            this.detectionLens.style.transform = 'scale(1.3)';
            this.detectionLens.style.filter = 'drop-shadow(0 0 20px rgba(255, 255, 0, 1)) drop-shadow(0 0 8px rgba(255, 255, 255, 1))';
            console.log(`🔄 NEW ROW ${row}! Moving south to start row ${row} of ${this.scanGrid.rows}`);
            
            setTimeout(() => {
                if (this.detectionLens) {
                    this.detectionLens.style.transform = 'scale(1)';
                    this.detectionLens.style.filter = 'drop-shadow(0 0 12px rgba(0, 255, 136, 0.8)) drop-shadow(0 0 4px rgba(255, 255, 255, 0.6))';
                }
            }, 600);
        }
        
        // Add scanning pulse effect
        this.detectionLens.style.animation = 'none'; // Reset animation
        setTimeout(() => {
            if (this.detectionLens) {
                this.detectionLens.style.animation = 'pulse 1.5s ease-in-out';
            }
        }, 10);
        
        // Add scanning flash effect at position
        const scanFlash = document.createElement('div');
        scanFlash.style.cssText = `
            position: absolute;
            left: ${screenPoint.x - 15}px;
            top: ${screenPoint.y - 15}px;
            width: 30px;
            height: 30px;
            background: radial-gradient(circle, rgba(0, 255, 136, 0.6) 0%, transparent 70%);
            border-radius: 50%;
            pointer-events: none;
            z-index: 1350;
            animation: flash 0.8s ease-out forwards;
        `;
        
        // Add flash animation if not exists
        if (!document.getElementById('flash-animation-style')) {
            const style = document.createElement('style');
            style.id = 'flash-animation-style';
            style.textContent = `
                @keyframes flash {
                    0% { 
                        transform: scale(0.5);
                        opacity: 0.8;
                    }
                    50% { 
                        transform: scale(1.2);
                        opacity: 0.4;
                    }
                    100% { 
                        transform: scale(2);
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        this.detectionOverlay.appendChild(scanFlash);
        
        // Remove flash after animation
        setTimeout(() => {
            if (scanFlash && scanFlash.parentNode) {
                scanFlash.remove();
            }
        }, 800);
        
        // Enhanced logging with more detail
        const progressPercent = ((row * this.scanGrid.cols + col + 1) / this.scanGrid.totalSteps * 100).toFixed(1);
        console.log(`🔍 Scan [${row}, ${col}] (${progressPercent}%) -> (${lat.toFixed(6)}, ${lng.toFixed(6)}) [ROW ${row}/${this.scanGrid.rows-1}]`);
        
        // Calculate next position (typewriter style: left-to-right, then down)
        if (col < this.scanGrid.cols - 1) {
            // Move right (same row)
            this.currentScanPosition.col++;
        } else {
            // Move to next row, reset column (go down and restart from left)
            this.currentScanPosition.row++;
            this.currentScanPosition.col = 0;
        }
        
        // Schedule next movement (slower for better visibility)
        const nextInterval = isNewRow ? this.detectionStepInterval * 2 : this.detectionStepInterval; // Pause longer at row changes
        this.scanAnimationId = setTimeout(() => {
            this.moveToNextScanPosition();
        }, nextInterval);
    }
    
    // Complete the scanning animation
    completeScanningAnimation() {
        if (this.detectionLens) {
            // Final animation - lens celebrates completion
            this.detectionLens.style.animation = 'none';
            this.detectionLens.style.transition = 'all 1s ease-out';
            this.detectionLens.style.transform = 'scale(1.5) rotate(360deg)';
            this.detectionLens.style.opacity = '1';
            this.detectionLens.style.filter = 'drop-shadow(0 0 20px rgba(0, 255, 136, 1)) drop-shadow(0 0 8px rgba(255, 255, 255, 1))';
            
            // After celebration, fade out
            setTimeout(() => {
                if (this.detectionLens) {
                    this.detectionLens.style.opacity = '0';
                    this.detectionLens.style.transform = 'scale(0.5) rotate(360deg)';
                }
            }, 1000);
            
            // Remove after fade
            setTimeout(() => {
                if (this.detectionLens && this.detectionLens.parentNode) {
                    this.detectionLens.remove();
                    this.detectionLens = null;
                }
            }, 2000);
        }
        
        // Reset scanning state but keep detection active for potential restart
        this.currentScanPosition = { row: 0, col: 0 };
        this.scanAnimationId = null;
        
        // Note: Removed completion text update to keep animation clean and minimal
        
        window.Logger?.app('info', 'Detection scanning animation completed with celebration');
    }
    
    // Get detector emoji based on structure type
    getDetectorEmoji(structureType) {
        const emojis = {
            'windmill': '🔍',  // Generic lens for windmills
            'tower': '🔍',     // Generic lens for towers
            'mound': '🏺',     // Archaeological artifact for mounds
            'generic': '🔍'    // Default lens
        };
        
        return emojis[structureType] || '🔍';
    }

    // Configure step size (for future customization)
    setDetectionStepSize(stepSizeMeters) {
        this.detectionStepSize = stepSizeMeters;
        window.Logger?.app('info', `Detection step size set to ${stepSizeMeters}m`);
        
        // If currently scanning, reinitialize grid with new step size
        if (this.detectionActive && this.scanGrid) {
            this.initializeScanningGrid();
        }
    }
    
    // Configure step interval (for future customization)
    setDetectionStepInterval(intervalMs) {
        this.detectionStepInterval = intervalMs;
        window.Logger?.app('info', `Detection step interval set to ${intervalMs}ms`);
    }
    
    // Preset configurations for different scanning modes
    setDetectionMode(mode) {
        const modes = {
            'precise': { stepSize: 1, interval: 5 },      // 1m steps, slow
            'standard': { stepSize: 2, interval: 3 },     // 2m steps, medium
            'rapid': { stepSize: 4, interval: 2 },        // 4m steps, fast
            'coarse': { stepSize: 8, interval: 1 }        // 8m steps, very fast
        };
        
        if (modes[mode]) {
            this.setDetectionStepSize(modes[mode].stepSize);
            this.setDetectionStepInterval(modes[mode].interval);
            window.Logger?.app('info', `Detection mode set to '${mode}'`);
        } else {
            window.Logger?.app('warn', `Unknown detection mode: ${mode}`);
        }
    }

    // ========================================
    // PURE UX ANIMATION - NO BACKEND INTEGRATION
    // ========================================
    
    // NOTE: The following methods are kept for future backend integration,
    // but the current animation is purely frontend UX focused.
    
    // Future: handleBackendPatchDetectionResult(patchData) {
    //     // Will integrate with backend detection results
    // }
    
    // Future: sendPatchToDetectionKernel(patchCenterLat, patchCenterLng) {
    //     // Will send coordinates to backend for actual analysis
    // }
    
    // Current animation is self-contained and independent of backend

    // ========================================
    // RESOLUTION DETECTION & ANIMATION
    // ========================================

    updateResolutionDisplay(actualResolution) {
        if (actualResolution && actualResolution !== 'Determining...') {
            // Update scan area label with resolution
            this.updateScanAreaLabel(actualResolution);
            
            // Log the resolution
            window.Logger?.lidar('info', `LiDAR resolution detected: ${actualResolution}`);
        }
    }

    updateAnimationForResolution(actualResolution, isHighResolution = null) {
        if (!this.animationState || !actualResolution) return;
        
        // Use backend-provided flag as the single source of truth
        const isHighRes = isHighResolution !== null ? isHighResolution : false;
        const newIconType = isHighRes ? 'airplane' : 'satellite';
        
        window.Logger?.animation('info', `Resolution update: "${actualResolution}" -> ${isHighRes ? 'HIGH-RES' : 'LOW-RES'} -> ${newIconType.toUpperCase()}`);
        
        if (this.animationState.iconType !== newIconType) {
            window.Logger?.animation('info', `Switching icon from ${this.animationState.iconType} to ${newIconType}`);
            
            this.animationState.iconType = newIconType;
            this.animationState.actualResolution = actualResolution;
            
            // Update the visual icon immediately
            if (this.scanningIcon) {
                this.scanningIcon.innerHTML = isHighRes ? '🚁' : '🛰️';
                this.scanningIcon.className = `scanning-icon ${newIconType}`;
                this.scanningIcon.style.fontSize = isHighRes ? '32px' : '28px';
            }
        }
    }

    // ========================================
    // ANIMATION SYSTEM
    // ========================================

    startScanningAnimation(iconType = 'satellite') {
        this.stopScanningAnimation();
        
        window.Logger?.animation('info', `Starting ${iconType} scanning animation`);
        
        // Create static icon positioned at top-center of map
        const scanIcon = document.createElement('div');
        scanIcon.className = `scanning-icon ${iconType}`;
        scanIcon.innerHTML = iconType === 'airplane' ? '🚁' : '🛰️';
        scanIcon.style.cssText = `
            position: absolute;
            top: 20px;
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
                    this.scanningIcon.style.filter = 'drop-shadow(0 3px 6px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 8px rgba(255, 255, 136, 0.6))';
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
        // Beam starts from below the icon with some offset
        const iconCenterX = mapContainer.offsetWidth / 2 +10;
        const iconCenterY = 60; // top position + icon height + offset for looser attachment
        
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
            // Use wss:// for HTTPS, ws:// for HTTP (localhost/dev)
            const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const wsUrl = `${wsProtocol}//${window.location.host}/api/v1/ws/discovery`;
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
        
        // Note: Detection animation runs independently as pure UX
        // Future backend integration would process detection results here
        
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
            
            // DON'T stop detection animation - it's independent UX that should complete naturally
            // this.stopDetectionAnimation(); // REMOVED - detection continues until it finishes
            
            // Reset button states - change "Stop" back to "Scan"
            this.updateButtonStates();
            
            window.Logger?.app('info', 'LiDAR session completed - UI reset to scan mode (detection continues)');
        }
    }

    handleSessionStopped(data) {
        console.log('🛑 Session stopped:', data.session_id);
        
        if (data.session_id === this.currentLidarSession) {
            this.currentLidarSession = null;
            this.stopScanningAnimation();
            
            // DON'T stop detection animation - it's independent UX that should complete naturally
            // this.stopDetectionAnimation(); // REMOVED - detection continues until it finishes
            
            // Reset button states - change "Stop" back to "Scan"
            this.updateButtonStates();
            
            window.Logger?.app('info', 'LiDAR session stopped - UI reset to scan mode (detection continues)');
        }
    }

    handleSessionFailed(data) {
        console.error('❌ Session failed:', data.session_id, data.error || data.message);
        
        if (data.session_id === this.currentLidarSession) {
            this.currentLidarSession = null;
            this.stopScanningAnimation();
            
            // DON'T stop detection animation - it's independent UX that should complete naturally
            // this.stopDetectionAnimation(); // REMOVED - detection continues until it finishes
            
            // Reset button states - change "Stop" back to "Scan"
            this.updateButtonStates();
            
            // Show error to user
            const errorMessage = data.error || data.message || 'Unknown error occurred';
            alert(`LiDAR scan failed: ${errorMessage}`);
            
            window.Logger?.app('error', 'LiDAR session failed - UI reset to scan mode (detection continues)', { error: errorMessage });
        }
    }

    // ========================================
    // AUTHENTICATION
    // ========================================

    async initializeAuth() {
        window.Logger?.app('info', 'Initializing authentication...');
        
        // Set up Google Sign-In callback
        this.setupGoogleAuth();
        
        // Check for stored token
        const storedToken = localStorage.getItem('auth_token');
        if (storedToken) {
            try {
                await this.validateStoredToken(storedToken);
            } catch (error) {
                window.Logger?.app('warn', 'Stored token validation failed:', error);
                localStorage.removeItem('auth_token');
            }
        }
    }

    async validateStoredToken(token) {
        try {
            const response = await fetch(`${window.AppConfig.apiBase}/auth/validate`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.accessToken = token;
                this.currentUser = data.user;
                this.updateAuthUI();
                window.Logger?.app('info', 'User authenticated from stored token');
                return true;
            } else {
                throw new Error('Token validation failed');
            }
        } catch (error) {
            window.Logger?.app('error', 'Token validation error:', error);
            throw error;
        }
    }

    setupGoogleAuth() {
        // Make handleGoogleLogin available globally
        window.handleGoogleLogin = this.handleGoogleLogin.bind(this);
        window.Logger?.app('info', 'Google Auth callback registered');
    }

    async handleGoogleLogin(response) {
        window.Logger?.app('info', 'Processing Google login response...');
        
        try {
            // Send the Google credential to our backend
            const authResponse = await fetch(`${window.AppConfig.apiBase}/auth/google`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    token: response.credential
                })
            });

            if (!authResponse.ok) {
                const errorData = await authResponse.json();
                throw new Error(errorData.detail || 'Authentication failed');
            }

            const authData = await authResponse.json();
            
            // Store authentication data
            this.accessToken = authData.access_token;
            this.currentUser = authData.user;
            
            // Store token for persistence
            localStorage.setItem('auth_token', this.accessToken);
            
            // Update UI
            this.updateAuthUI();
            
            window.Logger?.app('info', `User authenticated: ${this.currentUser.email}`);
            
        } catch (error) {
            window.Logger?.app('error', 'Google authentication failed:', error);
            this.showAuthError(error.message);
        }
    }

    updateAuthUI() {
        if (!this.currentUser) {
            this.showLoginSection();
            return;
        }

        // Hide login section
        const loginSection = document.getElementById('login-section');
        if (loginSection) {
            loginSection.style.display = 'none';
        }

        // Show user profile
        const userProfile = document.getElementById('user-profile');
        if (userProfile) {
            userProfile.style.display = 'block';
        }

        // Update user profile information
        const userAvatar = document.getElementById('user-avatar');
        const userName = document.getElementById('user-name');
        const userEmail = document.getElementById('user-email');
        const logoutBtn = document.getElementById('logout-btn');

        if (userAvatar && this.currentUser.picture) {
            userAvatar.src = this.currentUser.picture;
            userAvatar.alt = this.currentUser.name;
        }

        if (userName) {
            userName.textContent = this.currentUser.name;
        }

        if (userEmail) {
            userEmail.textContent = this.currentUser.email;
        }

        if (logoutBtn) {
            logoutBtn.style.display = 'block';
            logoutBtn.onclick = () => this.handleLogout();
        }

        // Show chat input
        const chatForm = document.getElementById('chat-input-form');
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');

        if (chatForm) {
            chatForm.style.display = 'flex';
        }

        if (chatInput) {
            chatInput.disabled = false;
            chatInput.placeholder = 'Ask Bella about discoveries...';
        }

        if (sendBtn) {
            sendBtn.disabled = false;
        }

        // Update welcome message
        const chatWelcome = document.getElementById('chat-welcome');
        if (chatWelcome) {
            chatWelcome.innerHTML = `
                <p>👋 Welcome back, ${this.currentUser.name}!</p>
                <p class="small">I'm Bella, your AI assistant for RE-Archaeology. How can I help you today?</p>
            `;
        }
    }

    showLoginSection() {
        const loginSection = document.getElementById('login-section');
        const userProfile = document.getElementById('user-profile');
        const chatForm = document.getElementById('chat-input-form');

        if (loginSection) {
            loginSection.style.display = 'block';
        }

        if (userProfile) {
            userProfile.style.display = 'none';
        }

        if (chatForm) {
            chatForm.style.display = 'none';
        }

        // Reset welcome message
        const chatWelcome = document.getElementById('chat-welcome');
        if (chatWelcome) {
            chatWelcome.innerHTML = `
                <p>👋 Hi! I'm Bella, your AI assistant for RE-Archaeology.</p>
                <p class="small">Sign in to start our conversation!</p>
            `;
        }
    }

    showAuthError(message) {
        alert(`Authentication Error: ${message}`);
    }

    async handleLogout() {
        try {
            // Call logout endpoint
            if (this.accessToken) {
                await fetch(`${window.AppConfig.apiBase}/auth/logout`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                });
            }
        } catch (error) {
            window.Logger?.app('warn', 'Logout API call failed:', error);
        } finally {
            // Clear local state regardless of API call success
            this.accessToken = null;
            this.currentUser = null;
            localStorage.removeItem('auth_token');
            
            // Update UI
            this.showLoginSection();
            
            window.Logger?.app('info', 'User logged out');
        }
    }

    // ========================================
    // CHAT FUNCTIONALITY
    // ========================================

    async handleChatSubmit() {
        const chatInput = document.getElementById('chat-input');
        if (!chatInput) return;

        const message = chatInput.value.trim();
        if (!message) return;

        // Clear input
        chatInput.value = '';

        // Add user message to chat
        this.addChatMessage('user', message);

        if (!this.currentUser || !this.accessToken) {
            this.addChatMessage('assistant', "I'm sorry, but you need to be signed in to chat with me. Please sign in with your Google account.");
            return;
        }

        try {
            // Show typing indicator
            this.showTypingIndicator();

            // Send message to backend
            const response = await fetch(`${window.AppConfig.apiBase}/ai/message`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message,
                    context: {
                        scanning: this.isScanning,
                        scan_area: this.selectedArea
                    }
                })
            });

            this.hideTypingIndicator();

            if (response.ok) {
                const data = await response.json();
                this.addChatMessage('assistant', data.response);
            } else {
                throw new Error(`Chat API error: ${response.status}`);
            }

        } catch (error) {
            this.hideTypingIndicator();
            window.Logger?.app('error', 'Chat error:', error);
            this.addChatMessage('assistant', "I'm sorry, I'm having trouble connecting right now. Please try again later.");
        }
    }

    addChatMessage(role, content) {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return;

        // Hide welcome message if it exists
        const chatWelcome = document.getElementById('chat-welcome');
        if (chatWelcome && role === 'user') {
            chatWelcome.style.display = 'none';
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${role}-message`;
        
        if (role === 'user') {
            messageDiv.innerHTML = `
                <div class="message-content user-content">
                    <div class="message-text">${this.escapeHtml(content)}</div>
                </div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="message-content assistant-content">
                    <div class="assistant-icon">🤖</div>
                    <div class="message-text">${this.escapeHtml(content)}</div>
                </div>
            `;
        }

        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    showTypingIndicator() {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return;

        const typingDiv = document.createElement('div');
        typingDiv.className = 'chat-message typing-indicator';
        typingDiv.id = 'typing-indicator';
        typingDiv.innerHTML = `
            <div class="message-content assistant-content">
                <div class="assistant-icon">🤖</div>
                <div class="message-text">
                    <div class="typing-dots">
                        <span></span><span></span><span></span>
                    </div>
                </div>
            </div>
        `;

        chatMessages.appendChild(typingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    hideTypingIndicator() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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

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
        this.satelliteBeam = null; // Optional: for future satellite beam effects
        
        // Animation state
        this.animationState = null;
        
        // Detection UX state (synchronized with backend)
        this.detectionActive = false;
        this.detectionLens = null;
        this.detectionOverlay = null;
        this.processedPatches = new Set();
        this.totalPatches = 0;
        
        this.layers = {
            patches: null,
            detections: null,
            animations: null
        };
        this.patches = new Map();
        this.detections = [];
        
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
            // Initialize WebSocket connection
            this.connectWebSocket();
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

    // Navigate to coordinates without page refresh
    navigateToCoordinates(lat, lon, updateHistory = true) {
        // Validate coordinates
        const latNum = parseFloat(lat);
        const lonNum = parseFloat(lon);
        
        if (isNaN(latNum) || isNaN(lonNum)) {
            console.warn('Invalid coordinates provided:', lat, lon);
            return false;
        }

        // Update map view and scan area
        this.selectScanArea(latNum, lonNum, 1.0);
        this.map.setView([latNum, lonNum], 13, { animate: true });
        
        // Update URL without reload if requested
        if (updateHistory) {
            this.updateUrlWithCoordinates(latNum, lonNum);
        }
        
        return true;
    }

    // Setup coordinate link handling for SPA navigation
    setupCoordinateLinkHandling() {
        // Handle clicks on internal links with lat/lon parameters
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (!link) return;
            
            const href = link.getAttribute('href');
            if (!href) return;
            
            // Check if it's an internal link with coordinates
            const isInternal = href.startsWith('/') || href.startsWith('./') || href.startsWith('?') || 
                              (!href.includes('://') && !href.startsWith('mailto:') && !href.startsWith('tel:'));
            
            if (!isInternal) return;
            
            // Parse URL for coordinates
            const url = new URL(href, window.location.origin);
            const lat = url.searchParams.get('lat');
            const lon = url.searchParams.get('lon');
            
            if (lat && lon) {
                // Prevent default browser navigation
                e.preventDefault();
                
                // Navigate to coordinates without page refresh
                if (this.navigateToCoordinates(lat, lon, true)) {
                    window.Logger?.app('info', `Navigated to coordinates: ${lat}, ${lon}`);
                }
            }
        });
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
        // Only set default coordinates if no URL parameters were provided
        const params = new URLSearchParams(window.location.search);
        const hasUrlCoords = params.has('lat') && params.has('lon');
        
        if (!hasUrlCoords) {
            this.selectScanArea(52.4751, 4.8156, 1.0);
        }
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

        // Handle coordinate links without page refresh
        this.setupCoordinateLinkHandling();
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
                
                // Ensure WebSocket is connected (reconnect if needed)
                if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
                    console.log('🔌 WebSocket not connected, connecting...');
                    this.connectWebSocket();
                    // Wait a bit for connection to establish
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
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
    // DETECTION ANIMATION - SYNCHRONIZED WITH BACKEND
    // ========================================
    //
    // This system synchronizes the frontend lens animation with backend detection progress.
    // The lens moves to each patch location only when a `patch_result` message is received
    // from the backend, ensuring perfect synchronization with actual detection processing.
    // 
    // Features:
    // - Backend-synchronized movement: lens moves only on patch_result messages
    // - Visual feedback for each patch detection
    // - Structure-specific lens emojis (windmill, tower, mound, generic)
    // - Confidence-based visual effects and animations
    // - Real-time progress tracking with backend detection
    // 
    // Message Flow:
    // 1. Backend processes each patch and sends patch_result message
    // 2. Frontend receives patch_result and moves lens to that location
    // 3. Lens shows detection confidence and result visually
    // 4. Animation completes when all patches are processed
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
        
        // Create detection lens but don't start movement yet - wait for backend messages
        this.createDetectionLens();
        
        // Reset detection state for new scan
        this.processedPatches = new Set();
        this.totalPatches = 0;
        
        // Add test movement to verify lens is working
        if (this.detectionLens && this.selectedArea) {
            const testLat = this.selectedArea.lat;
            const testLon = this.selectedArea.lon;
            console.log(`🧪 Testing lens movement to scan center: (${testLat}, ${testLon})`);
            
            setTimeout(() => {
                if (this.detectionLens && this.map) {
                    const testPoint = this.map.latLngToContainerPoint([testLat, testLon]);
                    console.log(`🧪 Test movement to screen coordinates: (${testPoint.x}, ${testPoint.y})`);
                    this.detectionLens.style.left = (testPoint.x - 20) + 'px';
                    this.detectionLens.style.top = (testPoint.y - 20) + 'px';
                    console.log('🧪 Test movement applied');
                }
            }, 1000);
        }
        
        window.Logger?.app('info', 'Detection animation initialized - waiting for backend patch_result messages');
    }

    // Test method for debugging lens movement (call from browser console)
    testLensMovement() {
        if (!this.detectionActive) {
            console.log('🧪 Starting detection animation for test...');
            this.startDetectionAnimation();
        }
        
        if (!this.selectedArea) {
            console.error('❌ No scan area selected');
            return;
        }
        
        // Test movement to different corners of the scan area
        const testPositions = [
            { lat: this.selectedArea.lat + 0.002, lon: this.selectedArea.lon - 0.002, name: 'North-West' },
            { lat: this.selectedArea.lat + 0.002, lon: this.selectedArea.lon + 0.002, name: 'North-East' },
            { lat: this.selectedArea.lat - 0.002, lon: this.selectedArea.lon + 0.002, name: 'South-East' },
            { lat: this.selectedArea.lat - 0.002, lon: this.selectedArea.lon - 0.002, name: 'South-West' },
            { lat: this.selectedArea.lat, lon: this.selectedArea.lon, name: 'Center' }
        ];
        
        testPositions.forEach((pos, index) => {
            setTimeout(() => {
                console.log(`🧪 Test movement ${index + 1}: ${pos.name} (${pos.lat.toFixed(6)}, ${pos.lon.toFixed(6)})`);
                const testPatch = {
                    lat: pos.lat,
                    lon: pos.lon,
                    confidence: Math.random(),
                    is_positive: Math.random() > 0.5
                };
                this.handlePatchResult(testPatch);
            }, index * 1000);
        });
        
        console.log('🧪 Test sequence started - lens should move to 5 positions over 5 seconds');
    }

    // Test the entire detection system (call from browser console)
    testDetectionSystem() {
        console.log('🧪 Testing entire detection system...');
        
        // Test 1: Start detection animation
        console.log('🧪 Test 1: Starting detection animation');
        this.startDetectionAnimation();
        
        // Test 2: Simulate patch_result message
        setTimeout(() => {
            console.log('🧪 Test 2: Simulating patch_result message');
            const testPatch = {
                lat: this.selectedArea?.lat || 52.4751,
                lon: this.selectedArea?.lon || 4.8156,
                confidence: 0.25,
                is_positive: true
            };
            
            // Simulate WebSocket message
            this.handleWebSocketMessage({
                type: 'patch_result',
                patch: testPatch
            });
        }, 2000);
        
        // Test 3: Simulate detection_result message
        setTimeout(() => {
            console.log('🧪 Test 3: Simulating detection_result message');
            const testDetection = {
                type: 'detection_result',
                structure_type: 'windmill',
                confidence: 0.25,
                lat: this.selectedArea?.lat || 52.4751,
                lon: this.selectedArea?.lon || 4.8156
            };
            
            this.handleWebSocketMessage(testDetection);
        }, 4000);
        
        console.log('🧪 Detection system test started - watch console and map for 6 seconds');
    }

    // Handle patch result message from backend - move lens for detection progression
    handlePatchResult(patchData) {
        console.log('🔍 ENTER handlePatchResult with data:', patchData);
        console.log('🔍 Detection active state:', this.detectionActive);
        console.log('🔍 Lens exists:', !!this.detectionLens);
        console.log('🔍 Map exists:', !!this.map);
        
        if (!this.detectionActive) {
            console.warn('⚠️ Detection not active, ignoring patch result');
            console.warn('⚠️ You may need to ensure detection is activated first');
            return;
        }
        
        if (!this.detectionLens) {
            console.warn('⚠️ Detection lens not found, creating it');
            this.createDetectionLens();
            if (!this.detectionLens) {
                console.error('❌ Failed to create detection lens');
                return;
            }
        }

        // Clear any pending visual effect timeouts to prevent conflicts
        if (this.lensTimeouts) {
            this.lensTimeouts.forEach(timeout => clearTimeout(timeout));
            this.lensTimeouts = [];
        } else {
            this.lensTimeouts = [];
        }

        const { lat, lon, confidence, is_positive, patch_size_m } = patchData;
        
        if (!lat || !lon) {
            console.warn('⚠️ Invalid patch coordinates:', patchData);
            return;
        }
        
        console.log(`🎯 Moving lens to detection patch at (${lat.toFixed(6)}, ${lon.toFixed(6)}) - size: ${patch_size_m}m`);
        
        // Convert patch coordinates to screen position
        const screenPoint = this.map.latLngToContainerPoint([lat, lon]);
        console.log(`📍 Screen coordinates: (${screenPoint.x}, ${screenPoint.y})`);
        
        // Check if the point is visible on screen
        const mapContainer = this.map.getContainer();
        const mapBounds = mapContainer.getBoundingClientRect();
        const isInView = screenPoint.x >= 0 && screenPoint.x <= mapBounds.width && 
                        screenPoint.y >= 0 && screenPoint.y <= mapBounds.height;
        
        if (!isInView) {
            console.warn(`⚠️ Patch location (${screenPoint.x}, ${screenPoint.y}) is outside map view bounds (${mapBounds.width}x${mapBounds.height})`);
            // Still update the position but log the issue
        }
        
        // Force immediate positioning by temporarily disabling transitions
        const originalTransition = this.detectionLens.style.transition;
        this.detectionLens.style.transition = 'all 80ms ease-in-out';
        
        // Move lens to this detection patch location
        const newLeft = (screenPoint.x - 20) + 'px';
        const newTop = (screenPoint.y - 20) + 'px';
        console.log(`🎯 Setting lens position: left=${newLeft}, top=${newTop} (inView: ${isInView})`);
        
        this.detectionLens.style.left = newLeft; // Center the lens (40px wide)
        this.detectionLens.style.top = newTop; // Center the lens (40px tall)
        
        // Restore original transition after a brief moment
        setTimeout(() => {
            if (this.detectionLens) {
                this.detectionLens.style.transition = originalTransition;
            }
        }, 50);
        
        console.log(`✅ Lens position updated: left=${this.detectionLens.style.left}, top=${this.detectionLens.style.top}`);
        
        // Update visual feedback based on detection result
        this.updateLensVisualFeedback(is_positive, confidence);
        
        // Track progress
        this.processedPatches.add(`${lat},${lon}`);
        
        window.Logger?.app('info', `Lens moved to patch (${lat.toFixed(6)}, ${lon.toFixed(6)}) - confidence: ${confidence.toFixed(3)}`);
    }

    // Ensure detection lens is ready for coordinated detection
    ensureDetectionLensReady() {
        console.log('🔧 Ensuring detection lens is ready for coordinated detection');
        
        // Activate detection if not already active
        if (!this.detectionActive) {
            console.log('🎯 Activating detection animation for coordinated detection');
            this.startDetectionAnimation();
        }
        
        // Create detection lens if it doesn't exist
        if (!this.detectionLens) {
            console.log('🔧 Creating detection lens for coordinated detection');
            this.createDetectionLens();
        }
        
        // Position lens at scan area center initially
        if (this.selectedArea && this.detectionLens) {
            const screenPoint = this.map.latLngToContainerPoint([this.selectedArea.lat, this.selectedArea.lon]);
            this.detectionLens.style.left = (screenPoint.x - 20) + 'px';
            this.detectionLens.style.top = (screenPoint.y - 20) + 'px';
            console.log('📍 Positioned detection lens at scan area center');
        }
    }

    // Update lens visual feedback based on detection results
    updateLensVisualFeedback(isPositive, confidence) {
        if (!this.detectionLens) return;

        // Reset animation
        this.detectionLens.style.animation = 'none';
        
        if (isPositive && confidence > 0.7) {
            // High confidence detection - bright flash
            this.detectionLens.style.transform = 'scale(1.5)';
            this.detectionLens.style.filter = 'drop-shadow(0 0 20px rgba(255, 215, 0, 1)) drop-shadow(0 0 8px rgba(255, 255, 255, 1))';
            this.detectionLens.textContent = '⭐'; // Star for high confidence
            
            // Flash effect
            const timeout1 = setTimeout(() => {
                if (this.detectionLens) {
                    this.detectionLens.style.transform = 'scale(1)';
                    this.detectionLens.style.filter = 'drop-shadow(0 0 12px rgba(0, 255, 136, 0.8)) drop-shadow(0 0 4px rgba(255, 255, 255, 0.6))';
                    
                    const structureType = document.getElementById('structureType')?.value || 'windmill';
                    this.detectionLens.textContent = this.getDetectorEmoji(structureType);
                }
            }, 500);
            if (!this.lensTimeouts) this.lensTimeouts = [];
            this.lensTimeouts.push(timeout1);
        } else if (isPositive && confidence > 0.4) {
            // Medium confidence detection - pulse
            this.detectionLens.style.transform = 'scale(1.2)';
            this.detectionLens.style.filter = 'drop-shadow(0 0 15px rgba(255, 165, 0, 0.8)) drop-shadow(0 0 6px rgba(255, 255, 255, 0.8))';
            
            const timeout2 = setTimeout(() => {
                if (this.detectionLens) {
                    this.detectionLens.style.transform = 'scale(1)';
                    this.detectionLens.style.filter = 'drop-shadow(0 0 12px rgba(0, 255, 136, 0.8)) drop-shadow(0 0 4px rgba(255, 255, 255, 0.6))';
                }
            }, 300);
            if (!this.lensTimeouts) this.lensTimeouts = [];
            this.lensTimeouts.push(timeout2);
        } else {
            // No detection or low confidence - subtle pulse
            this.detectionLens.style.animation = 'pulse 1s ease-in-out';
        }
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
        
        // Reset detection state
        this.processedPatches = new Set();
        this.totalPatches = 0;
        
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

    
    // Create the visual detection lens
    createDetectionLens() {
        console.log('🔧 Creating detection lens...');
        
        // Remove existing lens
        if (this.detectionLens && this.detectionLens.parentNode) {
            this.detectionLens.remove();
            console.log('🗑️ Removed existing lens');
        }
        
        // Ensure detection overlay exists
        if (!this.detectionOverlay) {
            console.error('❌ Detection overlay not found!');
            this.initializeDetectionOverlay();
            if (!this.detectionOverlay) {
                console.error('❌ Failed to initialize detection overlay');
                return;
            }
        }
        
        // Choose lens emoji based on structure type
        const structureType = document.getElementById('structureType')?.value || 'windmill';
        const lensEmoji = this.getDetectorEmoji(structureType);
        console.log(`🎭 Using lens emoji: ${lensEmoji} for structure: ${structureType}`);
        
        // Create lens element
        this.detectionLens = document.createElement('div');
        this.detectionLens.className = 'detection-lens';
        this.detectionLens.textContent = lensEmoji;
        this.detectionLens.style.cssText = `
            position: absolute;
            font-size: 28px;
            z-index: 1400;
            pointer-events: none;
            transition: all 80ms ease-in-out;
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
            left: 50px;
            top: 50px;
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
            console.log('✨ Added lens pulse CSS animation');
        }
        
        // Add to detection overlay
        this.detectionOverlay.appendChild(this.detectionLens);
        console.log('✅ Detection lens created and added to overlay');
        console.log('🔧 Lens DOM element:', this.detectionLens);
        console.log('🔧 Lens parent element:', this.detectionLens.parentElement);
        console.log('🔧 Detection overlay element:', this.detectionOverlay);
        
        // Lens is now properly configured and working
        
        window.Logger?.app('debug', 'Detection lens created with enhanced styling');
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

    // Complete the detection animation when backend scanning finishes
    completeDetectionAnimation() {
        if (!this.detectionLens) return;
        
        // Final celebration animation
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
        
        window.Logger?.app('info', 'Detection animation completed - synchronized with backend');
    }

    // ========================================
    // BACKEND INTEGRATION - SYNCHRONIZED DETECTION
    // ========================================

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
            color: '#ffff88',
            weight: 2,
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
            // Close existing connection if any
            if (this.websocket) {
                console.log('🔌 Closing existing WebSocket connection');
                this.websocket.close();
                this.websocket = null;
            }
            
            // Use wss:// for HTTPS, ws:// for HTTP (localhost/dev)
            const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const wsUrl = `${wsProtocol}//${window.location.host}/api/v1/ws/discovery`;
            console.log('🔌 Connecting to WebSocket:', wsUrl);
            this.websocket = new WebSocket(wsUrl);
            
            this.websocket.onopen = () => {
                console.log('✅ WebSocket connected successfully');
                
                // Send a ping to confirm connection
                this.websocket.send(JSON.stringify({
                    type: 'ping',
                    timestamp: new Date().toISOString()
                }));
            };
            
            this.websocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'pong') {
                        console.log('🏓 WebSocket pong received - connection active');
                    } else {
                        this.handleWebSocketMessage(data);
                    }
                } catch (error) {
                    console.error('❌ Failed to parse WebSocket message:', error);
                }
            };
            
            this.websocket.onclose = (event) => {
                console.log('🔌 WebSocket disconnected:', event.code, event.reason);
                this.websocket = null;
                
                // Reconnect if session active
                if (this.currentLidarSession) {
                    console.log('🔄 Attempting to reconnect WebSocket in 2 seconds...');
                    setTimeout(() => this.connectWebSocket(), 2000);
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
        // Debug: Log all patch_result and detection_result messages
        if (data.type === 'patch_result') {
            console.log('[DEBUG] patch_result message:', data);
        }
        if (data.type === 'detection_result') {
            console.log('[DEBUG] detection_result message:', data);
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
                
            case 'patch_result':
                console.log('📨 WebSocket received patch_result message:', data);
                console.log('📋 Patch data details:', JSON.stringify(data.patch, null, 2));
                console.log('🔍 Detection active:', this.detectionActive);
                console.log('🎯 Detection lens exists:', !!this.detectionLens);
                console.log('🗺️ Map exists:', !!this.map);
                if (data.patch) {
                    console.log('🎯 About to call handlePatchResult with:', data.patch);
                    this.handlePatchResult(data.patch);
                } else {
                    console.error('❌ No patch data in patch_result message');
                    console.log('❌ Full message structure:', JSON.stringify(data, null, 2));
                }
                break;
                
            case 'detection_result':
                this.handleDetectionResult(data);
                break;
                
            case 'detection_starting':
                console.log('🎯 Backend starting coordinated detection');
                this.ensureDetectionLensReady();
                break;
                
            case 'detection_completed':
                console.log('✅ Backend completed detection');
                this.stopDetectionAnimation();
                break;
                
            case 'connection_established':
                console.log('🔗 WebSocket connection confirmed by server');
                break;
                
            case 'error':
                console.error('❌ WebSocket error:', data.message);
                break;
                
            default:
                console.log('📨 Unknown message type:', data.type);
        }
    }

    handleDetectionResult(data) {
        // Debug: Log every detection result received
        console.log('[DEBUG] handleDetectionResult called with:', data);
        
        // Show detections with confidence > 0.3 (lowered from 0.7)
        if (data.structure_type === 'windmill' && data.confidence > 0.3) {
            // Prevent duplicate markers
            if (!this.detections.some(d => d.lat === data.lat && d.lon === data.lon)) {
                this.detections.push({ lat: data.lat, lon: data.lon, confidence: data.confidence });
                
                // Choose marker based on confidence level
                let markerHtml, markerClass, markerSize;
                if (data.confidence > 0.7) {
                    // High confidence - bright gold star
                    markerHtml = '⭐';
                    markerClass = 'windmill-star-marker-high';
                    markerSize = [28, 28];
                } else if (data.confidence > 0.5) {
                    // Medium confidence - yellow star
                    markerHtml = '🌟';
                    markerClass = 'windmill-star-marker-medium';
                    markerSize = [24, 24];
                } else {
                    // Low confidence - dim star
                    markerHtml = '✩';
                    markerClass = 'windmill-star-marker-low';
                    markerSize = [20, 20];
                }
                
                const marker = L.marker([data.lat, data.lon], {
                    icon: L.divIcon({
                        className: markerClass,
                        html: markerHtml,
                        iconSize: markerSize,
                        iconAnchor: [markerSize[0]/2, markerSize[1]/2]
                    })
                });
                
                // Add popup with detection scores
                const finalScore = data.final_score || 0.0;
                const detected = data.detected !== undefined ? data.detected : 'unknown';
                marker.bindPopup(`
                    <strong>Windmill Detection</strong><br>
                    G2 Detected: ${detected}<br>
                    Detection Score: ${(finalScore * 100).toFixed(1)}%<br>
                    Confidence: ${(data.confidence * 100).toFixed(1)}%<br>
                    Location: ${data.lat.toFixed(6)}, ${data.lon.toFixed(6)}
                `);
                
                marker.addTo(this.layers.detections);
                console.log(`[DEBUG] Windmill marker added at (${data.lat}, ${data.lon}) with score ${finalScore.toFixed(3)}, confidence ${data.confidence.toFixed(3)}`);
            } else {
                console.log(`[DEBUG] Duplicate windmill detection at (${data.lat}, ${data.lon}) ignored.`);
            }
        } else {
            console.log(`[DEBUG] Detection result ignored. structure_type: ${data.structure_type}, confidence: ${data.confidence}`);
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
        
        // Note: Detection lens follows patch_result messages, not LiDAR tiles
        
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
            
            // Complete the detection animation since backend scanning is done
            if (this.detectionActive) {
                this.completeDetectionAnimation();
            }
            
            // Reset button states - change "Stop" back to "Scan"
            this.updateButtonStates();
            
            window.Logger?.app('info', 'LiDAR session completed - detection animation completing');
        }
    }

    handleSessionStopped(data) {
        console.log('🛑 Session stopped:', data.session_id);
        
        if (data.session_id === this.currentLidarSession) {
            this.currentLidarSession = null;
            this.stopScanningAnimation();
            
            // Stop detection animation since scanning was manually stopped
            this.stopDetectionAnimation();
            
            // Reset button states - change "Stop" back to "Scan"
            this.updateButtonStates();
            
            window.Logger?.app('info', 'LiDAR session stopped - detection animation stopped');
        }
    }

    handleSessionFailed(data) {
        console.error('❌ Session failed:', data.session_id, data.error || data.message);
        
        if (data.session_id === this.currentLidarSession) {
            this.currentLidarSession = null;
            this.stopScanningAnimation();
            
            // Stop detection animation since scanning failed
            this.stopDetectionAnimation();
            
            // Reset button states - change "Stop" back to "Scan"
            this.updateButtonStates();
            
            // Show error to user
            const errorMessage = data.error || data.message || 'Unknown error occurred';
            alert(`LiDAR scan failed: ${errorMessage}`);
            
            window.Logger?.app('error', 'LiDAR session failed - detection animation stopped', { error: errorMessage });
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
        
        // Make test functions globally available for debugging
        window.testLensMovement = () => window.reApp.testLensMovement();
        window.testDetectionSystem = () => window.reApp.testDetectionSystem();
        
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

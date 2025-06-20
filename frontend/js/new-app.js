/**
 * Clean RE-Archaeology Application
 * Single unified class to avoid DOM conflicts and multiple map instances
 * 
 * Recent Updates:
 * - Removed LiDAR elevation layer from map overlay controls
 * - Added dedicated LiDAR Heatmap control panel with:
 *   - Resolution mode selection (auto/high/medium/low)
 *   - Optional structure detection toggle
 *   - Scanning animation control
 *   - Start/Stop/Clear buttons for heatmap operations
 * - Simplified visualization options by removing elevation checkbox
 * - Enhanced control panel structure for better workflow
 */

class REArchaeologyApp {
    constructor() {
        this.map = null;
        this.scanAreaRectangle = null;
        this.isScanning = false;
        this.selectedArea = null;
        this.patches = new Map();
        this.currentSession = null;
        this.compactControls = {};
        this.layers = {
            scanArea: null,
            patches: null,
            detections: null,
            animations: null
        };
        this.statusManager = null;
        this.websocket = null;
        this.currentUser = null;
        this.currentLidarSession = null;
        this.currentLidarHeatmapSession = null;
        this.mapVisualization = null;
        this.scanningIcon = null;
        this.resolutionBadge = null;
        this.satelliteBeam = null; // For the dynamic beam
        this.satelliteBeamLatLng = null; // Target tile position
        
        console.log('🚀 RE-Archaeology App initialized');
    }
    
    async init() {
        try {
            console.log('🔧 Starting application initialization...');
            
            // Wait for DOM to be ready
            if (document.readyState !== 'complete') {
                await new Promise(resolve => {
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', resolve);
                    } else {
                        resolve();
                    }
                });
            }
            
            // Initialize map first
            this.initializeMap();
            this.initializeLayers(); // <-- Ensure layers are initialized first
            this.setupDefaultScanArea(); // <-- Now safe to call
            this.setupEventListeners();
            this.initializeStatusManager();
            this.initializeAuth();
            
            console.log('✅ Application initialized successfully');
            
        } catch (error) {
            console.error('❌ Application initialization failed:', error);
            throw error;
        }
    }
    
    initializeMap() {
        console.log('🗺️ Initializing map...');
        
        const container = document.getElementById('mapContainer');
        if (!container) {
            throw new Error('Map container not found');
        }
        
        // Remove old map and controls if they exist
        if (container._leaflet_id) {
            if (container._leaflet_map && typeof container._leaflet_map.remove === 'function') {
                container._leaflet_map.remove();
            }
            while (container.firstChild) {
                container.removeChild(container.firstChild);
            }
            delete container._leaflet_id;
            delete container._leaflet_map;
        }
        
        // Prevent double initialization
        if (container._leaflet_id) {
            console.warn('Map container is already initialized. Skipping map creation.');
            // Optionally, you can reuse the existing map instance if needed
            this.map = container._leaflet_map || null;
            return;
        }
        
        // Ensure container has dimensions
        container.style.width = '100%';
        container.style.height = '100vh';
        container.style.minHeight = '100vh';
        
        // Force layout recalculation
        container.offsetHeight;
        
        if (!container.offsetWidth || !container.offsetHeight) {
            throw new Error('Map container has no dimensions');
        }
        
        console.log('✅ Container ready:', {
            width: container.offsetWidth,
            height: container.offsetHeight
        });
        
        // Create Leaflet map
        this.map = L.map(container, {
            center: [52.4751, 4.8156],
            zoom: 13,
            zoomControl: true,
            attributionControl: true,
            dragging: true,
            touchZoom: true,
            doubleClickZoom: true,
            scrollWheelZoom: true,
            boxZoom: true,
            keyboard: true
        });
        
        console.log('✅ Leaflet map created');
        
        // Add base layers
        this.addBaseLayers();
        
        // Initialize layer groups
        this.initializeLayers();
        
        // Setup map events
        this.setupMapEvents();
        
        console.log('✅ Map initialization complete');
    }
    
    addBaseLayers() {
        console.log('🗺️ Adding base layers...');
        
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
        const baseLayers = {
            '🛰️ Satellite': satellite,
            '🗺️ Street': street,
            '🏔️ Terrain': terrain
        };
        
        // No overlay layers - LiDAR is now controlled through the dedicated scan panel
        const overlayLayers = {};
 
        L.control.layers(baseLayers, overlayLayers, {
            position: 'topright',
            collapsed: false
        }).addTo(this.map);
        
        // Scale control
        L.control.scale({
            position: 'bottomleft',
            imperial: false
        }).addTo(this.map);
        
        console.log('✅ Base layers added');
    }
    
    initializeLayers() {
        console.log('🔧 Initializing layer groups...');
        
        this.layers.scanArea = L.layerGroup().addTo(this.map);
        this.layers.patches = L.layerGroup().addTo(this.map);
        this.layers.detections = L.layerGroup().addTo(this.map);
        this.layers.animations = L.layerGroup().addTo(this.map);
        
        console.log('✅ Layer groups initialized');
    }
    
    setupMapEvents() {
        console.log('🔧 Setting up map events...');
        
        // Ctrl+Click for scan area selection
        this.map.on('click', (e) => {
            if (e.originalEvent.ctrlKey && !this.isScanning) {
                console.log('🎯 Ctrl+Click detected, setting scan area');
                this.selectScanArea(e.latlng.lat, e.latlng.lng);
            }
        });
        
        // Map ready event
        this.map.whenReady(() => {
            console.log('✅ Map is ready for interactions');
        });
        
        console.log('✅ Map events configured');
    }
    
    setupDefaultScanArea() {
        console.log('🔧 Setting up default scan area...');
        
        const defaultLat = 52.4751;
        const defaultLon = 4.8156;
        const defaultRadius = 1.0;
        
        this.selectScanArea(defaultLat, defaultLon, defaultRadius);
        
        console.log('✅ Default scan area set');
    }
    
    selectScanArea(lat, lon, radiusKm = null) {
        console.log('🎯 Setting scan area:', { lat, lon, radiusKm });
        
        const radius = radiusKm || 1; // Default to 1km
        
        // Clear existing scan area rectangle
        if (this.scanAreaRectangle) {
            this.map.removeLayer(this.scanAreaRectangle);
            this.scanAreaRectangle = null;
        }
        
        // Calculate rectangle bounds for the scan area (square, not rectangle)
        const radiusInDegreesLat = radius / 111.32; // Latitude degrees
        const radiusInDegreesLon = radius / (111.32 * Math.cos(lat * Math.PI / 180)); // Longitude degrees adjusted for latitude
        const bounds = [
            [lat - radiusInDegreesLat, lon - radiusInDegreesLon], // southwest
            [lat + radiusInDegreesLat, lon + radiusInDegreesLon]  // northeast
        ];
        
        // Create scan area rectangle with transparent fill and zoom-responsive border
        const zoom = this.map.getZoom();
        const baseWeight = 3;
        const zoomFactor = Math.pow(2, (zoom - 13) / 3);
        const borderWeight = Math.max(1, Math.min(6, baseWeight * zoomFactor));
        
        this.scanAreaRectangle = L.rectangle(bounds, {
            color: '#00ff88',           // Green border
            weight: borderWeight,       // Zoom-responsive border thickness  
            fillColor: 'none',          // No fill color
            fillOpacity: 0,             // No fill opacity
            fill: false,                // Explicitly disable fill
            opacity: 0.9,              // High border visibility
            interactive: false          // Don't interfere with map interactions
        }).addTo(this.map);
        
        // Add zoom handler to update border thickness
        this.map.off('zoomend', this.updateScanAreaBorder); // Remove existing handler
        this.updateScanAreaBorder = () => {
            if (this.scanAreaRectangle) {
                const currentZoom = this.map.getZoom();
                const currentZoomFactor = Math.pow(2, (currentZoom - 13) / 3);
                const currentBorderWeight = Math.max(1, Math.min(6, baseWeight * currentZoomFactor));
                this.scanAreaRectangle.setStyle({ weight: currentBorderWeight });
            }
        };
        this.map.on('zoomend', this.updateScanAreaBorder);
        
        // Store area data
        this.selectedArea = {
            lat, 
            lon, 
            radius: radius,
            bounds: bounds,  // Store the calculated bounds
            isLocked: this.isScanning
        };
        
        console.log('✅ Scan area rectangle created with transparent fill');
        this.updateButtonStates();
    }
    
    setupEventListeners() {
        console.log('🔧 Setting up event listeners...');
        
        // LiDAR Scan buttons (main functionality)
        document.getElementById('startLidarScanBtn')?.addEventListener('click', () => {
            this.startLidarScan();
        });
        
        document.getElementById('stopLidarScanBtn')?.addEventListener('click', () => {
            this.stopLidarScan();
        });
        
        document.getElementById('clearLidarScanBtn')?.addEventListener('click', () => {
            this.clearLidarScan();
        });
        
        console.log('🔧 LiDAR button check:', {
            startBtn: !!document.getElementById('startLidarScanBtn'),
            stopBtn: !!document.getElementById('stopLidarScanBtn'),
            clearBtn: !!document.getElementById('clearLidarScanBtn'),
            enableDetection: !!document.getElementById('enableDetection'),
            structureType: !!document.getElementById('structureType')
        });
        
        console.log('✅ Event listeners configured');
    }
    
    /**
     * Start LiDAR scan with optional detection - clean and simplified
     */
    async startLidarScan() {
        if (!this.selectedArea) {
            console.warn('⚠️ No scan area selected. Please select an area first.');
            alert('Please select a scan area first by clicking on the map.');
            return;
        }
        
        const enableDetection = document.getElementById('enableDetection')?.checked || false;
        const structureType = document.getElementById('structureType')?.value || 'windmill';
        
        console.log('🛰️ Starting LiDAR scan:', { enableDetection, structureType });
        
        try {
            // Determine scan parameters based on zoom and area
            const scanParams = this.calculateScanParameters();
            
            // Start UI animations and show progress
            this.startScanUI(scanParams);
            
            // Configure and start the scan
            const config = {
                center_lat: this.selectedArea.lat,
                center_lon: this.selectedArea.lon,
                radius_km: this.selectedArea.radius,
                tile_size_m: scanParams.tileSize,
                heatmap_mode: true,
                streaming_mode: true,
                resolution: scanParams.resolution,
                enable_detection: enableDetection,
                structure_type: structureType
            };
            
            // Start the backend scan
            const result = await this.startBackendScan(config);
            
            // Store session and start monitoring
            this.currentLidarHeatmapSession = result.session_id;
            this.monitorLidarHeatmapProgress();
            
            console.log('✅ LiDAR scan started successfully');
            
        } catch (error) {
            console.error('❌ Failed to start LiDAR scan:', error);
            alert('Failed to start LiDAR scan: ' + error.message);
            this.cleanupAfterStop();
        }
    }
    
    /**
     * Calculate scan parameters based on zoom level and area
     */
    calculateScanParameters() {
        const zoomLevel = this.map.getZoom();
        const areaKm = this.selectedArea.radius;
        
        if (zoomLevel >= 16 || areaKm <= 0.5) {
            return { tileSize: 32, resolution: '0.25m', iconType: 'airplane' };
        } else if (zoomLevel >= 14 || areaKm <= 2) {
            return { tileSize: 64, resolution: '0.5m', iconType: 'satellite' };
        } else {
            return { tileSize: 128, resolution: '1m', iconType: 'satellite' };
        }
    }
    
    /**
     * Start UI elements for scan
     */
    startScanUI(scanParams) {
        this.showResolutionBadge(scanParams.resolution);
        this.startScanningAnimation(scanParams.iconType, scanParams.resolution);
        this.updateLidarScanButtonStates(true);
        
        // Initialize map visualization
        if (!this.mapVisualization) {
            this.initializeMapVisualization();
        }
        
        // Enable heatmap mode
        if (this.mapVisualization) {
            this.mapVisualization.enableHeatmapMode();
        }
    }
    
    /**
     * Start the backend scan
     */
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
    
    /**
     * Stop LiDAR scan - simplified and clean
     */
    async stopLidarScan() {
        console.log('🛑 Stopping LiDAR scan...');
        
        try {
            // Update button to show stopping state
            const stopBtn = document.getElementById('stopLidarScanBtn');
            if (stopBtn) {
                stopBtn.textContent = 'Stopping...';
                stopBtn.disabled = true;
            }
            
            // Stop the backend session
            if (this.currentLidarHeatmapSession) {
                try {
                    await this.stopLidarHeatmapSession();
                    console.log('✅ Backend session stopped successfully');
                } catch (stopError) {
                    console.warn('⚠️ Backend stop failed, continuing with cleanup:', stopError.message);
                }
            }
            
            // Disable heatmap mode
            if (this.mapVisualization) {
                this.mapVisualization.disableHeatmapMode();
            }
            
            console.log('✅ LiDAR scan stopped successfully');
            
        } catch (error) {
            console.error('❌ Failed to stop LiDAR scan:', error);
        } finally {
            // Always clean up UI and state
            this.cleanupAfterStop();
        }
    }
    
    /**
     * Clear LiDAR scan results
     */
    async clearLidarScan() {
        console.log('🧹 Clearing LiDAR scan results...');
        
        try {
            // Stop any running scan first
            await this.stopLidarScan();
            
            // Clear heatmap tiles from map
            if (this.mapVisualization && this.mapVisualization.heatmapTiles) {
                this.mapVisualization.heatmapTiles.forEach(tile => {
                    try {
                        if (tile.remove) {
                            tile.remove();
                        } else if (tile.removeFrom && this.map) {
                            tile.removeFrom(this.map);
                        }
                    } catch (removeError) {
                        console.warn('⚠️ Error removing tile:', removeError);
                    }
                });
                this.mapVisualization.heatmapTiles.clear();
            }
            
            // Clear other LiDAR overlays
            if (this.mapVisualization) {
                this.mapVisualization.clearElevationData();
                this.mapVisualization.clearLidarHeatmap();
            }
            
            // Clear all result layers
            this.layers.patches.clearLayers();
            this.layers.detections.clearLayers();
            this.layers.animations.clearLayers();
            
            // Clear patches data
            this.patches.clear();
            
            // Reset session IDs
            this.currentLidarHeatmapSession = null;
            this.currentLidarSession = null;
            this.currentSession = null;
            
            console.log('✅ LiDAR scan results cleared');
            
        } catch (error) {
            console.error('❌ Error clearing LiDAR scan:', error);
        }
    }
    
    /**
     * Update LiDAR scan button states
     */
    updateLidarScanButtonStates(isRunning) {
        const startBtn = document.getElementById('startLidarScanBtn');
        const stopBtn = document.getElementById('stopLidarScanBtn');
        
        if (startBtn && stopBtn) {
            startBtn.disabled = isRunning || !this.selectedArea;
            stopBtn.disabled = !isRunning;
            
            startBtn.textContent = isRunning ? 'Scanning...' : 'Scan';
        }
    }
    
    /**
     * Initialize map visualization component
     */
    initializeMapVisualization() {
        console.log('🔧 Checking MapVisualization availability...');
        console.log('🔧 window.MapVisualization exists:', !!window.MapVisualization);
        console.log('🔧 typeof window.MapVisualization:', typeof window.MapVisualization);
        
        if (window.MapVisualization) {
            try {
                this.mapVisualization = new window.MapVisualization(this.map);
                console.log('✅ Map visualization initialized successfully');
                console.log('🔧 MapVisualization methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(this.mapVisualization)).filter(name => name !== 'constructor'));
            } catch (error) {
                console.error('❌ Failed to initialize MapVisualization:', error);
                this.mapVisualization = null;
            }
        } else {
            console.warn('⚠️ MapVisualization not available');
            console.warn('⚠️ Available window properties:', Object.keys(window).filter(k => k.toLowerCase().includes('map') || k.toLowerCase().includes('visual')));
        }
    }
    
    /**
     * Monitor LiDAR progress through WebSocket
     */
    monitorLidarProgress() {
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            this.connectWebSocket();
        }
        
        // WebSocket message handling for LiDAR tiles will be handled in existing WebSocket setup
        console.log('📡 Monitoring LiDAR progress via WebSocket');
    }
    
    async startDetection() {
        if (this.isScanning || !this.selectedArea) {
            console.warn('⚠️ Cannot start detection');
            return;
        }
        
        console.log('🚀 Starting detection...');
        
        this.isScanning = true;
        this.updateButtonStates();
        
        // Lock scan area during scanning
        if (this.scanAreaRectangle) {
            this.scanAreaRectangle.setStyle({ interactive: false });
        }
        
        try {
            // Get detection parameters
            const params = {
                center_lat: this.selectedArea.lat,
                center_lon: this.selectedArea.lon,
                radius_km: this.selectedArea.radius,
                patch_size: parseInt(document.getElementById('patchSize')?.value || 40),
                sliding_step: parseInt(document.getElementById('slidingStep')?.value || 1),
                phi0_threshold: parseFloat(document.getElementById('phi0Threshold')?.value || 0.35),
                psi0_threshold: parseFloat(document.getElementById('psi0Threshold')?.value || 0.4),
                detection_mode: document.getElementById('detectionMode')?.value || 'windmill'
            };
            
            console.log('🔬 Detection parameters:', params);
            
            // Start detection via API
            const response = await fetch(`${window.AppConfig.apiBase}/detection/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(params)
            });
            
            if (!response.ok) {
                throw new Error(`Detection API failed: ${response.status}`);
            }
            
            const result = await response.json();
            this.currentSession = result.session_id;
            
            console.log('✅ Detection started, session:', this.currentSession);
            
            // Start monitoring for results
            this.monitorDetectionProgress();
            
        } catch (error) {
            console.error('❌ Failed to start detection:', error);
            this.isScanning = false;
            this.updateButtonStates();
            
            // Unlock scan area after error
            if (this.scanAreaRectangle) {
                this.scanAreaRectangle.setStyle({ interactive: true });
            }
        }
    }
    
    async stopDetection() {
        if (!this.isScanning || !this.currentSession) {
            return;
        }
        
        console.log('🛑 Stopping detection...');
        
        try {
            await fetch(`${window.AppConfig.apiBase}/detection/stop`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ session_id: this.currentSession })
            });
            
            this.isScanning = false;
            this.currentSession = null;
            this.updateButtonStates();
            
            // Unlock scan area after stopping
            if (this.scanAreaRectangle) {
                this.scanAreaRectangle.setStyle({ interactive: true });
            }
            
            console.log('✅ Detection stopped');
            
        } catch (error) {
            console.error('❌ Failed to stop detection:', error);
        }
    }
    
    clearResults() {
        console.log('🧹 Clearing results...');
        
        // Clear patches layer
        this.layers.patches.clearLayers();
        this.layers.detections.clearLayers();
        this.layers.animations.clearLayers();
        
        // Clear patches data
        this.patches.clear();
        
        console.log('✅ Results cleared');
    }
    
    monitorDetectionProgress() {
        if (!this.currentSession) return;
        
        // Connect to WebSocket for real-time updates
        this.connectWebSocket();
        
        // Also poll for updates as backup
        this.pollDetectionStatus();
    }
    
    connectWebSocket() {
        try {
            const wsUrl = `ws://${window.location.host}/api/v1/ws/discovery`;
            console.log('🔌 Connecting to WebSocket:', wsUrl);
            this.websocket = new WebSocket(wsUrl);
            
            this.websocket.onopen = () => {
                console.log('✅ WebSocket connected successfully');
            };
            
            this.websocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('📨 Raw WebSocket message received:', data.type);
                    this.handleWebSocketMessage(data);
                } catch (parseError) {
                    console.error('❌ Failed to parse WebSocket message:', parseError, event.data);
                }
            };
            
            this.websocket.onclose = () => {
                console.log('🔌 WebSocket disconnected');
                this.websocket = null;
                // Try to reconnect after 3 seconds if we have active sessions
                if (this.currentLidarHeatmapSession || this.currentLidarSession) {
                    console.log('🔄 Attempting WebSocket reconnection in 3 seconds...');
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
    
    async pollDetectionStatus() {
        if (!this.isScanning || !this.currentSession) return;
        
        try {
            const response = await fetch(`${window.AppConfig.apiBase}/discovery/status`);
            if (response.ok) {
                const data = await response.json();
                this.handleDetectionUpdate(data);
            }
        } catch (error) {
            console.error('❌ Polling error:', error);
        }
        
        // Continue polling
        if (this.isScanning) {
            setTimeout(() => this.pollDetectionStatus(), 2000);
        }
    }
    
    handleDetectionUpdate(data) {
        console.log('📊 Detection update:', data);
        
        // Update status
        document.getElementById('sessionStatus').textContent = data.status || 'Processing';
        
        // Handle patches
        if (data.patches) {
            data.patches.forEach(patch => {
                this.addPatchVisualization(patch);
            });
        }
        
        // Handle detections
        if (data.detections) {
            data.detections.forEach(detection => {
                this.addDetectionVisualization(detection);
            });
        }
        
        // Check if completed
        if (data.status === 'completed' || data.status === 'finished') {
            this.isScanning = false;
            this.updateButtonStates();
            
            // Unlock scan area after completion
            if (this.scanAreaRectangle) {
                this.scanAreaRectangle.setStyle({ interactive: true });
            }
            
            console.log('✅ Detection completed');
        }
    }
    
    addPatchVisualization(patch) {
        if (this.patches.has(patch.id)) {
            return; // Already visualized
        }
        
        const bounds = [
            [patch.bounds.south, patch.bounds.west],
            [patch.bounds.north, patch.bounds.east]
        ];
        
        const color = patch.is_positive ? '#ff6b35' : '#4a90e2';
        const opacity = patch.is_positive ? 0.8 : 0.3;
        
        const rectangle = L.rectangle(bounds, {
            color: color,
            weight: patch.is_positive ? 2 : 1,
            fillColor: color,
            fillOpacity: opacity * 0.3,
            opacity: opacity
        });
        
        // Add popup with patch info
        const popupContent = `
            <div>
                <h4>Patch ${patch.id}</h4>
                <p><strong>Confidence:</strong> ${(patch.confidence * 100).toFixed(1)}%</p>
                <p><strong>Size:</strong> ${patch.size_m}m</p>
                <p><strong>Type:</strong> ${patch.is_positive ? 'Detection' : 'Background'}</p>
                ${patch.phi0 ? `<p><strong>φ⁰:</strong> ${patch.phi0.toFixed(3)}</p>` : ''}
                ${patch.psi0 ? `<p><strong>ψ⁰:</strong> ${patch.psi0.toFixed(3)}</p>` : ''}
            </div>
        `;
        
        rectangle.bindPopup(popupContent);
        
        this.layers.patches.addLayer(rectangle);
        this.patches.set(patch.id, { patch, rectangle });
    }
    
    addDetectionVisualization(detection) {
        const marker = L.circleMarker([detection.lat, detection.lon], {
            color: '#ff0000',
            fillColor: '#ff0000',
            fillOpacity: 0.8,
            radius: 8,
            weight: 2
        });
        
        const popupContent = `
            <div>
                <h4>🏛️ Detection</h4>
                <p><strong>Confidence:</strong> ${(detection.confidence * 100).toFixed(1)}%</p>
                <p><strong>Type:</strong> ${detection.type}</p>
                <p><strong>Location:</strong> ${detection.lat.toFixed(6)}, ${detection.lon.toFixed(6)}</p>
            </div>
        `;
        
        marker.bindPopup(popupContent);
        this.layers.detections.addLayer(marker);
    }
    
    updateButtonStates() {
        // Update LiDAR scan button states
        this.updateLidarScanButtonStates(this.currentLidarHeatmapSession !== null);
    }
    
    initializeStatusManager() {
        console.log('🔧 Initializing status manager...');
        // Placeholder for status management
        document.getElementById('sessionStatus').textContent = 'Ready';
        console.log('✅ Status manager ready');
    }
    
    initializeAuth() {
        console.log('🔧 Initializing authentication...');
        
        // Google OAuth callback with error handling
        window.handleGoogleLogin = (response) => {
            try {
                console.log('✅ Google login successful');
                this.handleGoogleAuthSuccess(response);
            } catch (error) {
                console.error('❌ Google login callback error:', error);
            }
        };
        
        window.handleGoogleError = (error) => {
            console.error('❌ Google login failed:', error);
        };
        
        // Handle Google OAuth loading errors
        window.addEventListener('error', (event) => {
            if (event.target && event.target.src && event.target.src.includes('accounts.google.com')) {
                console.warn('⚠️ Google OAuth script loading issue, continuing without authentication');
            }
        });
        
        console.log('✅ Authentication ready');
    }
    
    handleGoogleAuthSuccess(response) {
        // Decode JWT token to get user info
        try {
            const payload = JSON.parse(atob(response.credential.split('.')[1]));
            this.currentUser = {
                id: payload.sub,
                email: payload.email,
                name: payload.name,
                picture: payload.picture
            };
            
            console.log('✅ User authenticated:', this.currentUser.name);
            this.updateAuthUI();
            
        } catch (error) {
            console.error('❌ Failed to parse auth token:', error);
        }
    }
    
    updateAuthUI() {
        if (this.currentUser) {
            // Hide login section
            document.getElementById('login-section').style.display = 'none';
            
            // Show chat input
            document.getElementById('chat-input-form').style.display = 'flex';
            document.getElementById('chat-input').disabled = false;
            document.getElementById('send-btn').disabled = false;
            
            // Show user profile
            document.getElementById('user-profile').style.display = 'block';
            document.getElementById('user-avatar').src = this.currentUser.picture;
            document.getElementById('user-name').textContent = this.currentUser.name;
            document.getElementById('user-email').textContent = this.currentUser.email;
            document.getElementById('logout-btn').style.display = 'block';
            
            // Update welcome message
            document.getElementById('chat-welcome').innerHTML = `
                <p>👋 Welcome ${this.currentUser.name}!</p>
                <p>I'm ready to help with your archaeological discoveries.</p>
            `;
        }
    }
    
    /**
     * Start scanning animation with satellite or airplane icon
     */
    startScanningAnimation(iconType = 'satellite', resolution = '0.5m') {
        // Always remove any existing scanning icon first to prevent duplicates
        this.stopScanningAnimation();
        
        // Wait a frame to ensure cleanup is complete
        requestAnimationFrame(() => {
            console.log(`🛰️ Creating new ${iconType} scanning animation (${resolution} resolution)`);
            
            // Create scanning icon element
            const scanIcon = document.createElement('div');
            scanIcon.className = `scanning-icon ${iconType}`;
            scanIcon.innerHTML = iconType === 'airplane' ? '✈️' : '🛰️';
            scanIcon.setAttribute('data-animation-id', Date.now()); // Unique ID for debugging
            
            // Set CSS styles directly
            scanIcon.style.cssText = `
                position: absolute;
                z-index: 1000;
                pointer-events: none;
                font-size: ${resolution.includes('0.25') || resolution.includes('0.1') ? '28px' : '24px'};
                filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
                transition: all 0.2s ease;
                opacity: 0;
            `;
            
            // Position relative to map container
            const mapContainer = this.map.getContainer();
            mapContainer.appendChild(scanIcon);
            
            // Store reference for cleanup
            this.scanningIcon = scanIcon;
            
            // Initialize animation tracking
            this.animationState = {
                tileCount: 0,
                lastTileTime: Date.now(),
                startTime: Date.now(),
                currentTileCenter: null, // Will store [lat, lon] of current tile being processed
                isActive: true,
                iconType: iconType,
                resolution: resolution
            };
            
            // Start with tile-based animation instead of time-based
            this.animateScanningIconWithTiles(scanIcon, resolution);
            
            console.log(`✅ Started ${iconType} scanning animation with ID:`, scanIcon.getAttribute('data-animation-id'));
        });
    }
    
    /**
     * Draw or update the satellite beam (white thin line) from the scanning icon to the current tile
     * @param {L.LatLng} targetLatLng - The lat/lng of the current tile being rendered
     */
    drawSatelliteBeam(targetLatLng) {
        if (!this.map || !this.scanningIcon || !targetLatLng) return;
        // Remove previous beam if any
        if (this.satelliteBeam) {
            this.map.removeLayer(this.satelliteBeam);
            this.satelliteBeam = null;
        }
        // Get satellite icon position (center of icon in pixels)
        const mapContainer = this.map.getContainer();
        const iconRect = this.scanningIcon.getBoundingClientRect();
        const mapRect = mapContainer.getBoundingClientRect();
        const iconCenter = [
            iconRect.left + iconRect.width / 2 - mapRect.left,
            iconRect.top + iconRect.height / 2 - mapRect.top
        ];
        // Convert icon pixel position to lat/lng
        const iconLatLng = this.map.containerPointToLatLng(iconCenter);
        // Draw a white polyline from iconLatLng to targetLatLng
        this.satelliteBeam = L.polyline([
            iconLatLng,
            targetLatLng
        ], {
            color: '#fff',
            weight: 2,
            opacity: 0.85,
            dashArray: '4, 6',
            interactive: false
        }).addTo(this.map);
        this.satelliteBeamLatLng = targetLatLng;
    }

    /**
     * Clear the satellite beam from the map
     */
    clearSatelliteBeam() {
        if (this.satelliteBeam) {
            this.map.removeLayer(this.satelliteBeam);
            this.satelliteBeam = null;
            this.satelliteBeamLatLng = null;
        }
    }
    
    /**
     * Animate scanning icon based on tile progress instead of time
     */
    animateScanningIconWithTiles(iconElement, resolution) {
        if (!this.selectedArea || !iconElement) return;
        
        console.log('🛰️ Starting tile-based animation for selected area:', this.selectedArea);
        
        const map = this.map;
        const bounds = this.selectedArea.bounds;
        
        // Get scan area bounds in pixels
        const updatePosition = () => {
            if (!this.scanningIcon || this.scanningIcon !== iconElement || !this.animationState?.isActive) {
                this.clearSatelliteBeam();
                return; // Animation stopped
            }
            
            try {
                // Convert geographic bounds to pixel coordinates
                const southWest = map.latLngToContainerPoint([bounds[0][0], bounds[0][1]]);
                const northEast = map.latLngToContainerPoint([bounds[1][0], bounds[1][1]]);
                
                if (!southWest || !northEast || isNaN(southWest.x) || isNaN(northEast.y)) {
                    console.warn('⚠️ Invalid coordinate conversion, retrying...');
                    setTimeout(updatePosition, 100);
                    return;
                }
                
                // Calculate scan area dimensions
                const minX = Math.min(southWest.x, northEast.x);
                const maxX = Math.max(southWest.x, northEast.x);
                const minY = Math.min(southWest.y, northEast.y);
                const maxY = Math.max(southWest.y, northEast.y);
                
                const scanWidth = maxX - minX;
                const scanHeight = maxY - minY;
                
                if (scanWidth < 50 || scanHeight < 50) {
                    setTimeout(updatePosition, 100);
                    return;
                }
                
                // Use a combination of tile count and time to determine position
                const baseTime = Date.now() - this.animationState.startTime;
                const timeBasedProgress = (baseTime / 15000) % 1; // 15 second cycle
                const tileCount = this.animationState.tileCount;
                
                // Combine time and tile-based movement for smooth animation
                const cols = 8;
                const rows = 8;
                const totalCells = cols * rows;
                
                // Use time-based progress but jump ahead with tile updates
                const effectiveProgress = (timeBasedProgress + (tileCount * 0.1)) % 1;
                const currentCell = Math.floor(effectiveProgress * totalCells) % totalCells;
                const col = currentCell % cols;
                const row = Math.floor(currentCell / cols);
                
                // Add some randomness to make it look more natural
                const jitter = 5; // pixels
                const jitterX = (Math.random() - 0.5) * jitter;
                const jitterY = (Math.random() - 0.5) * jitter;
                
                // Calculate position with padding
                const padding = 25;
                const usableWidth = scanWidth - (2 * padding);
                const usableHeight = scanHeight - (2 * padding);
                
                if (usableWidth <= 0 || usableHeight <= 0) {
                    setTimeout(updatePosition, 100);
                    return;
                }
                
                const x = minX + padding + (col / Math.max(1, cols - 1)) * usableWidth + jitterX;
                const y = minY + padding + (row / Math.max(1, rows - 1)) * usableHeight + jitterY;
                
                // Constrain to bounds
                const finalX = Math.max(minX + padding, Math.min(maxX - padding, x));
                const finalY = Math.max(minY + padding, Math.min(maxY - padding, y));
                
                // Update position
                iconElement.style.left = `${finalX}px`;
                iconElement.style.top = `${finalY}px`;
                iconElement.style.opacity = '0.9';
                
                // Only draw beam if we don't have real tile data
                // (Real tile data will update the beam via updateAnimationProgress)
                if (!this.animationState.currentTileCenter) {
                    // Fallback: convert satellite pixel position back to lat/lng
                    const tileLatLng = this.map.containerPointToLatLng([finalX, finalY]);
                    this.drawSatelliteBeam(tileLatLng);
                }
                
                // Schedule next update
                setTimeout(updatePosition, 1000 + Math.random() * 500); // Variable timing
                
            } catch (error) {
                console.error('❌ Animation error:', error);
                setTimeout(updatePosition, 1000);
            }
        };
        
        // Start animation
        setTimeout(updatePosition, 500); // Initial delay
        console.log('🛰️ Tile-based animation loop started');
    }

    /**
     * Update animation based on tile progress (called when tiles are received)
     */
    updateAnimationProgress(tileData) {
        if (this.animationState && this.animationState.isActive) {
            this.animationState.tileCount++;
            this.animationState.lastTileTime = Date.now();
            
            console.log('🛰️ Raw tile data received:', tileData);
            console.log('🛰️ Available keys:', Object.keys(tileData || {}));
            
            // Store the real tile bounds for beam targeting - check multiple possible field names
            let tileCenterLat, tileCenterLon;
            
            if (tileData) {
                // Method 1: Direct tile bounds
                if (tileData.tile_bounds) {
                    const bounds = tileData.tile_bounds;
                    tileCenterLat = (bounds.north + bounds.south) / 2;
                    tileCenterLon = (bounds.east + bounds.west) / 2;
                    console.log('🛰️ Using tile_bounds:', bounds);
                }
                // Method 2: Alternative bounds field
                else if (tileData.bounds) {
                    const bounds = tileData.bounds;
                    tileCenterLat = (bounds.north + bounds.south) / 2;
                    tileCenterLon = (bounds.east + bounds.west) / 2;
                    console.log('🛰️ Using bounds:', bounds);
                }
                // Method 3: Center coordinates
                else if (tileData.center_lat && tileData.center_lon) {
                    tileCenterLat = tileData.center_lat;
                    tileCenterLon = tileData.center_lon;
                    console.log('🛰️ Using center coordinates:', {lat: tileCenterLat, lon: tileCenterLon});
                }
                // Method 4: Southwest/Northeast format
                else if (tileData.southwest_lat && tileData.northeast_lat) {
                    tileCenterLat = (tileData.southwest_lat + tileData.northeast_lat) / 2;
                    tileCenterLon = (tileData.southwest_lon + tileData.northeast_lon) / 2;
                    console.log('🛰️ Using southwest/northeast format');
                }
                // Method 5: Check for nested data
                else if (tileData.tile_data && tileData.tile_data.bounds) {
                    const bounds = tileData.tile_data.bounds;
                    tileCenterLat = (bounds.north + bounds.south) / 2;
                    tileCenterLon = (bounds.east + bounds.west) / 2;
                    console.log('🛰️ Using nested tile_data.bounds:', bounds);
                }
                
                if (tileCenterLat && tileCenterLon) {
                    this.animationState.currentTileCenter = [tileCenterLat, tileCenterLon];
                    
                    // Update beam to point to the actual tile being processed
                    this.drawSatelliteBeam(L.latLng(tileCenterLat, tileCenterLon));
                    
                    console.log(`🛰️ Beam updated to tile center: ${tileCenterLat.toFixed(6)}, ${tileCenterLon.toFixed(6)}`);
                } else {
                    console.warn('⚠️ Could not extract tile center from data:', tileData);
                }
            }
            
            // Optional: Add visual feedback for each tile
            if (this.scanningIcon) {
                // Brief pulse effect when a tile is processed
                this.scanningIcon.style.transform = 'scale(1.2)';
                setTimeout(() => {
                    if (this.scanningIcon) {
                        this.scanningIcon.style.transform = 'scale(1)';
                    }
                }, 150);
            }
            
            console.log(`🛰️ Animation updated: ${this.animationState.tileCount} tiles processed`);
        }
    }

    /**
     * Stop scanning animation
     */
    stopScanningAnimation() {
        console.log('🛑 Stopping scanning animation...');
        
        // Stop animation state
        if (this.animationState) {
            this.animationState.isActive = false;
        }
        
        // Remove the scanning icon element
        if (this.scanningIcon) {
            const animationId = this.scanningIcon.getAttribute('data-animation-id');
            console.log('🗑️ Removing scanning icon with ID:', animationId);
            
            try {
                // Fade out animation
                this.scanningIcon.style.opacity = '0';
                setTimeout(() => {
                    if (this.scanningIcon && this.scanningIcon.parentNode) {
                        this.scanningIcon.parentNode.removeChild(this.scanningIcon);
                    }
                }, 200);
            } catch (error) {
                console.warn('⚠️ Error removing scanning icon:', error);
                // Force removal
                if (this.scanningIcon && this.scanningIcon.parentNode) {
                    this.scanningIcon.parentNode.removeChild(this.scanningIcon);
                }
            }
            
            this.scanningIcon = null;
        }
        
        // Clean up any orphaned scanning icons in the DOM
        const mapContainer = this.map?.getContainer();
        if (mapContainer) {
            const orphanedIcons = mapContainer.querySelectorAll('.scanning-icon');
            orphanedIcons.forEach((icon, index) => {
                console.log(`🧹 Removing orphaned scanning icon ${index + 1}`);
                try {
                    icon.parentNode.removeChild(icon);
                } catch (error) {
                    console.warn('⚠️ Error removing orphaned icon:', error);
                }
            });
        }
        
        // Clear the beam if it's still there
        this.clearSatelliteBeam();
        
        // Reset animation state
        this.animationState = null;
        
        console.log('✅ Scanning animation stopped and cleaned up');
    }
    
    /**
     * Show resolution indicator badge
     */
    showResolutionBadge(resolution) {
        // Remove existing badge
        this.hideResolutionBadge();
        
        const badge = document.createElement('div');
        badge.className = 'lidar-resolution-badge';
        badge.innerHTML = `LiDAR: ${resolution}`;
        
        const mapContainer = this.map.getContainer();
        mapContainer.appendChild(badge);
        
        this.resolutionBadge = badge;
    }
    
    /**
     * Hide resolution indicator badge
     */
    hideResolutionBadge() {
        if (this.resolutionBadge) {
            this.resolutionBadge.remove();
            this.resolutionBadge = null;
        }
    }
    
    /**
     * Stop LiDAR heatmap session
     */
    async stopLidarHeatmapSession() {
        if (!this.currentLidarHeatmapSession) {
            console.warn('⚠️ No active LiDAR session to stop');
            return { status: 'success', message: 'No active session' };
        }
        
        const sessionId = this.currentLidarHeatmapSession;
        console.log('🛑 Stopping LiDAR session:', sessionId);
        
        try {
            const response = await fetch(`${window.AppConfig.apiBase}/discovery/stop/${sessionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log(`✅ LiDAR session stopped:`, result.message);
                return result;
            } else if (response.status === 404) {
                console.log(`ℹ️ Session ${sessionId} not found (already stopped)`);
                return { status: 'success', message: 'Session already stopped' };
            } else {
                const errorText = await response.text();
                throw new Error(`Failed to stop session: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('❌ Failed to stop LiDAR session:', error);
            throw error;
        } finally {
            // Always clear the session
            this.currentLidarHeatmapSession = null;
        }
    }
    
    /**
     * Monitor LiDAR heatmap progress through WebSocket
     */
    monitorLidarHeatmapProgress() {
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            this.connectWebSocket();
        }
        
        // WebSocket message handling for LiDAR heatmap tiles will be handled in existing WebSocket setup
        console.log('🔄 Monitoring LiDAR heatmap progress via WebSocket');
    }
    
    /**
     * Manual test function for debugging (call from browser console)
     */
    testLidarScan() {
        console.log('🧪 Manual test: Testing LiDAR scan functionality');
        const enableDetectionCheckbox = document.getElementById('enableDetection');
        const structureTypeSelect = document.getElementById('structureType');
        
        console.log('🧪 LiDAR controls found:', {
            enableDetection: !!enableDetectionCheckbox,
            structureType: !!structureTypeSelect
        });
        console.log('🧪 Selected area:', this.selectedArea);
        console.log('🧪 Current sessions:', {
            heatmap: this.currentLidarHeatmapSession,
            regular: this.currentLidarSession,
            detection: this.currentSession
        });
        
        if (enableDetectionCheckbox) {
            console.log('🧪 Detection enabled:', enableDetectionCheckbox.checked);
        }
        if (structureTypeSelect) {
            console.log('🧪 Structure type:', structureTypeSelect.value);
        }
        
        console.log('🧪 Available test commands:');
        console.log('  - window.reApp.testBackendConnection()');
        console.log('  - window.reApp.forceStopAllSessions()');
        console.log('  - window.reApp.startLidarScan()');
        console.log('  - window.reApp.stopLidarScan()');
        console.log('  - window.reApp.clearLidarScan()');
    }
    
    /**
     * Handle WebSocket messages for real-time updates
     */
    handleWebSocketMessage(data) {
        console.log('📨 WebSocket message:', data);
        
        switch (data.type) {
            case 'detection_update':
                this.handleDetectionUpdate(data);
                break;
                
            case 'lidar_tile':
                console.log('🗺️ Processing lidar_tile message, session_id:', data.session_id);
                console.log('🗺️ Current heatmap session:', this.currentLidarHeatmapSession);
                console.log('🗺️ Current regular session:', this.currentLidarSession);
                this.handleLidarTileUpdate(data);
                break;
                
            case 'lidar_heatmap_tile':
                console.log('🔥 Processing lidar_heatmap_tile message');
                this.handleLidarHeatmapTileUpdate(data);
                break;
                
            case 'lidar_progress':
                console.log('📊 LiDAR progress update:', data);
                this.handleLidarProgressUpdate(data);
                break;
                
            case 'session_complete':
                this.handleSessionComplete(data);
                break;
                
            case 'error':
                console.error('❌ WebSocket error message:', data.message);
                break;
                
            default:
                console.log('📨 Unknown WebSocket message type:', data.type);
        }
    }
    
    /**
     * Handle LiDAR tile updates from WebSocket
     */
    handleLidarTileUpdate(data) {
        console.log('🗺️ LiDAR tile update:', data);
        console.log('🗺️ MapVisualization exists:', !!this.mapVisualization);
        console.log('🗺️ Heatmap mode:', this.mapVisualization?.heatmapMode);
        console.log('🗺️ Session ID comparison:', {
            received: data.session_id,
            heatmapSession: this.currentLidarHeatmapSession,
            regularSession: this.currentLidarSession
        });
        
        // Update animation progress for each tile received
        this.updateAnimationProgress(data);
        
        if (this.mapVisualization) {
            // Check if this is from our heatmap session OR if we're in heatmap mode
            if (this.mapVisualization.heatmapMode && 
                (data.session_id === this.currentLidarHeatmapSession || 
                 !this.currentLidarHeatmapSession)) {
                console.log('🔥 Routing to heatmap handler');
                // Handle as heatmap tile
                this.mapVisualization.addLidarHeatmapTile(data);
                
                // Update session ID tracking if we don't have it
                if (!this.currentLidarHeatmapSession) {
                    this.currentLidarHeatmapSession = data.session_id;
                    console.log('🔥 Updated heatmap session ID to:', data.session_id);
                }
            } else if (data.session_id === this.currentLidarSession) {
                console.log('📊 Routing to regular elevation handler');
                // Handle as regular elevation tile
                this.mapVisualization.addLidarTile(data);
            } else {
                console.warn('⚠️ Received lidar_tile for unknown session:', data.session_id);
                console.warn('⚠️ Known sessions:', {
                    heatmap: this.currentLidarHeatmapSession,
                    regular: this.currentLidarSession
                });
            }
        } else {
            console.error('❌ MapVisualization not available for lidar tile');
            console.error('❌ Available window objects:', Object.keys(window).filter(k => k.includes('Map') || k.includes('Visual')));
        }
    }
    
    /**
     * Handle LiDAR heatmap tile updates from WebSocket
     */
    handleLidarHeatmapTileUpdate(data) {
        console.log('🔥 LiDAR heatmap tile update:', data);
        
        if (this.mapVisualization && this.mapVisualization.heatmapMode && data.tile_data) {
            this.mapVisualization.addLidarHeatmapTile(data.tile_data);
        }
    }
    
    /**
     * Handle LiDAR progress updates from WebSocket
     */
    handleLidarProgressUpdate(data) {
        console.log('📊 LiDAR progress:', data);
        
        // Check if this progress update is for our current heatmap session
        if (data.session_id === this.currentLidarHeatmapSession || 
            data.session_id === this.currentLidarSession) {
            
            // Update any progress indicators if you have them
            const progressPercent = data.progress_percent || 0;
            const processedTiles = data.processed_tiles || 0;
            const totalTiles = data.total_tiles || 0;
            
            console.log(`📊 Scan progress: ${progressPercent.toFixed(1)}% (${processedTiles}/${totalTiles} tiles)`);
            
            // You could update a progress bar here if you have one
            // this.updateProgressBar(progressPercent);
        }
    }
    
    /**
     * Handle session completion
     */
    handleSessionComplete(data) {
        console.log('✅ Session completed:', data);
        
        if (data.session_id === this.currentSession) {
            this.isScanning = false;
            this.updateButtonStates();
            
            // Unlock scan area when session stops
            if (this.scanAreaRectangle) {
                this.scanAreaRectangle.setStyle({ interactive: true });
            }
        }
        
        if (data.session_id === this.currentLidarSession) {
            this.currentLidarSession = null;
            // Keep elevation layer active but stop monitoring
        }
        
        if (data.session_id === this.currentLidarHeatmapSession) {
            this.currentLidarHeatmapSession = null;
            this.stopScanningAnimation();
            // Keep heatmap layer active but stop scanning animation
        }
    }
    
    /**
     * Test backend connectivity and available endpoints
     */
    async testBackendConnection() {
        console.log('🔬 Testing backend connection...');
        
        const testEndpoints = [
            `${window.AppConfig.apiBase}/health`,
            `${window.AppConfig.apiBase}/status`,
            `${window.AppConfig.apiBase}/discovery/status`,
            `${window.AppConfig.apiBase}/discovery/sessions`
        ];
        
        for (const endpoint of testEndpoints) {
            try {
                const response = await fetch(endpoint, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    console.log(`✅ ${endpoint}:`, data);
                } else {
                    console.warn(`⚠️ ${endpoint}: ${response.status} ${response.statusText}`);
                }
            } catch (error) {
                console.error(`❌ ${endpoint}:`, error.message);
            }
        }
        
        // Test WebSocket connection
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            console.log('✅ WebSocket: Connected');
        } else {
            console.warn('⚠️ WebSocket: Not connected');
        }
    }

    /**
     * Global function for toggling collapsible control groups
     * Called from HTML onclick handlers
     */
    toggleControlGroup(headerElement) {
        const controlGroup = headerElement.parentElement;
        const content = controlGroup.querySelector('.control-content');
        const toggleIcon = headerElement.querySelector('.toggle-icon');
        
        if (!content || !toggleIcon) return;
        
        const isCollapsed = controlGroup.classList.contains('collapsed');
        
        if (isCollapsed) {
            // Expand
            controlGroup.classList.remove('collapsed');
            toggleIcon.textContent = '▼';
        } else {
            // Collapse
            controlGroup.classList.add('collapsed');
            toggleIcon.textContent = '▶';
        }
    }
    
    /**
     * Force stop all active sessions - simplified and clean
     */
    async forceStopAllSessions() {
        console.log('🚨 Force stopping all sessions...');
        
        // Collect all active session IDs
        const sessions = [
            this.currentLidarHeatmapSession,
            this.currentLidarSession,
            this.currentSession
        ].filter(Boolean);
        
        if (sessions.length === 0) {
            console.log('ℹ️ No active sessions to stop');
            this.cleanupAfterStop();
            return;
        }
        
        // Stop each session using the correct endpoint
        for (const sessionId of sessions) {
            console.log(`🛑 Stopping session: ${sessionId}`);
            
            try {
                const response = await fetch(`${window.AppConfig.apiBase}/discovery/stop/${sessionId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (response.ok) {
                    console.log(`✅ Session ${sessionId} stopped successfully`);
                } else if (response.status === 404) {
                    console.log(`ℹ️ Session ${sessionId} already stopped`);
                } else {
                    console.warn(`⚠️ Failed to stop session ${sessionId}: ${response.status}`);
                }
            } catch (error) {
                console.warn(`⚠️ Error stopping session ${sessionId}:`, error.message);
            }
        }
        
        // Clean up all state
        this.cleanupAfterStop();
        console.log('✅ Force stop completed');
    }
    
    /**
     * Clean up UI and state after stopping sessions
     */
    cleanupAfterStop() {
        // Clear all session IDs
        this.currentLidarHeatmapSession = null;
        this.currentLidarSession = null;
        this.currentSession = null;
        
        // Update UI
        this.updateLidarScanButtonStates(false);
        this.stopScanningAnimation();
        this.hideResolutionBadge();
        this.clearSatelliteBeam();
    }
}

// Make function globally available
window.toggleControlGroup = REArchaeologyApp.prototype.toggleControlGroup;

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('🌟 Starting RE-Archaeology Framework...');
        
        window.reApp = new REArchaeologyApp();
        window.testApp = window.reApp; // For easier console access
        await window.reApp.init();
        
        // Add debugging methods to global scope for easy console access
        window.debugScan = {
            start: () => window.reApp.startLidarScan(),
            stop: () => window.reApp.stopLidarScan(),
            clear: () => window.reApp.clearLidarScan(),
            testBackend: () => window.reApp.testBackendConnection(),
            forceStop: () => window.reApp.forceStopAllSessions(),
            checkMapViz: () => {
                console.log('🔧 MapVisualization check:');
                console.log('  - Available:', !!window.reApp.mapVisualization);
                console.log('  - Heatmap mode:', window.reApp.mapVisualization?.heatmapMode);
                console.log('  - Animation state:', window.reApp.animationState);
                console.log('  - Sessions:', {
                    heatmap: window.reApp.currentLidarHeatmapSession,
                    regular: window.reApp.currentLidarSession
                });
                console.log('  - WebSocket state:', window.reApp.websocket?.readyState);
            },
            simulateTile: () => {
                if (window.reApp.currentLidarHeatmapSession) {
                    const mockTile = {
                        type: 'lidar_tile',
                        session_id: window.reApp.currentLidarHeatmapSession,
                        tile_bounds: {
                            south: 52.470,
                            north: 52.480,
                            west: 4.810,
                            east: 4.820
                        },
                        elevation_data: []
                    };
                    window.reApp.handleLidarTileUpdate(mockTile);
                } else {
                    console.warn('No active session');
                }
            },
            animationInfo: () => {
                console.log('🛰️ Animation State:', window.reApp.animationState);
                console.log('🛰️ Scanning Icon:', !!window.reApp.scanningIcon);
                console.log('🛰️ Satellite Beam:', !!window.reApp.satelliteBeam);
                console.log('🛰️ Sessions:', {
                    heatmap: window.reApp.currentLidarHeatmapSession,
                    regular: window.reApp.currentLidarSession,
                    detection: window.reApp.currentSession
                });
                if (window.reApp.scanningIcon) {
                    const rect = window.reApp.scanningIcon.getBoundingClientRect();
                    const mapContainer = window.reApp.map.getContainer();
                    const mapRect = mapContainer.getBoundingClientRect();
                    const iconCenter = [
                        rect.left + rect.width / 2 - mapRect.left,
                        rect.top + rect.height / 2 - mapRect.top
                    ];
                    const iconLatLng = window.reApp.map.containerPointToLatLng(iconCenter);
                    console.log('🛰️ Icon position (pixels):', { x: rect.left, y: rect.top });
                    console.log('🛰️ Icon position (lat/lng):', iconLatLng);
                }
                if (window.reApp.satelliteBeam) {
                    const beamLatLngs = window.reApp.satelliteBeam.getLatLngs();
                    console.log('🛰️ Beam from:', beamLatLngs[0], 'to:', beamLatLngs[1]);
                }
                if (window.reApp.animationState?.currentTileCenter) {
                    const [lat, lon] = window.reApp.animationState.currentTileCenter;
                    console.log('🛰️ Current tile center:', {lat, lon});
                    console.log('🛰️ Current tile center (formatted):', `${lat.toFixed(6)}, ${lon.toFixed(6)}`);
                } else {
                    console.log('🛰️ No current tile center available');
                }
            },
            cleanupOrphanedIcons: () => {
                const mapContainer = window.reApp.map?.getContainer();
                if (mapContainer) {
                    const icons = mapContainer.querySelectorAll('.scanning-icon');
                    console.log(`🧹 Found ${icons.length} scanning icons`);
                    icons.forEach((icon, i) => {
                        console.log(`🧹 Removing icon ${i + 1}`);
                        icon.remove();
                    });
                }
            }
        };
        
        console.log('🧪 Debug commands available: window.debugScan');
        console.log('  - debugScan.start() - Start scan');
        console.log('  - debugScan.stop() - Stop scan');
        console.log('  - debugScan.clear() - Clear results');
        console.log('  - debugScan.checkMapViz() - Check MapVisualization');
        console.log('  - debugScan.simulateTile() - Simulate tile update');
        console.log('  - debugScan.animationInfo() - Show animation state');
        console.log('  - debugScan.cleanupOrphanedIcons() - Remove orphaned icons');
        
        console.log('🎉 Application started successfully!');
        
    } catch (error) {
        console.error('💥 Application startup failed:', error);
        
        // Show error to user
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

// Initialize the application when DOM is ready
window.addEventListener('DOMContentLoaded', async () => {
    try {
        window.reArchaeologyApp = new REArchaeologyApp();
        await window.reArchaeologyApp.init();
        console.log('🎉 RE-Archaeology App ready!');
    } catch (error) {
        console.error('❌ Failed to initialize RE-Archaeology App:', error);
    }
});
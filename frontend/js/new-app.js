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
        // Core components
        this.map = null;
        this.mapVisualization = null;
        this.websocket = null;
        
        // Scan state
        this.scanAreaRectangle = null;
        this.selectedArea = null;
        this.isScanning = false;
        
        // Sessions
        this.currentLidarHeatmapSession = null;
        this.currentSession = null;
        
        // UI elements
        this.scanningIcon = null;
        this.resolutionBadge = null;
        this.satelliteBeam = null;
        
        // Data
        this.patches = new Map();
        this.layers = {
            patches: null,
            detections: null,
            animations: null
        };
        
        // Animation state
        this.animationState = null;
        
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
            
            // Initialize components in order
            this.initializeMap();
            this.initializeLayers();
            this.setupDefaultScanArea();
            this.setupEventListeners();
            
            // Set initial button text
            const enableDetection = document.getElementById('enableDetection')?.checked || false;
            this.updateScanButtonText(enableDetection);
            
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
        
        // Clean up existing map
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
        
        // Add scale indicator
        L.control.scale({
            position: 'bottomleft',
            metric: true,
            imperial: true,
            maxWidth: 200
        }).addTo(this.map);
        
        this.addBaseLayers();
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
    
    selectScanArea(lat, lon, radiusKm = 1) {
        console.log('🎯 Setting scan area:', { lat, lon, radiusKm });
        
        // Clear existing scan area rectangle
        if (this.scanAreaRectangle) {
            this.map.removeLayer(this.scanAreaRectangle);
        }
        
        // Calculate rectangle bounds
        const radiusInDegreesLat = radiusKm / 111.32;
        const radiusInDegreesLon = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
        const bounds = [
            [lat - radiusInDegreesLat, lon - radiusInDegreesLon],
            [lat + radiusInDegreesLat, lon + radiusInDegreesLon]
        ];
        
        // Create scan area rectangle
        this.scanAreaRectangle = L.rectangle(bounds, {
            color: '#00ff88',
            weight: this.calculateOptimalBorderWeight(),
            fillOpacity: 0,
            fill: false,
            opacity: 0.9,
            interactive: false
        }).addTo(this.map);
        
        // Maintain constant border weight at all zoom levels
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
        this.map.on('zoom', updateBorder);
        this.updateScanAreaBorder = updateBorder;
        
        // Store area data
        this.selectedArea = { lat, lon, radius: radiusKm, bounds, isLocked: this.isScanning };
        
        console.log('✅ Scan area rectangle created');
        this.updateButtonStates();
    }
    
    /**
     * Zoom map to fit the selected scan area with appropriate padding
     */
    zoomToScanArea() {
        if (!this.selectedArea || !this.selectedArea.bounds) {
            console.warn('⚠️ No scan area selected for zooming');
            return;
        }
        
        console.log('🔍 Zooming to scan area:', this.selectedArea);
        
        // Convert bounds array to Leaflet LatLngBounds object
        const bounds = L.latLngBounds(this.selectedArea.bounds);
        
        // Fit map to bounds with padding
        this.map.fitBounds(bounds, {
            padding: [50, 50], // 50px padding on all sides
            maxZoom: 16,       // Don't zoom in too much
            animate: true,     // Smooth zoom animation
            duration: 1.0      // 1 second animation duration
        });
        
        // Update border weight after zoom animation completes
        const updateBorderAfterZoom = () => {
            if (this.scanAreaRectangle) {
                this.scanAreaRectangle.setStyle({
                    weight: this.calculateOptimalBorderWeight(),
                    color: '#00ff88',
                    opacity: 0.9
                });
            }
        };
        
        // Wait for zoom animation to complete before updating border
        this.map.once('zoomend', updateBorderAfterZoom);
        this.map.once('moveend', updateBorderAfterZoom);
        
        console.log('✅ Map zoomed to scan area');
    }
    
    setupEventListeners() {
        console.log('🔧 Setting up event listeners...');
        
        // LiDAR Scan buttons
        document.getElementById('startLidarScanBtn')?.addEventListener('click', () => this.startLidarScan());
        document.getElementById('stopLidarScanBtn')?.addEventListener('click', () => this.stopLidarScan());
        document.getElementById('clearLidarScanBtn')?.addEventListener('click', () => this.clearLidarScan());
        
        // Detection checkbox event listener
        document.getElementById('enableDetection')?.addEventListener('change', (e) => {
            this.updateScanButtonText(e.target.checked);
        });
        
        console.log('✅ Event listeners configured');
    }
    
    /**
     * Update scan button text based on detection checkbox state
     */
    updateScanButtonText(detectionEnabled) {
        const scanButton = document.getElementById('startLidarScanBtn');
        if (scanButton) {
            scanButton.textContent = detectionEnabled ? 'Scan & Detect' : 'Scan';
        }
    }
    
    /**
     * Start LiDAR scan with optional detection
     */
    async startLidarScan() {
        if (!this.selectedArea) {
            alert('Please select a scan area first by clicking on the map.');
            return;
        }
        
        const enableDetection = document.getElementById('enableDetection')?.checked || false;
        const structureType = document.getElementById('structureType')?.value || 'windmill';
        
        console.log('🛰️ Starting LiDAR scan:', { enableDetection, structureType });
        
        // Zoom to scan area first
        this.zoomToScanArea();
        
        try {
            // Wait a bit for zoom to start, then start UI with updated parameters
            setTimeout(() => {
                // Recalculate scan parameters after zoom (in case zoom level changed)
                const scanParams = this.calculateScanParameters();
                this.startScanUI(scanParams);
                
                // Configure and start the backend scan
                this.startBackendScanAfterDelay(enableDetection, structureType, scanParams);
            }, 500); // Small delay to let zoom start affecting the parameters
            
        } catch (error) {
            console.error('❌ Failed to start LiDAR scan:', error);
            alert('Failed to start LiDAR scan: ' + error.message);
            this.cleanupAfterStop();
        }
    }
    
    /**
     * Start backend scan after a small delay
     */
    async startBackendScanAfterDelay(enableDetection, structureType, scanParams) {
        try {
            // Configure scan - let backend determine optimal resolution
            const config = {
                center_lat: this.selectedArea.lat,
                center_lon: this.selectedArea.lon,
                radius_km: this.selectedArea.radius,
                tile_size_m: scanParams.tileSize,
                heatmap_mode: true,
                streaming_mode: true,
                prefer_high_resolution: scanParams.requestHighRes, // Hint for backend
                enable_detection: enableDetection,
                structure_type: structureType
            };
            
            // Start backend scan
            const result = await this.startBackendScan(config);
            this.currentLidarHeatmapSession = result.session_id;
            
            // Update UI with actual resolution returned by backend
            if (result.actual_resolution) {
                this.updateResolutionDisplay(result.actual_resolution);
                this.updateAnimationForResolution(result.actual_resolution);
            }
            
            this.monitorLidarHeatmapProgress();
            
            console.log('✅ LiDAR scan started successfully with resolution:', result.actual_resolution);
            
        } catch (error) {
            console.error('❌ Failed to start backend scan:', error);
            alert('Failed to start LiDAR scan: ' + error.message);
            this.cleanupAfterStop();
        }
    }
    
    /**
     * Calculate scan parameters based on zoom level and area
     * Frontend is now resolution-agnostic - let backend determine best resolution
     */
    calculateScanParameters() {
        const zoomLevel = this.map.getZoom();
        const areaKm = this.selectedArea.radius;
        
        // Frontend only determines UI parameters - backend will choose optimal resolution
        if (zoomLevel >= 16 || areaKm <= 0.5) {
            return { tileSize: 32, iconType: 'airplane', requestHighRes: true };
        } else if (zoomLevel >= 14 || areaKm <= 2) {
            return { tileSize: 64, iconType: 'satellite', requestHighRes: false };
        } else {
            return { tileSize: 128, iconType: 'satellite', requestHighRes: false };
        }
    }
    
    /**
     * Start UI elements for scan
     */
    startScanUI(scanParams) {
        // Start with placeholder resolution - will be updated when backend responds
        this.showResolutionBadge('Determining...');
        this.startScanningAnimation(scanParams.iconType, null); // No resolution yet
        this.updateLidarScanButtonStates(true);
        
        // Set scan area to scanning state with consistent border
        if (this.scanAreaRectangle) {
            this.scanAreaRectangle.setStyle({
                color: '#00ff88',
                weight: this.calculateOptimalBorderWeight(),  // Use helper method
                fillOpacity: 0,
                fill: false,
                opacity: 0.9,
                interactive: false  // Lock during scan
            });
        }
        
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
     * Stop LiDAR scan
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
            
            if (isRunning) {
                startBtn.textContent = 'Scanning...';
            } else {
                // Restore the correct button text based on detection state
                const enableDetection = document.getElementById('enableDetection')?.checked || false;
                this.updateScanButtonText(enableDetection);
            }
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
            this.scanAreaRectangle.setStyle({ 
                interactive: false,
                weight: 2  // Maintain constant border weight
            });
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
                this.scanAreaRectangle.setStyle({ 
                    interactive: true,
                    weight: 2  // Maintain constant border weight
                });
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
                this.scanAreaRectangle.setStyle({ 
                    interactive: true,
                    weight: 2  // Maintain constant border weight
                });
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
                this.scanAreaRectangle.setStyle({ 
                    interactive: true,
                    weight: 2  // Maintain constant border weight
                });
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

    /**
     * Cleanup after stopping scan
     */
    cleanupAfterStop() {
        this.isScanning = false;
        this.currentLidarHeatmapSession = null;
        this.stopScanningAnimation();
        this.hideResolutionBadge();
        this.updateButtonStates();
        
        // Reset scan area border to normal state with calibrated weight
        if (this.scanAreaRectangle) {
            this.scanAreaRectangle.setStyle({
                color: '#00ff88',
                weight: this.calculateOptimalBorderWeight(),  // Use helper method
                fillOpacity: 0,
                fill: false,
                opacity: 0.9,
                interactive: false  // Keep non-interactive but reset styling
            });
        }
        
        // Reset stop button text
        const stopBtn = document.getElementById('stopLidarScanBtn');
        if (stopBtn) {
            stopBtn.textContent = 'Stop';
            stopBtn.disabled = true;
        }
    }
    
    /**
     * Start scanning animation with satellite or airplane icon
     */
    startScanningAnimation(iconType = 'satellite', actualResolution = null) {
        // Remove any existing scanning icon first
        this.stopScanningAnimation();
        
        console.log(`🛰️ Creating ${iconType} scanning animation`);
        
        // Create scanning icon element
        const scanIcon = document.createElement('div');
        scanIcon.className = `scanning-icon ${iconType}`;
        scanIcon.innerHTML = iconType === 'airplane' ? '✈️' : '🛰️';
        
        // Set CSS styles - size based on icon type, not resolution
        scanIcon.style.cssText = `
            position: absolute;
            z-index: 1000;
            pointer-events: none;
            font-size: ${iconType === 'airplane' ? '28px' : '24px'};
            filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
            transition: all 0.2s ease;
            opacity: 0;
        `;
        
        // Add to map container
        const mapContainer = this.map.getContainer();
        mapContainer.appendChild(scanIcon);
        
        // Store reference
        this.scanningIcon = scanIcon;
        
        // Initialize animation state with adaptive parameters
        const areaKm = this.selectedArea?.radius || 1;
        const isHighRes = iconType === 'airplane'; // Use icon type as high-res indicator
        
        this.animationState = {
            tileCount: 0,
            startTime: Date.now(),
            isActive: true,
            iconType: iconType,
            actualResolution: actualResolution,
            // Adaptive scanning parameters based on icon type and area
            cols: isHighRes ? 16 : (areaKm > 2 ? 8 : 12),
            rows: isHighRes ? 12 : 8,
            cycleDuration: isHighRes ? 25000 : (areaKm > 2 ? 15000 : 20000),
            smoothing: isHighRes ? 0.2 : 0.3
        };
        
        // Start animation
        this.animateScanningIcon(scanIcon);
        
        console.log(`✅ Started ${iconType} scanning animation`);
    }
    
    /**
     * Draw satellite beam from icon to target location
     */
    drawSatelliteBeam(targetLatLng) {
        if (!this.map || !this.scanningIcon || !targetLatLng) return;
        
        // Remove previous beam
        if (this.satelliteBeam) {
            this.map.removeLayer(this.satelliteBeam);
        }
        
        // Get satellite icon position
        const mapContainer = this.map.getContainer();
        const iconRect = this.scanningIcon.getBoundingClientRect();
        const mapRect = mapContainer.getBoundingClientRect();
        const iconCenter = [
            iconRect.left + iconRect.width / 2 - mapRect.left,
            iconRect.top + iconRect.height / 2 - mapRect.top
        ];
        
        // Convert to lat/lng
        const iconLatLng = this.map.containerPointToLatLng(iconCenter);
        
        // Draw beam
        this.satelliteBeam = L.polyline([iconLatLng, targetLatLng], {
            color: '#fff',
            weight: 2,
            opacity: 0.85,
            dashArray: '4, 6',
            interactive: false
        }).addTo(this.map);
    }

    /**
     * Clear the satellite beam
     */
    clearSatelliteBeam() {
        if (this.satelliteBeam) {
            this.map.removeLayer(this.satelliteBeam);
            this.satelliteBeam = null;
        }
    }
    
    /**
     * Animate scanning icon within scan area
     */
    animateScanningIcon(iconElement) {
        if (!this.selectedArea || !iconElement) return;
        
        const map = this.map;
        const bounds = this.selectedArea.bounds;
        
        const updatePosition = () => {
            if (!this.scanningIcon || !this.animationState?.isActive) {
                this.clearSatelliteBeam();
                return;
            }
            
            try {
                // Convert bounds to pixel coordinates
                const southWest = map.latLngToContainerPoint([bounds[0][0], bounds[0][1]]);
                const northEast = map.latLngToContainerPoint([bounds[1][0], bounds[1][1]]);
                
                if (!southWest || !northEast) {
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
                
                // Calculate position with serpentine scanning pattern
                const baseTime = Date.now() - this.animationState.startTime;
                const cycleDuration = this.animationState.cycleDuration || 20000;
                const progress = (baseTime / cycleDuration) % 1;
                
                // Use adaptive grid size and serpentine pattern for realistic scanning
                const cols = this.animationState.cols || 12;
                const rows = this.animationState.rows || 8;
                const smoothing = this.animationState.smoothing || 0.3;
                
                const totalCells = cols * rows;
                const currentCell = Math.floor(progress * totalCells) % totalCells;
                
                // Calculate row and column with serpentine pattern
                const row = Math.floor(currentCell / cols);
                let col;
                
                // Alternate direction for each row (serpentine pattern)
                if (row % 2 === 0) {
                    // Even rows: left to right
                    col = currentCell % cols;
                } else {
                    // Odd rows: right to left
                    col = cols - 1 - (currentCell % cols);
                }
                
                // Add subtle jitter for natural movement
                const jitter = 3; // Reduced jitter for smoother movement
                const jitterX = (Math.random() - 0.5) * jitter;
                const jitterY = (Math.random() - 0.5) * jitter;
                
                // Calculate position with padding
                const padding = 30;
                const usableWidth = scanWidth - (2 * padding);
                const usableHeight = scanHeight - (2 * padding);
                
                // Smooth interpolation between grid points
                const baseX = minX + padding + (col / Math.max(1, cols - 1)) * usableWidth;
                const baseY = minY + padding + (row / Math.max(1, rows - 1)) * usableHeight;
                
                // Add smooth transitions between cells
                const cellProgress = (progress * totalCells) % 1;
                const transitionX = Math.sin(cellProgress * Math.PI * 2) * smoothing;
                const transitionY = Math.cos(cellProgress * Math.PI * 2) * smoothing;
                
                const x = baseX + transitionX + jitterX;
                const y = baseY + transitionY + jitterY;
                
                // Constrain to bounds
                const finalX = Math.max(minX + padding, Math.min(maxX - padding, x));
                const finalY = Math.max(minY + padding, Math.min(maxY - padding, y));
                
                // Update position
                iconElement.style.left = `${finalX}px`;
                iconElement.style.top = `${finalY}px`;
                iconElement.style.opacity = '0.9';
                
                // Draw beam to current position
                const tileLatLng = this.map.containerPointToLatLng([finalX, finalY]);
                this.drawSatelliteBeam(tileLatLng);
                
                // Schedule next update with adaptive timing
                const updateInterval = 800 + Math.random() * 400; // 800-1200ms for natural variation
                setTimeout(updatePosition, updateInterval);
                
            } catch (error) {
                console.error('❌ Animation error:', error);
                setTimeout(updatePosition, 1000);
            }
        };
        
        // Start animation
        setTimeout(updatePosition, 500);
    }

    /**
     * Update animation based on tile progress
     */
    updateAnimationProgress(tileData) {
        if (this.animationState && this.animationState.isActive) {
            this.animationState.tileCount++;
            
            // Extract tile center coordinates
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
                // Update beam to point to actual tile
                this.drawSatelliteBeam(L.latLng(tileCenterLat, tileCenterLon));
            }
            
            // Add visual feedback
            if (this.scanningIcon) {
                this.scanningIcon.style.transform = 'scale(1.2)';
                setTimeout(() => {
                    if (this.scanningIcon) {
                        this.scanningIcon.style.transform = 'scale(1)';
                    }
                }, 150);
            }
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
        
        // Remove scanning icon
        if (this.scanningIcon) {
            try {
                this.scanningIcon.style.opacity = '0';
                setTimeout(() => {
                    if (this.scanningIcon && this.scanningIcon.parentNode) {
                        this.scanningIcon.parentNode.removeChild(this.scanningIcon);
                    }
                }, 200);
            } catch (error) {
                console.warn('⚠️ Error removing scanning icon:', error);
                if (this.scanningIcon && this.scanningIcon.parentNode) {
                    this.scanningIcon.parentNode.removeChild(this.scanningIcon);
                }
            }
            this.scanningIcon = null;
        }
        
        // Clean up orphaned icons
        const mapContainer = this.map?.getContainer();
        if (mapContainer) {
            const orphanedIcons = mapContainer.querySelectorAll('.scanning-icon');
            orphanedIcons.forEach(icon => {
                try {
                    icon.parentNode.removeChild(icon);
                } catch (error) {
                    console.warn('⚠️ Error removing orphaned icon:', error);
                }
            });
        }
        
        // Clear beam and reset state
        this.clearSatelliteBeam();
        this.animationState = null;
        
        console.log('✅ Scanning animation stopped');
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
                
            case 'session_stopped':
                console.log('🛑 Session stopped via WebSocket:', data);
                this.handleSessionStopped(data);
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
        
        // Update resolution display if we receive resolution info from first tile
        if (data.actual_resolution && !this.animationState?.actualResolution) {
            this.updateResolutionDisplay(data.actual_resolution);
            this.updateAnimationForResolution(data.actual_resolution);
        }
        
        // Update animation progress
        this.updateAnimationProgress(data);
        
        if (this.mapVisualization && this.mapVisualization.heatmapMode) {
            if (data.session_id === this.currentLidarHeatmapSession || !this.currentLidarHeatmapSession) {
                this.mapVisualization.addLidarHeatmapTile(data);
                
                // Update session ID if needed
                if (!this.currentLidarHeatmapSession) {
                    this.currentLidarHeatmapSession = data.session_id;
                }
            }
        } else {
            console.error('❌ MapVisualization not available for lidar tile');
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
        
        // Update resolution display if we receive resolution info
        if (data.actual_resolution && !this.animationState?.actualResolution) {
            this.updateResolutionDisplay(data.actual_resolution);
            this.updateAnimationForResolution(data.actual_resolution);
        }
        
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
                this.scanAreaRectangle.setStyle({ 
                    interactive: true,
                    weight: 2  // Maintain constant border weight
                });
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
     * Handle session stopped message from WebSocket
     */
    handleSessionStopped(data) {
        console.log('🛑 Session stopped via WebSocket:', data);
        
        if (data.session_id === this.currentSession) {
            this.isScanning = false;
            this.currentSession = null;
            this.updateButtonStates();
            
            // Unlock scan area when session stops
            if (this.scanAreaRectangle) {
                this.scanAreaRectangle.setStyle({ 
                    interactive: true,
                    weight: this.calculateOptimalBorderWeight()
                });
            }
        }
        
        if (data.session_id === this.currentLidarSession) {
            this.currentLidarSession = null;
            // Keep elevation layer active but stop monitoring
        }
        
        if (data.session_id === this.currentLidarHeatmapSession) {
            this.currentLidarHeatmapSession = null;
            this.stopScanningAnimation();
            this.hideResolutionBadge();
            this.updateButtonStates();
            
            // Reset scan area border
            if (this.scanAreaRectangle) {
                this.scanAreaRectangle.setStyle({
                    color: '#00ff88',
                    weight: this.calculateOptimalBorderWeight(),
                    fillOpacity: 0,
                    fill: false,
                    opacity: 0.9,
                    interactive: false
                });
            }
            
            // Reset stop button
            const stopBtn = document.getElementById('stopLidarScanBtn');
            if (stopBtn) {
                stopBtn.textContent = 'Stop';
                stopBtn.disabled = true;
            }
        }
    }
    
    /**
     * Calculate optimal border weight based on current zoom level
     * @returns {number} The optimal border weight
     */
    calculateOptimalBorderWeight() {
        if (!this.map) return 2;
        
        const zoom = this.map.getZoom();
        
        if (zoom >= 18) {
            return 1.5;  // Thinner at very high zoom
        } else if (zoom <= 10) {
            return 2.5;  // Slightly thicker at low zoom for visibility
        } else {
            return 2;    // Standard weight for medium zoom levels
        }
    }
    
    /**
     * Update resolution display with actual resolution from backend
     */
    updateResolutionDisplay(actualResolution) {
        if (this.resolutionBadge && actualResolution) {
            this.resolutionBadge.innerHTML = `LiDAR: ${actualResolution}`;
            console.log(`📊 Updated resolution display: ${actualResolution}`);
        }
    }
    
    /**
     * Update animation parameters based on actual resolution from backend
     */
    updateAnimationForResolution(actualResolution) {
        if (this.animationState && actualResolution) {
            this.animationState.actualResolution = actualResolution;
            
            // Adjust animation if we now know it's high resolution
            const isHighRes = actualResolution.includes('0.25') || actualResolution.includes('0.1');
            if (isHighRes && this.animationState.iconType !== 'airplane') {
                // Fine-tune parameters for high resolution
                this.animationState.cols = Math.min(16, this.animationState.cols + 4);
                this.animationState.rows = Math.min(12, this.animationState.rows + 2);
                this.animationState.smoothing = 0.2;
            }
            
            console.log(`🎯 Updated animation for resolution: ${actualResolution}`);
        }
    }
    
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('🌟 Starting RE-Archaeology Framework...');
        
        window.reApp = new REArchaeologyApp();
        await window.reApp.init();
        
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
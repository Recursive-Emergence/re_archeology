/**
 * Clean RE-Archaeology Application
 * Single unified class to avoid DOM conflicts and multiple map instances
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
        this.mapVisualization = null;
        
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
        
        // LiDAR elevation overlay
        const lidar = L.tileLayer('https://service.pdok.nl/rce/ahn/wmts/ahn4_05m_dsm/EPSG:3857/{z}/{x}/{y}.png', {
            maxZoom: 16,
            opacity: 0.6
        });
        
        // Layer control
        const baseLayers = {
            '🛰️ Satellite': satellite,
            '🗺️ Street': street,
            '🏔️ Terrain': terrain
        };
        
        const overlayLayers = {
            '📊 LiDAR Elevation': lidar
        };
        
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
        
        // Update UI inputs
        document.getElementById('centerLat').value = defaultLat.toFixed(6);
        document.getElementById('centerLon').value = defaultLon.toFixed(6);
        document.getElementById('scanRadius').value = defaultRadius.toFixed(1);
        
        console.log('✅ Default scan area set');
    }
    
    selectScanArea(lat, lon, radiusKm = null) {
        console.log('🎯 Setting scan area:', { lat, lon, radiusKm });
        
        // Clear existing scan area
        if (this.scanAreaRectangle) {
            this.layers.scanArea.removeLayer(this.scanAreaRectangle);
        }
        
        const radius = (radiusKm || parseFloat(document.getElementById('scanRadius')?.value || 1)) * 1000; // Convert to meters
        
        // Calculate bounds
        const latDelta = radius / 111320;
        const lonDelta = radius / (111320 * Math.cos(lat * Math.PI / 180));
        
        const bounds = [
            [lat - latDelta, lon - lonDelta], // Southwest
            [lat + latDelta, lon + lonDelta]  // Northeast
        ];
        
        // Create rectangle
        this.scanAreaRectangle = L.rectangle(bounds, {
            color: '#00ff88',
            weight: 3,
            opacity: 0.8,
            fillOpacity: 0.1,
            fillColor: '#00ff88',
            interactive: !this.isScanning
        });
        
        // Add to scan area layer
        this.layers.scanArea.addLayer(this.scanAreaRectangle);
        
        // Store area data
        this.selectedArea = {
            lat, 
            lon, 
            radius: radiusKm || 1,
            bounds: bounds,
            rectangle: this.scanAreaRectangle,
            isLocked: this.isScanning
        };
        
        console.log('✅ Scan area created');
        this.updateButtonStates();
    }
    
    setupEventListeners() {
        console.log('🔧 Setting up event listeners...');
        
        // Start scan button
        document.getElementById('startScanBtn')?.addEventListener('click', () => {
            this.startDetection();
        });
        
        // Stop scan button
        document.getElementById('stopScanBtn')?.addEventListener('click', () => {
            this.stopDetection();
        });
        
        // Clear results button
        document.getElementById('clearResultsBtn')?.addEventListener('click', () => {
            this.clearResults();
        });
        
        // Elevation checkbox - LiDAR layer toggle
        this.attachElevationCheckboxListener();
        
        // Scan area input changes
        ['centerLat', 'centerLon', 'scanRadius'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => {
                this.updateScanAreaFromInputs();
            });
        });
        
        console.log('✅ Event listeners configured');
    }
    
    // Attach or re-attach the elevation checkbox event listener
    attachElevationCheckboxListener() {
        const checkbox = document.getElementById('showElevation');
        if (checkbox) {
            checkbox.removeEventListener('change', this._elevationListener);
            this._elevationListener = (e) => this.handleElevationLayerToggle(e.target.checked);
            checkbox.addEventListener('change', this._elevationListener);
        }
    }
    
    updateScanAreaFromInputs() {
        const lat = parseFloat(document.getElementById('centerLat')?.value || 52.4751);
        const lon = parseFloat(document.getElementById('centerLon')?.value || 4.8156);
        const radius = parseFloat(document.getElementById('scanRadius')?.value || 1);

        if (!isNaN(lat) && !isNaN(lon) && !isNaN(radius)) {
            this.selectScanArea(lat, lon, radius);
        }
    }
    
    /**
     * Handle elevation layer checkbox toggle
     * When checked, start LiDAR elevation data loading for selected area
     */
    async handleElevationLayerToggle(isChecked) {
        console.log('🌍 Elevation layer toggle:', isChecked);
        
        if (!this.selectedArea) {
            console.warn('⚠️ No scan area selected. Please select an area first.');
            // Uncheck the checkbox since no area is selected
            const checkbox = document.getElementById('showElevation');
            if (checkbox) checkbox.checked = false;
            return;
        }
        
        if (isChecked) {
            await this.startLidarElevationLayer();
        } else {
            this.clearLidarElevationLayer();
        }
    }
    
    /**
     * Start LiDAR elevation data loading for the selected scan area
     */
    async startLidarElevationLayer() {
        if (!this.selectedArea) {
            console.warn('⚠️ No scan area selected');
            return;
        }
        
        console.log('🚀 Starting LiDAR elevation layer...');
        
        try {
            // Create LiDAR scan configuration
            const config = {
                center_lat: this.selectedArea.lat,
                center_lon: this.selectedArea.lon,
                radius_km: this.selectedArea.radius,
                tile_size_m: 64, // Good balance between detail and performance
                streaming_mode: true
            };
            
            // Make API call to start LiDAR scan
            const response = await fetch(`${window.AppConfig.apiBase}/discovery/lidar-scan`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(config)
            });
            
            if (!response.ok) {
                throw new Error(`LiDAR scan failed: ${response.statusText}`);
            }
            
            const result = await response.json();
            console.log('✅ LiDAR scan started:', result);
            
            // Store session ID for tracking
            this.currentLidarSession = result.session_id;
            
            // Initialize map visualization if not already done
            if (!this.mapVisualization) {
                this.initializeMapVisualization();
            }
            
            // Monitor LiDAR progress via WebSocket
            this.monitorLidarProgress();
            
        } catch (error) {
            console.error('❌ Failed to start LiDAR elevation layer:', error);
            
            // Reset checkbox on error
            const checkbox = document.getElementById('showElevation');
            if (checkbox) checkbox.checked = false;
        }
    }
    
    /**
     * Clear LiDAR elevation layer
     */
    clearLidarElevationLayer() {
        console.log('🧹 Clearing LiDAR elevation layer...');
        
        // Stop current LiDAR session if active
        if (this.currentLidarSession) {
            this.stopLidarSession();
        }
        
        // Clear map visualization
        if (this.mapVisualization && this.mapVisualization.clearLidarHeatmap) {
            this.mapVisualization.clearLidarHeatmap();
        }
        
        this.currentLidarSession = null;
    }
    
    /**
     * Stop current LiDAR session
     */
    async stopLidarSession() {
        if (!this.currentLidarSession) return;
        
        try {
            const response = await fetch(`${window.AppConfig.apiBase}/discovery/stop/${this.currentLidarSession}`, {
                method: 'POST'
            });
            
            if (response.ok) {
                console.log('✅ LiDAR session stopped');
            }
        } catch (error) {
            console.warn('⚠️ Failed to stop LiDAR session:', error);
        }
    }
    
    /**
     * Initialize map visualization component
     */
    initializeMapVisualization() {
        if (window.MapVisualization) {
            this.mapVisualization = new window.MapVisualization(this.map);
            console.log('✅ Map visualization initialized');
        } else {
            console.warn('⚠️ MapVisualization not available');
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
        
        // Lock scan area
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
            this.websocket = new WebSocket(wsUrl);
            
            this.websocket.onopen = () => {
                console.log('✅ WebSocket connected');
            };
            
            this.websocket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            };
            
            this.websocket.onclose = () => {
                console.log('🔌 WebSocket disconnected');
                this.websocket = null;
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
        const startBtn = document.getElementById('startScanBtn');
        const stopBtn = document.getElementById('stopScanBtn');
        
        if (startBtn && stopBtn) {
            startBtn.disabled = this.isScanning || !this.selectedArea;
            stopBtn.disabled = !this.isScanning;
            
            startBtn.textContent = this.isScanning ? 'Scanning...' : 'Start Detection';
        }
    }
    
    initializeStatusManager() {
        console.log('🔧 Initializing status manager...');
        // Placeholder for status management
        document.getElementById('sessionStatus').textContent = 'Ready';
        console.log('✅ Status manager ready');
    }
    
    initializeAuth() {
        console.log('🔧 Initializing authentication...');
        
        // Google OAuth callback
        window.handleGoogleLogin = (response) => {
            console.log('✅ Google login successful');
            this.handleGoogleAuthSuccess(response);
        };
        
        window.handleGoogleError = (error) => {
            console.error('❌ Google login failed:', error);
        };
        
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
}

// Initialize application when DOM is ready
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
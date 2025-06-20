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
        
        // Clear existing scan area
        if (this.scanAreaRectangle) {
            this.layers.scanArea.removeLayer(this.scanAreaRectangle);
        }
        
        const radius = (radiusKm || 1) * 1000; // Convert to meters, default to 1km
        
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
     * Start LiDAR scan with optional detection
     */
    async startLidarScan() {
        if (!this.selectedArea) {
            console.warn('⚠️ No scan area selected. Please select an area first.');
            this.updateScanAreaFromInputs();
            
            if (!this.selectedArea) {
                alert('Please select a scan area first by clicking on the map or using the region inputs.');
                return;
            }
        }
        
        const enableDetection = document.getElementById('enableDetection')?.checked || false;
        const structureType = document.getElementById('structureType')?.value || 'windmill';
        
        console.log('�️ Starting LiDAR scan:', { enableDetection, structureType });
        
        try {
            // Auto-determine resolution based on zoom and area
            const zoomLevel = this.map.getZoom();
            const areaKm = this.selectedArea.radius;
            
            let tileSize, resolution, iconType;
            if (zoomLevel >= 16 || areaKm <= 0.5) {
                tileSize = 32;
                resolution = '0.25m';
                iconType = 'airplane';
            } else if (zoomLevel >= 14 || areaKm <= 2) {
                tileSize = 64;
                resolution = '0.5m';
                iconType = 'satellite';
            } else {
                tileSize = 128;
                resolution = '1m';
                iconType = 'satellite';
            }
            
            // Show resolution indicator and start animation
            this.showResolutionBadge(resolution);
            this.startScanningAnimation(iconType, resolution);
            
            // Update button states
            this.updateLidarScanButtonStates(true);
            
            // Initialize map visualization if needed
            if (!this.mapVisualization) {
                this.initializeMapVisualization();
            }
            
            // Enable heatmap mode
            if (this.mapVisualization) {
                this.mapVisualization.enableHeatmapMode();
            }
            
            // Configure LiDAR scan
            const config = {
                center_lat: this.selectedArea.lat,
                center_lon: this.selectedArea.lon,
                radius_km: this.selectedArea.radius,
                tile_size_m: tileSize,
                heatmap_mode: true,
                streaming_mode: true,
                resolution: resolution,
                enable_detection: enableDetection,
                structure_type: structureType
            };
            
            // Make API call
            const response = await fetch(`${window.AppConfig.apiBase}/discovery/lidar-scan`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(config)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`LiDAR scan failed: ${response.statusText} - ${errorText}`);
            }
            
            const result = await response.json();
            console.log('✅ LiDAR scan started:', result);
            
            // Store session ID
            this.currentLidarHeatmapSession = result.session_id;
            
            // Monitor progress
            this.monitorLidarHeatmapProgress();
            
        } catch (error) {
            console.error('❌ Failed to start LiDAR scan:', error);
            alert('Failed to start LiDAR scan: ' + error.message);
            this.stopLidarScan();
        }
    }
    
    /**
     * Stop LiDAR scan
     */
    stopLidarScan() {
        console.log('🛑 Stopping LiDAR scan...');
        
        // Stop animations
        this.stopScanningAnimation();
        this.hideResolutionBadge();
        
        // Update button states
        this.updateLidarScanButtonStates(false);
        
        // Stop session
        if (this.currentLidarHeatmapSession) {
            this.stopLidarHeatmapSession();
        }
        
        // Disable heatmap mode
        if (this.mapVisualization) {
            this.mapVisualization.disableHeatmapMode();
        }
    }
    
    /**
     * Clear LiDAR scan results
     */
    clearLidarScan() {
        console.log('🧹 Clearing LiDAR scan results...');
        
        // Stop any running scan first
        this.stopLidarScan();
        
        // Clear heatmap tiles
        if (this.mapVisualization && this.mapVisualization.heatmapTiles) {
            this.mapVisualization.heatmapTiles.forEach(tile => {
                tile.remove();
            });
            this.mapVisualization.heatmapTiles.clear();
        }
        
        // Clear other LiDAR overlays
        if (this.mapVisualization) {
            this.mapVisualization.clearElevationData();
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
        // Remove any existing scanning icon
        this.stopScanningAnimation();
        
        // Create scanning icon element
        const scanIcon = document.createElement('div');
        scanIcon.className = `scanning-icon ${iconType}`;
        scanIcon.innerHTML = iconType === 'airplane' ? '✈️' : '🛰️';
        
        // Remove CSS animation and use JavaScript animation instead
        scanIcon.style.cssText = `
            position: absolute;
            z-index: 1000;
            pointer-events: none;
            font-size: ${resolution.includes('0.25') || resolution.includes('0.1') ? '28px' : '24px'};
            filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
            transition: all 0.2s ease;
        `;
        
        // Position relative to map container
        const mapContainer = this.map.getContainer();
        mapContainer.appendChild(scanIcon);
        
        // Store reference for cleanup
        this.scanningIcon = scanIcon;
        
        // Animate within scan area bounds
        this.animateScanningIcon(scanIcon, resolution);
        
        console.log(`🛰️ Started ${iconType} scanning animation (${resolution} resolution)`);
    }
    
    /**
     * Animate scanning icon within the scan area bounds
     */
    animateScanningIcon(iconElement, resolution) {
        if (!this.selectedArea || !iconElement) return;
        
        console.log('🛰️ Starting animation for selected area:', this.selectedArea);
        
        const map = this.map;
        const bounds = this.selectedArea.bounds;
        
        // Get the scan area rectangle element for positioning reference
        const scanRect = this.selectedArea.rectangle;
        if (!scanRect) {
            console.warn('⚠️ No scan rectangle found, using map center');
            return;
        }
        
        let progress = 0;
        const duration = resolution.includes('0.25') ? 12000 : 8000;
        const startTime = Date.now();
        
        const animate = () => {
            if (!this.scanningIcon || this.scanningIcon !== iconElement) {
                return; // Animation stopped
            }
            
            const elapsed = Date.now() - startTime;
            progress = (elapsed % duration) / duration; // Loop continuously
            
            try {
                // Convert geographic bounds to pixel coordinates
                const southWest = map.latLngToContainerPoint([bounds[0][0], bounds[0][1]]);
                const northEast = map.latLngToContainerPoint([bounds[1][0], bounds[1][1]]);
                
                // Ensure we have valid coordinates
                if (!southWest || !northEast || isNaN(southWest.x) || isNaN(northEast.y)) {
                    console.warn('⚠️ Invalid coordinate conversion, retrying...');
                    requestAnimationFrame(animate);
                    return;
                }
                
                // Calculate scan area dimensions and ensure min/max bounds
                const minX = Math.min(southWest.x, northEast.x);
                const maxX = Math.max(southWest.x, northEast.x);
                const minY = Math.min(southWest.y, northEast.y);
                const maxY = Math.max(southWest.y, northEast.y);
                
                const scanWidth = maxX - minX;
                const scanHeight = maxY - minY;
                
                // Ensure we have a meaningful scan area
                if (scanWidth < 50 || scanHeight < 50) {
                    console.warn('⚠️ Scan area too small, using fallback size');
                    requestAnimationFrame(animate);
                    return;
                }
                
                // Create a scanning pattern - simple left-to-right, top-to-bottom
                const cols = 6;
                const rows = 6;
                const totalCells = cols * rows;
                const currentCell = Math.floor(progress * totalCells) % totalCells;
                
                const col = currentCell % cols;
                const row = Math.floor(currentCell / cols);
                
                // Calculate position within scan area (with padding to stay inside)
                const padding = 10; // 10px padding from edges
                const usableWidth = scanWidth - (2 * padding);
                const usableHeight = scanHeight - (2 * padding);
                
                const x = minX + padding + (col / (cols - 1)) * usableWidth;
                const y = minY + padding + (row / (rows - 1)) * usableHeight;
                
                // Double-check bounds before applying position
                const finalX = Math.max(minX + padding, Math.min(maxX - padding, x));
                const finalY = Math.max(minY + padding, Math.min(maxY - padding, y));
                
                // Apply position with debug info
                iconElement.style.left = `${finalX}px`;
                iconElement.style.top = `${finalY}px`;
                iconElement.style.opacity = '0.9';
                
                // Debug log every 100th frame
                if (Math.floor(progress * 1000) % 100 === 0) {
                    console.log(`🛰️ Animation frame: bounds=[${minX},${minY}] to [${maxX},${maxY}], icon at [${finalX},${finalY}]`);
                }
                
                // Continue animation
                requestAnimationFrame(animate);
                
            } catch (error) {
                console.error('❌ Animation error:', error);
                // Continue anyway
                requestAnimationFrame(animate);
            }
        };
        
        console.log('🛰️ Animation loop started');
        animate();
    }
    
    /**
     * Stop scanning animation
     */
    stopScanningAnimation() {
        if (this.scanningIcon) {
            this.scanningIcon.remove();
            this.scanningIcon = null;
        }
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
        if (!this.currentLidarHeatmapSession) return;
        
        try {
            const response = await fetch(`${window.AppConfig.apiBase}/discovery/stop/${this.currentLidarHeatmapSession}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                console.log('✅ LiDAR heatmap session stopped');
            }
        } catch (error) {
            console.warn('⚠️ Failed to stop LiDAR heatmap session:', error);
        }
        
        this.currentLidarHeatmapSession = null;
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
        
        if (enableDetectionCheckbox) {
            console.log('🧪 Detection enabled:', enableDetectionCheckbox.checked);
        }
        if (structureTypeSelect) {
            console.log('🧪 Structure type:', structureTypeSelect.value);
        }
        
        console.log('🧪 To test, click "Scan" button or call: window.reApp.startLidarScan()');
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
    
    updateScanAreaFromInputs() {
        // Use default values since we don't have input fields in the simplified interface
        const lat = 52.4751;
        const lon = 4.8156;
        const radius = 1;

        this.selectScanArea(lat, lon, radius);
    }
}

/**
 * Global function for toggling collapsible control groups
 * Called from HTML onclick handlers
 */
function toggleControlGroup(headerElement) {
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

// Make function globally available
window.toggleControlGroup = toggleControlGroup;

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('🌟 Starting RE-Archaeology Framework...');
        
        window.reApp = new REArchaeologyApp();
        window.testApp = window.reApp; // For easier console access
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
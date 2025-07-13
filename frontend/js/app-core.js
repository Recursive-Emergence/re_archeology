// Core application logic and main class
import { setupMap, setupLayers } from './map.js';
import { setupUI, updateScanButtonText, updateLidarScanButtonStates, updateButtonStates, startScanUI, cleanupAfterStop, updateResolutionDisplay, updateAnimationForResolution, updateAnimationProgress, showResolutionBadge, hideResolutionBadge } from './ui.js';
import { startDetectionAnimation, stopDetectionAnimation, handlePatchResult, createDetectionLens, ensureDetectionLensReady, updateLensVisualFeedback, completeDetectionAnimation, updateDetectionProfileText } from './detection.js';
import { connectWebSocket, handleWebSocketMessage } from './websocket.js';
import { calculateAreaBounds } from './utils.js';

export class REArchaeologyApp {
    constructor() {
        // Core components
        this.map = null;
        this.mapVisualization = null;
        this.websocket = null;
        // Scan state
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
        // Detection UX state
        this.detectionActive = false;
        this.detectionLens = null;
        this.detectionOverlay = null;
        this.processedPatches = new Set();
        this.totalPatches = 0;
        this.layers = { patches: null, detections: null, animations: null };
        this.patches = new Map();
        this.detections = [];
        // Add a layer group for discovered sites
        this.discoveredSitesLayer = null;
        
        // Task management
        this.taskList = null;
        
        // Grid state for LiDAR tiles
        this.lidarGridRows = null;
        this.lidarGridCols = null;
        
        window.Logger?.app('info', 'RE-Archaeology App initialized');
    }

    async loadDiscoveredSites(retryCount = 0) {
        if (!this.map || !window.L) {
            if (retryCount < 5) {
                window.Logger?.app('warn', 'Map or Leaflet not ready, retrying discovered sites load...');
                setTimeout(() => this.loadDiscoveredSites(retryCount + 1), 500);
            } else {
                window.Logger?.app('error', 'Map or Leaflet not available after retries, cannot show discovered sites.');
            }
            return;
        }
        try {
            window.Logger?.app('info', 'Loading discovered sites...');
            const response = await fetch('/api/v1/discovery/discovered_sites', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            // console.log('Discovered sites raw data:', data); // Suppressed for clean UI
            if (!Array.isArray(data)) {
                window.Logger?.app('warn', 'Discovered sites response is not an array');
                return;
            }
            // Remove old layer if exists
            if (this.discoveredSitesLayer && this.map) {
                this.map.removeLayer(this.discoveredSitesLayer);
            }
            // Create a new layer group
            this.discoveredSitesLayer = window.L.layerGroup();
            const markerLatLngs = [];
            data.forEach(site => {
                if (typeof site.latitude !== 'number' || typeof site.longitude !== 'number') return;
                // Log coordinates for debugging
                // console.log('Discovered site marker:', site.latitude, site.longitude, site.name || site.type || 'Discovered Site'); // Suppressed for clean UI
                // Use a custom emoji marker (🏺) for visibility
                const emojiIcon = window.L.divIcon({
                    html: '<span style="font-size: 2rem; line-height: 2rem;">🏺</span>',
                    className: 'discovered-site-emoji-marker',
                    iconSize: [32, 32],
                    iconAnchor: [16, 16],
                    popupAnchor: [0, -16]
                });
                const marker = window.L.marker([site.latitude, site.longitude], {
                    icon: emojiIcon,
                    title: site.name || site.type || 'Discovered Site'
                });
                let popupHtml = `<b>${site.name ? this.escapeHtml(site.name) : 'Discovered Site'}</b>`;
                if (site.type) popupHtml += `<br><i>${this.escapeHtml(site.type)}</i>`;
                if (site.description) popupHtml += `<br>${this.escapeHtml(site.description)}`;
                if (site.country) popupHtml += `<br><small>${this.escapeHtml(site.country)}</small>`;
                marker.bindPopup(popupHtml);
                this.discoveredSitesLayer.addLayer(marker);
                markerLatLngs.push([site.latitude, site.longitude]);
                // Marker added silently
            });
            this.discoveredSitesLayer.addTo(this.map);
            // Store marker bounds for potential later use, but don't automatically fit
            if (markerLatLngs.length > 0) {
                this.discoveredSitesBounds = window.L.latLngBounds(markerLatLngs);
            }
            window.Logger?.app('info', `Loaded ${data.length} discovered sites`);
        } catch (error) {
            window.Logger?.app('error', `Failed to load discovered sites: ${error.message}`);
            // console.error('❌ Discovered sites loading error:', error); // Suppressed for clean UI
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

    async init() {
        try {
            window.Logger?.app('info', 'Starting application initialization...');
            
            // Clear any existing session state to start fresh
            if (window.TaskList && typeof window.TaskList.manageScanningSession === 'function') {
                window.TaskList.manageScanningSession(null, 'clear');
            }
            
            await this.waitForDOM();
            setupMap(this);
            setupLayers(this);
            
            console.log('[APP-CORE] Map setup completed, map object:', this.map);
            console.log('[APP-CORE] Dispatching mapReady event');
            
            // Notify that map is ready
            window.dispatchEvent(new CustomEvent('mapReady', { detail: { map: this.map, app: this } }));
            
            // Initialize clean animation system
            this.initializeLidarAnimationSystem();
            
            // Initialize map visualization for heatmap tiles
            this.initializeMapVisualization();
            
            this.setupMapUrlSync();
            // Skip structure types loading for streamlined performance
            // await this.loadAvailableStructureTypes?.();
            
            // Load discovered sites in background to avoid blocking page load
            this.loadDiscoveredSites().catch(err => {
                window.Logger?.app('warn', 'Failed to load discovered sites:', err);
            });
            
            setupUI(this);
            const enableDetection = document.getElementById('enableDetection')?.checked || false;
            updateScanButtonText(this, enableDetection);
            this.initializeDetectionOverlay?.();
            connectWebSocket(this);
            
            // Enable heatmap mode by default to be ready for resumed tasks
            if (this.mapVisualization && typeof this.mapVisualization.enableHeatmapMode === 'function') {
                if (window.Logger) window.Logger.debug('app', '🔥 Enabling heatmap mode for resumed tasks');
                this.mapVisualization.enableHeatmapMode();
            } else {
                if (window.Logger) window.Logger.warn('app', '❌ Cannot enable heatmap mode - mapVisualization not ready');
            }
            
            // Defer task list initialization to allow modules to load
            setTimeout(() => this.initializeTaskList(), 100);
            
            // Start periodic task refresh to ensure ground truth synchronization
            this.startPeriodicTaskRefresh();
            
            await this.initializeAuth?.();
            window.Logger?.app('info', 'Application initialized successfully');
        } catch (error) {
            // console.error('❌ Application initialization failed:', error); // Suppressed for clean UI
            throw error;
        }
    }

    setupMapUrlSync() {
        if (!this.map) return;
        this.map.on('moveend zoomend', () => {
            const center = this.map.getCenter();
            const zoom = this.map.getZoom();
            this.updateUrlWithCoordinates(center.lat, center.lng, zoom);
        });
    }

    updateUrlWithCoordinates(lat, lon, zoom) {
        if (isNaN(lat) || isNaN(lon)) return;
        const url = new URL(window.location);
        url.searchParams.set('lat', lat.toFixed(6));
        url.searchParams.set('lon', lon.toFixed(6));
        url.searchParams.set('zoom', Math.round(zoom));
        window.history.replaceState({}, '', url);
    }

    initializeTaskList() {
        if (this.map && window.TaskList) {
            try {
                this.taskList = new TaskList(this.map);
                window.Logger?.app('info', 'Task list initialized successfully');
            } catch (error) {
                window.Logger?.app('error', 'Failed to initialize task list:', error);
            }
        } else {
            window.Logger?.app('warn', 'Cannot initialize task list - map or TaskList class not available');
        }
    }

    // Removed scan area selection functionality - now using task list for navigation

    async startLidarScan() {
        window.Logger?.lidar('info', 'LiDAR scan functionality disabled - use task list for navigation');
        alert('LiDAR scan functionality has been disabled. Use the task list to navigate to existing scan areas.');
        return;
    }

    // --- Removed scan area related methods ---
    zoomToScanArea() {
        window.Logger?.lidar('warn', 'Scan area functionality disabled');
    }

    buildScanConfig(enableDetection, structureType) {
        if (typeof calculateScanParameters === 'function') {
            const scanParams = calculateScanParameters(this);
            const config = {
                center_lat: this.selectedArea.lat,
                center_lon: this.selectedArea.lon,
                tile_size_m: scanParams.tileSize,
                heatmap_mode: true,
                streaming_mode: true,
                prefer_high_resolution: scanParams.requestHighRes,
                enable_detection: enableDetection,
                structure_type: structureType
            };
            
            // Support both rectangular and circular scan areas
            if (this.selectedArea.width_km && this.selectedArea.height_km) {
                // Rectangular scan area
                config.width_km = this.selectedArea.width_km;
                config.height_km = this.selectedArea.height_km;
            } else if (this.selectedArea.radius) {
                // Circular scan area (legacy)
                config.radius_km = this.selectedArea.radius;
            }
            
            return config;
        } else {
            return {};
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

    updateResolutionDisplay(resolution) {
        if (typeof updateResolutionDisplay === 'function') {
            updateResolutionDisplay(this, resolution);
        }
    }

    updateAnimationForResolution(resolution, isHighRes) {
        if (typeof updateAnimationForResolution === 'function') {
            updateAnimationForResolution(this, resolution, isHighRes);
        }
    }

    connectWebSocket() {
        if (typeof connectWebSocket === 'function') {
            connectWebSocket(this);
        }
    }

    cleanupAfterStop() {
        if (typeof cleanupAfterStop === 'function') {
            cleanupAfterStop(this);
        }
    }

    // --- UI and Detection passthroughs ---
    startScanUI() { if (typeof startScanUI === 'function') startScanUI(this); }
    updateScanButtonText(detectionEnabled) { if (typeof updateScanButtonText === 'function') updateScanButtonText(this, detectionEnabled); }
    updateLidarScanButtonStates(isRunning) { if (typeof updateLidarScanButtonStates === 'function') updateLidarScanButtonStates(this, isRunning); }
    updateButtonStates() { if (typeof updateButtonStates === 'function') updateButtonStates(this); }
    showResolutionBadge(resolution) { if (typeof showResolutionBadge === 'function') showResolutionBadge(this, resolution); }
    hideResolutionBadge() { if (typeof hideResolutionBadge === 'function') hideResolutionBadge(this); }
    // Legacy animation functions disabled to prevent duplicate satellites - now using LidarAnimationSystem
    startScanningAnimation(iconType) { 
        if (this.lidarAnimationSystem && !this.lidarAnimationSystem.getState().isActive) {
            this.lidarAnimationSystem.startScanning(iconType);
        }
    }
    stopScanningAnimation() { 
        if (this.lidarAnimationSystem && this.lidarAnimationSystem.getState().isActive) {
            this.lidarAnimationSystem.stopScanning();
        }
    }
    updateAnimationProgress(tileData) { if (typeof updateAnimationProgress === 'function') updateAnimationProgress(this, tileData); }
    initializeDetectionOverlay() {
        if (!this.detectionOverlay && typeof document !== 'undefined') {
            this.detectionOverlay = document.getElementById('detectionOverlay');
        }
    }

    // --- Detection passthroughs ---
    startDetectionAnimation() { if (typeof startDetectionAnimation === 'function') startDetectionAnimation(this); }
    stopDetectionAnimation() { if (typeof stopDetectionAnimation === 'function') stopDetectionAnimation(this); }
    handlePatchResult(patchData) { if (typeof handlePatchResult === 'function') handlePatchResult(this, patchData); }
    createDetectionLens() { if (typeof createDetectionLens === 'function') createDetectionLens(this); }
    ensureDetectionLensReady() { if (typeof ensureDetectionLensReady === 'function') ensureDetectionLensReady(this); }
    updateLensVisualFeedback(isPositive, confidence) { if (typeof updateLensVisualFeedback === 'function') updateLensVisualFeedback(this, isPositive, confidence); }
    completeDetectionAnimation() { if (typeof completeDetectionAnimation === 'function') completeDetectionAnimation(this); }
    updateDetectionProfileText(text) { if (typeof updateDetectionProfileText === 'function') updateDetectionProfileText(this, text); }

    // --- WebSocket and backend event passthroughs ---
    handleWebSocketMessage(data) { if (typeof handleWebSocketMessage === 'function') handleWebSocketMessage(this, data); }

    // --- LiDAR tile rendering using direct GCS fetch and progressive subtile grid ---
    // PROTOCOL: The grid origin (0,0) for both tiles and subtiles is the top-left (northwest) corner of the region.
    // Rows increase downward (north to south), columns increase rightward (west to east).
    // All subtile bounds (subtile_lat0, subtile_lat1, subtile_lon0, subtile_lon1) must be provided.
    // subtile_row=0 is the topmost row, subtile_col=0 is the leftmost column.
    // The backend must generate and send subtiles in this order, and the frontend must render them as-is.
    elevationStats = {};
    elevationBounds = {};

    handleLidarTileUpdate(data) {
        if (window.DEBUG_LIDAR_GRID) {
            if (window.Logger) window.Logger.debug('lidar', '[LIDAR_TILE] handleLidarTileUpdate received:', JSON.stringify(data));
        }
        // Accepts backend tile messages: {coarse_row, coarse_col, subtile_row, subtile_col, subtiles_per_side, level, elevation, ...}
        // Robustly map snake_case to camelCase for frontend rendering
        if (!this.lidarGridRows || !this.lidarGridCols) {
            if (data.grid_x && data.grid_y) {
                this.lidarGridCols = data.grid_x;
                this.lidarGridRows = data.grid_y;
            } else {
                this.lidarGridCols = 5;
                this.lidarGridRows = 10;
            }
        }
        const gridRows = this.lidarGridRows;
        const gridCols = this.lidarGridCols;
        // Map backend fields to frontend variables
        const coarseRow = data.coarse_row ?? data.grid_row ?? data.coarseRow ?? 0;
        const coarseCol = data.coarse_col ?? data.grid_col ?? data.coarseCol ?? 0;
        const subtiles = data.subtiles_per_side ?? data.subtiles ?? 1;
        const subtileRow = data.subtile_row ?? data.subtileRow ?? 0;
        const subtileCol = data.subtile_col ?? data.subtileCol ?? 0;
        const level = data.level ?? 0;
        const elev = data.elevation ?? data.elev ?? 0;
        // No inversion: trust backend protocol, subtileRow=0 is top row
        const lat = data.lat ?? undefined;
        const lon = data.lon ?? undefined;
        // Track elevations per level
        if (!this.elevationStats[level]) this.elevationStats[level] = [];
        this.elevationStats[level].push(elev);
        // Update bounds every 50 new tiles (or adjust as needed)
        if (this.elevationStats[level].length % 50 === 0) {
            const sorted = this.elevationStats[level].slice().sort((a, b) => a - b);
            const min = sorted[Math.floor(sorted.length * 0.02)];
            const max = sorted[Math.ceil(sorted.length * 0.98)];
            this.elevationBounds[level] = [min, max];
        }
        // Color mapping
        const bounds = this.elevationBounds[level] || [5000, 9000];
        const [minElev, maxElev] = bounds;
        const t = Math.max(0, Math.min(1, (elev - minElev) / (maxElev - minElev)));
        const r = Math.round(255 * t);
        const g = Math.round(180 * (1 - t));
        const b = Math.round(255 * (1 - t));
        const color = `rgb(${r},${g},${b})`;
        // Render subtile in canvas grid
        if (typeof window.renderLidarSubtile === 'function') {
            const subtile_lat0 = data.subtile_lat0 ?? data.subtileLat0;
            const subtile_lat1 = data.subtile_lat1 ?? data.subtileLat1;
            const subtile_lon0 = data.subtile_lon0 ?? data.subtileLon0;
            const subtile_lon1 = data.subtile_lon1 ?? data.subtileLon1;
            if (window.DEBUG_LIDAR_GRID) {
                if (window.Logger) window.Logger.debug('lidar', '[LIDAR_TILE] Rendering subtile:', {
                    gridRows, gridCols, coarseRow, coarseCol, subtiles, subtileRow, subtileCol, level, color, elev, lat, lon,
                    subtile_lat0, subtile_lat1, subtile_lon0, subtile_lon1, dataset: data.dataset, resolution: data.resolution
                });
            }
            window.renderLidarSubtile({
                gridRows, gridCols, coarseRow, coarseCol, subtiles, subtileRow, subtileCol, level, color, elev, lat, lon,
                subtile_lat0, subtile_lat1, subtile_lon0, subtile_lon1
            });
        } else {
            if (window.DEBUG_LIDAR_GRID) {
                if (window.Logger) window.Logger.warn('lidar', '[LIDAR_TILE] window.renderLidarSubtile is not defined');
            }
        }
        // Legacy satellite animation disabled - now using LidarAnimationSystem for clean single satellite at top
        // if (typeof moveSatelliteAnimationToTile === 'function') {
        //     moveSatelliteAnimationToTile(this, {
        //         gridRows, gridCols, coarseRow, coarseCol, subtiles, subtileRow, subtileCol
        //     });
        // }
        // Optionally, update progress bar or stats if needed
    }
    handleLidarHeatmapTileUpdate(data) { if (typeof this.mapVisualization?.addLidarHeatmapTile === 'function') this.mapVisualization.addLidarHeatmapTile(data.tile_data); this.updateAnimationProgress?.(data.tile_data); }
    handleLidarProgressUpdate(data) { /* implement as needed */ }
    handleSessionComplete(data) { /* implement as needed */ }
    handleSessionStopped(data) { /* implement as needed */ }
    handleSessionFailed(data) { /* implement as needed */ }

    // --- Map and scan area helpers ---
    initializeLidarAnimationSystem() {
        if (window.Logger) {
            window.Logger.debug('app', '🎬 Initializing LiDAR animation system...');
            window.Logger.debug('app', '   - window.LidarAnimationSystem:', typeof window.LidarAnimationSystem);
            window.Logger.debug('app', '   - this.map:', !!this.map);
        }
        
        if (typeof window.LidarAnimationSystem === 'function' && this.map) {
            this.lidarAnimationSystem = new window.LidarAnimationSystem(this.map);
            if (window.Logger) window.Logger.debug('app', '✅ LidarAnimationSystem initialized');
        } else {
            if (window.Logger) window.Logger.warn('app', '❌ LidarAnimationSystem not available - will use legacy system');
        }
    }

    initializeMapVisualization() { 
        if (window.Logger) {
            window.Logger.debug('app', '🗺️ Initializing map visualization...');
            window.Logger.debug('app', '   - window.MapVisualization:', typeof window.MapVisualization);
            window.Logger.debug('app', '   - this.map:', !!this.map);
        }
        
        if (typeof window.MapVisualization === 'function' && this.map) {
            this.mapVisualization = new window.MapVisualization(this.map);
            if (window.Logger) window.Logger.debug('app', '✅ MapVisualization initialized');
        } else {
            if (window.Logger) window.Logger.warn('app', '❌ MapVisualization initialization failed');
        }
    }
    calculateOptimalBorderWeight() { return this.map ? (this.map.getZoom() >= 16 ? 3 : this.map.getZoom() >= 14 ? 2.5 : this.map.getZoom() >= 12 ? 2 : 1.5) : 2; }

    // --- Scan control ---
    async stopLidarScan() {
        // Stop the backend session if active
        try {
            if (this.currentLidarSession) {
                await this.stopLidarSession?.();
            }
            if (this.mapVisualization && typeof this.mapVisualization.disableHeatmapMode === 'function') {
                this.mapVisualization.disableHeatmapMode();
            }
        } catch (error) {
            // console.error('❌ Failed to stop LiDAR scan:', error); // Suppressed for clean UI
        } finally {
            this.cleanupAfterStop?.();
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
            // console.log('✅ LiDAR session stopped:', result.message); // Suppressed for clean UI
        }
    }

    async clearLidarScan() {
        window.Logger?.lidar('info', 'Clearing LiDAR scan results...');
        await this.stopLidarScan();
        if (this.mapVisualization) {
            if (typeof this.mapVisualization.clearElevationData === 'function') this.mapVisualization.clearElevationData();
            if (typeof this.mapVisualization.clearLidarHeatmap === 'function') this.mapVisualization.clearLidarHeatmap();
        }
        Object.values(this.layers).forEach(layer => layer?.clearLayers?.());
        this.patches.clear();
        this.currentLidarSession = null;
        
        // Reset resolution update flag
        this.resolutionUpdated = false;
        
        // Clear current resolution
        this.currentResolution = null;
        
        // Clear cached bitmaps
        this.clearCachedBitmaps();
        
        // Remove discovered sites layer from map
        if (this.discoveredSitesLayer && this.map) {
            this.map.removeLayer(this.discoveredSitesLayer);
            this.discoveredSitesLayer = null;
        }
        this.updateScanAreaLabel?.();
    }

    // --- Chat and Auth functionality ---
    async handleChatSubmit() {
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        const message = chatInput.value.trim();
        
        if (!message) return;
        
        // Disable input during processing
        chatInput.disabled = true;
        sendBtn.disabled = true;
        chatInput.value = '';
        
        try {
            // Add user message to chat
            this.addChatMessage('user', message);
            
            // Show typing indicator
            this.showTypingIndicator();
            
            // Send request to backend
            const response = await fetch(`${window.AppConfig.apiBase}/ai/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.accessToken || 'dummy-token'}`
                },
                body: JSON.stringify({
                    message: message,
                    context: this.getChatContext()
                })
            });
            
            if (!response.ok) {
                throw new Error(`Chat request failed: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Hide typing indicator
            this.hideTypingIndicator();
            
            // Add Bella's response to chat
            this.addChatMessage('assistant', data.response);
            
        } catch (error) {
            console.error('Chat error:', error);
            this.hideTypingIndicator();
            this.addChatMessage('assistant', "Sorry, I'm having trouble connecting right now. Please try again in a moment!");
        } finally {
            // Re-enable input
            chatInput.disabled = false;
            sendBtn.disabled = false;
            chatInput.focus();
        }
    }

    getChatContext() {
        // Provide context about current scanning state
        const context = {};
        
        if (this.currentLidarSession) {
            context.current_scan = {
                session_id: this.currentLidarSession,
                is_scanning: this.isScanning
            };
        }
        
        if (this.totalPatches) {
            context.total_patches = this.totalPatches;
        }
        
        if (this.detections && this.detections.length > 0) {
            context.positive_detections = this.detections.length;
        }
        
        // Add task context if available
        if (this.taskList && this.taskList.currentlySelectedTask) {
            const selectedTask = this.taskList.tasks.find(t => t.id === this.taskList.currentlySelectedTask);
            if (selectedTask) {
                context.selected_task = {
                    id: selectedTask.id,
                    status: selectedTask.status,
                    findings: selectedTask.findings ? selectedTask.findings.length : 0
                };
            }
        }
        
        // Add current map coordinates
        if (this.map) {
            const center = this.map.getCenter();
            const zoom = this.map.getZoom();
            context.current_coordinates = {
                latitude: center.lat,
                longitude: center.lng,
                zoom: zoom
            };
        }
        
        return context;
    }

    addChatMessage(role, content) {
        const chatMessages = document.getElementById('chat-messages');
        const chatWelcome = document.getElementById('chat-welcome');
        
        // Hide welcome message on first interaction
        if (chatWelcome && chatWelcome.style.display !== 'none') {
            chatWelcome.style.display = 'none';
        }
        
        // Create message element
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${role}-message`;
        
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        
        if (role === 'user') {
            // Use user's Google avatar if available, otherwise default
            const userAvatar = document.getElementById('user-avatar');
            if (userAvatar && userAvatar.src && userAvatar.src !== '') {
                const avatarImg = document.createElement('img');
                avatarImg.src = userAvatar.src;
                avatarImg.alt = 'User';
                avatarImg.className = 'avatar-image';
                avatar.appendChild(avatarImg);
            } else {
                avatar.textContent = '👤';
            }
        } else {
            // Use Bella's avatar - a professional lady icon
            avatar.innerHTML = '👩‍🔬'; // Female scientist emoji for Bella
        }
        
        const content_div = document.createElement('div');
        content_div.className = 'message-content';
        content_div.textContent = content;
        
        const timestamp = document.createElement('div');
        timestamp.className = 'message-timestamp';
        timestamp.textContent = new Date().toLocaleTimeString();
        
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(content_div);
        messageDiv.appendChild(timestamp);
        
        chatMessages.appendChild(messageDiv);
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    showTypingIndicator() {
        const chatMessages = document.getElementById('chat-messages');
        
        // Remove existing typing indicator
        const existing = chatMessages.querySelector('.typing-indicator');
        if (existing) existing.remove();
        
        const typingDiv = document.createElement('div');
        typingDiv.className = 'chat-message assistant-message typing-indicator';
        
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = '💬';
        
        const content_div = document.createElement('div');
        content_div.className = 'message-content typing-animation';
        content_div.innerHTML = '<span></span><span></span><span></span>';
        
        typingDiv.appendChild(avatar);
        typingDiv.appendChild(content_div);
        
        chatMessages.appendChild(typingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    hideTypingIndicator() {
        const typingIndicator = document.querySelector('.typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }
    escapeHtml(text) {
        if (!text) return '';
        return String(text).replace(/[&<>"]/g, function (c) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c];
        });
    }
    async loadAvailableStructureTypes() {
        try {
            window.Logger?.app('info', 'Loading available structure types...');
            const response = await fetch('/api/v1/discovery/structure_types', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            const structureSelect = document.getElementById('structureType');
            if (!structureSelect) {
                window.Logger?.app('warn', 'Structure type select element not found');
                return;
            }
            structureSelect.innerHTML = '';
            if (data.available_types && data.available_types.length > 0) {
                data.available_types.forEach(structureType => {
                    const option = document.createElement('option');
                    option.value = structureType;
                    option.textContent = this.formatStructureTypeName?.(structureType) || structureType;
                    if (structureType === data.default_type) {
                        option.selected = true;
                    }
                    structureSelect.appendChild(option);
                });
                structureSelect.disabled = false;
                window.Logger?.app('info', `Loaded ${data.available_types.length} structure types`);
            } else {
                structureSelect.disabled = true;
                window.Logger?.app('error', 'No structure types received from backend.');
            }
        } catch (error) {
            window.Logger?.app('error', `Failed to load structure types: ${error.message}`);
            const structureSelect = document.getElementById('structureType');
            if (structureSelect) {
                structureSelect.innerHTML = '';
                structureSelect.disabled = true;
            }
        }
    }
    async initializeAuth() {
        // Set up Google Auth and check for existing session
        this.setupGoogleAuth();
        const storedToken = localStorage.getItem('google_id_token');
        if (storedToken) {
            const valid = await this.validateStoredToken(storedToken);
            if (valid) {
                this.accessToken = storedToken;
                this.currentUser = valid;
                this.updateAuthUI();
                return;
            } else {
                localStorage.removeItem('google_id_token');
            }
        }
        this.showLoginSection();
    }

    setupGoogleAuth() {
        // Attach Google login callback
        window.handleGoogleLogin = this.handleGoogleLogin.bind(this);
        
        // Check if Google script has loaded
        if (typeof window.google === 'undefined' || !window.google.accounts) {
            // Google script hasn't loaded yet, try again shortly
            setTimeout(() => this.setupGoogleAuth(), 500);
            return;
        }
        
        try {
            // Initialize Google Auth
            window.google.accounts.id.initialize({
                client_id: window.AppConfig.googleClientId || '555743158084-ribsom4oerhv0jgohosoit190p8bh72n.apps.googleusercontent.com',
                callback: window.handleGoogleLogin,
                auto_select: false,
                cancel_on_tap_outside: false
            });
            
            // Render the button
            const buttonContainer = document.querySelector('.g_id_signin');
            if (buttonContainer) {
                window.google.accounts.id.renderButton(buttonContainer, {
                    theme: 'outline',
                    size: 'medium',
                    text: 'sign_in_with',
                    shape: 'rectangular'
                });
            }
        } catch (error) {
            if (window.Logger) window.Logger.error('app', 'Google Auth setup failed:', error);
            // Try again after a delay
            setTimeout(() => this.setupGoogleAuth(), 1000);
        }
    }

    async handleGoogleLogin(response) {
        if (!response || !response.credential) {
            window.Logger?.app('error', 'Google login failed: No credential');
            return;
        }
        const idToken = response.credential;
        // Optionally validate token with backend here
        const valid = await this.validateStoredToken(idToken);
        if (valid) {
            this.accessToken = idToken;
            this.currentUser = valid;
            localStorage.setItem('google_id_token', idToken);
            this.updateAuthUI();
            // Force UI update in case DOM is not refreshed
            setTimeout(() => this.updateAuthUI(), 100);
        } else {
            window.Logger?.app('error', 'Google token validation failed');
            this.showLoginSection();
        }
    }

    async validateStoredToken(token) {
        // For demo: decode token client-side (in production, validate with backend)
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            if (payload && payload.email) {
                // Check expiration (exp is in seconds since epoch)
                const now = Math.floor(Date.now() / 1000);
                if (payload.exp && payload.exp < now + 300) { // Less than 5 minutes left or expired
                    window.Logger?.app('warn', 'Google token expired or about to expire, forcing re-login');
                    return null;
                }
                return { name: payload.name, email: payload.email, picture: payload.picture };
            }
        } catch (e) {
            window.Logger?.app('error', 'Invalid Google token');
        }
        return null;
    }

    updateAuthUI() {
        // Hide login, show chat input, show user profile
        document.getElementById('login-section').style.display = 'none';
        document.getElementById('chat-input-form').style.display = '';
        document.getElementById('chat-input').disabled = false;
        document.getElementById('send-btn').disabled = false;
        const user = this.currentUser;
        if (user) {
            document.getElementById('user-profile').style.display = '';
            document.getElementById('user-avatar').src = user.picture || '';
            document.getElementById('user-name').textContent = user.name || '';
            document.getElementById('user-email').textContent = user.email || '';
            document.getElementById('logout-btn').style.display = '';
            document.getElementById('logout-btn').onclick = () => this.handleLogout();
        }
    }

    showLoginSection() {
        document.getElementById('login-section').style.display = '';
        document.getElementById('chat-input-form').style.display = 'none';
        document.getElementById('chat-input').disabled = true;
        document.getElementById('send-btn').disabled = true;
        document.getElementById('user-profile').style.display = 'none';
    }

    async handleLogout() {
        localStorage.removeItem('google_id_token');
        this.accessToken = null;
        this.currentUser = null;
        this.showLoginSection();
    }

    formatStructureTypeName(structureType) {
        const typeMap = {
            'windmill': 'Windmill Structures',
            'tower': 'Tower Structures',
            'mound': 'Archaeological Mounds',
            'geoglyph': 'Geoglyphs',
            'citadel': 'Citadel Structures',
            'generic': 'Generic Structures'
        };
        return typeMap[structureType] || structureType.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    initializeTaskList(retryCount = 0) {
        if (this.map && window.TaskList) {
            try {
                this.taskList = new TaskList(this.map);
                window.Logger?.app('info', 'Task list initialized successfully');
            } catch (error) {
                window.Logger?.app('error', 'Failed to initialize task list:', error);
            }
        } else {
            if (retryCount < 10) {
                window.Logger?.app('debug', `Task list retry ${retryCount} - map: ${!!this.map}, TaskList: ${!!window.TaskList}`);
                setTimeout(() => this.initializeTaskList(retryCount + 1), 200);
            } else {
                window.Logger?.app('warn', 'Cannot initialize task list - map or TaskList class not available after retries');
            }
        }
    }

    fitToDiscoveredSitesIfNeeded() {
        // Only fit to discovered sites if we have them and no running tasks
        if (this.discoveredSitesBounds && this.taskList) {
            const runningTasks = this.taskList.tasks.filter(task => task.status === 'running');
            if (runningTasks.length === 0) {
                if (window.Logger) window.Logger.debug('app', 'No running tasks found, smoothly transitioning to discovered sites');
                // Smooth transition to discovered sites
                this.map.flyToBounds(this.discoveredSitesBounds, { 
                    padding: [40, 40], 
                    duration: 2.0,
                    easeLinearity: 0.1
                });
            }
        }
    }

    startPeriodicTaskRefresh() {
        // Start periodic task refresh every 15 seconds to ensure ground truth (silent refresh)
        setInterval(() => {
            if (this.taskList && typeof this.taskList.backgroundRefresh === 'function') {
                this.taskList.backgroundRefresh();
                window.Logger?.app('debug', 'Periodic task refresh completed (silent)');
            } else if (this.taskList && typeof this.taskList.loadTasks === 'function') {
                // Fallback to regular loadTasks if backgroundRefresh doesn't exist
                if (this.taskList.taskService && typeof this.taskList.taskService.clearCache === 'function') {
                    this.taskList.taskService.clearCache();
                }
                this.taskList.loadTasks();
                window.Logger?.app('debug', 'Periodic task refresh completed (with loading)');
            }
        }, 15000); // Every 15 seconds
        
        window.Logger?.app('info', 'Periodic task refresh started (15s intervals, silent mode)');
    }

    /**
     * Load all cached LiDAR tile JSONs for a running task directly from GCS and replay them as if they were live tiles.
     * This is fault-tolerant and deduplicates with live websocket updates.
     * @param {string} taskId
     * @param {object} options - { gcsBaseUrl, gridX, gridY, levels }
     */
    async loadCachedTilesForTask(taskId, options = {}) {
        // Example GCS base URL: 'https://storage.googleapis.com/re_archaeology/tasks/{taskId}/cache/subtile_data/'
        const gcsBaseUrl = options.gcsBaseUrl || `https://storage.googleapis.com/re_archaeology/tasks/${taskId}/cache/subtile_data/`;
        const gridX = options.gridX;
        const gridY = options.gridY;
        const levels = options.levels || [
            { res: 8.0, subtiles: 1 },
            { res: 4.0, subtiles: 2 },
            { res: 2.0, subtiles: 4 },
            { res: 1.0, subtiles: 8 }
        ];
        // Set to deduplicate tiles (level-coarseRow-coarseCol-subtileRow-subtileCol)
        const seenTiles = new Set();
        this.lidarGridRows = gridY;
        this.lidarGridCols = gridX;
        let consecutive404s = 0;
        const max404s = 20; // Stop after 20 consecutive 404s
        let foundAnyTiles = false;
        
        if (window.Logger) window.Logger.debug('lidar', '[LIDAR_RESTORE] loadCachedTilesForTask', { taskId, gridX, gridY, levels });
        
        outerLoop: for (let levelIdx = 0; levelIdx < levels.length; ++levelIdx) {
            const subtiles = levels[levelIdx].subtiles;
            for (let coarseRow = 0; coarseRow < gridY; ++coarseRow) {
                for (let coarseCol = 0; coarseCol < gridX; ++coarseCol) {
                    for (let subtileRow = 0; subtileRow < subtiles; ++subtileRow) {
                        for (let subtileCol = 0; subtileCol < subtiles; ++subtileCol) {
                            const tileKey = `${levelIdx}-${coarseRow}-${coarseCol}-${subtileRow}-${subtileCol}`;
                            if (seenTiles.has(tileKey)) continue;
                            
                            // Stop if we've hit too many consecutive 404s
                            if (consecutive404s >= max404s) {
                                if (window.Logger) window.Logger.debug('lidar', `[LIDAR_RESTORE] Stopping after ${consecutive404s} consecutive 404s`);
                                break outerLoop;
                            }
                            
                            const url = `${gcsBaseUrl}level_${levelIdx}/tile_${coarseRow}_${coarseCol}/subtile_${subtileRow}_${subtileCol}.json`;
                            if (window.Logger) window.Logger.debug('lidar', '[LIDAR_RESTORE] Fetching tile', url);
                            try {
                                const resp = await fetch(url);
                                if (!resp.ok) {
                                    consecutive404s++;
                                    continue;
                                }
                                const tileData = await resp.json();
                                consecutive404s = 0; // Reset counter on success
                                foundAnyTiles = true;
                                seenTiles.add(tileKey);
                                console.log('[LIDAR_RESTORE] Restoring tile', tileKey, tileData);
                                this.handleLidarTileUpdate(tileData);
                            } catch (e) {
                                consecutive404s++;
                                console.warn('[LIDAR_RESTORE] Failed to fetch/restore tile', url, e);
                                continue;
                            }
                        }
                    }
                }
            }
        }
        
        if (!foundAnyTiles) {
            if (window.Logger) window.Logger.debug('lidar', `[LIDAR_RESTORE] No cached tiles found for task ${taskId}`);
        }
        // Store seenTiles for deduplication with websocket
        this._restoredTileKeys = seenTiles;
    }

    /**
     * Call this from your websocket handler to skip tiles already restored from cache
     */
    isTileRestored(tileData) {
        if (!this._restoredTileKeys) return false;
        const key = `${tileData.level}-${tileData.coarse_row}-${tileData.coarse_col}-${tileData.subtile_row}-${tileData.subtile_col}`;
        return this._restoredTileKeys.has(key);
    }

    /**
     * Load cached bitmap snapshots for a task to restore visual state after page refresh
     * This uses the existing snapshot loading system in lidar-grid.js
     */
    async loadCachedBitmapForTask(taskId) {
        try {
            // Loading cached bitmap for task
            
            // Get task data from task list to determine bounds
            const task = this.taskList?.tasks?.find(t => t.id === taskId);
            if (!task) {
                // Task not found in task list
                return;
            }
            
            // Calculate bounds for the task
            let bounds = null;
            if (task.bounds && Array.isArray(task.bounds) && task.bounds.length === 2) {
                bounds = task.bounds;
            } else if (task.start_coordinates && task.range) {
                const [lat, lon] = task.start_coordinates;
                const { width_km, height_km } = task.range;
                const latOffset = height_km / 111;
                const lonOffset = width_km / (111 * Math.cos(lat * Math.PI / 180));
                bounds = [
                    [lat - latOffset / 2, lon - lonOffset / 2], // Southwest
                    [lat + latOffset / 2, lon + lonOffset / 2]  // Northeast
                ];
            }
            
            if (!bounds) {
                // No bounds available for task
                return;
            }
            
            // Only load snapshots if we have an active websocket connection
            if (window.showHighestAvailableLidarSnapshot && this.websocket) {
                await window.showHighestAvailableLidarSnapshot(taskId, bounds);
            }
            
        } catch (error) {
            // Failed to load cached bitmap for task
            throw error;
        }
    }

    /**
     * Clear cached bitmap overlays for cleanup
     */
    clearCachedBitmaps() {
        try {
            // Clearing cached bitmap overlays
            
            // Use the existing overlay removal system
            if (window.removeObsoleteLidarSnapshotOverlays) {
                window.removeObsoleteLidarSnapshotOverlays([]);
            }
            
            // Successfully cleared cached bitmap overlays
        } catch (error) {
            // Failed to clear cached bitmap overlays
        }
    }
} // End of class

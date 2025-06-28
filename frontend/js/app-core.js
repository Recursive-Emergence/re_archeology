// Core application logic and main class
import { setupMap, setupLayers, setupMapEvents, selectScanArea, zoomToScanArea, updateScanAreaLabel, calculateScanParameters } from './map.js';
import { setupUI, updateScanButtonText, updateLidarScanButtonStates, updateButtonStates, startScanUI, cleanupAfterStop, updateResolutionDisplay, updateAnimationForResolution, startScanningAnimation, stopScanningAnimation, updateAnimationProgress, showResolutionBadge, hideResolutionBadge } from './ui.js';
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
            console.log('Discovered sites raw data:', data);
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
                console.log('Discovered site marker:', site.latitude, site.longitude, site.name || site.type || 'Discovered Site');
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
                window.Logger?.app('debug', `Added marker for site: ${site.name || site.type || 'Discovered Site'} at [${site.latitude}, ${site.longitude}]`);
            });
            this.discoveredSitesLayer.addTo(this.map);
            // Fit map to bounds if there are markers
            if (markerLatLngs.length > 0) {
                const bounds = window.L.latLngBounds(markerLatLngs);
                this.map.fitBounds(bounds, { padding: [40, 40] });
            }
            window.Logger?.app('info', `Loaded ${data.length} discovered sites`);
        } catch (error) {
            window.Logger?.app('error', `Failed to load discovered sites: ${error.message}`);
            console.error('❌ Discovered sites loading error:', error);
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
            await this.waitForDOM();
            setupMap(this);
            setupLayers(this);
            this.handleUrlCoordinates();
            this.setupDefaultScanArea();
            await this.loadAvailableStructureTypes?.();
            // Load discovered sites after map is ready
            await this.loadDiscoveredSites();
            setupUI(this);
            const enableDetection = document.getElementById('enableDetection')?.checked || false;
            updateScanButtonText(this, enableDetection);
            this.initializeDetectionOverlay?.();
            connectWebSocket(this);
            await this.initializeAuth?.();
            window.Logger?.app('info', 'Application initialized successfully');
        } catch (error) {
            console.error('❌ Application initialization failed:', error);
            throw error;
        }
    }

    handleUrlCoordinates() {
        const params = new URLSearchParams(window.location.search);
        const lat = parseFloat(params.get('lat'));
        const lon = parseFloat(params.get('lon'));
        const valid = !isNaN(lat) && !isNaN(lon);
        if (valid) {
            selectScanArea(this, lat, lon, 1.0);
            this.map.setView([lat, lon], 13, { animate: true });
        }
        window.addEventListener('popstate', () => {
            const params = new URLSearchParams(window.location.search);
            const lat = parseFloat(params.get('lat'));
            const lon = parseFloat(params.get('lon'));
            if (!isNaN(lat) && !isNaN(lon)) {
                selectScanArea(this, lat, lon, 1.0);
                this.map.setView([lat, lon], 13, { animate: true });
            }
        });
    }

    updateUrlWithCoordinates(lat, lon) {
        const url = new URL(window.location.href);
        url.searchParams.set('lat', lat);
        url.searchParams.set('lon', lon);
        window.history.pushState({}, '', url);
    }

    navigateToCoordinates(lat, lon, updateHistory = true) {
        const latNum = parseFloat(lat);
        const lonNum = parseFloat(lon);
        if (isNaN(latNum) || isNaN(lonNum)) {
            console.warn('Invalid coordinates provided:', lat, lon);
            return false;
        }
        selectScanArea(this, latNum, lonNum, 1.0);
        this.map.setView([latNum, lonNum], 13, { animate: true });
        if (updateHistory) {
            this.updateUrlWithCoordinates(latNum, lonNum);
        }
        return true;
    }

    setupDefaultScanArea() {
        const params = new URLSearchParams(window.location.search);
        const hasUrlCoords = params.has('lat') && params.has('lon');
        if (!hasUrlCoords) {
            // Set default to Amazon area and zoom 4
            selectScanArea(this, -2.284550660236957, -66.35742187500001, 1.0);
            if (this.map) {
                this.map.setView([-2.284550660236957, -66.35742187500001], 4, { animate: true });
            }
        }
    }

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
        try {
            this.zoomToScanArea();
            setTimeout(async () => {
                const config = this.buildScanConfig?.(enableDetection, structureType) || {};
                this.startScanUI?.();
                if (this.startBackendScan) {
                    const result = await this.startBackendScan(config);
                    this.currentLidarSession = result.session_id;
                    if (result.actual_resolution) {
                        this.updateResolutionDisplay?.(result.actual_resolution);
                        this.updateAnimationForResolution?.(result.actual_resolution, result.is_high_resolution);
                    }
                }
                if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
                    this.connectWebSocket?.();
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                window.Logger?.lidar('info', 'LiDAR scan started successfully');
            }, 500);
        } catch (error) {
            console.error('❌ Failed to start LiDAR scan:', error);
            alert('Failed to start LiDAR scan: ' + error.message);
            this.cleanupAfterStop?.();
        }
    }

    // --- Add missing methods as passthroughs to preserve modular wiring ---
    zoomToScanArea() {
        if (typeof zoomToScanArea === 'function') {
            zoomToScanArea(this);
        } else {
            console.warn('zoomToScanArea is not defined');
        }
    }

    buildScanConfig(enableDetection, structureType) {
        if (typeof calculateScanParameters === 'function') {
            const scanParams = calculateScanParameters(this);
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
    startScanningAnimation(iconType) { if (typeof startScanningAnimation === 'function') startScanningAnimation(this, iconType); }
    stopScanningAnimation() { if (typeof stopScanningAnimation === 'function') stopScanningAnimation(this); }
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
    handleLidarTileUpdate(data) { if (typeof this.mapVisualization?.addLidarHeatmapTile === 'function') this.mapVisualization.addLidarHeatmapTile(data); this.updateAnimationProgress?.(data); }
    handleLidarHeatmapTileUpdate(data) { if (typeof this.mapVisualization?.addLidarHeatmapTile === 'function') this.mapVisualization.addLidarHeatmapTile(data.tile_data); this.updateAnimationProgress?.(data.tile_data); }
    handleLidarProgressUpdate(data) { /* implement as needed */ }
    handleSessionComplete(data) { /* implement as needed */ }
    handleSessionStopped(data) { /* implement as needed */ }
    handleSessionFailed(data) { /* implement as needed */ }

    // --- Map and scan area helpers ---
    initializeMapVisualization() { if (typeof window.MapVisualization === 'function' && this.map) this.mapVisualization = new window.MapVisualization(this.map); }
    calculateScanParameters() { if (typeof calculateScanParameters === 'function') return calculateScanParameters(this); return {}; }
    calculateAreaBounds(lat, lon, radiusKm) { if (typeof calculateAreaBounds === 'function') return calculateAreaBounds(lat, lon, radiusKm); return []; }
    calculateOptimalBorderWeight() { return this.map ? (this.map.getZoom() >= 16 ? 3 : this.map.getZoom() >= 14 ? 2.5 : this.map.getZoom() >= 12 ? 2 : 1.5) : 2; }
    selectScanArea(lat, lon, radiusKm = 1) { if (typeof selectScanArea === 'function') selectScanArea(this, lat, lon, radiusKm); }
    updateScanAreaLabel(resolution = null) { if (typeof updateScanAreaLabel === 'function') updateScanAreaLabel(this, resolution); }

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
            console.error('❌ Failed to stop LiDAR scan:', error);
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
            console.log('✅ LiDAR session stopped:', result.message);
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
        // Remove discovered sites layer from map
        if (this.discoveredSitesLayer && this.map) {
            this.map.removeLayer(this.discoveredSitesLayer);
            this.discoveredSitesLayer = null;
        }
        this.updateScanAreaLabel?.();
    }

    // --- Chat and Auth (stubs, to be implemented as needed) ---
    async handleChatSubmit() { /* implement as needed */ }
    addChatMessage(role, content) { /* implement as needed */ }
    showTypingIndicator() { /* implement as needed */ }
    hideTypingIndicator() { /* implement as needed */ }
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
            console.error('❌ Structure types loading error:', error);
            const structureSelect = document.getElementById('structureType');
            if (structureSelect) {
                structureSelect.innerHTML = '';
                structureSelect.disabled = true;
            }
        }
    }
    async initializeAuth() { /* implement as needed */ }
    updateAuthUI() { /* implement as needed */ }
    showLoginSection() { /* implement as needed */ }
    async handleGoogleLogin(response) { /* implement as needed */ }
    async validateStoredToken(token) { /* implement as needed */ }
    setupGoogleAuth() { /* implement as needed */ }
    async handleLogout() { /* implement as needed */ }
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
} // End of class

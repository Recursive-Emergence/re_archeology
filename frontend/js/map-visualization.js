/**
 * Map Visualization Components
 * Handles all map-related visualization for the windmill discovery system
 */

class MapVisualization {
    constructor(mapElementId, options = {}) {
        this.mapElement = document.getElementById(mapElementId);
        this.map = null;
        this.layers = new Map();
        this.patches = new Map();
        this.options = {
            center: [52.4751, 4.8156],
            zoom: 13,
            minZoom: 8,
            maxZoom: 18,
            ...options
        };
        
        this.initMap();
        this.setupEventHandlers();
    }

    /**
     * Initialize the Leaflet map
     */
    initMap() {
        this.map = L.map(this.mapElement, {
            center: this.options.center,
            zoom: this.options.zoom,
            minZoom: this.options.minZoom,
            maxZoom: this.options.maxZoom,
            zoomControl: true,
            attributionControl: true
        });

        // Add base layers
        this.addBaseLayers();
        
        // Add custom controls
        this.addCustomControls();
        
        // Initialize layer groups
        this.initLayerGroups();
    }

    /**
     * Add base map layers
     */
    addBaseLayers() {
        const baseLayers = {
            'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            }),
            'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'Tiles © Esri',
                maxZoom: 19
            }),
            'Terrain': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
                attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap',
                maxZoom: 17
            })
        };

        // Add default layer
        baseLayers['OpenStreetMap'].addTo(this.map);

        // Add layer control
        L.control.layers(baseLayers).addTo(this.map);
    }

    /**
     * Add custom map controls
     */
    addCustomControls() {
        // Scale control
        L.control.scale({
            position: 'bottomleft',
            imperial: false
        }).addTo(this.map);

        // Coordinates display
        const coordsControl = L.control({position: 'bottomleft'});
        coordsControl.onAdd = () => {
            const div = L.DomUtil.create('div', 'coords-display');
            div.style.background = 'rgba(0, 0, 0, 0.8)';
            div.style.color = '#fff';
            div.style.padding = '4px 8px';
            div.style.borderRadius = '4px';
            div.style.fontSize = '12px';
            div.innerHTML = 'Lat: --, Lon: --';
            return div;
        };
        coordsControl.addTo(this.map);

        // Update coordinates on mouse move
        this.map.on('mousemove', (e) => {
            const coordsDiv = document.querySelector('.coords-display');
            if (coordsDiv) {
                coordsDiv.innerHTML = `Lat: ${e.latlng.lat.toFixed(6)}, Lon: ${e.latlng.lng.toFixed(6)}`;
            }
        });
    }

    /**
     * Initialize layer groups for different data types
     */
    initLayerGroups() {
        this.layers.set('scanArea', L.layerGroup().addTo(this.map));
        this.layers.set('patches', L.layerGroup().addTo(this.map));
        this.layers.set('detections', L.layerGroup().addTo(this.map));
        this.layers.set('animations', L.layerGroup().addTo(this.map));
        this.layers.set('elevation', L.layerGroup());
    }

    /**
     * Set up map event handlers
     */
    setupEventHandlers() {
        this.map.on('click', (e) => {
            this.onMapClick(e);
        });

        this.map.on('zoomend', () => {
            this.onZoomChange();
        });

        this.map.on('moveend', () => {
            this.onMoveEnd();
        });
    }

    /**
     * Handle map click events
     */
    onMapClick(e) {
        const event = new CustomEvent('mapClick', {
            detail: {
                latlng: e.latlng,
                originalEvent: e.originalEvent
            }
        });
        this.mapElement.dispatchEvent(event);
    }

    /**
     * Handle zoom change events
     */
    onZoomChange() {
        const zoom = this.map.getZoom();
        const event = new CustomEvent('zoomChange', {
            detail: { zoom }
        });
        this.mapElement.dispatchEvent(event);
        
        // Update patch visibility based on zoom level
        this.updatePatchVisibility();
    }

    /**
     * Handle map move end events
     */
    onMoveEnd() {
        const center = this.map.getCenter();
        const bounds = this.map.getBounds();
        const event = new CustomEvent('moveEnd', {
            detail: { center, bounds }
        });
        this.mapElement.dispatchEvent(event);
    }

    /**
     * Add or update scan area visualization
     */
    updateScanArea(lat, lon, radiusKm) {
        const scanLayer = this.layers.get('scanArea');
        scanLayer.clearLayers();

        const circle = L.circle([lat, lon], {
            color: '#00ff88',
            fillColor: '#00ff88',
            fillOpacity: 0.1,
            weight: 2,
            radius: radiusKm * 1000
        });

        const marker = L.circleMarker([lat, lon], {
            color: '#00ff88',
            fillColor: '#00ff88',
            fillOpacity: 0.8,
            radius: 6,
            weight: 2
        });

        scanLayer.addLayer(circle);
        scanLayer.addLayer(marker);

        return { circle, marker };
    }

    /**
     * Add a patch to the map
     */
    addPatch(patch) {
        const patchLayer = this.layers.get('patches');
        
        // Calculate patch bounds
        const bounds = this.calculatePatchBounds(patch);
        
        // Determine patch color
        const color = this.getPatchColor(patch);
        
        // Create rectangle
        const rectangle = L.rectangle(bounds, {
            color: color,
            weight: 1,
            fillColor: color,
            fillOpacity: patch.is_positive ? 0.7 : 0.3,
            className: `patch ${patch.is_positive ? 'positive' : 'negative'}`
        });

        // Add popup with patch information
        rectangle.bindPopup(this.createPatchPopup(patch));

        // Add hover effects
        rectangle.on('mouseover', (e) => {
            rectangle.setStyle({
                weight: 3,
                fillOpacity: patch.is_positive ? 0.9 : 0.5
            });
            this.showPatchTooltip(e, patch);
        });

        rectangle.on('mouseout', () => {
            rectangle.setStyle({
                weight: 1,
                fillOpacity: patch.is_positive ? 0.7 : 0.3
            });
            this.hideTooltip();
        });

        // Add click handler
        rectangle.on('click', () => {
            this.onPatchClick(patch);
        });

        patchLayer.addLayer(rectangle);
        this.patches.set(patch.patch_id, {
            patch: patch,
            element: rectangle,
            bounds: bounds
        });

        return rectangle;
    }

    /**
     * Calculate patch bounds from coordinates and size
     */
    calculatePatchBounds(patch) {
        const patchSize = patch.patch_size || 40; // default 40m
        const halfSize = patchSize / 2;
        
        // Convert meters to degrees (rough approximation)
        const latDelta = halfSize / 111000; // ~111km per degree latitude
        const lonDelta = halfSize / (111000 * Math.cos(patch.lat * Math.PI / 180));
        
        return [
            [patch.lat - latDelta, patch.lon - lonDelta],
            [patch.lat + latDelta, patch.lon + lonDelta]
        ];
    }

    /**
     * Determine patch color based on detection results
     */
    getPatchColor(patch) {
        if (!patch.is_positive) {
            return '#666666';
        }

        const confidence = patch.confidence || 0;
        if (confidence >= 0.8) return '#ff4444'; // High confidence - red
        if (confidence >= 0.6) return '#ffaa00'; // Medium confidence - orange
        if (confidence >= 0.4) return '#ffff00'; // Low confidence - yellow
        return '#666666'; // Very low confidence - gray
    }

    /**
     * Create popup content for a patch
     */
    createPatchPopup(patch) {
        const detection = patch.detection_result || {};
        const stats = patch.elevation_stats || {};
        
        return `
            <div class="patch-popup">
                <h4>Patch ${patch.patch_id}</h4>
                <div class="popup-content">
                    <div class="info-row">
                        <span>Location:</span>
                        <span>${patch.lat.toFixed(6)}, ${patch.lon.toFixed(6)}</span>
                    </div>
                    <div class="info-row">
                        <span>Status:</span>
                        <span class="${patch.is_positive ? 'positive' : 'negative'}">
                            ${patch.is_positive ? 'Detection' : 'No Detection'}
                        </span>
                    </div>
                    <div class="info-row">
                        <span>Confidence:</span>
                        <span>${(patch.confidence * 100).toFixed(1)}%</span>
                    </div>
                    <div class="info-row">
                        <span>φ⁰ Score:</span>
                        <span>${detection.phi0?.toFixed(3) || '--'}</span>
                    </div>
                    <div class="info-row">
                        <span>ψ⁰ Score:</span>
                        <span>${detection.psi0?.toFixed(3) || '--'}</span>
                    </div>
                    <div class="info-row">
                        <span>Elevation Range:</span>
                        <span>${stats.min?.toFixed(1) || '--'}m - ${stats.max?.toFixed(1) || '--'}m</span>
                    </div>
                    <div class="info-row">
                        <span>Timestamp:</span>
                        <span>${new Date(patch.timestamp).toLocaleTimeString()}</span>
                    </div>
                </div>
                <div class="popup-actions">
                    <button onclick="window.discoveryApp.showPatchDetails('${patch.patch_id}')" class="btn-small">
                        View Details
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Show scan animation at a location
     */
    showScanAnimation(lat, lon, duration = 2000) {
        const animationLayer = this.layers.get('animations');
        
        const circle = L.circle([lat, lon], {
            color: '#00ff88',
            fillColor: 'transparent',
            weight: 2,
            radius: 50,
            className: 'scan-animation'
        });

        animationLayer.addLayer(circle);

        // Remove after animation duration
        setTimeout(() => {
            animationLayer.removeLayer(circle);
        }, duration);

        return circle;
    }

    /**
     * Update patch visibility based on zoom level
     */
    updatePatchVisibility() {
        const zoom = this.map.getZoom();
        const patchLayer = this.layers.get('patches');
        
        if (zoom < 12) {
            // Hide patches at low zoom levels for performance
            patchLayer.setStyle({opacity: 0.3, fillOpacity: 0.1});
        } else {
            patchLayer.setStyle({opacity: 1, fillOpacity: 0.7});
        }
    }

    /**
     * Show tooltip for patch hover
     */
    showPatchTooltip(e, patch) {
        const tooltip = document.getElementById('patchHoverInfo');
        if (tooltip) {
            // Update tooltip content
            const event = new CustomEvent('showPatchTooltip', {
                detail: { patch, mouseEvent: e.originalEvent }
            });
            document.dispatchEvent(event);
        }
    }

    /**
     * Hide tooltip
     */
    hideTooltip() {
        const event = new CustomEvent('hidePatchTooltip');
        document.dispatchEvent(event);
    }

    /**
     * Handle patch click
     */
    onPatchClick(patch) {
        const event = new CustomEvent('patchClick', {
            detail: { patch }
        });
        this.mapElement.dispatchEvent(event);
    }

    /**
     * Update patch colors based on current settings
     */
    refreshPatchColors() {
        this.patches.forEach(({patch, element}) => {
            const color = this.getPatchColor(patch);
            element.setStyle({
                color: color,
                fillColor: color
            });
        });
    }

    /**
     * Clear all patches from the map
     */
    clearPatches() {
        const patchLayer = this.layers.get('patches');
        patchLayer.clearLayers();
        this.patches.clear();
    }

    /**
     * Clear all layers
     */
    clearAll() {
        this.layers.forEach(layer => layer.clearLayers());
        this.patches.clear();
    }

    /**
     * Fit map to show all patches
     */
    fitToPatches() {
        if (this.patches.size === 0) return;

        const bounds = [];
        this.patches.forEach(({bounds: patchBounds}) => {
            bounds.push(patchBounds[0], patchBounds[1]);
        });

        this.map.fitBounds(bounds, {padding: [20, 20]});
    }

    /**
     * Get map center
     */
    getCenter() {
        return this.map.getCenter();
    }

    /**
     * Set map center
     */
    setCenter(lat, lon, zoom) {
        this.map.setView([lat, lon], zoom || this.map.getZoom());
    }

    /**
     * Get current zoom level
     */
    getZoom() {
        return this.map.getZoom();
    }

    /**
     * Get map bounds
     */
    getBounds() {
        return this.map.getBounds();
    }

    /**
     * Export map as image
     */
    async exportAsImage() {
        // This would require additional libraries like leaflet-image
        // For now, return a placeholder
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==');
            }, 100);
        });
    }

    /**
     * Destroy the map instance
     */
    destroy() {
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
        this.layers.clear();
        this.patches.clear();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapVisualization;
} else {
    window.MapVisualization = MapVisualization;
}

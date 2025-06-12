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
     * Add a patch to the map with elevation data visualization
     */
    addPatch(patch) {
        const patchLayer = this.layers.get('patches');
        
        // Calculate patch bounds
        const bounds = this.calculatePatchBounds(patch);
        
        // Determine border color based on detection results
        const borderColor = this.getPatchColor(patch);
        
        // Determine fill based on elevation data
        const fillStyle = this.getPatchFillStyle(patch);
        
        // Create rectangle with elevation fill and detection border
        const rectangle = L.rectangle(bounds, {
            color: borderColor,
            weight: patch.is_positive ? 3 : 1, // Thicker border for detections
            fillColor: fillStyle.color,
            fillOpacity: fillStyle.opacity,
            fillPattern: fillStyle.pattern,
            className: `patch ${patch.is_positive ? 'positive' : 'negative'}`
        });

        // Add popup with patch information
        rectangle.bindPopup(this.createPatchPopup(patch));

        // Add hover effects
        rectangle.on('mouseover', (e) => {
            rectangle.setStyle({
                weight: patch.is_positive ? 5 : 3,
                fillOpacity: Math.min(fillStyle.opacity + 0.2, 1.0)
            });
            this.showPatchTooltip(e, patch);
        });

        rectangle.on('mouseout', () => {
            rectangle.setStyle({
                weight: patch.is_positive ? 3 : 1,
                fillOpacity: fillStyle.opacity
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
     * Get fill style based on elevation data
     */
    getPatchFillStyle(patch) {
        if (!patch.elevation_data || !Array.isArray(patch.elevation_data)) {
            // No elevation data - use neutral fill
            return {
                color: '#666666',
                opacity: 0.3,
                pattern: null
            };
        }

        // Calculate elevation statistics
        const stats = patch.elevation_stats || this.calculateElevationStats(patch.elevation_data);
        
        if (stats.range === 0) {
            // Flat terrain - use single color
            return {
                color: this.getElevationColor(0.5), // Middle elevation color
                opacity: 0.6,
                pattern: null
            };
        }

        // Use elevation range to determine visualization
        const normalizedMean = stats.range > 0 ? (stats.mean - stats.min) / stats.range : 0.5;
        
        return {
            color: this.getElevationColor(normalizedMean),
            opacity: 0.7,
            pattern: null
        };
    }

    /**
     * Calculate elevation statistics for visualization
     */
    calculateElevationStats(data) {
        const flatData = data.flat().filter(v => v !== null && v !== undefined && !isNaN(v));
        
        if (flatData.length === 0) {
            return { min: 0, max: 0, mean: 0, std: 0, range: 0 };
        }

        const min = Math.min(...flatData);
        const max = Math.max(...flatData);
        const mean = flatData.reduce((a, b) => a + b, 0) / flatData.length;
        const variance = flatData.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / flatData.length;
        const std = Math.sqrt(variance);
        const range = max - min;

        return { min, max, mean, std, range };
    }

    /**
     * Get elevation color using terrain color scale
     */
    getElevationColor(normalized) {
        // Use a terrain-like color scale
        const colors = [
            { pos: 0.0, color: [70, 130, 180] },     // Steel blue (low)
            { pos: 0.2, color: [100, 180, 120] },    // Light green
            { pos: 0.4, color: [180, 200, 120] },    // Yellow-green
            { pos: 0.6, color: [200, 180, 100] },    // Sandy brown
            { pos: 0.8, color: [180, 120, 80] },     // Brown
            { pos: 1.0, color: [140, 100, 80] }      // Dark brown (high)
        ];

        // Find the two colors to interpolate between
        let lowerColor = colors[0];
        let upperColor = colors[colors.length - 1];

        for (let i = 0; i < colors.length - 1; i++) {
            if (normalized >= colors[i].pos && normalized <= colors[i + 1].pos) {
                lowerColor = colors[i];
                upperColor = colors[i + 1];
                break;
            }
        }

        // Interpolate between the two colors
        const range = upperColor.pos - lowerColor.pos;
        const factor = range === 0 ? 0 : (normalized - lowerColor.pos) / range;

        const r = Math.round(lowerColor.color[0] + factor * (upperColor.color[0] - lowerColor.color[0]));
        const g = Math.round(lowerColor.color[1] + factor * (upperColor.color[1] - lowerColor.color[1]));
        const b = Math.round(lowerColor.color[2] + factor * (upperColor.color[2] - lowerColor.color[2]));

        return `rgb(${r}, ${g}, ${b})`;
    }

    /**
     * Calculate patch bounds from coordinates and size
     * Fixed to eliminate gaps between adjacent patches
     */
    calculatePatchBounds(patch) {
        const patchSize = patch.patch_size || 40; // default 40m
        const halfSize = patchSize / 2;
        
        // Convert meters to degrees with more accurate calculation
        const latDelta = halfSize / 111000; // ~111km per degree latitude
        const lonDelta = halfSize / (111000 * Math.cos(patch.lat * Math.PI / 180));
        
        // Ensure patches are adjacent by using exact boundaries
        // The patch coordinates represent the center, so we create exact boundaries
        return [
            [patch.lat - latDelta, patch.lon - lonDelta],
            [patch.lat + latDelta, patch.lon + lonDelta]
        ];
    }

    /**
     * Determine patch border color based on detection results
     */
    getPatchColor(patch) {
        if (!patch.is_positive) {
            return '#888888'; // Gray border for no detection
        }

        const confidence = patch.confidence || 0;
        if (confidence >= 0.8) return '#FF0000'; // Bright red for high confidence
        if (confidence >= 0.6) return '#FF6600'; // Orange for medium confidence  
        if (confidence >= 0.4) return '#FFAA00'; // Yellow-orange for low confidence
        return '#CCCCCC'; // Light gray for very low confidence
    }

    /**
     * Create popup content for a patch
     */
    createPatchPopup(patch) {
        const detection = patch.detection_result || {};
        const stats = patch.elevation_stats || {};
        const rows = patch.elevation_data?.length || 0;
        const cols = patch.elevation_data?.[0]?.length || 0;
        
        // Determine grid resolution that will be displayed
        let displayGridSize = 8; // default
        if (rows >= 60 && cols >= 60) {
            displayGridSize = 21; // High resolution - matches detection kernel
        } else if (rows >= 32 && cols >= 32) {
            displayGridSize = 16; // Medium resolution
        } else if (rows >= 16 && cols >= 16) {
            displayGridSize = 12; // Low-medium resolution
        }
        
        return `
            <div class="patch-popup extended">
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
                        <span>Data Resolution:</span>
                        <span>${rows}×${cols} → ${displayGridSize}×${displayGridSize} ${displayGridSize === 21 ? '(Kernel Match!)' : 'display'}</span>
                    </div>
                    <div class="info-row">
                        <span>Timestamp:</span>
                        <span>${new Date(patch.timestamp).toLocaleTimeString()}</span>
                    </div>
                </div>
                
                <!-- Mini Elevation Visualization -->
                <div class="popup-visualization">
                    <div class="mini-elevation-grid" id="miniElevationGrid_${patch.patch_id}">
                        <!-- Will be populated by JavaScript -->
                    </div>
                    <div class="mini-histogram" id="miniHistogram_${patch.patch_id}">
                        <canvas width="150" height="80"></canvas>
                    </div>
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

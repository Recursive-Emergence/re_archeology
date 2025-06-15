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
        
        // Determine fill: use confidence colors for detections, elevation for non-detections
        let fillColor, fillOpacity;
        if (patch.is_positive) {
            // For positive detections, use the confidence color with good opacity
            fillColor = borderColor;
            fillOpacity = 0.8;
        } else {
            // For non-detections, use elevation-based fill
            const fillStyle = this.getPatchFillStyle(patch);
            fillColor = fillStyle.color;
            fillOpacity = fillStyle.opacity;
        }
        
        // Create rectangle with detection-based coloring
        const rectangle = L.rectangle(bounds, {
            color: borderColor,
            weight: patch.is_positive ? 3 : 1, // Thicker border for detections
            fillColor: fillColor,
            fillOpacity: fillOpacity,
            className: `patch ${patch.is_positive ? 'positive' : 'negative'}`
        });

        // Add popup with patch information
        rectangle.bindPopup(this.createPatchPopup(patch));

        // Populate mini elevation grid when popup opens
        rectangle.on('popupopen', () => {
            this.populateMiniElevationGrid(patch);
        });

        // Add hover effects
        rectangle.on('mouseover', (e) => {
            rectangle.setStyle({
                weight: patch.is_positive ? 5 : 3,
                fillOpacity: Math.min(fillOpacity + 0.2, 1.0)
            });
            this.showPatchTooltip(e, patch);
        });

        rectangle.on('mouseout', () => {
            rectangle.setStyle({
                weight: patch.is_positive ? 3 : 1,
                fillOpacity: fillOpacity
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
        // Clamp normalized value to [0, 1]
        normalized = Math.max(0, Math.min(1, normalized));
        
        // Matplotlib terrain colormap approximation
        const colors = [
            { pos: 0.0, color: [51, 102, 153] },    // Deep blue (water/valleys)
            { pos: 0.15, color: [68, 119, 170] },   // Blue
            { pos: 0.3, color: [34, 136, 51] },     // Deep green (lowlands)
            { pos: 0.45, color: [102, 170, 68] },   // Light green (vegetation)
            { pos: 0.6, color: [170, 170, 68] },    // Yellow-green (hills)
            { pos: 0.75, color: [204, 153, 102] },  // Brown (exposed earth)
            { pos: 0.9, color: [238, 221, 204] },   // Light brown (rocky areas)
            { pos: 1.0, color: [255, 255, 255] }    // White (peaks)
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
        if (confidence >= 0.8) return '#006400'; // Dark green for high confidence
        if (confidence >= 0.6) return '#228B22'; // Forest green for medium-high confidence  
        if (confidence >= 0.4) return '#32CD32'; // Lime green for medium confidence
        if (confidence >= 0.2) return '#90EE90'; // Light green for low confidence
        return '#E8F5E8'; // Very light green for very low confidence
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
                        <span>Detection Method:</span>
                        <span>${detection.method || 'G2_dutch_windmill'}</span>
                    </div>
                    <div class="info-row">
                        <span>G2 Detected:</span>
                        <span>${detection.g2_detected ? 'Yes' : 'No'}</span>
                    </div>
                    <div class="info-row">
                        <span>G2 Confidence:</span>
                        <span>${detection.g2_confidence ? (detection.g2_confidence * 100).toFixed(1) + '%' : '--'}</span>
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
            const borderColor = this.getPatchColor(patch);
            
            let fillColor, fillOpacity;
            if (patch.is_positive) {
                // For positive detections, use confidence color
                fillColor = borderColor;
                fillOpacity = 0.7;
            } else {
                // For non-detections, use elevation color
                const fillStyle = this.getPatchFillStyle(patch);
                fillColor = fillStyle.color;
                fillOpacity = fillStyle.opacity;
            }
            
            element.setStyle({
                color: borderColor,
                fillColor: fillColor,
                fillOpacity: fillOpacity
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

    /**
     * Populate the mini elevation grid in popup with terrain colormap
     */
    populateMiniElevationGrid(patch) {
        const gridId = `miniElevationGrid_${patch.patch_id}`;
        const gridContainer = document.getElementById(gridId);
        
        if (!gridContainer) {
            console.warn(`Mini elevation grid container ${gridId} not found`);
            return;
        }

        if (!patch.elevation_data || !Array.isArray(patch.elevation_data)) {
            gridContainer.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">No elevation data</div>';
            return;
        }

        const data = patch.elevation_data;
        const rows = data.length;
        const cols = data[0]?.length || 0;

        if (rows === 0 || cols === 0) {
            gridContainer.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">Invalid elevation data</div>';
            return;
        }

        // Calculate statistics
        const flatData = data.flat().filter(v => v !== null && v !== undefined && !isNaN(v));
        const min = Math.min(...flatData);
        const max = Math.max(...flatData);
        const range = max - min;

        // Improved resolution - use more detail than the old 8x8 grid
        const maxSize = 20; // Much better than the old 8x8
        const rowStep = Math.max(1, Math.floor(rows / maxSize));
        const colStep = Math.max(1, Math.floor(cols / maxSize));
        const displayRows = Math.ceil(rows / rowStep);
        const displayCols = Math.ceil(cols / colStep);

        // Create grid HTML
        const cellSize = Math.min(120 / displayCols, 120 / displayRows); // Max 120px container
        
        let gridHTML = `
            <div style="display: grid; 
                       grid-template-columns: repeat(${displayCols}, ${cellSize}px); 
                       grid-template-rows: repeat(${displayRows}, ${cellSize}px); 
                       gap: 1px; 
                       background: #333; 
                       padding: 2px; 
                       border-radius: 3px;
                       margin: 5px 0;">
        `;

        for (let i = 0; i < displayRows; i++) {
            for (let j = 0; j < displayCols; j++) {
                const rowIdx = Math.min(i * rowStep, rows - 1);
                const colIdx = Math.min(j * colStep, cols - 1);
                const value = data[rowIdx][colIdx];
                
                let backgroundColor = '#666'; // Default for invalid data
                if (value !== null && value !== undefined && !isNaN(value)) {
                    const normalized = range > 0 ? (value - min) / range : 0;
                    backgroundColor = this.getElevationColor(normalized);
                }
                
                gridHTML += `
                    <div style="background-color: ${backgroundColor}; 
                               width: ${cellSize}px; 
                               height: ${cellSize}px;"
                         title="Elevation: ${value?.toFixed(2) || 'N/A'}m">
                    </div>
                `;
            }
        }
        
        gridHTML += '</div>';
        
        // Add title with resolution info
        const titleHTML = `
            <div style="font-size: 11px; color: #ccc; text-align: center; margin-bottom: 5px;">
                Elevation Heatmap (${displayRows}×${displayCols}) - Terrain Colors
            </div>
        `;
        
        gridContainer.innerHTML = titleHTML + gridHTML;
        
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapVisualization;
} else {
    window.MapVisualization = MapVisualization;
}

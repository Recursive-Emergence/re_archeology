/**
 * Clean Map Visualization Components
 * Focused on LiDAR heatmap visualization with consistent elevation palettes
 */

class MapVisualization {
    constructor(mapInstance, options = {}) {
        if (!mapInstance || typeof mapInstance.getContainer !== 'function') {
            throw new Error('MapVisualization requires a valid Leaflet map instance');
        }
        
        this.map = mapInstance;
        this.mapElement = mapInstance.getContainer();
        
        // Core data structures
        this.layers = new Map();
        this.heatmapTiles = new Map();
        
        // Global elevation range for consistent heatmap coloring
        this.globalElevationRange = {
            min: null,
            max: null,
            isInitialized: false
        };
        
        // Heatmap mode state
        this.heatmapMode = false;
        
        this.initLayerGroups();
        window.Logger?.visualization('info', 'MapVisualization initialized (clean version)');
    }

    /**
     * Initialize layer groups for different data types
     */
    initLayerGroups() {
        this.layers.set('patches', L.layerGroup().addTo(this.map));
        this.layers.set('detections', L.layerGroup().addTo(this.map));
        this.layers.set('animations', L.layerGroup().addTo(this.map));
        this.layers.set('elevation', L.layerGroup());
    }

    /**
     * Enable heatmap mode for LiDAR visualization
     */
    enableHeatmapMode() {
        this.heatmapMode = true;
        this.heatmapTiles = new Map();
        
        // Reset global elevation range for new scan
        this.resetGlobalElevationRange();
        
        window.Logger?.visualization('debug', 'Enabled LiDAR heatmap mode with global elevation range');
    }
    
    /**
     * Disable heatmap mode
     */
    disableHeatmapMode() {
        this.heatmapMode = false;
        this.clearHeatmapTiles();
        window.Logger?.visualization('debug', 'Disabled LiDAR heatmap mode');
    }

    /**
     * Reset global elevation range
     */
    resetGlobalElevationRange() {
        this.globalElevationRange = {
            min: null,
            max: null,
            isInitialized: false
        };
    }

    /**
     * Update global elevation range from tile data
     */
    updateGlobalElevationRange(elevationData) {
        for (let i = 0; i < elevationData.length; i++) {
            for (let j = 0; j < elevationData[0].length; j++) {
                const elev = elevationData[i][j];
                if (elev !== null && !isNaN(elev)) {
                    if (!this.globalElevationRange.isInitialized) {
                        this.globalElevationRange.min = elev;
                        this.globalElevationRange.max = elev;
                        this.globalElevationRange.isInitialized = true;
                    } else {
                        this.globalElevationRange.min = Math.min(this.globalElevationRange.min, elev);
                        this.globalElevationRange.max = Math.max(this.globalElevationRange.max, elev);
                    }
                }
            }
        }
        
        window.Logger?.visualization('debug', `Global elevation range: ${this.globalElevationRange.min?.toFixed(2)}m to ${this.globalElevationRange.max?.toFixed(2)}m`);
    }

    /**
     * Add LiDAR heatmap tile with consistent elevation coloring
     */
    addLidarHeatmapTile(tileData) {
        if (!this.heatmapMode) {
            window.Logger?.visualization('warn', 'Heatmap mode not enabled');
            return;
        }

        try {
            // Extract tile bounds
            const bounds = this.extractTileBounds(tileData);
            if (!bounds) {
                window.Logger?.visualization('error', 'No valid bounds found in tile data', tileData);
                return;
            }

            // Extract elevation data
            const elevationData = this.extractElevationData(tileData);
            if (!elevationData) {
                window.Logger?.visualization('error', 'No valid elevation data in tile', tileData);
                return;
            }

            // Log tile information for debugging
            const tileSizeM = tileData.size_m || tileData.tile_size_m || 40;
            const actualTileSize = tileSizeM > 200 ? 40 : tileSizeM;
            // Use logger for reduced console noise
            window.Logger?.visualization('debug', `Adding tile ${tileData.tile_id}`, {
                dataSize: `${elevationData.length}×${elevationData[0].length}`,
                tileSize: `${actualTileSize}m`,
                bounds: bounds
            });

            // Create heatmap canvas
            const canvas = this.createHeatmapCanvas(elevationData, tileData);
            
            // Create and add overlay
            const heatmapOverlay = this.createHeatmapOverlay(canvas, bounds);
            heatmapOverlay.addTo(this.map);

            // Store tile reference
            this.heatmapTiles.set(tileData.tile_id, heatmapOverlay);

            window.Logger?.visualization('debug', `Added heatmap tile ${tileData.tile_id}`);

        } catch (error) {
            window.Logger?.visualization('error', `Failed to add heatmap tile ${tileData.tile_id}`, error);
        }
    }

    /**
     * Extract tile bounds from tile data
     */
    extractTileBounds(tileData) {
        // Try different bound formats - prioritize explicit tile_bounds
        if (tileData.tile_bounds) {
            window.Logger?.visualization('debug', `Using explicit tile bounds for ${tileData.tile_id}`, tileData.tile_bounds);
            return tileData.tile_bounds;
        }
        
        if (tileData.bounds) {
            return tileData.bounds;
        }
        
        // Calculate from center and size
        if (tileData.center_lat && tileData.center_lon) {
            const centerLat = tileData.center_lat;
            const centerLon = tileData.center_lon;
            const tileSizeM = tileData.size_m || tileData.tile_size_m || 40;
            
            // Prevent using scan area size as tile size
            const actualTileSize = tileSizeM > 200 ? 40 : tileSizeM;
            
            window.Logger?.visualization('debug', `Calculating bounds for tile ${tileData.tile_id}`, {
                center: `(${centerLat}, ${centerLon})`,
                size: `${actualTileSize}m`
            });
            
            // Correct conversion: 1 degree ≈ 111,320 meters at the equator
            // For half-tile size (radius from center)
            const latDelta = (actualTileSize / 2) / 111320; // Half tile size in degrees latitude
            const lonDelta = (actualTileSize / 2) / (111320 * Math.cos(centerLat * Math.PI / 180)); // Half tile size in degrees longitude
            
            const calculatedBounds = {
                south: centerLat - latDelta,
                west: centerLon - lonDelta,
                north: centerLat + latDelta,
                east: centerLon + lonDelta
            };
            
            window.Logger?.visualization('debug', 'Calculated bounds', calculatedBounds);
            return calculatedBounds;
        }

        return null;
    }

    /**
     * Extract elevation data from tile data
     */
    extractElevationData(tileData) {
        if (tileData.viz_elevation && Array.isArray(tileData.viz_elevation)) {
            return tileData.viz_elevation;
        }
        
        if (tileData.elevation_data && Array.isArray(tileData.elevation_data)) {
            return tileData.elevation_data;
        }
        
        return null;
    }

    /**
     * Create heatmap canvas from elevation data
     */
    createHeatmapCanvas(elevationData, tileData) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        const rows = elevationData.length;
        const cols = elevationData[0].length;
        
        // Use actual data dimensions for canvas size
        // This ensures 1:1 pixel mapping with the elevation data
        canvas.width = cols;
        canvas.height = rows;

        window.Logger?.visualization('debug', `Creating heatmap canvas: ${cols}×${rows} for tile ${tileData.tile_id || 'unknown'}`);

        // Render heatmap
        this.renderHeatmapCanvas(ctx, elevationData, canvas.width, canvas.height);
        
        return canvas;
    }

    /**
     * Create heatmap overlay from canvas
     */
    createHeatmapOverlay(canvas, bounds) {
        const imageUrl = canvas.toDataURL();
        const leafletBounds = L.latLngBounds(
            [bounds.south, bounds.west],
            [bounds.north, bounds.east]
        );
        
        const overlay = L.imageOverlay(imageUrl, leafletBounds, {
            opacity: 0.85,
            className: 'lidar-heatmap-tile visible',
            interactive: false,
            crossOrigin: true
        });
        
        // Add debugging information
        overlay.on('add', function() {
            window.Logger?.visualization('debug', 'Tile overlay added to map', { bounds: leafletBounds });
        });
        
        return overlay;
    }

    /**
     * Render elevation data as heatmap on canvas with global elevation range
     */
    renderHeatmapCanvas(ctx, elevationData, canvasWidth, canvasHeight) {
        const rows = elevationData.length;
        const cols = elevationData[0].length;
        
        // Update global elevation range first
        this.updateGlobalElevationRange(elevationData);
        
        // Use global elevation range for consistent coloring
        const minElev = this.globalElevationRange.min;
        const maxElev = this.globalElevationRange.max;
        const elevRange = maxElev - minElev;
        
        // Calculate cell dimensions - ensure we fill the entire canvas
        const cellWidth = canvasWidth / cols;
        const cellHeight = canvasHeight / rows;

        // Render each cell with precise positioning
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                const elev = elevationData[i][j];
                
                if (elev !== null && !isNaN(elev)) {
                    // Normalize using global range for consistency
                    const normalized = elevRange > 0 ? (elev - minElev) / elevRange : 0.5;
                    const color = this.getHeatmapColor(normalized);
                    
                    ctx.fillStyle = color;
                    
                    // Use Math.floor to ensure pixels align to grid
                    const x = Math.floor(j * cellWidth);
                    const y = Math.floor(i * cellHeight);
                    const w = Math.ceil(cellWidth);
                    const h = Math.ceil(cellHeight);
                    
                    ctx.fillRect(x, y, w, h);
                }
            }
        }
    }

    /**
     * Get heatmap color based on normalized elevation (0-1)
     */
    getHeatmapColor(value) {
        value = Math.max(0, Math.min(1, value));
        
        let r, g, b;
        
        if (value < 0.2) {
            // Deep blue to blue
            const t = value / 0.2;
            r = Math.floor(30 * t);
            g = Math.floor(100 * t);
            b = Math.floor(120 + 135 * t);
        } else if (value < 0.4) {
            // Blue to cyan
            const t = (value - 0.2) / 0.2;
            r = Math.floor(30);
            g = Math.floor(100 + 155 * t);
            b = 255;
        } else if (value < 0.6) {
            // Cyan to green
            const t = (value - 0.4) / 0.2;
            r = Math.floor(30 * (1 - t));
            g = 255;
            b = Math.floor(255 * (1 - t));
        } else if (value < 0.8) {
            // Green to yellow
            const t = (value - 0.6) / 0.2;
            r = Math.floor(255 * t);
            g = 255;
            b = 0;
        } else {
            // Yellow to red
            const t = (value - 0.8) / 0.2;
            r = 255;
            g = Math.floor(255 * (1 - t));
            b = 0;
        }
        
        return `rgba(${r}, ${g}, ${b}, 0.85)`;
    }

    /**
     * Clear all heatmap tiles
     */
    clearHeatmapTiles() {
        if (this.heatmapTiles) {
            this.heatmapTiles.forEach((overlay) => {
                this.map.removeLayer(overlay);
            });
            this.heatmapTiles.clear();
        }
        
        this.resetGlobalElevationRange();
        window.Logger?.visualization('debug', 'Cleared heatmap tiles and reset elevation range');
    }

    /**
     * Clear LiDAR heatmap data
     */
    clearLidarHeatmap() {
        this.clearHeatmapTiles();
        window.Logger?.visualization('debug', 'Cleared LiDAR heatmap data');
    }

    /**
     * Clear elevation data
     */
    clearElevationData() {
        this.clearLidarHeatmap();
        
        const elevationLayer = this.layers.get('elevation');
        if (elevationLayer) {
            elevationLayer.clearLayers();
        }
        
        window.Logger?.visualization('debug', 'Cleared elevation data');
    }

    /**
     * Clear all layers
     */
    clearAll() {
        this.layers.forEach(layer => layer.clearLayers());
        this.clearLidarHeatmap();
        window.Logger?.visualization('debug', 'Cleared all visualization layers');
    }

    /**
     * Destroy the visualization instance
     */
    destroy() {
        window.Logger?.visualization('debug', 'Destroying MapVisualization instance...');
        
        this.clearAll();
        
        if (this.heatmapTiles) {
            this.heatmapTiles.clear();
        }
        
        this.heatmapMode = false;
        window.Logger?.visualization('debug', 'MapVisualization destroyed');
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapVisualization;
} else {
    window.MapVisualization = MapVisualization;
}

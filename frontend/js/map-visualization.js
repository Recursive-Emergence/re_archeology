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
        console.log('✅ MapVisualization initialized (clean version)');
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
        
        console.log('🔥 Enabled LiDAR heatmap mode with global elevation range');
    }
    
    /**
     * Disable heatmap mode
     */
    disableHeatmapMode() {
        this.heatmapMode = false;
        this.clearHeatmapTiles();
        console.log('❄️ Disabled LiDAR heatmap mode');
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
        
        console.log(`🌍 Global elevation range: ${this.globalElevationRange.min?.toFixed(2)}m to ${this.globalElevationRange.max?.toFixed(2)}m`);
    }

    /**
     * Add LiDAR heatmap tile with consistent elevation coloring
     */
    addLidarHeatmapTile(tileData) {
        if (!this.heatmapMode) {
            console.warn('⚠️ Heatmap mode not enabled');
            return;
        }

        try {
            // Extract tile bounds
            const bounds = this.extractTileBounds(tileData);
            if (!bounds) {
                console.error('❌ No valid bounds found in tile data');
                return;
            }

            // Extract elevation data
            const elevationData = this.extractElevationData(tileData);
            if (!elevationData) {
                console.error('❌ No valid elevation data in tile');
                return;
            }

            // Create heatmap canvas
            const canvas = this.createHeatmapCanvas(elevationData, tileData);
            
            // Create and add overlay
            const heatmapOverlay = this.createHeatmapOverlay(canvas, bounds);
            heatmapOverlay.addTo(this.map);

            // Store tile reference
            this.heatmapTiles.set(tileData.tile_id, heatmapOverlay);

            console.log(`✅ Added LiDAR heatmap tile ${tileData.tile_id}`);

        } catch (error) {
            console.error(`❌ Failed to add heatmap tile ${tileData.tile_id}:`, error);
        }
    }

    /**
     * Extract tile bounds from tile data
     */
    extractTileBounds(tileData) {
        // Try different bound formats
        if (tileData.tile_bounds) {
            return tileData.tile_bounds;
        }
        
        if (tileData.bounds) {
            return tileData.bounds;
        }
        
        // Calculate from center and size
        if (tileData.center_lat && tileData.center_lon) {
            const centerLat = tileData.center_lat;
            const centerLon = tileData.center_lon;
            const tileSizeM = tileData.tile_size_m || tileData.size_m || 40;
            
            // Prevent using scan area size as tile size
            const actualTileSize = tileSizeM > 200 ? 40 : tileSizeM;
            
            const latDelta = actualTileSize / 222000; // Half size in degrees
            const lonDelta = actualTileSize / (222000 * Math.cos(centerLat * Math.PI / 180));
            
            return {
                south: centerLat - latDelta,
                west: centerLon - lonDelta,
                north: centerLat + latDelta,
                east: centerLon + lonDelta
            };
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
        const tileSizeM = tileData.tile_size_m || tileData.size_m || 40;
        
        // Set canvas dimensions
        const pixelsPerMeter = tileSizeM <= 40 ? 2 : tileSizeM <= 100 ? 1.5 : 1;
        canvas.width = Math.max(cols, tileSizeM * pixelsPerMeter);
        canvas.height = Math.max(rows, tileSizeM * pixelsPerMeter);

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
        
        return L.imageOverlay(imageUrl, leafletBounds, {
            opacity: 0.85,
            className: 'lidar-heatmap-tile',
            interactive: false
        });
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
        
        const cellWidth = canvasWidth / cols;
        const cellHeight = canvasHeight / rows;

        // Render each cell
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                const elev = elevationData[i][j];
                
                if (elev !== null && !isNaN(elev)) {
                    // Normalize using global range for consistency
                    const normalized = elevRange > 0 ? (elev - minElev) / elevRange : 0.5;
                    const color = this.getHeatmapColor(normalized);
                    
                    ctx.fillStyle = color;
                    ctx.fillRect(j * cellWidth, i * cellHeight, cellWidth, cellHeight);
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
        console.log('🧹 Cleared heatmap tiles and reset elevation range');
    }

    /**
     * Clear LiDAR heatmap data
     */
    clearLidarHeatmap() {
        this.clearHeatmapTiles();
        console.log('🧹 Cleared LiDAR heatmap data');
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
        
        console.log('🧹 Cleared elevation data');
    }

    /**
     * Clear all layers
     */
    clearAll() {
        this.layers.forEach(layer => layer.clearLayers());
        this.clearLidarHeatmap();
        console.log('🧹 Cleared all visualization layers');
    }

    /**
     * Destroy the visualization instance
     */
    destroy() {
        console.log('🧹 Destroying MapVisualization instance...');
        
        this.clearAll();
        
        if (this.heatmapTiles) {
            this.heatmapTiles.clear();
        }
        
        this.heatmapMode = false;
        console.log('✅ MapVisualization destroyed');
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapVisualization;
} else {
    window.MapVisualization = MapVisualization;
}

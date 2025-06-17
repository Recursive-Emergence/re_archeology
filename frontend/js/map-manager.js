/**
 * Map Manager
 * Handles Leaflet map operations, patch visualization, and geographic interactions
 */

class MapManager extends EventEmitter {
    constructor() {
        super();
        this.map = null;
        this.patches = new Map();
        this.scanAreaCircle = null;
        this.layers = {};
        this.patchVisualization = null;
    }
    
    async init() {
        this.initLeafletMap();
        this.initPatchVisualization();
        this.setupMapEvents();
    }
    
    initLeafletMap() {
        // Initialize the map
        this.map = L.map('map').setView([52.4751, 4.8156], 13);
        
        // Add base layers
        this.layers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri'
        }).addTo(this.map);
        
        this.layers.street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        });
        
        // Add LiDAR elevation overlay for Netherlands region
        this.layers.lidar = L.tileLayer('https://service.pdok.nl/rce/ahn/wmts/ahn4_05m_dsm/EPSG:3857/{z}/{x}/{y}.png', {
            maxZoom: 16
        });
        
        // Add layer control
        const baseLayers = {
            'Satellite': this.layers.satellite,
            'Street': this.layers.street
        };
        
        const overlayLayers = {
            'LiDAR Elevation': this.layers.lidar
        };
        
        L.control.layers(baseLayers, overlayLayers).addTo(this.map);
        
        // Add scan area circle
        this.scanAreaCircle = L.circle([52.4751, 4.8156], {
            radius: 2000,
            color: '#00ff88',
            fillColor: '#00ff88',
            fillOpacity: 0.1,
            weight: 2
        }).addTo(this.map);
    }
    
    initPatchVisualization() {
        // Initialize patch visualization system if available
        if (typeof PatchVisualization !== 'undefined') {
            this.patchVisualization = new PatchVisualization();
            console.log('✅ Patch visualization initialized');
        } else {
            console.warn('⚠️ PatchVisualization not available');
        }
    }
    
    setupMapEvents() {
        // Handle map clicks for setting scan center
        this.map.on('click', (e) => {
            const { lat, lng } = e.latlng;
            this.updateScanArea({ lat, lon: lng, radius: 2 });
            
            // Emit area selected event
            this.emit('areaSelected', {
                north: lat + 0.02,
                south: lat - 0.02,
                east: lng + 0.02,
                west: lng - 0.02
            });
        });
        
        // Handle map zoom/pan for performance optimization
        this.map.on('zoomend moveend', () => {
            this.optimizePatchDisplay();
        });
    }
    
    updateScanArea(area) {
        if (!area) return;
        
        const { lat, lon, radius } = area;
        const radiusMeters = radius * 1000; // Convert km to meters
        
        // Update scan area circle
        this.scanAreaCircle.setLatLng([lat, lon]);
        this.scanAreaCircle.setRadius(radiusMeters);
        
        // Center map on new location
        this.map.setView([lat, lon], this.map.getZoom());
        
        console.log(`🎯 Scan area updated: ${lat.toFixed(6)}, ${lon.toFixed(6)} (${radius}km radius)`);
    }
    
    addPatch(patch) {
        if (!patch || this.patches.has(patch.patch_id)) {
            return;
        }
        
        console.log(`📍 Adding patch to map: ${patch.patch_id}`);
        
        const bounds = this.calculatePatchBounds(patch);
        const style = this.getPatchStyle(patch);
        
        // Create rectangle for patch
        const rectangle = L.rectangle(bounds, {
            ...style,
            className: `patch ${patch.is_positive ? 'positive' : 'negative'} ${patch.detection_result?.g2_detected ? 'g2-detected' : ''}`
        }).addTo(this.map);
        
        // Create popup content
        const popupContent = this.createPatchPopup(patch);
        rectangle.bindPopup(popupContent, {
            className: 'professional-popup',
            maxWidth: 400
        });
        
        // Add click handler for detailed visualization
        rectangle.on('click', () => {
            setTimeout(() => {
                this.showPatchDetailedVisualization(patch);
            }, 200);
        });
        
        // Store patch data
        patch.mapElement = rectangle;
        this.patches.set(patch.patch_id, patch);
        
        console.log(`✅ Patch ${patch.patch_id} added to map`);
    }
    
    calculatePatchBounds(patch) {
        const patchSizeM = patch.patch_size_m || 40;
        const patchSizeKm = patchSizeM / 1000;
        
        // Convert patch size to degrees
        const latOffset = patchSizeKm / 111.32; // 1 degree latitude = ~111.32 km
        const lonOffset = patchSizeKm / (111.32 * Math.cos(patch.lat * Math.PI / 180));
        
        return [
            [patch.lat - latOffset/2, patch.lon - lonOffset/2],
            [patch.lat + latOffset/2, patch.lon + lonOffset/2]
        ];
    }
    
    getPatchStyle(patch) {
        const borderColor = this.getPatchColor(patch);
        let fillColor, fillOpacity, borderWeight;
        
        if (patch.is_positive && patch.detection_result?.g2_detected) {
            fillColor = borderColor;
            fillOpacity = 0.3;
            borderWeight = 3;
        } else if (patch.is_positive) {
            fillColor = borderColor;
            fillOpacity = 0.2;
            borderWeight = 2;
        } else {
            fillColor = '#666666';
            fillOpacity = 0.05;
            borderWeight = 1;
        }
        
        return {
            color: borderColor,
            fillColor: fillColor,
            fillOpacity: fillOpacity,
            weight: borderWeight,
            opacity: 0.8
        };
    }
    
    getPatchColor(patch) {
        // Prioritize G2 detection result for positive patches
        if (patch.is_positive && patch.detection_result?.g2_detected) {
            const g2Score = patch.detection_result.g2_final_score || patch.detection_result.g2_confidence || 0;
            if (g2Score >= 0.8) return '#00ff88'; // Bright green for high G2 scores
            if (g2Score >= 0.6) return '#00cc66'; // Medium green
            return '#009944'; // Dark green
        }
        
        // Fallback to confidence for non-G2 or negative patches
        const confidence = patch.confidence || 0;
        if (confidence >= 0.7) return '#00ff88';
        if (confidence >= 0.5) return '#00cc66';
        if (confidence >= 0.3) return '#009944';
        if (confidence >= 0.1) return '#006622';
        return '#666666'; // Gray for no detection
    }
    
    createPatchPopup(patch) {
        const confidence = this.getNumericFinalScore(patch);
        const confidenceText = this.formatConfidence(confidence);
        const statusText = this.getConfidenceStatusText(patch);
        const backgroundColor = this.getConfidenceBackground(patch);
        const textColor = this.getConfidenceTextColor(patch);
        
        return `
            <div style="padding: 12px; font-family: 'Segoe UI', sans-serif; min-width: 300px; background: ${backgroundColor}; border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div style="font-weight: bold; font-size: 14px; color: #fff;">
                        📍 Patch ${patch.patch_id}
                    </div>
                    <div style="font-size: 11px; color: #ccc;">
                        ${patch.lat.toFixed(6)}, ${patch.lon.toFixed(6)}
                    </div>
                </div>
                
                <div style="margin-bottom: 12px; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 4px;">
                    <div style="font-size: 12px; font-weight: bold; color: ${textColor}; margin-bottom: 4px;">
                        ${statusText}
                    </div>
                    <div style="font-size: 11px; color: #ccc;">
                        Final Score: <span style="color: ${textColor}; font-weight: bold;">${confidenceText}</span>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                    <div>
                        <div style="font-size: 10px; color: #999; margin-bottom: 4px;">ELEVATION HEATMAP</div>
                        <div id="miniElevationGrid_${patch.patch_id}" style="width: 120px; height: 120px; border: 1px solid #333; border-radius: 4px; background: #1a1a1a;"></div>
                    </div>
                    <div>
                        <div style="font-size: 10px; color: #999; margin-bottom: 4px;">DISTRIBUTION</div>
                        <div id="miniHistogram_${patch.patch_id}">
                            <canvas width="120" height="120" style="width: 120px; height: 120px; border: 1px solid #333; border-radius: 4px; background: #1a1a1a;"></canvas>
                        </div>
                    </div>
                </div>
                
                ${this.createG2FeatureScores(patch)}
            </div>
        `;
    }
    
    createG2FeatureScores(patch) {
        if (!patch.detection_result?.g2_feature_scores) {
            return '';
        }
        
        const scores = patch.detection_result.g2_feature_scores;
        const scoreEntries = Object.entries(scores)
            .filter(([key, value]) => typeof value === 'number' && !isNaN(value))
            .slice(0, 6); // Limit to top 6 scores
        
        if (scoreEntries.length === 0) {
            return '';
        }
        
        const scoreElements = scoreEntries.map(([feature, score]) => {
            const color = this.getScoreColor(score);
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                    <span style="font-size: 9px; color: #ccc;">${feature}</span>
                    <span style="font-size: 9px; color: ${color}; font-weight: bold;">${score.toFixed(3)}</span>
                </div>
            `;
        }).join('');
        
        return `
            <div style="margin-top: 8px; padding: 6px; background: rgba(0,0,0,0.2); border-radius: 4px;">
                <div style="font-size: 9px; color: #999; margin-bottom: 4px; text-transform: uppercase;">G₂ Feature Analysis</div>
                ${scoreElements}
            </div>
        `;
    }
    
    showPatchDetailedVisualization(patch) {
        // Create elevation heatmap and histogram in popup
        const elevationGridId = `miniElevationGrid_${patch.patch_id}`;
        const histogramId = `miniHistogram_${patch.patch_id}`;
        
        const elevationContainer = document.getElementById(elevationGridId);
        const histogramContainer = document.getElementById(histogramId);
        
        if (!elevationContainer || !histogramContainer) {
            console.warn('⚠️ Visualization containers not found for patch:', patch.patch_id);
            return;
        }
        
        // Get elevation data
        let elevationData = null;
        if (patch.elevation_data && Array.isArray(patch.elevation_data)) {
            elevationData = patch.elevation_data;
        } else if (patch.detection_result?.elevation_data && Array.isArray(patch.detection_result.elevation_data)) {
            elevationData = patch.detection_result.elevation_data;
        }
        
        // Create visualizations
        this.createElevationHeatmap(elevationContainer, patch, elevationData);
        this.createElevationHistogram(histogramContainer, patch, elevationData);
    }
    
    createElevationHeatmap(container, patch, elevationData) {
        container.innerHTML = '';
        
        if (!elevationData || !Array.isArray(elevationData)) {
            this.showNoElevationData(container);
            return;
        }
        
        // Handle both 1D and 2D elevation data
        let rows, cols, flatData;
        
        if (Array.isArray(elevationData[0])) {
            rows = elevationData.length;
            cols = elevationData[0].length;
            flatData = elevationData.flat().filter(val => typeof val === 'number' && !isNaN(val) && isFinite(val));
        } else {
            // Assume square grid for 1D data
            const totalPoints = elevationData.filter(val => typeof val === 'number' && !isNaN(val) && isFinite(val));
            const size = Math.floor(Math.sqrt(totalPoints.length));
            rows = cols = size;
            flatData = totalPoints.slice(0, size * size);
        }
        
        if (flatData.length === 0) {
            this.showNoElevationData(container);
            return;
        }
        
        // Create canvas for heatmap
        const canvas = document.createElement('canvas');
        canvas.width = 120;
        canvas.height = 120;
        canvas.style.width = '120px';
        canvas.style.height = '120px';
        canvas.style.border = '1px solid #333';
        canvas.style.borderRadius = '4px';
        
        const ctx = canvas.getContext('2d');
        
        // Calculate display parameters
        const cellWidth = canvas.width / cols;
        const cellHeight = canvas.height / rows;
        
        // Find min/max for normalization
        const minElev = Math.min(...flatData);
        const maxElev = Math.max(...flatData);
        const range = maxElev - minElev;
        
        if (!isFinite(minElev) || !isFinite(maxElev) || range === 0) {
            this.showNoElevationData(container);
            return;
        }
        
        // Create heatmap with terrain colors
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const index = row * cols + col;
                if (index < flatData.length) {
                    const elevation = flatData[index];
                    const normalized = (elevation - minElev) / range;
                    
                    // Use terrain color scheme
                    let r, g, b;
                    if (normalized < 0.3) {
                        // Blue to green (water to low land)
                        r = Math.floor(normalized * 3 * 100);
                        g = Math.floor(100 + normalized * 3 * 155);
                        b = Math.floor(200 - normalized * 3 * 100);
                    } else if (normalized < 0.7) {
                        // Green to yellow (low to medium elevation)
                        const t = (normalized - 0.3) / 0.4;
                        r = Math.floor(100 + t * 155);
                        g = Math.floor(255 - t * 100);
                        b = Math.floor(100 - t * 100);
                    } else {
                        // Yellow to red (medium to high elevation)
                        const t = (normalized - 0.7) / 0.3;
                        r = 255;
                        g = Math.floor(255 - t * 255);
                        b = 0;
                    }
                    
                    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                    ctx.fillRect(col * cellWidth, row * cellHeight, cellWidth, cellHeight);
                }
            }
        }
        
        container.appendChild(canvas);
        
        // Add elevation range info
        const info = document.createElement('div');
        info.style.cssText = 'font-size: 9px; color: #999; text-align: center; margin-top: 4px;';
        info.innerHTML = `
            <div style="font-size: 8px; color: #666;">${rows}×${cols} LiDAR Grid</div>
            <div>${minElev.toFixed(1)}m - ${maxElev.toFixed(1)}m</div>
        `;
        container.appendChild(info);
    }
    
    createElevationHistogram(container, patch, elevationData) {
        const canvas = container.querySelector('canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
        
        // Handle elevation data
        let flatData = [];
        
        if (!elevationData || !Array.isArray(elevationData)) {
            this.drawNoDataHistogram(ctx, width, height);
            return;
        }
        
        if (Array.isArray(elevationData[0])) {
            flatData = elevationData.flat().filter(val => typeof val === 'number' && !isNaN(val) && isFinite(val));
        } else {
            flatData = elevationData.filter(val => typeof val === 'number' && !isNaN(val) && isFinite(val));
        }
        
        if (flatData.length === 0) {
            this.drawNoDataHistogram(ctx, width, height);
            return;
        }
        
        // Create histogram
        const numBins = 16;
        const minElev = Math.min(...flatData);
        const maxElev = Math.max(...flatData);
        const range = maxElev - minElev;
        
        if (!isFinite(minElev) || !isFinite(maxElev) || range === 0) {
            this.drawNoDataHistogram(ctx, width, height);
            return;
        }
        
        const binWidth = range / numBins;
        const bins = new Array(numBins).fill(0);
        
        // Fill bins
        flatData.forEach(elev => {
            const binIndex = Math.min(Math.floor((elev - minElev) / binWidth), numBins - 1);
            bins[binIndex]++;
        });
        
        // Draw histogram
        const maxCount = Math.max(...bins);
        if (maxCount === 0) return;
        
        const barWidth = (width - 20) / numBins;
        const maxBarHeight = height - 30;
        
        ctx.fillStyle = '#00ff88';
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        
        bins.forEach((count, i) => {
            const barHeight = (count / maxCount) * maxBarHeight;
            const x = 10 + i * barWidth;
            const y = height - 15 - barHeight;
            
            ctx.fillRect(x, y, barWidth - 1, barHeight);
            ctx.strokeRect(x, y, barWidth - 1, barHeight);
        });
        
        // Draw axes
        ctx.strokeStyle = '#555';
        ctx.beginPath();
        ctx.moveTo(10, height - 15);
        ctx.lineTo(width - 10, height - 15);
        ctx.moveTo(10, 15);
        ctx.lineTo(10, height - 15);
        ctx.stroke();
        
        // Add labels
        ctx.fillStyle = '#999';
        ctx.font = '8px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${minElev.toFixed(1)}m`, 15, height - 3);
        ctx.fillText(`${maxElev.toFixed(1)}m`, width - 15, height - 3);
        
        // Add sample count
        ctx.textAlign = 'right';
        ctx.fillText(`n=${flatData.length}`, width - 5, 12);
    }
    
    drawNoDataHistogram(ctx, width, height) {
        // Draw axes
        ctx.strokeStyle = '#555';
        ctx.beginPath();
        ctx.moveTo(10, height - 15);
        ctx.lineTo(width - 10, height - 15);
        ctx.stroke();
        
        // Add "No Data" message
        ctx.fillStyle = '#666';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('No Data', width / 2, height / 2);
    }
    
    showNoElevationData(container) {
        const placeholder = document.createElement('div');
        placeholder.style.cssText = `
            width: 120px;
            height: 120px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #666;
            font-size: 10px;
            border: 1px solid #333;
            border-radius: 4px;
            background: #1a1a1a;
        `;
        placeholder.textContent = 'No Elevation Data';
        container.appendChild(placeholder);
    }
    
    clearPatches() {
        console.log('🧹 Clearing map patches...');
        
        // Remove all patch layers from map
        this.patches.forEach(patchData => {
            if (patchData.mapElement) {
                this.map.removeLayer(patchData.mapElement);
            }
        });
        
        this.patches.clear();
        console.log('✅ Map patches cleared');
    }
    
    optimizePatchDisplay() {
        // Performance optimization: hide/show patches based on zoom level
        const currentZoom = this.map.getZoom();
        const showPatches = currentZoom >= 12; // Only show patches at zoom 12+
        
        this.patches.forEach(patchData => {
            if (patchData.mapElement) {
                if (showPatches) {
                    patchData.mapElement.setStyle({ opacity: 0.8 });
                } else {
                    patchData.mapElement.setStyle({ opacity: 0.2 });
                }
            }
        });
    }
    
    // Utility methods
    getNumericFinalScore(patch) {
        if (patch.detection_result?.g2_final_score !== undefined) {
            return patch.detection_result.g2_final_score;
        }
        if (patch.detection_result?.g2_confidence !== undefined) {
            return patch.detection_result.g2_confidence;
        }
        return patch.confidence || 0;
    }
    
    formatConfidence(confidence) {
        if (!confidence) return '0.0';
        if (confidence > 1) {
            return confidence.toFixed(1);
        } else {
            return (confidence * 100).toFixed(1) + '%';
        }
    }
    
    getConfidenceStatusText(patch) {
        if (patch.detection_result?.g2_detected) {
            return '🎯 G₂ DETECTION CONFIRMED';
        }
        
        const conf = patch.confidence || 0;
        if (conf >= 0.7) return '🎯 HIGH CONFIDENCE DETECTION';
        if (conf >= 0.5) return '✅ STRONG DETECTION';
        if (conf >= 0.3) return '🔍 MODERATE DETECTION';
        if (conf >= 0.1) return '⚡ WEAK DETECTION';
        return '❌ NO DETECTION';
    }
    
    getConfidenceBackground(patch) {
        let score = patch.confidence || 0;
        if (patch.detection_result?.g2_detected && patch.detection_result?.g2_final_score !== undefined) {
            score = patch.detection_result.g2_final_score;
        }
        
        if (score >= 0.7) return 'rgba(0, 255, 136, 0.15)';
        if (score >= 0.5) return 'rgba(0, 204, 102, 0.15)';
        if (score >= 0.3) return 'rgba(0, 153, 68, 0.15)';
        if (score >= 0.1) return 'rgba(0, 102, 34, 0.15)';
        return 'rgba(102, 102, 102, 0.1)';
    }
    
    getConfidenceTextColor(patch) {
        let score = patch.confidence || 0;
        if (patch.detection_result?.g2_detected && patch.detection_result?.g2_final_score !== undefined) {
            score = patch.detection_result.g2_final_score;
        }
        
        if (score >= 0.7) return '#00ff88';
        if (score >= 0.5) return '#00cc66';
        if (score >= 0.3) return '#009944';
        if (score >= 0.1) return '#006622';
        return '#666666';
    }
    
    getScoreColor(score) {
        if (score >= 0.7) return '#00ff88';
        if (score >= 0.4) return '#00cc66';
        return '#009944';
    }
    
    // Public API
    getMap() {
        return this.map;
    }
    
    getPatch(patchId) {
        return this.patches.get(patchId);
    }
    
    getAllPatches() {
        return new Map(this.patches);
    }
}

// Make available globally
window.MapManager = MapManager;

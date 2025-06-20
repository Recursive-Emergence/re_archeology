/**
 * Patch Data Visualization Components
 * Handles detailed visualization of elevation and detection data for individual patches
 */

class PatchVisualization {
    constructor() {
        this.currentPatch = null;
        this.charts = new Map();
        this.initializeComponents();
    }

    /**
     * Initialize visualization components
     */
    initializeComponents() {
        this.setupElevationGrid();
        this.setupEventListeners();
    }

    /**
     * Setup elevation grid component
     */
    setupElevationGrid() {
        const gridContainer = document.getElementById('patchGrid');
        if (!gridContainer) {
            console.warn('⚠️ patchGrid container not found during setup');
            return;
        }

        // Don't add a close button here - it's already in the HTML structure
        console.log('✅ Elevation grid setup complete');
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Listen for patch visualization events
        document.addEventListener('showPatchDetails', (e) => {
            this.showPatchDetails(e.detail.patch);
        });

        document.addEventListener('hidePatchDetails', () => {
            this.hidePatchDetails();
        });

        // Listen for patch click events from the map
        const mapElement = document.getElementById('map');
        if (mapElement) {
            mapElement.addEventListener('patchClick', (e) => {
                this.showPatchDetails(e.detail.patch);
            });
        } else {
            console.error('❌ Map element not found for patch click listener');
        }

        // Click outside to close
        document.addEventListener('click', (e) => {
            const gridContainer = document.getElementById('patchGrid');
            if (gridContainer && 
                gridContainer.style.display === 'flex' && 
                !gridContainer.contains(e.target) && 
                !e.target.closest('.leaflet-interactive')) {
                this.hidePatchDetails();
            }
        });
    }

    /**
     * Show detailed visualization for a patch
     */
    showPatchDetails(patch) {
        this.currentPatch = patch;
        
        // DO NOT show the modal - we want popup only
        // const gridContainer = document.getElementById('patchGrid');
        // if (gridContainer) {
        //     gridContainer.style.display = 'flex';
        // }
        
        // Instead, let the popup handle everything
    }

    /**
     * Display elevation data as a colored grid with enhanced visualization
     */
    displayElevationGrid(patch) {
        const gridContainer = document.getElementById('patchGrid');
        const elevationGrid = document.getElementById('elevationGrid');
        
        if (!gridContainer || !elevationGrid) {
            console.error('❌ Missing grid containers!');
            return;
        }

        elevationGrid.innerHTML = '';

        if (!patch.elevation_data || !Array.isArray(patch.elevation_data)) {
            elevationGrid.innerHTML = `
                <div style="text-align: center; color: #aaa; padding: 40px; grid-column: 1 / -1;">
                    <p>📊 No elevation data available</p>
                    <p>This patch may be outside the LiDAR coverage area</p>
                </div>
            `;
            return;
        }

        const data = patch.elevation_data;
        const rows = data.length;
        const cols = data[0]?.length || 0;

        if (rows === 0 || cols === 0) {
            elevationGrid.innerHTML = `
                <div style="text-align: center; color: #aaa; padding: 40px; grid-column: 1 / -1;">
                    <p>📊 Empty elevation data</p>
                    <p>Data dimensions: ${rows} x ${cols}</p>
                </div>
            `;
            return;
        }

        // Limit grid size for performance - adjust for compact mode
        const isCompact = elevationGrid.classList.contains('mini');
        const maxGridSize = isCompact ? 16 : 25;  // Smaller grid for compact mode
        const displayRows = Math.min(rows, maxGridSize);
        const displayCols = Math.min(cols, maxGridSize);

        elevationGrid.style.gridTemplateColumns = `repeat(${displayCols}, 1fr)`;

        const stats = patch.elevation_stats || this.calculateElevationStats(data);
        const min = stats.min;
        const max = stats.max;
        const range = max - min;

        // Add grid header with patch info and detection status - compact version
        if (!isCompact) {
            const headerInfo = document.createElement('div');
            headerInfo.className = 'elevation-grid-header';
            headerInfo.innerHTML = `
                <div class="grid-title">
                    <h4>Patch ${patch.patch_id} - LiDAR Elevation Data</h4>
                    <div class="detection-status ${patch.is_positive ? 'positive' : 'negative'}">
                        ${patch.is_positive ? '🎯 DETECTION' : '❌ NO DETECTION'}
                        ${patch.confidence ? `(${(patch.confidence * 100).toFixed(1)}% confidence)` : ''}
                    </div>
                </div>
                <div class="elevation-legend">
                    <span class="legend-label">Elevation Range:</span>
                    <div class="legend-bar">
                        <span class="legend-min">${min.toFixed(1)}m</span>
                        <div class="legend-gradient"></div>
                        <span class="legend-max">${max.toFixed(1)}m</span>
                    </div>
                </div>
            `;
            elevationGrid.parentElement.insertBefore(headerInfo, elevationGrid);
        }

        // Sample data if needed
        const rowStep = Math.max(1, Math.floor(rows / displayRows));
        const colStep = Math.max(1, Math.floor(cols / displayCols));

        for (let i = 0; i < displayRows; i++) {
            for (let j = 0; j < displayCols; j++) {
                const rowIdx = Math.min(i * rowStep, rows - 1);
                const colIdx = Math.min(j * colStep, cols - 1);
                const value = data[rowIdx][colIdx];
                
                if (value === null || value === undefined || isNaN(value)) continue;

                const normalized = range > 0 ? (value - min) / range : 0;
                
                const cell = document.createElement('div');
                cell.className = 'elevation-cell enhanced';
                
                // Show elevation value only on hover to reduce clutter
                cell.style.backgroundColor = this.getElevationColor(normalized);
                cell.style.color = normalized > 0.5 ? '#fff' : '#000';
                cell.title = `Elevation: ${value.toFixed(2)}m\nPosition: [${rowIdx}, ${colIdx}]\nNormalized: ${normalized.toFixed(3)}`;
                
                // Add subtle elevation indicator
                const elevationIndicator = document.createElement('div');
                elevationIndicator.className = 'elevation-indicator';
                elevationIndicator.style.height = `${Math.max(2, normalized * 100)}%`;
                cell.appendChild(elevationIndicator);
                
                // Add click handler for cell details
                cell.onclick = () => this.showCellDetails(value, rowIdx, colIdx);
                
                elevationGrid.appendChild(cell);
            }
        }

        gridContainer.style.display = 'flex';
    }

    /**
     * Calculate elevation statistics if not provided
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
     * Get color for elevation value (normalized 0-1) using matplotlib's terrain colormap
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
     * Display professional elevation histogram comparison (like the histogram analyzer)
     */
    async displayElevationChart(patch) {
        console.log('🎯 displayElevationChart called with patch:', patch.patch_id);
        console.log('🎯 Patch data structure:', patch);
        const chartContainer = document.getElementById('elevationChart');
        
        if (!chartContainer) {
            console.error('❌ Missing chart container with ID elevationChart!');
            return;
        }

        // Clear container and create analyzer-style layout
        chartContainer.innerHTML = '';
        chartContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            padding: 15px;
            background: #1a1a1a;
            border-radius: 8px;
            border: 1px solid #333;
        `;

        // Check if Chart.js is available
        if (typeof Chart === 'undefined') {
            console.error('❌ Chart.js library not loaded!');
            console.log('Available global objects:', Object.keys(window).filter(k => k.toLowerCase().includes('chart')));
            chartContainer.innerHTML = `
                <div style="text-align: center; color: #aaa; padding: 20px;">
                    <p>📊 Chart.js library not loaded</p>
                    <p>Please check network connection and library loading</p>
                </div>
            `;
            return;
        }

        if (!patch.elevation_data || !Array.isArray(patch.elevation_data)) {
            console.error('❌ No elevation data available for patch:', patch.patch_id);
            chartContainer.innerHTML = `
                <div style="text-align: center; color: #aaa; padding: 20px;">
                    <p>📊 No elevation data available</p>
                </div>
            `;
            return;
        }

        // Get G2 score for display
        const g2Score = patch.detection_result?.g2_final_score || patch.detection_result?.g2_confidence || patch.confidence || 0;
        
        // Calculate histogram data with real detection scores
        const histogramData = await this.calculateHistogramData(patch);
        const score = histogramData?.score || g2Score;

        // === TOP: Elevation Heatmap (like your analyzer) ===
        const heatmapSection = document.createElement('div');
        heatmapSection.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            margin-bottom: 10px;
        `;

        // Patch title with G2 score - using terrain colormap like histogram_check.py
        const heatmapTitle = document.createElement('div');
        const isG2Detection = patch.detection_result?.g2_detected;
        const scoreLabel = isG2Detection ? 'G2 Score' : 'Score';
        heatmapTitle.innerHTML = `
            <h5 style="color: #fff; margin: 0 0 8px 0; text-align: center; font-size: 12px;">
                ${patch.metadata?.name || `Patch ${patch.patch_id}`}
                ${isG2Detection ? '<span style="color: #00ff88; font-size: 9px;">🎯 G2 DETECTED</span>' : ''}
                <br><span style="color: ${this.getScoreColor(score)}; font-size: 10px;">${scoreLabel}: ${score.toFixed(4)}</span>
                <br><span style="color: #888; font-size: 9px;">Terrain Colormap</span>
            </h5>
        `;
        heatmapSection.appendChild(heatmapTitle);

        // Elevation heatmap canvas
        const heatmapCanvas = document.createElement('canvas');
        heatmapCanvas.width = 150;  // Increased from 120 to match improved resolution
        heatmapCanvas.height = 150; // Increased from 120 to match improved resolution
        heatmapCanvas.style.cssText = `
            border: 1px solid #444;
            border-radius: 4px;
            image-rendering: pixelated;
            background: #f0f8ff;
        `;
        heatmapSection.appendChild(heatmapCanvas);

        // Draw elevation heatmap
        this.drawElevationHeatmap(heatmapCanvas, patch.elevation_data);

        chartContainer.appendChild(heatmapSection);

        // === BOTTOM: Histogram Comparison (like your analyzer) ===
        const histogramSection = document.createElement('div');
        histogramSection.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100%;
        `;

        // Histogram title
        const histogramTitle = document.createElement('div');
        histogramTitle.innerHTML = `
            <h6 style="color: #ccc; margin: 0 0 8px 0; text-align: center; font-size: 11px;">
                Elevation Histograms
            </h6>
        `;
        histogramSection.appendChild(histogramTitle);

        // Use existing canvas or create new one
        let canvas = document.getElementById('elevationHistogramCanvas');
        if (canvas) {
            console.log('✅ Using existing canvas element');
            // Clear and resize the existing canvas
            canvas.width = 300;
            canvas.height = 160;
            canvas.style.cssText = `
                background: #1a1a1a;
                border: 1px solid #333;
                border-radius: 4px;
            `;
            // Add canvas to our layout
            const canvasContainer = document.createElement('div');
            canvasContainer.style.cssText = `
                position: relative;
                height: 160px;
                width: 100%;
                display: flex;
                justify-content: center;
            `;
            canvasContainer.appendChild(canvas);
            histogramSection.appendChild(canvasContainer);
        } else {
            // Fallback: create new canvas
            const canvasContainer = document.createElement('div');
            canvasContainer.style.cssText = `
                position: relative;
                height: 140px;
                width: 100%;
            `;
            
            canvas = document.createElement('canvas');
            canvas.id = 'professionalHistogramCanvas';
            canvas.width = 300;
            canvas.height = 140;
            canvasContainer.appendChild(canvas);
            histogramSection.appendChild(canvasContainer);
        }

        chartContainer.appendChild(histogramSection);

        // Create professional Chart.js histogram
        console.log('✅ About to create Chart.js histogram...');
        console.log('Canvas element:', canvas);
        console.log('Histogram data:', histogramData);
        console.log('Score:', score);
        await this.createProfessionalChartJS(canvas, histogramData, score);
        console.log('✅ Chart creation completed');
    }

    /**
     * Draw elevation heatmap like the analyzer
     */
    drawElevationHeatmap(canvas, elevationData) {
        console.log('🎨 drawElevationHeatmap called with:', elevationData);
        
        if (!elevationData || !Array.isArray(elevationData)) {
            console.warn('❌ No elevation data for heatmap');
            return;
        }
        
        const ctx = canvas.getContext('2d');
        
        // Handle both 1D and 2D data structures
        let rows, cols;
        
        if (Array.isArray(elevationData[0])) {
            // 2D array
            rows = elevationData.length;
            cols = elevationData[0]?.length || 0;
        } else {
            // 1D array - assume square
            const size = Math.sqrt(elevationData.length);
            rows = cols = Math.floor(size);
        }
        
        console.log(`🎨 Grid dimensions: ${rows}x${cols}`);
        
        if (rows === 0 || cols === 0) {
            console.warn('❌ Invalid grid dimensions');
            return;
        }

        // Calculate statistics
        const flatData = elevationData.flat().filter(v => v !== null && v !== undefined && !isNaN(v));
        const min = Math.min(...flatData);
        const max = Math.max(...flatData);
        const range = max - min;

        // Adjust canvas size to maintain aspect ratio
        const aspectRatio = cols / rows;
        if (aspectRatio > 1) {
            canvas.width = 150;
            canvas.height = Math.round(150 / aspectRatio);
        } else {
            canvas.height = 150;
            canvas.width = Math.round(150 * aspectRatio);
        }

        console.log(`🎨 Final canvas: ${canvas.width}x${canvas.height}`);

        // Create smooth heatmap using ImageData (like matplotlib)
        const imageData = ctx.createImageData(canvas.width, canvas.height);
        const pixelData = imageData.data;

        // For each pixel in the canvas, interpolate from elevation data
        for (let canvasY = 0; canvasY < canvas.height; canvasY++) {
            for (let canvasX = 0; canvasX < canvas.width; canvasX++) {
                // Map canvas coordinates to data coordinates
                const dataX = (canvasX / canvas.width) * cols;
                const dataY = (canvasY / canvas.height) * rows;
                
                // Bilinear interpolation for smooth heatmap
                const x0 = Math.floor(dataX);
                const x1 = Math.min(x0 + 1, cols - 1);
                const y0 = Math.floor(dataY);
                const y1 = Math.min(y0 + 1, rows - 1);
                
                const fx = dataX - x0;
                const fy = dataY - y0;
                
                // Get the four surrounding elevation values
                let v00, v01, v10, v11;
                
                if (Array.isArray(elevationData[0])) {
                    // 2D array access
                    v00 = elevationData[y0] && elevationData[y0][x0] !== null ? elevationData[y0][x0] : min;
                    v01 = elevationData[y0] && elevationData[y0][x1] !== null ? elevationData[y0][x1] : min;
                    v10 = elevationData[y1] && elevationData[y1][x0] !== null ? elevationData[y1][x0] : min;
                    v11 = elevationData[y1] && elevationData[y1][x1] !== null ? elevationData[y1][x1] : min;
                } else {
                    // 1D array access
                    v00 = elevationData[y0 * cols + x0] !== null ? elevationData[y0 * cols + x0] : min;
                    v01 = elevationData[y0 * cols + x1] !== null ? elevationData[y0 * cols + x1] : min;
                    v10 = elevationData[y1 * cols + x0] !== null ? elevationData[y1 * cols + x0] : min;
                    v11 = elevationData[y1 * cols + x1] !== null ? elevationData[y1 * cols + x1] : min;
                }
                
                // Bilinear interpolation
                const interpolatedValue = 
                    v00 * (1 - fx) * (1 - fy) +
                    v01 * fx * (1 - fy) +
                    v10 * (1 - fx) * fy +
                    v11 * fx * fy;
                
                // Normalize and get color
                const normalized = range > 0 ? (interpolatedValue - min) / range : 0.5;
                const colorStr = this.getElevationColor(normalized);
                
                // Parse RGB values from string like "rgb(51, 102, 153)"
                const rgbMatch = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                let r = 240, g = 248, b = 255; // Default light blue
                if (rgbMatch) {
                    r = parseInt(rgbMatch[1]);
                    g = parseInt(rgbMatch[2]);
                    b = parseInt(rgbMatch[3]);
                }
                
                // Set pixel color
                const pixelIndex = (canvasY * canvas.width + canvasX) * 4;
                pixelData[pixelIndex] = r;       // Red
                pixelData[pixelIndex + 1] = g;   // Green
                pixelData[pixelIndex + 2] = b;   // Blue
                pixelData[pixelIndex + 3] = 255; // Alpha
            }
        }
        
        // Draw the smooth heatmap
        ctx.putImageData(imageData, 0, 0);
        
        console.log('✅ Elevation heatmap drawn successfully');
    }

    /**
     * Create professional Chart.js histogram like the analyzer
     */
    async createProfessionalChartJS(canvas, histogramData, score) {
        console.log('🎯 createProfessionalChartJS called with:');
        console.log('  - Canvas:', canvas);
        console.log('  - Canvas ID:', canvas.id);
        console.log('  - Canvas parent:', canvas.parentElement);
        console.log('  - HistogramData:', histogramData);
        console.log('  - Score:', score);
        
        const { localDensity, kernelDensity, binLabels } = histogramData;
        
        if (!localDensity.length || !kernelDensity.length) {
            console.warn('❌ Empty histogram data arrays');
            return;
        }

        console.log('✅ Histogram data validated:');
        console.log('  - Local density length:', localDensity.length);
        console.log('  - Kernel density length:', kernelDensity.length);
        console.log('  - Bin labels length:', binLabels.length);

        // Destroy existing chart if it exists
        if (this.charts.has('professional-histogram')) {
            console.log('🔄 Destroying existing chart');
            this.charts.get('professional-histogram').destroy();
            this.charts.delete('professional-histogram');
        }

        const ctx = canvas.getContext('2d');
        console.log('✅ Canvas context obtained:', !!ctx);

        // Create professional Chart.js histogram (exactly like your analyzer)
        console.log('🎨 Creating Chart.js instance...');
        const chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: binLabels,
                datasets: [{
                    label: 'Local',
                    data: localDensity,
                    backgroundColor: 'rgba(54, 162, 235, 0.7)', // Blue like analyzer
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1,
                    barPercentage: 0.8,
                    categoryPercentage: 0.9
                }, {
                    label: 'Kernel', 
                    data: kernelDensity,
                    backgroundColor: 'rgba(255, 159, 64, 0.7)', // Orange like analyzer
                    borderColor: 'rgba(255, 159, 64, 1)',
                    borderWidth: 1,
                    barPercentage: 0.8,
                    categoryPercentage: 0.9
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 600
                },
                plugins: {
                    title: {
                        display: false // Title handled separately
                    },
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#ccc',
                            font: {
                                size: 11
                            },
                            padding: 8,
                            usePointStyle: true,
                            pointStyle: 'rect'
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: '#00ff88',
                        borderWidth: 1,
                        callbacks: {
                            title: function(context) {
                                return `Elevation Bin: ${context[0].label}`;
                            },
                            label: function(context) {
                                const percentage = (context.raw * 100).toFixed(1);
                                return `${context.dataset.label}: ${percentage}% density`;
                            },
                            afterBody: function(context) {
                                if (context[0].datasetIndex === 0) {
                                    return [`Similarity Score: ${score.toFixed(4)}`];
                                }
                                return [];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Normalized Elevation Bin',
                            color: '#ccc',
                            font: {
                                size: 10
                            }
                        },
                        ticks: {
                            color: '#ccc',
                            maxRotation: 0,
                            font: {
                                size: 8
                            },
                            callback: function(value, index) {
                                // Show every 4th label to avoid crowding
                                return index % 4 === 0 ? this.getLabelForValue(value) : '';
                            }
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            drawBorder: true
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Density',
                            color: '#ccc',
                            font: {
                                size: 10
                            }
                        },
                        ticks: {
                            color: '#ccc',
                            precision: 3,
                            maxTicksLimit: 6,
                            font: {
                                size: 8
                            }
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            drawBorder: true
                        },
                        beginAtZero: true
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            }
        });

        // Store chart reference
        this.charts.set('professional-histogram', chart);
        console.log('✅ Chart created and stored successfully');
        console.log('✅ Chart instance:', chart);
        console.log('✅ Total charts stored:', this.charts.size);
    }

    /**
     * Hide patch details panel
     */
    hidePatchDetails() {
        const gridContainer = document.getElementById('patchGrid');
        if (gridContainer) {
            gridContainer.style.display = 'none';
        }

        const analysisContainer = document.getElementById('detectionAnalysis');
        if (analysisContainer) {
            analysisContainer.innerHTML = '';
        }

        this.currentPatch = null;
    }

    /**
     * Export patch data
     */
    async exportPatchData(patchId) {
        if (!this.currentPatch) return;

        const data = {
            patch_info: this.currentPatch,
            elevation_data: this.currentPatch.elevation_data,
            detection_result: this.currentPatch.detection_result,
            export_timestamp: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: 'application/json'
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `patch_${patchId}_data.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * View patch in 3D (placeholder)
     */
    viewIn3D(patchId) {
        alert('3D visualization feature coming soon!');
    }

    /**
     * Compare with similar patches (placeholder)
     */
    compareWithSimilar(patchId) {
        alert('Patch comparison feature coming soon!');
    }

    /**
     * Create elevation profile chart
     */
    createElevationProfile(data, direction = 'horizontal') {
        // This would create a line chart showing elevation profile
        // Placeholder for future implementation
        return null;
    }

    /**
     * Create contour visualization
     */
    createContourVisualization(data) {
        // This would create contour lines for elevation data
        // Placeholder for future implementation
        return null;
    }

    /**
     * Calculate histogram data for Chart.js visualization
     */
    async calculateHistogramData(patch) {
        // If no elevation data, return empty histogram
        if (!patch.elevation_data || !Array.isArray(patch.elevation_data)) {
            return {
                localDensity: [],
                kernelDensity: [],
                binLabels: [],
                score: 0
            };
        }
        
        const data = patch.elevation_data;
        const flatData = data.flat().filter(v => v !== null && v !== undefined && !isNaN(v));
        
        if (flatData.length === 0) {
            return {
                localDensity: [],
                kernelDensity: [],
                binLabels: [],
                score: 0
            };
        }
        
        // Normalize elevation data to 0-1 range
        const min = Math.min(...flatData);
        const max = Math.max(...flatData);
        const range = max - min;
        
        if (range === 0) {
            // Flat terrain - single bin
            return {
                localDensity: [1.0],
                kernelDensity: [1.0],
                binLabels: ['0.5'],
                score: 0.1
            };
        }
        
        // Create histogram bins (16 bins like the backend G2 system)
        const numBins = 16;
        const localDensity = new Array(numBins).fill(0);
        const binLabels = [];
        
        // Create bin labels
        for (let i = 0; i < numBins; i++) {
            binLabels.push((i / (numBins - 1)).toFixed(2));
        }
        
        // Populate local histogram
        flatData.forEach(value => {
            const normalized = (value - min) / range;
            const binIndex = Math.min(Math.floor(normalized * numBins), numBins - 1);
            localDensity[binIndex]++;
        });
        
        // Normalize to density
        const totalSamples = flatData.length;
        for (let i = 0; i < numBins; i++) {
            localDensity[i] = localDensity[i] / totalSamples;
        }
        
        // Create synthetic kernel density (in real system this would come from trained G2 kernel)
        const kernelDensity = this.generateSyntheticKernelDensity(patch, numBins);
        
        // Calculate similarity score using chi-squared test approximation
        let score = 0;
        for (let i = 0; i < numBins; i++) {
            const expected = kernelDensity[i];
            const observed = localDensity[i];
            if (expected > 0) {
                score += Math.pow(observed - expected, 2) / expected;
            }
        }
        
        // Convert to similarity score (lower chi-squared = higher similarity)
        score = Math.max(0, Math.min(1, Math.exp(-score / 2)));
        
        return {
            localDensity,
            kernelDensity,
            binLabels,
            score
        };
    }
    
    /**
     * Generate synthetic kernel density based on G2 feature scores
     */
    generateSyntheticKernelDensity(patch, numBins) {
        const scores = patch.detection_result?.g2_feature_scores || {};
        const density = new Array(numBins).fill(0);
        
        // Use G2 feature scores to shape the expected distribution
        const volume = scores.Volume || 0.5;
        const compactness = scores.Compactness || 0.5;
        const planarity = scores.Planarity || 0.5;
        const entropy = scores.ElevationEntropy || 0.5;
        
        // Create distribution based on windmill characteristics
        for (let i = 0; i < numBins; i++) {
            const pos = i / (numBins - 1);
            
            // Base windmill pattern - elevated center with gentle slopes
            let value = 0;
            
            if (compactness > 0.6) {
                // Compact structure - peaked distribution
                const center = 0.3 + volume * 0.4; // Higher volume shifts peak higher
                value = Math.exp(-Math.pow(pos - center, 2) / (2 * (1 - compactness) * 0.1));
            } else {
                // Spread structure - more uniform distribution
                value = 0.5 + 0.3 * Math.sin(pos * Math.PI * 2) * (1 - entropy);
            }
            
            // Add noise based on entropy
            value += Math.random() * entropy * 0.2;
            
            density[i] = Math.max(0, value);
        }
        
        // Normalize
        const sum = density.reduce((a, b) => a + b, 0);
        if (sum > 0) {
            for (let i = 0; i < numBins; i++) {
                density[i] = density[i] / sum;
            }
        }
        
        return density;
    }
    
    /**
     * Destroy visualization components
     */
    destroy() {
        this.charts.forEach(chart => {
            if (chart && typeof chart.destroy === 'function') {
                chart.destroy();
            }
        });
        this.charts.clear();
        this.currentPatch = null;
    }


}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PatchVisualization;
} else {
    window.PatchVisualization = PatchVisualization;
}

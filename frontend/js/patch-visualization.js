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
            console.log('✅ Setting up patchClick event listener on map element');
            mapElement.addEventListener('patchClick', (e) => {
                console.log('🎯 Patch click event received:', e.detail.patch.patch_id);
                console.log('🎯 Event detail:', e.detail);
                console.log('🎯 Patch object:', e.detail.patch);
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
        console.log('🎯 showPatchDetails called - DISABLING MODAL, using popup only');
        this.currentPatch = patch;
        
        // DO NOT show the modal - we want popup only
        // const gridContainer = document.getElementById('patchGrid');
        // if (gridContainer) {
        //     gridContainer.style.display = 'flex';
        // }
        
        // Instead, let the popup handle everything
        console.log('✅ Patch details handled by popup system');
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
            return { min: 0, max: 0, mean: 0, std: 0 };
        }

        const min = Math.min(...flatData);
        const max = Math.max(...flatData);
        const mean = flatData.reduce((a, b) => a + b, 0) / flatData.length;
        const variance = flatData.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / flatData.length;
        const std = Math.sqrt(variance);

        return { min, max, mean, std };
    }

    /**
     * Get color for elevation value (normalized 0-1)
     */
    getElevationColor(normalized) {
        // Use a terrain-like color scale
        const colors = [
            { pos: 0.0, color: [0, 100, 200] },     // Deep blue (low)
            { pos: 0.2, color: [0, 150, 255] },     // Light blue
            { pos: 0.4, color: [100, 200, 100] },   // Green
            { pos: 0.6, color: [255, 255, 100] },   // Yellow
            { pos: 0.8, color: [255, 150, 50] },    // Orange
            { pos: 1.0, color: [200, 50, 50] }      // Red (high)
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
            console.log('Available elements:', document.querySelectorAll('[id*="chart"], [id*="Chart"], [id*="histogram"], [id*="Histogram"]'));
            return;
        }
        
        console.log('✅ Chart container found, creating professional layout...');

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
        
        console.log('✅ Chart.js library loaded successfully');

        if (!patch.elevation_data || !Array.isArray(patch.elevation_data)) {
            console.error('❌ No elevation data available for patch:', patch.patch_id);
            chartContainer.innerHTML = `
                <div style="text-align: center; color: #aaa; padding: 20px;">
                    <p>📊 No elevation data available</p>
                </div>
            `;
            return;
        }
        
        console.log('✅ Elevation data found, creating professional visualization...');

        // Calculate histogram data with real detection scores
        const histogramData = await this.calculateHistogramData(patch);
        const score = histogramData.score;

        // === TOP: Elevation Heatmap (like your analyzer) ===
        const heatmapSection = document.createElement('div');
        heatmapSection.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            margin-bottom: 10px;
        `;

        // Patch title with score
        const heatmapTitle = document.createElement('div');
        heatmapTitle.innerHTML = `
            <h5 style="color: #fff; margin: 0 0 8px 0; text-align: center; font-size: 12px;">
                ${patch.metadata?.name || patch.patch_id}
                <br><span style="color: ${this.getScoreColor(score)}; font-size: 10px;">Score: ${score.toFixed(4)}</span>
            </h5>
        `;
        heatmapSection.appendChild(heatmapTitle);

        // Elevation heatmap canvas
        const heatmapCanvas = document.createElement('canvas');
        heatmapCanvas.width = 120;
        heatmapCanvas.height = 120;
        heatmapCanvas.style.cssText = `
            border: 1px solid #444;
            border-radius: 4px;
            image-rendering: pixelated;
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
            console.log('⚠️ Creating new canvas element');
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
        const ctx = canvas.getContext('2d');
        const rows = elevationData.length;
        const cols = elevationData[0]?.length || 0;
        
        if (rows === 0 || cols === 0) return;

        // Calculate statistics
        const flatData = elevationData.flat().filter(v => v !== null && v !== undefined && !isNaN(v));
        const min = Math.min(...flatData);
        const max = Math.max(...flatData);
        const range = max - min;

        // Sample data to fit canvas
        const maxSize = 25;
        const rowStep = Math.max(1, Math.floor(rows / maxSize));
        const colStep = Math.max(1, Math.floor(cols / maxSize));
        const displayRows = Math.min(maxSize, rows);
        const displayCols = Math.min(maxSize, cols);

        const cellWidth = canvas.width / displayCols;
        const cellHeight = canvas.height / displayRows;

        // Draw heatmap
        for (let i = 0; i < displayRows; i++) {
            for (let j = 0; j < displayCols; j++) {
                const rowIdx = Math.min(i * rowStep, rows - 1);
                const colIdx = Math.min(j * colStep, cols - 1);
                const value = elevationData[rowIdx][colIdx];
                
                if (value === null || value === undefined || isNaN(value)) continue;

                const normalized = range > 0 ? (value - min) / range : 0;
                const color = this.getElevationColor(normalized);
                
                ctx.fillStyle = color;
                ctx.fillRect(j * cellWidth, i * cellHeight, cellWidth, cellHeight);
            }
        }
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
     * Get elevation histogram score for a patch
     */
    async getElevationHistogramScore(patch) {
        try {
            // Try to get real score from detection result
            if (patch.detection_result?.elevation_histogram_score !== undefined) {
                return patch.detection_result.elevation_histogram_score;
            }
            
            // Calculate histogram and get score
            const histogramData = await this.calculateHistogramData(patch);
            return histogramData.score;
            
        } catch (error) {
            console.warn('⚠️ Could not get elevation histogram score:', error);
            return 0.1; // Default low score
        }
    }

    /**
     * Get score color like the analyzer
     */
    getScoreColor(score) {
        if (score >= 0.7) return '#00ff88'; // Green
        if (score >= 0.4) return '#ffaa00'; // Yellow/Orange
        return '#ff4444'; // Red
    }

    /**
     * Calculate histogram data for professional display
     */
    async calculateHistogramData(patch) {
        console.log('🎯 calculateHistogramData called for patch:', patch.patch_id);
        // Flatten elevation data and filter out invalid values
        const elevationValues = patch.elevation_data
            .flat()
            .filter(v => v !== null && v !== undefined && !isNaN(v));

        if (elevationValues.length === 0) {
            return { localDensity: [], kernelDensity: [], score: 0.1 };
        }

        // Calculate statistics
        const stats = patch.elevation_stats || this.calculateElevationStats(patch.elevation_data);
        const elevationRange = stats.max - stats.min;
        
        // Apply same normalization as phi0_core histogram scoring
        let normalizedElevation = [];
        if (elevationRange >= 0.5) {
            const relativeElevation = elevationValues.map(v => v - stats.min);
            const maxRelative = Math.max(...relativeElevation);
            if (maxRelative >= 0.1) {
                normalizedElevation = relativeElevation.map(v => v / maxRelative);
            }
        }
        
        if (normalizedElevation.length === 0) {
            return { localDensity: [], kernelDensity: [], score: 0.1 };
        }

        // Create histogram with 16 bins (same as histogram analyzer)
        const numBins = 16;
        const binWidth = 1.0 / numBins;
        
        // Create bins for local patch
        const localBins = Array(numBins).fill(0);
        
        // Fill local histogram bins
        normalizedElevation.forEach(value => {
            const binIndex = Math.min(Math.floor(value / binWidth), numBins - 1);
            if (binIndex >= 0) {
                localBins[binIndex]++;
            }
        });

        // Normalize to probability distribution (same as histogram analyzer)
        const totalCount = normalizedElevation.length;
        const localDensity = localBins.map(count => count / (totalCount + 1e-8));

        // Get kernel data and similarity score
        const kernelResult = await this.getRealKernelData(localDensity, patch);
        
        return {
            localDensity: localDensity,
            kernelDensity: kernelResult.kernelDensity,
            score: kernelResult.score,
            binLabels: localBins.map((_, i) => {
                const binStart = i * binWidth;
                const binEnd = (i + 1) * binWidth;
                return `${(binStart * 100).toFixed(0)}-${(binEnd * 100).toFixed(0)}%`;
            })
        };
    }

    /**
     * Draw professional histogram comparison like the analyzer
     */
    async drawProfessionalHistogram(canvas, histogramData, score) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const { localDensity, kernelDensity, binLabels } = histogramData;
        
        if (!localDensity.length || !kernelDensity.length) {
            // Draw "No data" message
            ctx.fillStyle = '#666';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No histogram data', canvas.width / 2, canvas.height / 2);
            return;
        }

        // Chart dimensions
        const padding = { top: 15, bottom: 40, left: 40, right: 20 };
        const chartWidth = canvas.width - padding.left - padding.right;
        const chartHeight = canvas.height - padding.top - padding.bottom;
        
        // Find max value for scaling
        const maxValue = Math.max(...localDensity, ...kernelDensity);
        const barWidth = chartWidth / (localDensity.length * 2); // Two bars per bin
        
        // Draw bars
        for (let i = 0; i < localDensity.length; i++) {
            const x = padding.left + (i * 2 * barWidth);
            
            // Local patch bar (blue)
            const localHeight = (localDensity[i] / maxValue) * chartHeight;
            ctx.fillStyle = 'rgba(54, 162, 235, 0.7)';
            ctx.fillRect(x, padding.top + chartHeight - localHeight, barWidth, localHeight);
            
            // Kernel bar (orange)
            const kernelHeight = (kernelDensity[i] / maxValue) * chartHeight;
            ctx.fillStyle = 'rgba(255, 159, 64, 0.7)';
            ctx.fillRect(x + barWidth, padding.top + chartHeight - kernelHeight, barWidth, kernelHeight);
        }
        
        // Draw axes
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // Y-axis
        ctx.moveTo(padding.left, padding.top);
        ctx.lineTo(padding.left, padding.top + chartHeight);
        // X-axis
        ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
        ctx.stroke();
        
        // Draw legend
        ctx.font = '10px Arial';
        ctx.textAlign = 'left';
        
        // Local patch legend
        ctx.fillStyle = 'rgba(54, 162, 235, 0.7)';
        ctx.fillRect(10, 5, 12, 8);
        ctx.fillStyle = '#ccc';
        ctx.fillText('Local', 25, 12);
        
        // Kernel legend
        ctx.fillStyle = 'rgba(255, 159, 64, 0.7)';
        ctx.fillRect(65, 5, 12, 8);
        ctx.fillStyle = '#ccc';
        ctx.fillText('Kernel', 80, 12);
        
        // Y-axis labels
        ctx.fillStyle = '#ccc';
        ctx.font = '8px Arial';
        ctx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + chartHeight - (i / 4) * chartHeight;
            const value = (maxValue * i / 4).toFixed(3);
            ctx.fillText(value, padding.left - 5, y + 3);
        }
        
        // X-axis labels (show every 4th bin to avoid crowding)
        ctx.textAlign = 'center';
        for (let i = 0; i < binLabels.length; i += 4) {
            const x = padding.left + (i * 2 * barWidth) + barWidth;
            ctx.fillText(binLabels[i].split('-')[0] + '%', x, canvas.height - 5);
        }
    }
    async getRealKernelData(localDensity, patch) {
        try {
            // Method 1: Use detection scores from patch if available
            if (patch.detection_result && patch.detection_result.elevation_histogram_score !== undefined) {
                const score = patch.detection_result.elevation_histogram_score;
                
                // Try to get kernel histogram from patch metadata
                if (patch.detection_result.kernel_histogram) {
                    return {
                        kernelDensity: patch.detection_result.kernel_histogram,
                        score: score
                    };
                }
                
                // Generate approximate kernel density based on windmill pattern
                const kernelDensity = this.generateWindmillKernelPattern(localDensity.length);
                return { kernelDensity, score };
            }
            
            // Method 2: Try to get kernel data from API
            try {
                if (window.discoveryAPI) {
                    const kernelData = await this.fetchKernelFromAPI();
                    if (kernelData && kernelData.elevation_histogram) {
                        const score = this.calculateHistogramSimilarity(localDensity, kernelData.elevation_histogram);
                        return {
                            kernelDensity: kernelData.elevation_histogram,
                            score: score
                        };
                    }
                }
            } catch (apiError) {
                // Silently continue to fallback
            }
            
            // Method 3: Calculate similarity using windmill pattern and estimate score
            const kernelDensity = this.generateWindmillKernelPattern(localDensity.length);
            const score = this.calculateWindmillPatternScore(localDensity, patch);
            
            return { kernelDensity, score };
            
        } catch (error) {
            console.error('❌ Error getting kernel data:', error);
            // Fallback: flat distribution with low score
            const kernelDensity = Array(localDensity.length).fill(1.0 / localDensity.length);
            return { kernelDensity, score: 0.1 };
        }
    }

    /**
     * Fetch kernel data from API
     */
    async fetchKernelFromAPI() {
        try {
            const response = await fetch('/api/v1/discovery/kernels?structure_type=windmill');
            if (!response.ok) {
                throw new Error(`API response: ${response.status}`);
            }
            const data = await response.json();
            
            // Look for active windmill kernel
            if (data.kernels && data.kernels.length > 0) {
                const windmillKernel = data.kernels.find(k => k.structure_type === 'windmill');
                return windmillKernel;
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Generate realistic windmill elevation histogram pattern
     */
    generateWindmillKernelPattern(numBins) {
        // Windmills typically show:
        // - High values in center (mound)
        // - Gradual decrease towards edges
        // - Some noise but generally smooth distribution
        
        const kernelDensity = Array(numBins).fill(0);
        
        // Create mound-like distribution typical of windmill sites
        for (let i = 0; i < numBins; i++) {
            const normalized = i / (numBins - 1); // 0 to 1
            
            // Windmill pattern: higher density in middle-high elevation bins
            // Peak around 60-80% elevation, tapering off
            let density;
            if (normalized < 0.3) {
                // Low elevation - minimal density
                density = 0.02 + 0.01 * normalized;
            } else if (normalized < 0.6) {
                // Rising to peak
                density = 0.03 + 0.12 * (normalized - 0.3) / 0.3;
            } else if (normalized < 0.8) {
                // Peak region - highest density
                density = 0.15 + 0.05 * Math.sin(Math.PI * (normalized - 0.6) / 0.2);
            } else {
                // High elevation - decreasing
                density = 0.08 * (1.0 - normalized) / 0.2;
            }
            
            kernelDensity[i] = Math.max(0.01, density); // Ensure minimum density
        }
        
        // Normalize to probability distribution
        const total = kernelDensity.reduce((a, b) => a + b, 0);
        return kernelDensity.map(d => d / total);
    }

    /**
     * Calculate similarity score using cosine similarity
     */
    calculateHistogramSimilarity(localDensity, kernelDensity) {
        if (!localDensity || !kernelDensity || localDensity.length !== kernelDensity.length) {
            return 0.0;
        }
        
        // Cosine similarity (same as phi0_core)
        const localNorm = Math.sqrt(localDensity.reduce((sum, val) => sum + val * val, 0));
        const kernelNorm = Math.sqrt(kernelDensity.reduce((sum, val) => sum + val * val, 0));
        
        if (localNorm < 1e-8 || kernelNorm < 1e-8) {
            return 0.0;
        }
        
        const dotProduct = localDensity.reduce((sum, val, i) => sum + val * kernelDensity[i], 0);
        const similarity = dotProduct / (localNorm * kernelNorm);
        
        return Math.max(0.0, Math.min(1.0, similarity));
    }

    /**
     * Calculate windmill pattern score based on elevation characteristics
     */
    calculateWindmillPatternScore(localDensity, patch) {
        // Use available detection scores if present
        if (patch.detection_result) {
            if (patch.detection_result.elevation_histogram_score !== undefined) {
                return patch.detection_result.elevation_histogram_score;
            }
            if (patch.detection_result.phi0 !== undefined) {
                // Use phi0 score as approximation
                return patch.detection_result.phi0;
            }
        }
        
        // Fall back to confidence score
        if (patch.confidence !== undefined) {
            return patch.confidence;
        }
        
        // Estimate based on elevation pattern characteristics
        const stats = patch.elevation_stats || this.calculateElevationStats(patch.elevation_data);
        const elevationRange = stats.max - stats.min;
        
        // Windmills typically have good elevation variation (1-10m range)
        let rangeScore = 0;
        if (elevationRange >= 2.0 && elevationRange <= 10.0) {
            rangeScore = 0.8;
        } else if (elevationRange >= 1.0 && elevationRange <= 15.0) {
            rangeScore = 0.6;
        } else if (elevationRange >= 0.5) {
            rangeScore = 0.3;
        }
        
        // Check for mound-like pattern in histogram
        const peakBin = localDensity.indexOf(Math.max(...localDensity));
        const isMiddlePeak = peakBin > localDensity.length * 0.3 && peakBin < localDensity.length * 0.8;
        const patternScore = isMiddlePeak ? 0.3 : 0.1;
        
        return Math.min(1.0, rangeScore + patternScore);
    }

    /**
     * Add statistics overlay to chart container
     */
    addStatisticsOverlay(container, stats, count) {
        const existingOverlay = container.querySelector('.stats-overlay');
        if (existingOverlay) {
            existingOverlay.remove();
        }

        const overlay = document.createElement('div');
        overlay.className = 'stats-overlay';
        overlay.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            border: 1px solid #00ff88;
            border-radius: 4px;
            padding: 8px;
            font-size: 11px;
            color: #ccc;
            pointer-events: none;
        `;
        
        overlay.innerHTML = `
            <div><strong>Statistics:</strong></div>
            <div>Count: ${count}</div>
            <div>Min: ${stats.min.toFixed(2)}m</div>
            <div>Max: ${stats.max.toFixed(2)}m</div>
            <div>Mean: ${stats.mean.toFixed(2)}m</div>
            <div>Std: ${stats.std.toFixed(2)}m</div>
        `;

        container.appendChild(overlay);
    }

    /**
     * Display detection analysis information
     */
    displayDetectionAnalysis(patch) {
        const analysisContainer = document.getElementById('detectionAnalysis');
        if (!analysisContainer) return;

        const detection = patch.detection_result || {};
        const stats = patch.elevation_stats || {};
        const isCompact = analysisContainer.classList.contains('compact');

        if (isCompact) {
            // Compact analysis - show only key metrics
            const analysisHTML = `
                <div class="analysis-section">
                    <h4>Detection Metrics</h4>
                    <div class="analysis-grid">
                        <div class="metric">
                            <label>φ⁰ Score:</label>
                            <span class="value ${this.getScoreClass(detection.phi0)}">${detection.phi0?.toFixed(3) || '--'}</span>
                        </div>
                        <div class="metric">
                            <label>ψ⁰ Score:</label>
                            <span class="value ${this.getScoreClass(detection.psi0)}">${detection.psi0?.toFixed(3) || '--'}</span>
                        </div>
                        <div class="metric">
                            <label>Confidence:</label>
                            <span class="value ${this.getConfidenceClass(patch.confidence)}">${(patch.confidence * 100).toFixed(1)}%</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Full analysis - original detailed version
            const analysisHTML = `
                <div class="analysis-section">
                    <h4>Detection Analysis</h4>
                    <div class="analysis-grid">
                        <div class="metric">
                            <label>φ⁰ Resonance:</label>
                            <span class="value ${this.getScoreClass(detection.phi0)}">${detection.phi0?.toFixed(3) || '--'}</span>
                        </div>
                        <div class="metric">
                            <label>ψ⁰ Attractors:</label>
                            <span class="value ${this.getScoreClass(detection.psi0)}">${detection.psi0?.toFixed(3) || '--'}</span>
                        </div>
                        <div class="metric">
                            <label>Confidence:</label>
                            <span class="value ${this.getConfidenceClass(patch.confidence)}">${(patch.confidence * 100).toFixed(1)}%</span>
                        </div>
                        <div class="metric">
                            <label>Structure Type:</label>
                            <span class="value">${detection.structure_type || 'Unknown'}</span>
                        </div>
                    </div>
                    
                    <h5>Elevation Statistics</h5>
                    <div class="stats-grid">
                        <div class="stat">
                            <label>Range:</label>
                            <span>${stats.min?.toFixed(2) || '--'}m - ${stats.max?.toFixed(2) || '--'}m</span>
                        </div>
                        <div class="stat">
                            <label>Mean:</label>
                            <span>${stats.mean?.toFixed(2) || '--'}m</span>
                        </div>
                        <div class="stat">
                            <label>Std Dev:</label>
                            <span>${stats.std?.toFixed(2) || '--'}m</span>
                        </div>
                    </div>

                    <h5>Processing Info</h5>
                    <div class="info-grid">
                        <div class="info">
                            <label>Timestamp:</label>
                            <span>${new Date(patch.timestamp).toLocaleString()}</span>
                        </div>
                        <div class="info">
                            <label>Patch ID:</label>
                            <span>${patch.patch_id}</span>
                        </div>
                        <div class="info">
                            <label>Session ID:</label>
                            <span>${patch.session_id}</span>
                        </div>
                    </div>
                </div>
            `;
        }

        analysisContainer.innerHTML = analysisHTML;
    }

    /**
     * Get CSS class for score values
     */
    getScoreClass(score) {
        if (!score) return 'score-unknown';
        if (score >= 0.7) return 'score-high';
        if (score >= 0.4) return 'score-medium';
        return 'score-low';
    }

    /**
     * Get CSS class for confidence values
     */
    getConfidenceClass(confidence) {
        if (!confidence) return 'confidence-unknown';
        if (confidence >= 0.8) return 'confidence-high';
        if (confidence >= 0.6) return 'confidence-medium';
        if (confidence >= 0.4) return 'confidence-low';
        return 'confidence-very-low';
    }

    /**
     * Update patch information panel
     */
    updatePatchInfoPanel(patch) {
        const infoPanel = document.getElementById('patchInfoPanel');
        if (!infoPanel) return;

        const isCompact = infoPanel.classList.contains('compact');
        
        if (isCompact) {
            // Compact layout - more condensed information
            const panelHTML = `
                <div class="patch-info-compact">
                    <div class="info-row">
                        <strong>Patch ${patch.patch_id}</strong>
                        <span class="status-badge ${patch.is_positive ? 'positive' : 'negative'}">
                            ${patch.is_positive ? '✓ DETECTION' : '✗ NO DETECTION'}
                        </span>
                    </div>
                    <div class="info-row">
                        <span>📍 ${patch.lat.toFixed(4)}, ${patch.lon.toFixed(4)}</span>
                        <span>🎯 ${((patch.confidence || 0) * 100).toFixed(1)}% confidence</span>
                    </div>
                    <div class="info-row">
                        <span>φ⁰: ${patch.detection_result?.phi0?.toFixed(3) || '--'}</span>
                        <span>ψ⁰: ${patch.detection_result?.psi0?.toFixed(3) || '--'}</span>
                    </div>
                </div>
            `;
        } else {
            // Full layout - original detailed information
            const panelHTML = `
                <div class="patch-info-header">
                    <h3>Patch ${patch.patch_id}</h3>
                    <div class="status-badge ${patch.is_positive ? 'positive' : 'negative'}">
                        ${patch.is_positive ? 'DETECTION' : 'NO DETECTION'}
                    </div>
                </div>
                <div class="patch-coordinates">
                    <span>📍 ${patch.lat.toFixed(6)}, ${patch.lon.toFixed(6)}</span>
                </div>
                <div class="patch-actions">
                    <button onclick="window.patchViz.exportPatchData('${patch.patch_id}')" class="btn-small">
                        📊 Export Data
                    </button>
                    <button onclick="window.patchViz.viewIn3D('${patch.patch_id}')" class="btn-small">
                        🎯 View in 3D
                    </button>
                    <button onclick="window.patchViz.compareWithSimilar('${patch.patch_id}')" class="btn-small">
                        🔍 Compare
                    </button>
                </div>
            `;
        }

        infoPanel.innerHTML = panelHTML;
    }

    /**
     * Show details for a specific elevation cell
     */
    showCellDetails(value, row, col) {
        const modal = document.createElement('div');
        modal.className = 'cell-details-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h4>Cell Details</h4>
                <div class="cell-info">
                    <div class="info-row">
                        <span>Position:</span>
                        <span>[${row}, ${col}]</span>
                    </div>
                    <div class="info-row">
                        <span>Elevation:</span>
                        <span>${value.toFixed(3)}m</span>
                    </div>
                    <div class="info-row">
                        <span>Patch:</span>
                        <span>${this.currentPatch?.patch_id || 'Unknown'}</span>
                    </div>
                </div>
                <button onclick="this.parentElement.parentElement.remove()" class="btn-small">Close</button>
            </div>
        `;

        document.body.appendChild(modal);

        // Auto-close after 3 seconds
        setTimeout(() => {
            if (modal.parentElement) {
                modal.remove();
            }
        }, 3000);
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

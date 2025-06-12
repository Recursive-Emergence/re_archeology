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

        // Test visualization with mock data (for debugging)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'T' && e.ctrlKey && e.shiftKey) {
                console.log('🧪 Testing patch visualization with mock data');
                this.testVisualization();
            }
        });

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
        console.log('🔍 PatchVisualization.showPatchDetails called with patch:', patch.patch_id);
        console.log('🔍 Patch elevation_data present:', !!patch.elevation_data);
        console.log('🔍 Patch elevation_data type:', typeof patch.elevation_data);
        console.log('🔍 Patch elevation_data sample:', patch.elevation_data ? patch.elevation_data.slice(0, 3) : 'none');
        
        this.currentPatch = patch;
        
        // Show the modal first
        const gridContainer = document.getElementById('patchGrid');
        if (gridContainer) {
            console.log('✅ Modal container found');
            console.log('🔍 Current display style:', gridContainer.style.display);
            console.log('🔍 Computed display style:', window.getComputedStyle(gridContainer).display);
            
            // Force show the modal
            gridContainer.style.display = 'flex';
            gridContainer.style.visibility = 'visible';
            gridContainer.style.opacity = '1';
            
            console.log('✅ Modal display set to flex');
            
            // Add a temporary background for debugging
            gridContainer.style.background = 'rgba(255, 0, 0, 0.8)';
            setTimeout(() => {
                gridContainer.style.background = 'rgba(0, 0, 0, 0.8)';
            }, 1000);
            
        } else {
            console.error('❌ Modal container not found!');
            return;
        }
        
        // Show elevation grid
        this.displayElevationGrid(patch);
        
        // Show 3D elevation chart if possible
        this.displayElevationChart(patch);
        
        // Show detection analysis
        this.displayDetectionAnalysis(patch);
        
        // Update patch info panel
        this.updatePatchInfoPanel(patch);
    }

    /**
     * Display elevation data as a colored grid with enhanced visualization
     */
    displayElevationGrid(patch) {
        console.log('🔍 displayElevationGrid called for patch:', patch.patch_id);
        
        const gridContainer = document.getElementById('patchGrid');
        const elevationGrid = document.getElementById('elevationGrid');
        
        console.log('🔍 Grid container found:', !!gridContainer);
        console.log('🔍 Elevation grid found:', !!elevationGrid);
        
        if (!gridContainer || !elevationGrid) {
            console.error('❌ Missing grid containers!');
            return;
        }

        elevationGrid.innerHTML = '';

        if (!patch.elevation_data || !Array.isArray(patch.elevation_data)) {
            console.warn('⚠️ No elevation data or not array for patch:', patch.patch_id);
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

        console.log('🔍 Elevation data dimensions:', rows, 'x', cols);

        if (rows === 0 || cols === 0) {
            console.warn('⚠️ Empty elevation data dimensions');
            elevationGrid.innerHTML = `
                <div style="text-align: center; color: #aaa; padding: 40px; grid-column: 1 / -1;">
                    <p>📊 Empty elevation data</p>
                    <p>Data dimensions: ${rows} x ${cols}</p>
                </div>
            `;
            return;
        }

        // Limit grid size for performance but show more detail than before
        const maxGridSize = 25;
        const displayRows = Math.min(rows, maxGridSize);
        const displayCols = Math.min(cols, maxGridSize);

        elevationGrid.style.gridTemplateColumns = `repeat(${displayCols}, 1fr)`;

        const stats = patch.elevation_stats || this.calculateElevationStats(data);
        const min = stats.min;
        const max = stats.max;
        const range = max - min;

        // Add grid header with patch info and detection status
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
     * Display elevation chart (histogram) using Chart.js
     */
    displayElevationChart(patch) {
        console.log('📊 displayElevationChart called for patch:', patch.patch_id);
        
        const chartContainer = document.getElementById('elevationChart');
        let canvas = document.getElementById('elevationHistogramCanvas');
        
        console.log('📊 Chart container found:', !!chartContainer);
        console.log('📊 Canvas found:', !!canvas);
        console.log('📊 Chart.js available:', typeof Chart !== 'undefined');
        
        if (!chartContainer) {
            console.error('❌ Missing chart container!');
            return;
        }

        // Recreate canvas if it doesn't exist or has issues
        if (!canvas) {
            console.log('📊 Creating new canvas element');
            canvas = document.createElement('canvas');
            canvas.id = 'elevationHistogramCanvas';
            chartContainer.innerHTML = '';
            chartContainer.appendChild(canvas);
        }

        // Set canvas dimensions explicitly
        const containerRect = chartContainer.getBoundingClientRect();
        canvas.width = Math.max(400, containerRect.width - 40);
        canvas.height = Math.max(250, containerRect.height - 40);
        canvas.style.width = `${canvas.width}px`;
        canvas.style.height = `${canvas.height}px`;

        // Check if Chart.js is available
        if (typeof Chart === 'undefined') {
            console.warn('⚠️ Chart.js not available');
            chartContainer.innerHTML = `
                <div style="text-align: center; color: #aaa; padding: 40px;">
                    <p>📊 Chart.js library not loaded</p>
                    <p>Histogram visualization unavailable</p>
                </div>
            `;
            return;
        }

        if (!patch.elevation_data || !Array.isArray(patch.elevation_data)) {
            console.warn('⚠️ No elevation data for histogram');
            chartContainer.innerHTML = `
                <div style="text-align: center; color: #aaa; padding: 40px;">
                    <p>📊 No elevation data available</p>
                    <p>Cannot generate histogram</p>
                </div>
            `;
            return;
        }

        // Flatten elevation data and filter out invalid values
        const elevationValues = patch.elevation_data
            .flat()
            .filter(v => v !== null && v !== undefined && !isNaN(v));

        if (elevationValues.length === 0) {
            chartContainer.innerHTML = `
                <div style="text-align: center; color: #aaa; padding: 40px;">
                    <p>📊 No valid elevation data</p>
                    <p>Cannot generate histogram</p>
                </div>
            `;
            return;
        }

        // Calculate histogram bins
        const stats = patch.elevation_stats || this.calculateElevationStats(patch.elevation_data);
        const numBins = Math.min(20, Math.max(5, Math.ceil(Math.sqrt(elevationValues.length))));
        const binWidth = (stats.max - stats.min) / numBins;
        
        // Create bins
        const bins = Array(numBins).fill(0);
        const binLabels = [];
        
        for (let i = 0; i < numBins; i++) {
            const binStart = stats.min + i * binWidth;
            const binEnd = stats.min + (i + 1) * binWidth;
            binLabels.push(`${binStart.toFixed(1)}-${binEnd.toFixed(1)}m`);
        }

        // Fill bins
        elevationValues.forEach(value => {
            const binIndex = Math.min(Math.floor((value - stats.min) / binWidth), numBins - 1);
            if (binIndex >= 0) {
                bins[binIndex]++;
            }
        });

        // Destroy existing chart if it exists
        if (this.charts.has('elevation-histogram')) {
            console.log('📊 Destroying existing chart');
            this.charts.get('elevation-histogram').destroy();
            this.charts.delete('elevation-histogram');
        }

        // Clear canvas context
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        console.log('📊 Creating Chart.js histogram with dimensions:', canvas.width, 'x', canvas.height);
        console.log('📊 Histogram data - bins:', bins.length, 'values:', elevationValues.length);

        // Create new chart with explicit sizing
        const chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: binLabels,
                datasets: [{
                    label: 'Frequency',
                    data: bins,
                    backgroundColor: 'rgba(0, 255, 136, 0.6)',
                    borderColor: '#00ff88',
                    borderWidth: 1,
                    borderRadius: 2
                }]
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                animation: {
                    duration: 800,
                    easing: 'easeInOutQuart'
                },
                plugins: {
                    title: {
                        display: true,
                        text: `Elevation Distribution - Patch ${patch.patch_id}`,
                        color: '#00ff88',
                        font: {
                            size: 14,
                            weight: 'bold'
                        }
                    },
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#00ff88',
                        bodyColor: '#fff',
                        borderColor: '#00ff88',
                        borderWidth: 1,
                        callbacks: {
                            title: function(context) {
                                return `Elevation Range: ${context[0].label}`;
                            },
                            label: function(context) {
                                const percentage = ((context.raw / elevationValues.length) * 100).toFixed(1);
                                return `Count: ${context.raw} (${percentage}%)`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Elevation Range (meters)',
                            color: '#ccc'
                        },
                        ticks: {
                            color: '#ccc',
                            maxRotation: 45
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Frequency',
                            color: '#ccc'
                        },
                        ticks: {
                            color: '#ccc',
                            precision: 0,
                            maxTicksLimit: 10
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            }
        });

        // Store chart reference for cleanup
        this.charts.set('elevation-histogram', chart);

        console.log('📊 Chart created successfully!', chart);

        // Force chart update and render
        setTimeout(() => {
            chart.update();
            chart.render();
            console.log('📊 Chart updated and rendered');
        }, 100);

        // Add statistics overlay
        this.addStatisticsOverlay(chartContainer, stats, elevationValues.length);
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

    /**
     * Test visualization with mock elevation data
     */
    testVisualization() {
        // Create mock patch with elevation data
        const mockPatch = {
            patch_id: 'test-patch-001',
            lat: 52.4751,
            lon: 4.8156,
            is_positive: true,
            confidence: 0.85,
            patch_size_m: 40,
            detection_result: {
                phi0: 0.72,
                psi0: 0.68
            },
            elevation_data: this.generateMockElevationData(32, 32),
            elevation_stats: {
                min: 2.1,
                max: 8.7,
                mean: 4.2,
                std: 1.3
            }
        };

        console.log('🧪 Mock patch created:', mockPatch);
        this.showPatchDetails(mockPatch);
    }

    /**
     * Generate mock elevation data for testing
     */
    generateMockElevationData(rows, cols) {
        const data = [];
        for (let i = 0; i < rows; i++) {
            const row = [];
            for (let j = 0; j < cols; j++) {
                // Generate realistic elevation values with some pattern
                const centerX = cols / 2;
                const centerY = rows / 2;
                const distFromCenter = Math.sqrt((i - centerY) ** 2 + (j - centerX) ** 2);
                const baseElevation = 4.0;
                const variation = Math.sin(distFromCenter * 0.3) * 2.0 + Math.random() * 0.5;
                row.push(baseElevation + variation);
            }
            data.push(row);
        }
        return data;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PatchVisualization;
} else {
    window.PatchVisualization = PatchVisualization;
}

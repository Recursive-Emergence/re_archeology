/**
 * Map Visualization Components
 * Handles all map-related visualization for the windmill discovery system
 */

class MapVisualization {
    constructor(mapInstance, options = {}) {
        // Accept existing map instance instead of creating a new one
        if (mapInstance && typeof mapInstance.getContainer === 'function') {
            this.map = mapInstance;
            this.mapElement = mapInstance.getContainer();
            console.log('✅ MapVisualization initialized with existing map instance');
        } else {
            throw new Error('MapVisualization requires a valid Leaflet map instance');
        }
        
        this.layers = new Map();
        this.patches = new Map();
        this.controlsAdded = false;
        this.basicMapReady = true; // Map is already ready since it's passed in
        this.options = {
            center: [52.4751, 4.8156],
            zoom: 13,
            minZoom: 8,
            maxZoom: 18,
            ...options
        };
        
        // Setup event handlers on the existing map
        try {
            this.setupEventHandlers();
        } catch (error) {
            console.error('❌ Failed to setup event handlers:', error);
            this.initError = error;
        }
    }

    /**
     * Initialize the Leaflet map with proper cleanup
     */
    initMap() {
        console.log('🗺️ Initializing map on element:', this.mapElement);
        
        // Wait for DOM to be fully loaded
        if (document.readyState !== 'complete' && document.readyState !== 'interactive') {
            console.log('⏳ DOM not ready, waiting...');
            document.addEventListener('DOMContentLoaded', () => {
                console.log('✅ DOM ready, retrying map init');
                this.initMap();
            });
            return;
        }
        
        // Handle both string ID and DOM element with enhanced validation
        let container;
        if (typeof this.mapElement === 'string') {
            container = document.getElementById(this.mapElement);
            console.log('🔍 Looking for container by ID:', this.mapElement);
        } else if (this.mapElement instanceof HTMLElement) {
            container = this.mapElement;
            console.log('🔍 Using provided HTML element');
        } else {
            throw new Error(`Invalid map element: ${this.mapElement}. Must be string ID or DOM element.`);
        }
        
        if (!container) {
            console.error('❌ Container not found in DOM:', {
                mapElement: this.mapElement,
                documentReady: document.readyState,
                bodyChildren: document.body ? Array.from(document.body.children).map(el => el.id || el.tagName) : 'no body'
            });
            throw new Error(`Map container element not found: ${this.mapElement}`);
        }

        // Verify container is actually in the DOM
        if (!container.parentElement && !document.body.contains(container)) {
            console.error('❌ Container exists but not in DOM tree:', {
                container: container,
                parentElement: container.parentElement,
                isInDocument: document.body.contains(container)
            });
            throw new Error('Map container is not attached to the DOM');
        }

        console.log('✅ Container found and validated:', {
            element: container,
            parentElement: container.parentElement,
            isInDocument: document.body.contains(container)
        });
        
        // Force container setup - skip all async operations
        console.log('🔧 Force-setting up container with guaranteed dimensions...');
        
        // Ensure container is visible and in the DOM
        if (!document.body.contains(container)) {
            console.error('❌ Container not in DOM, cannot proceed');
            throw new Error('Map container is not attached to the document');
        }
        
        // Force absolute positioning and dimensions
        container.style.cssText = `
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            z-index: 1 !important;
            display: block !important;
            visibility: visible !important;
        `;
        
        // Force layout recalculation multiple times
        container.offsetHeight;
        container.offsetWidth;
        document.body.offsetHeight; // Force full document reflow
        
        // Final dimension check
        console.log('🔍 Final container dimensions:', {
            offsetWidth: container.offsetWidth,
            offsetHeight: container.offsetHeight,
            parentElement: container.parentElement,
            isInDocument: document.body.contains(container),
            computedWidth: window.getComputedStyle(container).width,
            computedHeight: window.getComputedStyle(container).height
        });
        
        if (!container.offsetWidth || !container.offsetHeight) {
            console.error('❌ Container STILL has no dimensions after force styling');
            throw new Error('Cannot force container to have dimensions - CSS or DOM issue');
        }
        
        console.log('✅ Container successfully forced to have dimensions, proceeding directly');
        
        // Initialize map immediately without async operations
        try {
            this.initializeLeafletMap(container);
        } catch (error) {
            console.error('❌ Direct map initialization failed:', error);
            this.initError = error;
            throw error;
        }
    }
    
    /**
     * Initialize Leaflet map instance with proper error handling
     */
    initializeLeafletMap(container) {
        if (container._leaflet_id) {
            console.warn('🗺️ Map container already has Leaflet instance, cleaning up...');
            
            try {
                // Get existing map instance and properly remove it
                const existingMap = container._leaflet_map;
                if (existingMap) {
                    existingMap.remove();
                }
                
                // Clear the container's leaflet ID but preserve content
                delete container._leaflet_id;
                delete container._leaflet_map;
                // DO NOT clear innerHTML to preserve container structure
                
                // Remove any leaflet-specific classes
                container.className = container.className.replace(/leaflet-[^\s]*/g, '');
                
                console.log('✅ Existing map instance cleaned up');
            } catch (cleanupError) {
                console.warn('⚠️ Error during map cleanup:', cleanupError);
                // Force clear IDs but preserve container structure
                delete container._leaflet_id;
                delete container._leaflet_map;
            }
        }
        
        // Verify container is still valid and has dimensions - with retry logic
        if (!container.offsetWidth || !container.offsetHeight) {
            console.warn('⚠️ Container has no dimensions, applying emergency styles and retrying:', {
                offsetWidth: container.offsetWidth,
                offsetHeight: container.offsetHeight,
                offsetParent: container.offsetParent
            });
            
            // Emergency container styling
            container.style.display = 'block';
            container.style.position = 'relative';
            container.style.width = '100%';
            container.style.height = '100vh';
            container.style.minHeight = '400px';
            container.style.minWidth = '300px';
            
            // Force layout recalculation
            container.offsetHeight;
            
            // Final check
            if (!container.offsetWidth || !container.offsetHeight) {
                console.error('❌ Container still has no dimensions after emergency styling:', {
                    offsetWidth: container.offsetWidth,
                    offsetHeight: container.offsetHeight,
                    parentElement: container.parentElement,
                    computedStyle: window.getComputedStyle(container)
                });
                throw new Error('Map container must be visible and have dimensions');
            }
            
            console.log('✅ Emergency styling successful, proceeding with map creation');
        }
        
        try {
            // Create map using the container element (not the original this.mapElement)
            this.map = L.map(container, {
                center: this.options.center,
                zoom: this.options.zoom,
                minZoom: this.options.minZoom,
                maxZoom: this.options.maxZoom,
                zoomControl: true,
                attributionControl: true,
                // Explicitly enable dragging and other interactions
                dragging: true,
                touchZoom: true,
                doubleClickZoom: true,
                scrollWheelZoom: true,
                boxZoom: true,
                keyboard: true,
                // Add additional safety options
                preferCanvas: false,
                zoomSnap: 1,
                zoomDelta: 1,
                trackResize: true
            });

            console.log('✅ New map instance created successfully');

            // Ensure map control corners are initialized - force manual creation for reliability
            console.log('🔧 Force-initializing map control corners...');
            const mapContainer = this.map.getContainer();
            this.map._controlCorners = {};
            this.map._controlContainer = mapContainer;
            
            const corners = ['topleft', 'topright', 'bottomleft', 'bottomright'];
            const classNames = {
                topleft: 'leaflet-top leaflet-left',
                topright: 'leaflet-top leaflet-right', 
                bottomleft: 'leaflet-bottom leaflet-left',
                bottomright: 'leaflet-bottom leaflet-right'
            };
            
            corners.forEach(corner => {
                this.map._controlCorners[corner] = L.DomUtil.create('div', classNames[corner], mapContainer);
                console.log(`✅ Created control corner: ${corner}`, this.map._controlCorners[corner]);
            });
            
            console.log('✅ All control corners created:', this.map._controlCorners);
            
            // Verify they exist
            if (this.map._controlCorners.topright && this.map._controlCorners.bottomleft) {
                console.log('✅ Control corners verification passed');
            } else {
                console.error('❌ Control corners verification failed', this.map._controlCorners);
            }

            // Store reference to map in container for cleanup
            container._leaflet_map = this.map;

            // Wait for map to be ready before adding layers and controls
            this.map.whenReady(() => {
                // Wait much longer and perform comprehensive readiness checks
                setTimeout(() => {
                    this.initializeMapLayers();
                }, 5000); // Increased delay to 5 seconds for more reliable initialization
            });
            
        } catch (error) {
            console.error('❌ Failed to create map instance:', error);
            this.initError = error;
            return;
        }
    }
    
    /**
     * Initialize map layers with comprehensive validation
     */
    initializeMapLayers(retryCount = 0) {
        const maxRetries = 5; // Limit retries to prevent infinite loops
        
        try {
            // Comprehensive readiness check
            if (!this.isMapFullyReady()) {
                if (retryCount < maxRetries) {
                    console.warn(`⚠️ Map not fully ready, scheduling retry ${retryCount + 1}/${maxRetries}...`);
                    setTimeout(() => this.initializeMapLayers(retryCount + 1), 2000); // Increased delay
                } else {
                    console.error('❌ Map failed to initialize after maximum retries');
                    // Don't fail completely - set a flag that basic map is ready
                    this.basicMapReady = true;
                }
                return;
            }
            
            // Prevent duplicate control creation
            if (this.controlsAdded) {
                console.log('✅ Controls already added, skipping duplicate creation');
                return;
            }
            
            // Add custom controls  
            this.addCustomControls();
            
            // Initialize layer groups
            this.initLayerGroups();
            
            // Mark controls as added
            this.controlsAdded = true;
            this.basicMapReady = true;
            
            console.log('✅ Map layers and controls initialized');
        } catch (error) {
            console.error('❌ Failed to initialize map layers:', error);
            // Only retry if we haven't hit the limit
            if (retryCount < maxRetries) {
                setTimeout(() => this.initializeMapLayers(retryCount + 1), 2000);
            } else {
                console.error('❌ Max retries reached for map layer initialization');
                // Still mark as basically ready so app can function
                this.basicMapReady = true;
            }
        }
    }
    
    /**
     * Check if map is fully ready for layer operations
     */
    isMapFullyReady() {
        if (!this.map) {
            console.debug('Map readiness check: no map instance');
            return false;
        }
        
        const container = this.map.getContainer();
        if (!container) {
            console.debug('Map readiness check: no container');
            return false;
        }
        
        // Basic checks only - no coordinate system testing to avoid _leaflet_pos error
        try {
            // Wait for map to be fully rendered
            if (!this.map._loaded) {
                console.debug('Map readiness check: map not loaded yet');
                return false;
            }
            
            // Check if map has valid bounds without coordinate conversion
            try {
                const bounds = this.map.getBounds();
                if (!bounds) {
                    console.debug('Map readiness check: no bounds available');
                    return false;
                }
            } catch (e) {
                console.debug('Map readiness check: bounds error', e.message);
                return false;
            }
            
        } catch (e) {
            console.debug('Map readiness check: error', e.message);
            return false;
        }
        
        // Don't test coordinate conversion - it causes _leaflet_pos errors
        console.debug('✅ Map basic readiness confirmed');
        return true;
    }

    /**
     * Add custom map controls
     */
    addCustomControls() {
        try {
            // Use the comprehensive readiness check
            if (!this.isMapFullyReady()) {
                throw new Error('Map not ready for custom controls');
            }
            
            // Scale control with error handling
            try {
                L.control.scale({
                    position: 'bottomleft',
                    imperial: false
                }).addTo(this.map);
                console.log('✅ Scale control added successfully');
            } catch (scaleError) {
                console.error('❌ Failed to add scale control:', scaleError);
            }

            // Coordinates display with error handling
            try {
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
                console.log('✅ Coordinates control added successfully');
            } catch (coordsError) {
                console.error('❌ Failed to add coordinates control:', coordsError);
            }
        } catch (error) {
            console.error('❌ Failed to add custom controls:', error);
            // Retry after delay
            setTimeout(() => {
                try {
                    if (this.map && this.map.getContainer()) {
                        this.addCustomControls();
                        console.log('✅ Custom controls added on retry');
                    }
                } catch (retryError) {
                    console.error('❌ Custom controls retry failed:', retryError);
                }
            }, 1500);
        }

        // Update coordinates on mouse move (only if map exists)
        if (this.map) {
            this.map.on('mousemove', (e) => {
                const coordsDiv = document.querySelector('.coords-display');
                if (coordsDiv) {
                    coordsDiv.innerHTML = `Lat: ${e.latlng.lat.toFixed(6)}, Lon: ${e.latlng.lng.toFixed(6)}`;
                }
            });
        }
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
     * Check if there's an active selection on the map
     * This method provides compatibility with the main app's selection logic
     */
    hasActiveSelection() {
        // Check if there are any items in the scanArea layer group
        const scanAreaLayer = this.layers.get('scanArea');
        if (scanAreaLayer && scanAreaLayer.getLayers().length > 0) {
            return true;
        }
        
        // Check if there's a global selectedArea reference
        if (window.unifiedApp && window.unifiedApp.selectedArea) {
            return true;
        }
        
        // Also check window.app (alternative global reference)
        if (window.app && window.app.selectedArea) {
            return true;
        }
        
        return false;
    }

    /**
     * Set up map event handlers
     */
    setupEventHandlers() {
        if (!this.map) {
            console.warn('⚠️ Cannot setup event handlers: map is null');
            return;
        }
        
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
     * Add a patch to the map with real elevation data visualization
     */
    addPatch(patch) {
        const patchLayer = this.layers.get('patches');
        
        // Calculate patch bounds
        const bounds = this.calculatePatchBounds(patch);
        
        // Determine border color based on detection results
        const borderColor = this.getPatchColor(patch);
        
        // Create the main rectangle
        const rectangle = L.rectangle(bounds, {
            color: borderColor,
            weight: patch.is_positive ? 3 : 1,
            fillColor: patch.is_positive ? borderColor : '#333333',
            fillOpacity: patch.is_positive ? 0.7 : 0.2,
            className: `patch sliding-window ${patch.is_positive ? 'positive' : 'negative'}`
        });

        // Add LiDAR elevation overlay if data is available
        if (patch.elevation_data && Array.isArray(patch.elevation_data)) {
            this.addLiDAROverlay(bounds, patch.elevation_data, patchLayer);
        }

        // Add popup with enhanced patch information including LiDAR data
        rectangle.bindPopup(this.createPatchPopup(patch));

        // Populate mini elevation grid when popup opens (now with real data)
        rectangle.on('popupopen', () => {
            this.populateMiniElevationGrid(patch);
        });

        // Enhanced hover effects
        rectangle.on('mouseover', (e) => {
            rectangle.setStyle({
                weight: patch.is_positive ? 5 : 3,
                fillOpacity: Math.min((rectangle.options.fillOpacity || 0.5) + 0.2, 1.0)
            });
            this.showPatchTooltip(e, patch);
        });

        rectangle.on('mouseout', () => {
            rectangle.setStyle({
                weight: patch.is_positive ? 3 : 1,
                fillOpacity: rectangle.options.fillOpacity || 0.5
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

        console.log(`✅ Added sliding window patch ${patch.patch_id} with ${patch.elevation_data ? 'LiDAR overlay' : 'basic visualization'}`);

        return rectangle;
    }

    /**
     * Add LiDAR elevation overlay as a detailed grid
     */
    addLiDAROverlay(bounds, elevationData, targetLayer) {
        const rows = elevationData.length;
        const cols = elevationData[0]?.length || 0;
        
        if (rows === 0 || cols === 0) return;
        
        // Calculate statistics for color mapping
        const flatData = elevationData.flat().filter(v => v !== null && v !== undefined && !isNaN(v));
        const min = Math.min(...flatData);
        const max = Math.max(...flatData);
        const range = max - min;
        
        if (range === 0) return; // No elevation variation
        
        // Create a grid of small rectangles to show elevation data
        const [[southWest], [northEast]] = bounds;
        const latStep = (northEast - southWest) / rows;
        const lonStep = (bounds[1][1] - bounds[0][1]) / cols;
        
        // Only show a subset for performance (every nth cell)
        const step = Math.max(1, Math.floor(Math.min(rows, cols) / 16)); // Max 16x16 grid
        
        for (let i = 0; i < rows; i += step) {
            for (let j = 0; j < cols; j += step) {
                const value = elevationData[i][j];
                if (value !== null && value !== undefined && !isNaN(value)) {
                    const normalized = (value - min) / range;
                    const color = this.getElevationColor(normalized);
                    
                    const cellBounds = [
                        [southWest + i * latStep, bounds[0][1] + j * lonStep],
                        [southWest + (i + step) * latStep, bounds[0][1] + (j + step) * lonStep]
                    ];
                    
                    const cell = L.rectangle(cellBounds, {
                        color: 'transparent',
                        fillColor: color,
                        fillOpacity: 0.6,
                        weight: 0,
                        className: 'lidar-cell'
                    });
                    
                    cell.bindTooltip(`Elevation: ${value.toFixed(2)}m`);
                    targetLayer.addLayer(cell);
                }
            }
        }
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
     * Fixed to handle sliding window patches properly
     */
    calculatePatchBounds(patch) {
        const patchSize = patch.patch_size || patch.patch_size_m || 40; // default 40m
        const halfSize = patchSize / 2;
        
        // Convert meters to degrees with more accurate calculation
        const latDelta = halfSize / 111000; // ~111km per degree latitude
        const lonDelta = halfSize / (111000 * Math.cos(patch.lat * Math.PI / 180));
        
        // For sliding window patches, use exact boundaries based on patch center
        // The patch coordinates represent the center of the analysis window
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
        const bounds = patch.bounds || {};
        const rows = patch.elevation_data?.length || 0;
        const cols = patch.elevation_data?.[0]?.length || 0;
        
        // Calculate patch dimensions and sliding window info
        const patchSize = patch.patch_size || 64; // Default patch size in meters
        const slidingStep = patch.sliding_step || 1; // Default sliding step
        const patchArea = (patchSize * patchSize / 10000).toFixed(2); // Convert to hectares
        
        // Determine grid resolution that will be displayed
        let displayGridSize = 8; // default
        let resolutionLabel = 'Basic';
        if (rows >= 60 && cols >= 60) {
            displayGridSize = 21; // High resolution - matches detection kernel
            resolutionLabel = 'Ultra-High (Kernel Match!)';
        } else if (rows >= 32 && cols >= 32) {
            displayGridSize = 16; // Medium resolution
            resolutionLabel = 'High';
        } else if (rows >= 16 && cols >= 16) {
            displayGridSize = 12; // Low-medium resolution
            resolutionLabel = 'Medium';
        }
        
        // Calculate meters per pixel resolution
        const metersPerPixel = rows > 0 ? (patchSize / rows).toFixed(2) : '--';
        
        // Terrain roughness indicator
        const terrainRoughness = this.calculateTerrainRoughness(stats);
        
        return `
            <div class="patch-popup extended">
                <h4>🔍 Sliding Window Patch ${patch.patch_id}</h4>
                
                <!-- Sliding Window Information -->
                <div class="sliding-window-info">
                    <h5>🎯 Sliding Window Scan</h5>
                    <div class="info-row">
                        <span>Patch Size:</span>
                        <span>${patchSize}m × ${patchSize}m (${patchArea} hectares)</span>
                    </div>
                    <div class="info-row">
                        <span>Sliding Step:</span>
                        <span>${slidingStep}m (${slidingStep === 1 ? 'Maximum Overlap' : 'Optimized Speed'})</span>
                    </div>
                    <div class="info-row">
                        <span>Center Position:</span>
                        <span>${patch.lat.toFixed(6)}, ${patch.lon.toFixed(6)}</span>
                    </div>
                    <div class="info-row">
                        <span>Scan Progress:</span>
                        <span>${patch.scan_index || '--'} of ${patch.total_patches || '--'}</span>
                    </div>
                </div>
                
                <!-- Detection Results -->
                <div class="popup-content">
                    <div class="info-row">
                        <span>🎯 Detection Status:</span>
                        <span class="${patch.is_positive ? 'positive' : 'negative'}">
                            ${patch.is_positive ? '✅ DETECTION' : '❌ No Detection'}
                        </span>
                    </div>
                    <div class="info-row">
                        <span>🔬 AI Confidence:</span>
                        <span class="${patch.confidence > 0.7 ? 'positive' : patch.confidence > 0.4 ? '' : 'negative'}">
                            ${(patch.confidence * 100).toFixed(1)}%
                        </span>
                    </div>
                    <div class="info-row">
                        <span>🤖 Detection Method:</span>
                        <span>${detection.method || 'G2_dutch_windmill'}</span>
                    </div>
                    <div class="info-row">
                        <span>🌀 G2 Algorithm:</span>
                        <span class="${detection.g2_detected ? 'positive' : 'negative'}">
                            ${detection.g2_detected ? 'DETECTED' : 'None'} 
                            ${detection.g2_confidence ? `(${(detection.g2_confidence * 100).toFixed(1)}%)` : ''}
                        </span>
                    </div>
                    <div class="info-row">
                        <span>📊 φ⁰ Signature:</span>
                        <span>${detection.phi0?.toFixed(4) || '--'}</span>
                    </div>
                    <div class="info-row">
                        <span>📈 ψ⁰ Pattern:</span>
                        <span>${detection.psi0?.toFixed(4) || '--'}</span>
                    </div>
                </div>

                <!-- Real LiDAR Data Information -->
                <div class="sliding-window-info">
                    <h5>🗺️ Real LiDAR Terrain Data</h5>
                    <div class="info-row">
                        <span>Elevation Range:</span>
                        <span>${stats.min?.toFixed(1) || '--'}m - ${stats.max?.toFixed(1) || '--'}m</span>
                    </div>
                    <div class="info-row">
                        <span>Terrain Relief:</span>
                        <span>${stats.range?.toFixed(1) || '--'}m ${terrainRoughness}</span>
                    </div>
                    <div class="info-row">
                        <span>Data Resolution:</span>
                        <span>${resolutionLabel} (${rows}×${cols})</span>
                    </div>
                    <div class="info-row">
                        <span>Precision:</span>
                        <span>${metersPerPixel}m/pixel → ${displayGridSize}×${displayGridSize} display</span>
                    </div>
                    <div class="info-row">
                        <span>⏱️ Scan Time:</span>
                        <span>${new Date(patch.timestamp).toLocaleTimeString()}</span>
                    </div>
                </div>
                
                <!-- Real LiDAR Elevation Visualization -->
                <div class="popup-visualization">
                    <div class="mini-elevation-grid" id="miniElevationGrid_${patch.patch_id}">
                        <!-- Will be populated with real terrain data -->
                    </div>
                    <div class="elevation-legend">
                        <div class="legend-item">
                            <div class="color-box" style="background: #000080;"></div>
                            <span>Low</span>
                        </div>
                        <div class="legend-item">
                            <div class="color-box" style="background: #00ff00;"></div>
                            <span>Mid</span>
                        </div>
                        <div class="legend-item">
                            <div class="color-box" style="background: #ff4500;"></div>
                            <span>High</span>
                        </div>
                    </div>
                    <div class="mini-histogram" id="miniHistogram_${patch.patch_id}">
                        <canvas width="150" height="80"></canvas>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Show scan animation at a location - small square instead of circle
     */
    showScanAnimation(lat, lon, duration = 2000) {
        const animationLayer = this.layers.get('animations');
        
        // Calculate small square bounds for animation
        const patchSize = 64; // meters
        const latMPerDeg = 111000;
        const lonMPerDeg = 111000 * Math.cos(lat * Math.PI / 180);
        const halfSize = patchSize / 2;
        const latDelta = halfSize / latMPerDeg;
        const lonDelta = halfSize / lonMPerDeg;
        
        const bounds = [
            [lat - latDelta, lon - lonDelta],
            [lat + latDelta, lon + lonDelta]
        ];
        
        const rectangle = L.rectangle(bounds, {
            color: '#00ff88',
            fillColor: 'transparent',
            weight: 2,
            className: 'scan-animation'
        });

        animationLayer.addLayer(rectangle);

        // Remove after animation duration
        setTimeout(() => {
            animationLayer.removeLayer(rectangle);
        }, duration);

        return rectangle;
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
        
        // Also clear LiDAR heatmap
        this.clearLidarHeatmap();
    }

    /**
     * Clear all layers
     */
    clearAll() {
        this.layers.forEach(layer => layer.clearLayers());
        this.patches.clear();
        
        // Also clear LiDAR heatmap
        this.clearLidarHeatmap();
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
     * Cleanup method to properly destroy the map
     */
    destroy() {
        console.log('🧹 Destroying MapVisualization instance...');
        
        if (this.map) {
            try {
                // Remove all layers and event listeners
                this.map.eachLayer((layer) => {
                    this.map.removeLayer(layer);
                });
                
                // Remove the map instance
                this.map.remove();
                this.map = null;
                
                console.log('✅ Map instance destroyed');
            } catch (error) {
                console.warn('⚠️ Error destroying map:', error);
            }
        }
        
        // Clear any other data
        if (this.lidarTiles) {
            this.lidarTiles.clear();
        }
        
        if (this.canvasOverlay) {
            this.canvasOverlay = null;
        }
    }

    /**
     * Populate mini elevation grid with real LiDAR data and create histogram
     */
    populateMiniElevationGrid(patch) {
        const gridId = `miniElevationGrid_${patch.patch_id}`;
        const histogramId = `miniHistogram_${patch.patch_id}`;
        const gridContainer = document.getElementById(gridId);
        const histogramContainer = document.getElementById(histogramId);
        
        if (!gridContainer) {
            console.warn(`Mini elevation grid container ${gridId} not found`);
            return;
        }

        if (!patch.elevation_data || !Array.isArray(patch.elevation_data)) {
            gridContainer.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">⚠️ No real LiDAR data available</div>';
            return;
        }

        const data = patch.elevation_data;
        const rows = data.length;
        const cols = data[0]?.length || 0;

        if (rows === 0 || cols === 0) {
            gridContainer.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">❌ Invalid elevation data format</div>';
            return;
        }

        // Calculate statistics
        const flatData = data.flat().filter(v => v !== null && v !== undefined && !isNaN(v));
        const min = Math.min(...flatData);
        const max = Math.max(...flatData);
        const range = max - min;
        const mean = flatData.reduce((a, b) => a + b, 0) / flatData.length;

        // Enhanced resolution based on available data
        const maxDisplaySize = 24; // Increased from 20 for better detail
        const rowStep = Math.max(1, Math.floor(rows / maxDisplaySize));
        const colStep = Math.max(1, Math.floor(cols / maxDisplaySize));
        const displayRows = Math.ceil(rows / rowStep);
        const displayCols = Math.ceil(cols / colStep);

        // Dynamic cell size based on container and grid size
        const maxContainerSize = 140; // Slightly larger container
        const cellSize = Math.max(4, Math.min(maxContainerSize / Math.max(displayRows, displayCols), 8));
        
        let gridHTML = `
            <div style="display: grid; 
                       grid-template-columns: repeat(${displayCols}, ${cellSize}px); 
                       grid-template-rows: repeat(${displayRows}, ${cellSize}px); 
                       gap: 0.5px; 
                       background: #333; 
                       padding: 3px; 
                       border-radius: 4px;
                       margin: 8px auto;
                       width: fit-content;
                       box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
        `;

        // Build elevation grid with improved styling
        for (let i = 0; i < displayRows; i++) {
            for (let j = 0; j < displayCols; j++) {
                const rowIdx = Math.min(i * rowStep, rows - 1);
                const colIdx = Math.min(j * colStep, cols - 1);
                const value = data[rowIdx][colIdx];
                
                let backgroundColor = '#444'; // Default for invalid data
                let borderStyle = '';
                
                if (value !== null && value !== undefined && !isNaN(value)) {
                    const normalized = range > 0 ? (value - min) / range : 0.5;
                    backgroundColor = this.getElevationColor(normalized);
                    
                    // Add subtle highlighting for extreme values
                    if (normalized > 0.9) {
                        borderStyle = 'border: 1px solid #ff6b6b;'; // High elevation
                    } else if (normalized < 0.1) {
                        borderStyle = 'border: 1px solid #4dabf7;'; // Low elevation
                    }
                }
                
                gridHTML += `
                    <div style="background-color: ${backgroundColor}; 
                               width: ${cellSize}px; 
                               height: ${cellSize}px;
                               ${borderStyle}
                               transition: transform 0.1s ease;"
                         title="Row ${rowIdx}, Col ${colIdx}&#10;Elevation: ${value?.toFixed(2) || 'N/A'}m&#10;Relative: ${value !== null ? ((value - min) / range * 100).toFixed(1) + '%' : 'N/A'}"
                         onmouseover="this.style.transform='scale(1.2)'; this.style.zIndex='10';"
                         onmouseout="this.style.transform='scale(1)'; this.style.zIndex='1';">
                    </div>
                `;
            }
        }
        
        gridHTML += '</div>';
        
        // Enhanced title with more detailed information
        const dataQuality = this.assessDataQuality(rows, cols, flatData.length);
        const titleHTML = `
            <div style="font-size: 12px; color: #00ff88; text-align: center; margin-bottom: 8px; font-weight: 600;">
                🗺️ Real-Time LiDAR Elevation (${displayRows}×${displayCols})
            </div>
            <div style="font-size: 10px; color: #ccc; text-align: center; margin-bottom: 8px;">
                ${dataQuality} | Range: ${range.toFixed(1)}m | Mean: ${mean.toFixed(1)}m
            </div>
        `;
        
        gridContainer.innerHTML = titleHTML + gridHTML;
        
        // Create elevation histogram if container exists
        if (histogramContainer) {
            this.createElevationHistogram(histogramContainer, flatData, min, max, patch.patch_id);
        }
    }

    /**
     * Assess data quality based on resolution and completeness
     */
    assessDataQuality(rows, cols, validPoints) {
        const totalPoints = rows * cols;
        const completeness = validPoints / totalPoints;
        const resolution = Math.min(rows, cols);
        
        if (resolution >= 60 && completeness > 0.95) {
            return '🟢 Ultra-High Quality';
        } else if (resolution >= 32 && completeness > 0.9) {
            return '🟡 High Quality';
        } else if (resolution >= 16 && completeness > 0.8) {
            return '🟠 Medium Quality';
        } else {
            return '🔴 Basic Quality';
        }
    }

    /**
     * Create a mini histogram of elevation distribution
     */
    createElevationHistogram(container, data, min, max, patchId) {
        const canvas = container.querySelector('canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
        
        // Create histogram bins
        const numBins = 12;
        const binSize = (max - min) / numBins;
        const bins = new Array(numBins).fill(0);
        
        // Fill bins
        data.forEach(value => {
            const binIndex = Math.min(Math.floor((value - min) / binSize), numBins - 1);
            bins[binIndex]++;
        });
        
        const maxBinCount = Math.max(...bins);
        const barWidth = width / numBins;
        
        // Draw bars with elevation colors
        bins.forEach((count, i) => {
            const barHeight = (count / maxBinCount) * (height - 20);
            const x = i * barWidth;
            const y = height - barHeight - 10;
            
            // Use elevation color for each bar
            const normalized = i / (numBins - 1);
            ctx.fillStyle = this.getElevationColor(normalized);
            ctx.fillRect(x + 1, y, barWidth - 2, barHeight);
            
            // Add subtle outline
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x + 1, y, barWidth - 2, barHeight);
        });
        
        // Add title
        ctx.fillStyle = '#ccc';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Elevation Distribution', width / 2, 12);
        
        // Add min/max labels
        ctx.font = '8px Arial';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#999';
        ctx.fillText(`${min.toFixed(1)}m`, 2, height - 2);
        ctx.textAlign = 'right';
        ctx.fillText(`${max.toFixed(1)}m`, width - 2, height - 2);
    }

    /**
     * Calculate terrain roughness indicator
     */
    calculateTerrainRoughness(stats) {
        if (!stats.range || stats.range === 0) {
            return '🏞️ (Flat)';
        }
        
        if (stats.range < 2) {
            return '🏞️ (Gentle)';
        } else if (stats.range < 5) {
            return '🏔️ (Rolling)';
        } else if (stats.range < 10) {
            return '⛰️ (Hilly)';
        } else {
            return '🗻 (Steep)';
        }
    }

    /**
     * Add sliding window overlay visualization
     */
    addSlidingWindowOverlay(centerLat, centerLon, scanRadiusKm, patchSizeM, slidingStepM) {
        const slidingLayer = this.layers.get('slidingWindow') || L.layerGroup().addTo(this.map);
        this.layers.set('slidingWindow', slidingLayer);
        
        // Clear existing overlay
        slidingLayer.clearLayers();
        
        // Calculate scanning parameters
        const scanRadiusM = scanRadiusKm * 1000;
        const latMPerDeg = 111000;
        const lonMPerDeg = 111000 * Math.cos(centerLat * Math.PI / 180);
        
        // Calculate grid
        const stepsPerAxis = Math.ceil((scanRadiusM * 2) / slidingStepM);
        const startLat = centerLat + (scanRadiusM / latMPerDeg);
        const startLon = centerLon - (scanRadiusM / lonMPerDeg);
        
        const latStepDeg = slidingStepM / latMPerDeg;
        const lonStepDeg = slidingStepM / lonMPerDeg;
        
        // Create a sample of patches to show the sliding window pattern
        const sampleEvery = Math.max(1, Math.floor(stepsPerAxis / 20)); // Show ~20x20 grid max
        
        for (let i = 0; i < stepsPerAxis; i += sampleEvery) {
            for (let j = 0; j < stepsPerAxis; j += sampleEvery) {
                const lat = startLat - i * latStepDeg;
                const lon = startLon + j * lonStepDeg;
                
                // Calculate patch bounds
                const patchHalfSize = patchSizeM / 2;
                const patchLatDelta = patchHalfSize / latMPerDeg;
                const patchLonDelta = patchHalfSize / lonMPerDeg;
                
                const bounds = [
                    [lat - patchLatDelta, lon - patchLonDelta],
                    [lat + patchLatDelta, lon + patchLonDelta]
                ];
                
                // Create semi-transparent overlay to show sliding window pattern
                const overlay = L.rectangle(bounds, {
                    color: '#00ff88',
                    weight: 1,
                    fillColor: '#00ff88',
                    fillOpacity: 0.1,
                    className: 'sliding-window-overlay'
                });
                
                overlay.bindTooltip(`Sliding Window<br>Step: ${i * sampleEvery}, ${j * sampleEvery}<br>Center: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
                
                slidingLayer.addLayer(overlay);
            }
        }
        
        // Add center marker
        const centerMarker = L.circleMarker([centerLat, centerLon], {
            color: '#00ff88',
            fillColor: '#00ff88',
            fillOpacity: 0.8,
            radius: 8,
            weight: 2
        });
        centerMarker.bindTooltip(`Scan Center<br>${centerLat.toFixed(6)}, ${centerLon.toFixed(6)}<br>Radius: ${scanRadiusKm}km`);
        slidingLayer.addLayer(centerMarker);
        
        console.log(`✅ Added sliding window overlay: ${stepsPerAxis}x${stepsPerAxis} grid (showing ${Math.ceil(stepsPerAxis/sampleEvery)}x${Math.ceil(stepsPerAxis/sampleEvery)} sample)`);
    }
    
    /**
     * Clear sliding window overlay
     */
    clearSlidingWindowOverlay() {
        const slidingLayer = this.layers.get('slidingWindow');
        if (slidingLayer) {
            slidingLayer.clearLayers();
        }
    }

    /**
     * Add a LiDAR tile to the map with visual wipe effect and sync protection
     */
    addLidarTile(tileData) {
        // Store tile data for canvas-based heatmap
        if (!this.lidarTiles) {
            this.lidarTiles = new Map();
            this.tileQueue = [];
            this.isWiping = false;
            this.queueSorted = false;
            this.processedTileIds = new Set(); // Track processed tiles to prevent duplicates
        }
        
        // Check for duplicate tiles to prevent sync issues
        if (this.processedTileIds.has(tileData.tile_id)) {
            // console.warn(`⚠️ Duplicate tile detected: ${tileData.tile_id}, skipping`); // Reduced log noise
            return null;
        }
        
        // Mark tile as processed
        this.processedTileIds.add(tileData.tile_id);
        
        // Store scan area bounds from first tile (should be consistent across session)
        if (!this.scanAreaBounds && tileData.scan_bounds) {
            this.scanAreaBounds = tileData.scan_bounds;
            console.log('📍 Scan area bounds set:', this.scanAreaBounds);
        }
        
        this.tileQueue.push(tileData);
        
        if (!this.isWiping) {
            this.startWipeEffect();
        }
        
        return null; // No individual rectangles anymore
    }
    
    /**
     * Start the visual wipe effect (left to right)
     */
    startWipeEffect() {
        this.isWiping = true;
        this.processWipeQueue();
    }
    
    /**
     * Process the tile queue with sequential left-to-right wipe timing  
     */
    processWipeQueue() {
        if (this.tileQueue.length === 0) {
            this.isWiping = false;
            return;
        }
        
        // Sort queue by grid position for left-to-right effect (only once)
        if (!this.queueSorted) {
            this.tileQueue.sort((a, b) => {
                if (a.grid_row !== b.grid_row) {
                    return a.grid_row - b.grid_row; // Top to bottom
                }
                return a.grid_col - b.grid_col; // Left to right within row
            });
            this.queueSorted = true;
        }
        
        // Get the next tile to wipe (first in sorted queue)
        const currentTile = this.tileQueue[0];
        if (!currentTile) return;
        
        if (!currentTile.wipeStartTime) {
            currentTile.wipeStartTime = Date.now();
            currentTile.wipeProgress = 0;
        }
        
        // Calculate wipe progress for current tile only
        const currentTime = Date.now();
        const timeSinceStart = currentTime - currentTile.wipeStartTime;
        
        // Adaptive wipe duration: faster if more tiles in queue
        const baseDuration = 600; // Base 600ms per tile  
        const queueSpeedBonus = Math.min(400, this.tileQueue.length * 30); // Up to 400ms faster
        const wipeDuration = Math.max(200, baseDuration - queueSpeedBonus); // Minimum 200ms
        
        // Update progress for current tile
        currentTile.wipeProgress = Math.min(1, timeSinceStart / wipeDuration);
        
        // Add current tile to render map
        this.lidarTiles.set(currentTile.tile_id, currentTile);
        
        // Update canvas to show current tile progress
        this.updateCanvasHeatmap();
        
        if (currentTile.wipeProgress >= 1) {
            this.tileQueue.shift();
            
            if (this.tileQueue.length > 0) {
                setTimeout(() => this.processWipeQueue(), 16);
            } else {
                this.isWiping = false;
                this.queueSorted = false;
            }
        } else {
            setTimeout(() => this.processWipeQueue(), 16); // 60fps for smooth animation
        }
    }
    
    /**
     * Create popup content for LiDAR tiles
     */
    createLidarTilePopup(tileData) {
        const hasData = tileData.has_data;
        
        return `
            <div class="lidar-tile-popup">
                <h4>📡 LiDAR Tile</h4>
                <div class="tile-info">
                    <div class="info-row">
                        <span class="label">Tile ID:</span>
                        <span class="value">${tileData.tile_id}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Location:</span>
                        <span class="value">${tileData.center_lat.toFixed(6)}, ${tileData.center_lon.toFixed(6)}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Size:</span>
                        <span class="value">${tileData.size_m}m × ${tileData.size_m}m</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Data Status:</span>
                        <span class="value status-${hasData ? 'available' : 'unavailable'}">
                            ${hasData ? '✅ Available' : '❌ Unavailable'}
                        </span>
                    </div>
                    ${hasData ? `
                        <div class="elevation-stats">
                            <h5>Elevation Statistics</h5>
                            <div class="stats-grid">
                                <div class="stat">
                                    <span class="stat-label">Min:</span>
                                    <span class="stat-value">${tileData.elevation_stats.min.toFixed(2)}m</span>
                                </div>
                                <div class="stat">
                                    <span class="stat-label">Max:</span>
                                    <span class="stat-value">${tileData.elevation_stats.max.toFixed(2)}m</span>
                                </div>
                                <div class="stat">
                                    <span class="stat-label">Mean:</span>
                                    <span class="stat-value">${tileData.elevation_stats.mean.toFixed(2)}m</span>
                                </div>
                                <div class="stat">
                                    <span class="stat-label">Std Dev:</span>
                                    <span class="stat-value">${tileData.elevation_stats.std.toFixed(2)}m</span>
                                </div>
                            </div>
                        </div>
                    ` : `
                        <div class="no-data-message">
                            <p>${tileData.message || 'No LiDAR data available for this tile'}</p>
                        </div>
                    `}
                    <div class="info-row">
                        <span class="label">Timestamp:</span>
                        <span class="value">${new Date(tileData.timestamp).toLocaleString()}</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Update canvas-based heatmap overlay for smooth elevation visualization
     */
    updateCanvasHeatmap() {
        if (!this.lidarTiles || this.lidarTiles.size === 0) {
            return;
        }
        
        // Use scan area bounds if available, otherwise calculate from tiles
        let bounds;
        if (this.scanAreaBounds) {
            bounds = this.scanAreaBounds;
        } else {
            // Calculate bounds of all tiles as fallback
            const tilesArray = Array.from(this.lidarTiles.values());
            bounds = this.calculateTileBounds(tilesArray);
        }
        
        if (!bounds) {
            console.warn("⚠️ Could not determine bounds for heatmap");
            return;
        }
        
        // Get tiles array for rendering
        const tilesArray = Array.from(this.lidarTiles.values());
        
        // Remove existing canvas overlay if it exists
        if (this.canvasOverlay) {
            this.map.removeLayer(this.canvasOverlay);
            this.canvasOverlay = null;
        }
        
        // Create canvas overlay
        this.canvasOverlay = this.createCanvasOverlay(bounds, tilesArray);
        
        // Add directly to map instead of layer group for proper positioning
        this.canvasOverlay.addTo(this.map);
        
        // Auto-zoom to the LiDAR area for better visibility (but not if we have a selection rectangle)
        if (tilesArray.length >= 2 && !this.hasActiveSelection()) {  
            const mapBounds = L.latLngBounds(
                [bounds.south, bounds.west],
                [bounds.north, bounds.east]
            );
            this.map.fitBounds(mapBounds, { padding: [20, 20] });
        }
    }
    
    /**
     * Calculate the overall bounds of all LiDAR tiles
     */
    calculateTileBounds(tilesArray) {
        if (tilesArray.length === 0) return null;
        
        let minLat = Infinity, maxLat = -Infinity;
        let minLon = Infinity, maxLon = -Infinity;
        
        for (const tile of tilesArray) {
            const latSize = tile.size_m / 111320;
            const lonSize = tile.size_m / (111320 * Math.cos(tile.center_lat * Math.PI / 180));
            
            const tileBounds = {
                south: tile.center_lat - latSize / 2,
                north: tile.center_lat + latSize / 2,
                west: tile.center_lon - lonSize / 2,
                east: tile.center_lon + lonSize / 2
            };
            
            minLat = Math.min(minLat, tileBounds.south);
            maxLat = Math.max(maxLat, tileBounds.north);
            minLon = Math.min(minLon, tileBounds.west);
            maxLon = Math.max(maxLon, tileBounds.east);
        }
        
        const overallBounds = {
            south: minLat,
            north: maxLat,
            west: minLon,
            east: maxLon,
            center: [(minLat + maxLat) / 2, (minLon + maxLon) / 2]
        };
        
        return overallBounds;
    }
    
    /**
     * Create a canvas overlay with high-resolution elevation data
     */
    createCanvasOverlay(bounds, tilesArray) {
        // Calculate appropriate canvas size based on tile resolution
        const boundsWidth = bounds.east - bounds.west;
        const boundsHeight = bounds.north - bounds.south;
        const metersPerDegreeLat = 111320;
        const metersPerDegreeLon = 111320 * Math.cos((bounds.north + bounds.south) / 2 * Math.PI / 180);
        
        const areaWidthM = boundsWidth * metersPerDegreeLon;
        const areaHeightM = boundsHeight * metersPerDegreeLat;
        
        // Set canvas size to provide good resolution without being too large
        const targetResolutionM = 2.0; // 2m per pixel for good detail
        const canvasWidth = Math.min(1024, Math.max(256, Math.round(areaWidthM / targetResolutionM)));
        const canvasHeight = Math.min(1024, Math.max(256, Math.round(areaHeightM / targetResolutionM)));
        
        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');
        
        // Calculate global elevation range for consistent coloring
        let globalMin = Infinity;
        let globalMax = -Infinity;
        
        tilesArray.forEach(tile => {
            if (tile.has_data && tile.elevation_stats) {
                globalMin = Math.min(globalMin, tile.elevation_stats.min);
                globalMax = Math.max(globalMax, tile.elevation_stats.max);
            }
        });
        
        // Clear canvas with transparent background
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw each tile with high-resolution data
        tilesArray.forEach(tile => {
            if (tile.has_data && tile.viz_elevation) {
                this.drawHighResolutionTile(ctx, canvas, bounds, tile, {min: globalMin, max: globalMax});
            }
        });
        
        // Create Leaflet image overlay
        const imageBounds = [[bounds.south, bounds.west], [bounds.north, bounds.east]];
        const overlay = L.imageOverlay(canvas.toDataURL(), imageBounds, {
            opacity: 0.8,
            className: 'lidar-canvas-heatmap'
        });
        
        return overlay;
    }
    
    /**
     * Draw a single tile with high-resolution elevation data and wipe effect
     */
    drawHighResolutionTile(ctx, canvas, bounds, tile, elevRange) {
        const elevation2D = tile.viz_elevation;
        const rows = elevation2D.length;
        const cols = elevation2D[0].length;
        
        // Get wipe progress (0 to 1)
        const wipeProgress = tile.wipeProgress || 1.0;
        
        // Calculate tile bounds
        const tileLatSize = tile.size_m / 111320;
        const tileLonSize = tile.size_m / (111320 * Math.cos(tile.center_lat * Math.PI / 180));
        
        const tileBounds = {
            south: tile.center_lat - tileLatSize / 2,
            north: tile.center_lat + tileLatSize / 2,
            west: tile.center_lon - tileLonSize / 2,
            east: tile.center_lon + tileLonSize / 2
        };
        
        // Convert tile bounds to canvas coordinates
        const tileCanvasX = ((tileBounds.west - bounds.west) / (bounds.east - bounds.west)) * canvas.width;
        const tileCanvasY = ((bounds.north - tileBounds.north) / (bounds.north - bounds.south)) * canvas.height;
        const tileCanvasW = ((tileBounds.east - tileBounds.west) / (bounds.east - bounds.west)) * canvas.width;
        const tileCanvasH = ((tileBounds.north - tileBounds.south) / (bounds.north - bounds.south)) * canvas.height;
        
        // Calculate how many columns to show based on wipe progress (left to right)
        const visibleCols = Math.floor(cols * wipeProgress);
        const partialCol = cols * wipeProgress - visibleCols;
        
        // Draw each elevation pixel as a colored rectangle
        const pixelWidth = tileCanvasW / cols;
        const pixelHeight = tileCanvasH / rows;
        
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col <= visibleCols; col++) {
                if (col >= cols) break;
                
                const elevation = elevation2D[row][col];
                if (isNaN(elevation)) continue;
                
                const color = this.elevationToColor(elevation, elevRange);
                
                const pixelX = tileCanvasX + col * pixelWidth;
                const pixelY = tileCanvasY + row * pixelHeight;
                
                let pixelWidthToDraw = pixelWidth;
                
                // For the last partial column, only draw the visible portion
                if (col === visibleCols && partialCol > 0) {
                    pixelWidthToDraw = pixelWidth * partialCol;
                }
                
                ctx.fillStyle = color;
                ctx.fillRect(
                    Math.floor(pixelX), 
                    Math.floor(pixelY), 
                    Math.ceil(pixelWidthToDraw), 
                    Math.ceil(pixelHeight)
                );
            }
        }
        
        // Add a subtle vertical line at the wipe edge for visual feedback
        if (wipeProgress < 1.0 && wipeProgress > 0) {
            const wipeX = tileCanvasX + tileCanvasW * wipeProgress;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(wipeX, tileCanvasY);
            ctx.lineTo(wipeX, tileCanvasY + tileCanvasH);
            ctx.stroke();
        }
    }
    
    /**
     * Calculate global elevation range across all tiles
     */
    calculateGlobalElevationRange(tilesArray) {
        let globalMin = Infinity;
        let globalMax = -Infinity;
        
        for (const tile of tilesArray) {
            if (tile.has_data && tile.elevation_stats) {
                globalMin = Math.min(globalMin, tile.elevation_stats.min);
                globalMax = Math.max(globalMax, tile.elevation_stats.max);
            }
        }
        
        // Add some padding for better visualization
        const padding = (globalMax - globalMin) * 0.1;
        return {
            min: globalMin - padding,
            max: globalMax + padding
        };
    }
    
    /**
     * Draw smooth elevation data on canvas with interpolation
     */
    drawSmoothElevationData(ctx, canvas, bounds, tilesArray, elevRange) {
        const imageData = ctx.createImageData(canvas.width, canvas.height);
        const data = imageData.data;
        
        const elevGrid = this.createElevationGrid(bounds, tilesArray, canvas.width, canvas.height);
        const nonNullPixels = elevGrid.filter(val => val !== null).length;
        
        const smoothGrid = this.applyGaussianBlur(elevGrid, canvas.width, canvas.height, 0.5);
        
        // Convert elevation data to colors
        let coloredPixels = 0;
        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                const idx = (y * canvas.width + x) * 4;
                const elevation = smoothGrid[y * canvas.width + x];
                
                if (elevation !== null) {
                    const color = this.elevationToColor(elevation, elevRange);
                    data[idx] = color.r;     // Red
                    data[idx + 1] = color.g; // Green
                    data[idx + 2] = color.b; // Blue
                    data[idx + 3] = 192;     // Alpha (75% opacity)
                    coloredPixels++;
                } else {
                    // Transparent for no data areas
                    data[idx + 3] = 0;
                }
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
        console.log(`✅ Canvas elevation data drawn successfully`);
    }
    
    /**
     * Create elevation grid from tile data using discrete zones
     * Based on working lidar patch code approach
     */
    createElevationGrid(bounds, tilesArray, width, height) {
        const grid = new Array(width * height).fill(null);
        const contourInterval = 0.5; // Match working code's contour_interval
        
        const latSpan = bounds.north - bounds.south;
        const lonSpan = bounds.east - bounds.west;
        
        for (const tile of tilesArray) {
            if (!tile.has_data || !tile.elevation_stats) continue;
            
            const latSize = tile.size_m / 111320;
            const lonSize = tile.size_m / (111320 * Math.cos(tile.center_lat * Math.PI / 180));
            
            // Calculate tile bounds in grid coordinates
            const tileBounds = {
                south: tile.center_lat - latSize / 2,
                north: tile.center_lat + latSize / 2,
                west: tile.center_lon - lonSize / 2,
                east: tile.center_lon + lonSize / 2
            };
            
            // Convert to pixel coordinates
            const x1 = Math.floor((tileBounds.west - bounds.west) / lonSpan * width);
            const x2 = Math.ceil((tileBounds.east - bounds.west) / lonSpan * width);
            const y1 = Math.floor((bounds.north - tileBounds.north) / latSpan * height);
            const y2 = Math.ceil((bounds.north - tileBounds.south) / latSpan * height);
            
            // Use discrete elevation zones like working code
            const rawElevation = tile.elevation_stats.mean;
            const discreteElevation = Math.floor(rawElevation / contourInterval) * contourInterval;
            
            // Fill grid cells with discrete elevation
            for (let y = Math.max(0, y1); y < Math.min(height, y2); y++) {
                for (let x = Math.max(0, x1); x < Math.min(width, x2); x++) {
                    grid[y * width + x] = discreteElevation;
                }
            }
        }
        
        return grid;
    }
    
    /**
     * Apply Gaussian blur for smooth transitions between tiles
     */
    applyGaussianBlur(grid, width, height, radius) {
        const result = new Array(grid.length);
        const kernel = this.createGaussianKernel(radius);
        const kernelSize = kernel.length;
        const kernelRadius = Math.floor(kernelSize / 2);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                let weightSum = 0;
                
                for (let ky = 0; ky < kernelSize; ky++) {
                    for (let kx = 0; kx < kernelSize; kx++) {
                        const sourceX = x + kx - kernelRadius;
                        const sourceY = y + ky - kernelRadius;
                        
                        if (sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height) {
                            const sourceValue = grid[sourceY * width + sourceX];
                            if (sourceValue !== null) {
                                const weight = kernel[ky][kx];
                                sum += sourceValue * weight;
                                weightSum += weight;
                            }
                        }
                    }
                }
                
                result[y * width + x] = weightSum > 0 ? sum / weightSum : null;
            }
        }
        
        return result;
    }
    
    /**
     * Create Gaussian kernel for blurring
     */
    createGaussianKernel(radius) {
        const size = Math.ceil(radius * 2) * 2 + 1;
        const kernel = [];
        const sigma = radius / 3;
        const center = Math.floor(size / 2);
        let sum = 0;
        
        for (let y = 0; y < size; y++) {
            kernel[y] = [];
            for (let x = 0; x < size; x++) {
                const distance = Math.sqrt((x - center) ** 2 + (y - center) ** 2);
                const value = Math.exp(-(distance ** 2) / (2 * sigma ** 2));
                kernel[y][x] = value;
                sum += value;
            }
        }
        
        // Normalize kernel
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                kernel[y][x] /= sum;
            }
        }
        
        return kernel;
    }
    
    /**
     * Convert elevation to color using archaeological contour-based scheme
     * Based on working lidar patch code that uses discrete elevation zones
     */
    elevationToColor(elevation, range) {
        // Use contour intervals like the working code (0.5m intervals)
        const contourInterval = 0.5;
        
        // Create discrete elevation zones (like the working code does)
        const discreteElevation = Math.floor(elevation / contourInterval) * contourInterval;
        
        // Normalize based on discrete zones for better contrast
        const normalized = Math.max(0, Math.min(1, (discreteElevation - range.min) / (range.max - range.min)));
        
        // Enhanced archaeological color scheme with better contrast
        if (normalized < 0.15) {
            // Very low areas: dark blue (water/depressions)
            return this.rgbToHex({r: 0, g: 80, b: 160});
        } else if (normalized < 0.35) {
            // Low elevation: light blue to cyan (low ground) 
            return this.rgbToHex({r: 50, g: 150, b: 200});
        } else if (normalized < 0.55) {
            // Medium elevation: green (normal ground level)
            return this.rgbToHex({r: 80, g: 180, b: 80});
        } else if (normalized < 0.75) {
            // Higher elevation: yellow-orange (elevated features)
            return this.rgbToHex({r: 255, g: 200, b: 50});
        } else {
            // High elevation: red (potential structures/mounds)
            return this.rgbToHex({r: 220, g: 50, b: 50});
        }
    }
    
    /**
     * Convert RGB object to hex color string
     */
    rgbToHex(rgb) {
        const componentToHex = (c) => {
            const hex = Math.max(0, Math.min(255, Math.round(c))).toString(16);
            return hex.length == 1 ? "0" + hex : hex;
        };
        return `#${componentToHex(rgb.r)}${componentToHex(rgb.g)}${componentToHex(rgb.b)}`;
    }

    /**
     * Interpolate between two colors (kept for compatibility)
     */
    interpolateColor(color1, color2, t) {
        return {
            r: Math.round(color1.r + (color2.r - color1.r) * t),
            g: Math.round(color1.g + (color2.g - color1.g) * t),
            b: Math.round(color1.b + (color2.b - color1.b) * t)
        };
    }
    
    /**
     * Find the tile at a specific lat/lon location
     */
    findTileAtLocation(lat, lon) {
        for (const tile of this.lidarTiles.values()) {
            const latSize = tile.size_m / 111320;
            const lonSize = tile.size_m / (111320 * Math.cos(tile.center_lat * Math.PI / 180));
            
            const bounds = {
                south: tile.center_lat - latSize / 2,
                north: tile.center_lat + latSize / 2,
                west: tile.center_lon - lonSize / 2,
                east: tile.center_lon + lonSize / 2
            };
            
            if (lat >= bounds.south && lat <= bounds.north && 
                lon >= bounds.west && lon <= bounds.east) {
                return tile;
            }
        }
        return null;
    }
    
    /**
     * Clear LiDAR heatmap data and sync state
     */
    clearLidarHeatmap() {
        // Clear tile data
        if (this.lidarTiles) {
            this.lidarTiles.clear();
        }
        
        // Clear sync tracking
        if (this.processedTileIds) {
            this.processedTileIds.clear();
        }
        
        // Clear wipe effect state
        if (this.tileQueue) {
            this.tileQueue = [];
        }
        this.isWiping = false;
        this.queueSorted = false;
        
        // Clear scan area bounds
        this.scanAreaBounds = null;
        
        // Remove canvas overlay
        if (this.canvasOverlay) {
            this.map.removeLayer(this.canvasOverlay);
            this.canvasOverlay = null;
        }
        
        console.log('🧹 Cleared LiDAR heatmap, wipe effect state, and sync tracking');
    }

}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapVisualization;
} else {
    window.MapVisualization = MapVisualization;
}

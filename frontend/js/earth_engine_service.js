/**
 * Earth Engine Service for RE-Archaeology Framework
 * Handles map operations, layer management, and Earth Engine integration
 */

class EarthEngineService {
    constructor() {
        this.map = null;
        this.currentThreadId = null;
        this.layers = new Map();
        this.markers = [];
        this.backgroundTaskService = null;
        this.authService = null;
        this.baseUrl = 'http://localhost:8000';
        
        // Initialize map when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initializeMap());
        } else {
            this.initializeMap();
        }
    }

    /**
     * Set dependencies
     */
    setDependencies(backgroundTaskService, authService) {
        this.backgroundTaskService = backgroundTaskService;
        this.authService = authService;
    }
    
    /**
     * Initialize the Earth Engine service
     * This method is called during application startup
     */
    async initialize() {
        console.log('Initializing Earth Engine Service');
        // This method will be called by the ChatApp during initialization
        // Add actual initialization logic here when we have a real API
        return true;
    }

    /**
     * Initialize the map
     */
    async initializeMap() {
        try {
            // Create map container if it doesn't exist
            if (!document.getElementById('map')) {
                console.log('Map container not found, skipping map initialization');
                return;
            }

            // Initialize Leaflet map
            this.map = L.map('map').setView([40.0, -100.0], 4);

            // Add base tile layer
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(this.map);

            // Add drawing controls
            this.initializeDrawingControls();

            console.log('Map initialized successfully');
        } catch (error) {
            console.error('Error initializing map:', error);
        }
    }

    /**
     * Initialize drawing controls
     */
    initializeDrawingControls() {
        if (!this.map) return;

        // Create feature group for drawn items
        const drawnItems = new L.FeatureGroup();
        this.map.addLayer(drawnItems);

        // Initialize the draw control
        const drawControl = new L.Control.Draw({
            edit: {
                featureGroup: drawnItems
            },
            draw: {
                polygon: true,
                rectangle: true,
                circle: false,
                marker: true,
                polyline: false,
                circlemarker: false
            }
        });
        this.map.addControl(drawControl);

        // Handle draw events
        this.map.on(L.Draw.Event.CREATED, (event) => {
            const layer = event.layer;
            drawnItems.addLayer(layer);
            this.onAreaDrawn(layer);
        });
    }

    /**
     * Handle area drawn event
     */
    async onAreaDrawn(layer) {
        try {
            if (!this.currentThreadId) {
                alert('Please select a thread first');
                return;
            }

            const geometry = layer.toGeoJSON().geometry;
            
            // Create background task for Earth Engine analysis
            if (this.backgroundTaskService) {
                await this.backgroundTaskService.createTask(
                    'earth_engine_analysis',
                    {
                        thread_id: this.currentThreadId,
                        geometry: geometry,
                        analysis_type: 'basic'
                    },
                    `Earth Engine analysis for thread ${this.currentThreadId}`
                );
            }
        } catch (error) {
            console.error('Error handling drawn area:', error);
        }
    }

    /**
     * Set current thread for map context
     */
    setCurrentThread(threadId) {
        this.currentThreadId = threadId;
        this.loadThreadMaps(threadId);
    }

    /**
     * Load maps for a specific thread
     */
    async loadThreadMaps(threadId) {
        try {
            const headers = {};
            if (this.authService && this.authService.isAuthenticated()) {
                headers['Authorization'] = `Bearer ${this.authService.getToken()}`;
            }

            const response = await fetch(`${this.baseUrl}/api/v1/earth-engine/thread/${threadId}/maps`, {
                headers
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const maps = await response.json();
            this.displayThreadMaps(maps);
        } catch (error) {
            console.error('Error loading thread maps:', error);
        }
    }

    /**
     * Display maps for the current thread
     */
    displayThreadMaps(maps) {
        if (!this.map) return;

        // Clear existing layers
        this.clearLayers();

        maps.forEach(mapData => {
            this.addMapLayer(mapData);
        });
    }

    /**
     * Add a map layer to the display
     */
    addMapLayer(mapData) {
        try {
            if (mapData.type === 'tile_layer' && mapData.tile_url) {
                const layer = L.tileLayer(mapData.tile_url, {
                    attribution: mapData.attribution || 'Earth Engine',
                    opacity: mapData.opacity || 0.7
                });
                
                layer.addTo(this.map);
                this.layers.set(mapData.id, layer);
            } else if (mapData.type === 'geojson' && mapData.geojson_data) {
                const layer = L.geoJSON(mapData.geojson_data, {
                    style: mapData.style || {}
                });
                
                layer.addTo(this.map);
                this.layers.set(mapData.id, layer);
            }
        } catch (error) {
            console.error('Error adding map layer:', error);
        }
    }

    /**
     * Clear all layers from the map
     */
    clearLayers() {
        this.layers.forEach(layer => {
            this.map.removeLayer(layer);
        });
        this.layers.clear();
        
        // Clear markers
        this.markers.forEach(marker => {
            this.map.removeLayer(marker);
        });
        this.markers = [];
    }

    /**
     * Add a marker to the map
     */
    addMarker(lat, lng, title, popup) {
        if (!this.map) return null;

        const marker = L.marker([lat, lng]);
        if (title) marker.bindTooltip(title);
        if (popup) marker.bindPopup(popup);
        
        marker.addTo(this.map);
        this.markers.push(marker);
        
        return marker;
    }

    /**
     * Fit map view to bounds
     */
    fitBounds(bounds) {
        if (!this.map) return;
        
        if (Array.isArray(bounds) && bounds.length === 4) {
            // bounds format: [minLat, minLng, maxLat, maxLng]
            const leafletBounds = [[bounds[0], bounds[1]], [bounds[2], bounds[3]]];
            this.map.fitBounds(leafletBounds);
        }
    }

    /**
     * Start Earth Engine analysis for current view
     */
    async startAnalysis(analysisType = 'basic') {
        try {
            if (!this.currentThreadId) {
                throw new Error('No thread selected');
            }

            if (!this.authService || !this.authService.isAuthenticated()) {
                throw new Error('Authentication required');
            }

            const bounds = this.map.getBounds();
            const geometry = {
                type: 'Polygon',
                coordinates: [[
                    [bounds.getWest(), bounds.getSouth()],
                    [bounds.getEast(), bounds.getSouth()],
                    [bounds.getEast(), bounds.getNorth()],
                    [bounds.getWest(), bounds.getNorth()],
                    [bounds.getWest(), bounds.getSouth()]
                ]]
            };

            if (this.backgroundTaskService) {
                await this.backgroundTaskService.createTask(
                    'earth_engine_analysis',
                    {
                        thread_id: this.currentThreadId,
                        geometry: geometry,
                        analysis_type: analysisType
                    },
                    `Earth Engine ${analysisType} analysis`
                );
            }
        } catch (error) {
            console.error('Error starting analysis:', error);
            alert(`Error starting analysis: ${error.message}`);
        }
    }

    /**
     * Export current map view
     */
    async exportMap(format = 'png') {
        try {
            if (!this.currentThreadId) {
                throw new Error('No thread selected');
            }

            if (!this.authService || !this.authService.isAuthenticated()) {
                throw new Error('Authentication required');
            }

            const bounds = this.map.getBounds();
            const exportParams = {
                thread_id: this.currentThreadId,
                bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
                format: format,
                zoom: this.map.getZoom()
            };

            if (this.backgroundTaskService) {
                await this.backgroundTaskService.createTask(
                    'map_export',
                    exportParams,
                    `Map export (${format})`
                );
            }
        } catch (error) {
            console.error('Error exporting map:', error);
            alert(`Error exporting map: ${error.message}`);
        }
    }

    /**
     * Load predefined datasets
     */
    async loadDataset(datasetId) {
        try {
            if (!this.authService || !this.authService.isAuthenticated()) {
                throw new Error('Authentication required');
            }

            const response = await fetch(`${this.baseUrl}/api/v1/earth-engine/datasets/${datasetId}`, {
                headers: {
                    'Authorization': `Bearer ${this.authService.getToken()}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const dataset = await response.json();
            this.addMapLayer(dataset);
        } catch (error) {
            console.error('Error loading dataset:', error);
            alert(`Error loading dataset: ${error.message}`);
        }
    }

    /**
     * Get available Earth Engine datasets
     */
    async getAvailableDatasets() {
        try {
            const response = await fetch(`${this.baseUrl}/api/v1/earth-engine/datasets`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error getting datasets:', error);
            return [];
        }
    }

    /**
     * Toggle layer visibility
     */
    toggleLayer(layerId) {
        const layer = this.layers.get(layerId);
        if (layer) {
            if (this.map.hasLayer(layer)) {
                this.map.removeLayer(layer);
            } else {
                this.map.addLayer(layer);
            }
        }
    }

    /**
     * Set layer opacity
     */
    setLayerOpacity(layerId, opacity) {
        const layer = this.layers.get(layerId);
        if (layer && typeof layer.setOpacity === 'function') {
            layer.setOpacity(opacity);
        }
    }

    /**
     * Get map center and zoom
     */
    getMapState() {
        if (!this.map) return null;
        
        const center = this.map.getCenter();
        return {
            center: [center.lat, center.lng],
            zoom: this.map.getZoom(),
            bounds: this.map.getBounds()
        };
    }

    /**
     * Set map center and zoom
     */
    setMapState(state) {
        if (!this.map || !state) return;
        
        if (state.center) {
            this.map.setView(state.center, state.zoom || this.map.getZoom());
        }
    }

    /**
     * Get maps for a thread
     */
    async getMaps(threadId) {
        try {
            // Try to fetch from API
            try {
                const response = await fetch(`/api/v1/maps/thread/${threadId}`, {
                    headers: this.authService ? this.authService.getAuthHeaders() : {}
                });

                if (response.ok) {
                    return await response.json();
                }
            } catch (error) {
                console.warn('API not available, using mock map data');
            }
            
            // Return mock data for thread 1
            if (threadId === 'thread-1') {
                return [
                    {
                        id: 'map-1',
                        title: 'Archaeological Potential Analysis',
                        type: 'archaeological_potential',
                        thread_id: threadId,
                        center: [25.135, 35.342],
                        zoom: 13,
                        layers: [
                            {
                                id: 'base',
                                name: 'Base Layer',
                                type: 'satellite'
                            },
                            {
                                id: 'potential',
                                name: 'Archaeological Potential',
                                type: 'heatmap'
                            }
                        ]
                    }
                ];
            }
            
            return [];
        } catch (error) {
            console.error('Error fetching maps for thread:', error);
            return [];
        }
    }
    
    /**
     * Render a map in the specified container
     */
    renderMap(mapData, containerId) {
        try {
            console.log(`Rendering map in container: ${containerId}`);
            const container = document.getElementById(containerId);
            
            if (!container) {
                console.error(`Map container ${containerId} not found`);
                return;
            }
            
            // For this mock implementation, we'll just display a simple static map image
            container.innerHTML = `
                <div class="mock-map" style="width: 100%; height: 300px; background-color: #c2d4e2; display: flex; align-items: center; justify-content: center;">
                    <div style="text-align: center;">
                        <h4>${mapData.title}</h4>
                        <p>Mock Map: ${mapData.type}</p>
                        <p>Coordinates: ${mapData.center[0]}, ${mapData.center[1]}</p>
                    </div>
                </div>
            `;
            
            console.log(`Map rendered in container ${containerId}`);
        } catch (error) {
            console.error('Error rendering map:', error);
        }
    }
    
    /**
     * Initialize map selector for the "Add Map" form
     */
    initializeMapSelector() {
        try {
            console.log('Initializing map selector');
            const mapSelectorContainer = document.getElementById('map-selector');
            
            if (!mapSelectorContainer) {
                console.error('Map selector container not found');
                return;
            }
            
            // Create a simple mock map selector
            mapSelectorContainer.innerHTML = `
                <div class="mock-map-selector" style="width: 100%; height: 300px; background-color: #d4e2c2; display: flex; align-items: center; justify-content: center;">
                    <div style="text-align: center;">
                        <h4>Select Area of Interest</h4>
                        <p>Click on the map to select an area</p>
                        <button id="select-area-btn" class="btn btn-primary">Select This Area</button>
                    </div>
                </div>
            `;
            
            // Add event listener to the select button
            const selectBtn = document.getElementById('select-area-btn');
            if (selectBtn) {
                selectBtn.addEventListener('click', () => {
                    // Mock selected area
                    this.selectedArea = {
                        type: 'Polygon',
                        coordinates: [
                            [25.13, 35.34],
                            [25.14, 35.34],
                            [25.14, 35.35],
                            [25.13, 35.35],
                            [25.13, 35.34]
                        ]
                    };
                    
                    selectBtn.textContent = 'Area Selected';
                    selectBtn.disabled = true;
                });
            }
            
            console.log('Map selector initialized');
        } catch (error) {
            console.error('Error initializing map selector:', error);
        }
    }
    
    /**
     * Get the selected area from the map selector
     */
    getSelectedArea() {
        return this.selectedArea;
    }
    
    /**
     * Get analysis parameters based on analysis type
     */
    getAnalysisParameters(analysisType) {
        // Return default parameters based on analysis type
        switch (analysisType) {
            case 'satellite_imagery':
                return { 
                    startDate: '2020-01-01', 
                    endDate: '2023-01-01',
                    collection: 'LANDSAT/LC08/C02/T1_TOA'
                };
            case 'archaeological_potential':
                return {
                    variables: ['elevation', 'slope', 'distance_to_water'],
                    model: 'random_forest'
                };
            case 'change_detection':
                return {
                    baselineDate: '2018-01-01',
                    comparisonDate: '2023-01-01'
                };
            default:
                return {};
        }
    }
    
    /**
     * Create map analysis task
     */
    async createMapAnalysis(threadId, analysisType, areaOfInterest, parameters) {
        try {
            // Try to post to API
            try {
                const response = await fetch('/api/v1/maps/analysis', {
                    method: 'POST',
                    headers: this.authService ? this.authService.getAuthHeaders() : {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        thread_id: threadId,
                        type: analysisType,
                        area_of_interest: areaOfInterest,
                        parameters: parameters
                    })
                });

                if (response.ok) {
                    return await response.json();
                }
            } catch (error) {
                console.warn('API not available, using mock map analysis task');
            }
            
            // Return a mock task
            return {
                id: 'task-' + Date.now(),
                title: `${analysisType.replace('_', ' ')} Analysis`,
                status: 'PENDING',
                progress: 0,
                thread_id: threadId,
                type: 'MAP_ANALYSIS',
                created_at: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error creating map analysis task:', error);
            throw error;
        }
    }
}

// Create global instance
window.earthEngineService = new EarthEngineService();

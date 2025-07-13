import { calculateAreaBounds } from './utils.js';

// Map setup, layers, events, scan area management
export function setupMap(app) {
    const container = document.getElementById('mapContainer');
    if (!container) throw new Error('Map container not found');
    if (container._leaflet_id) {
        if (container._leaflet_map?.remove) container._leaflet_map.remove();
        while (container.firstChild) container.removeChild(container.firstChild);
        delete container._leaflet_id;
        delete container._leaflet_map;
    }
    container.style.cssText = 'width: 100%; height: 100vh; min-height: 100vh;';
    container.offsetHeight;
    if (!container.offsetWidth || !container.offsetHeight) throw new Error('Map container has no dimensions');
    app.map = L.map(container, {
        center: [20, 0], // Start with a global view
        zoom: 2,
        zoomControl: false, // Disable default zoom control
        attributionControl: true,
        minZoom: 3,
        maxZoom: 19
    });
    
    // Add custom zoom control to ensure proper functionality
    L.control.zoom({
        position: 'topleft'
    }).addTo(app.map);
    
    addBaseLayers(app);
    setupMapEvents(app);
}

function addBaseLayers(app) {
    const minZoom = 3, maxZoom = 19;
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri', minZoom, maxZoom
    }).addTo(app.map);
    const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', minZoom, maxZoom
    });
    const terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap contributors', minZoom, maxZoom: 17
    });
    L.control.layers({
        '🛰️ Satellite': satellite,
        '🗺️ Street': street,
        '🏔️ Terrain': terrain
    }, {}, { position: 'topright', collapsed: false }).addTo(app.map);
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(app.map);
}

export function setupLayers(app) {
    app.layers.patches = L.layerGroup().addTo(app.map);
    app.layers.detections = L.layerGroup().addTo(app.map);
    app.layers.animations = L.layerGroup().addTo(app.map);
}

export function setupMapEvents(app) {
    // Removed scan area selection - using task list for navigation
}

// Fetch real resolution from backend for a given area
export async function fetchResolutionForArea(lat, lon, radiusKm) {
    try {
        // For now, return a static resolution based on area size
        // TODO: Implement proper resolution endpoint in backend
        if (radiusKm <= 0.5) return '0.25m (High Resolution)';
        else if (radiusKm <= 2) return '0.5m (Medium Resolution)';
        else return '1.0m (Standard Resolution)';
    } catch (err) {
        return null;
    }
}

export function calculateScanParameters(app) {
    const zoomLevel = app.map.getZoom();
    
    // Determine area size for parameter calculation
    let areaKm;
    if (app.selectedArea?.width_km && app.selectedArea?.height_km) {
        // For rectangular areas, use the minimum dimension
        areaKm = Math.min(app.selectedArea.width_km, app.selectedArea.height_km);
    } else {
        areaKm = app.selectedArea?.radius || 1;
    }
    
    if (zoomLevel >= 16 || areaKm <= 0.5) {
        return { tileSize: 32, requestHighRes: true };
    } else if (zoomLevel >= 14 || areaKm <= 2) {
        return { tileSize: 64, requestHighRes: false };
    } else {
        return { tileSize: 128, requestHighRes: false };
    }
}

function calculateOptimalBorderWeight(app) {
    const zoom = app.map.getZoom();
    if (zoom >= 16) return 3;
    if (zoom >= 14) return 2.5;
    if (zoom >= 12) return 2;
    return 1.5;
}

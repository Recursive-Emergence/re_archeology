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
        center: [52.4751, 4.8156],
        zoom: 13,
        zoomControl: true,
        attributionControl: true
    });
    addBaseLayers(app);
    setupMapEvents(app);
    window.Logger?.map('info', 'Map initialization complete');
}

function addBaseLayers(app) {
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri', maxZoom: 19
    }).addTo(app.map);
    const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19
    });
    const terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap contributors', maxZoom: 17
    });
    L.control.layers({
        '🛰️ Satellite': satellite,
        '🗺️ Street': street,
        '🏔️ Terrain': terrain
    }, {}, { position: 'topright', collapsed: false }).addTo(app.map);
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(app.map);
}

export function setupLayers(app) {
    window.Logger?.map('info', 'Initializing layer groups...');
    app.layers.patches = L.layerGroup().addTo(app.map);
    app.layers.detections = L.layerGroup().addTo(app.map);
    app.layers.animations = L.layerGroup().addTo(app.map);
}

export function setupMapEvents(app) {
    app.map.on('click', (e) => {
        if (e.originalEvent.ctrlKey && !app.isScanning) {
            window.Logger?.map('info', 'Ctrl+Click detected, setting scan area');
            selectScanArea(app, e.latlng.lat, e.latlng.lng);
        }
    });
}

export function selectScanArea(app, lat, lon, radiusKm = 1) {
    window.Logger?.map('info', 'Setting scan area', { lat, lon, radiusKm });
    if (app.scanAreaRectangle) app.map.removeLayer(app.scanAreaRectangle);
    if (app.scanAreaLabel) app.map.removeLayer(app.scanAreaLabel);
    const bounds = calculateAreaBounds(lat, lon, radiusKm);
    const radiusInDegreesLat = radiusKm / 111.32;
    app.scanAreaRectangle = L.rectangle(bounds, {
        color: '#00ff88',
        weight: calculateOptimalBorderWeight(app),
        fillOpacity: 0,
        fill: false,
        opacity: 0.9,
        interactive: false
    }).addTo(app.map);
    const bottomRimLat = lat - radiusInDegreesLat;
    const scanLabel = L.marker([bottomRimLat, lon], {
        icon: L.divIcon({
            className: 'scan-area-label',
            html: `<div id="scan-area-label-text" style="background: rgba(0, 0, 0, 0.85); color: #00ff88; padding: 6px 12px; border-radius: 16px; font-size: 11px; font-weight: 600; border: 1px solid #00ff88; backdrop-filter: blur(6px); white-space: nowrap; transform: translateY(100%); text-align: center; box-shadow: 0 2px 8px rgba(0, 255, 136, 0.3); min-width: 120px; max-width: 200px; overflow: hidden; text-overflow: ellipsis;">📡 Scan Area (${radiusKm}km)</div>`,
            iconSize: [200, 30],
            iconAnchor: [100, 0]
        }),
        interactive: false
    }).addTo(app.map);
    app.scanAreaLabel = scanLabel;
    const updateBorder = () => {
        if (app.scanAreaRectangle) {
            app.scanAreaRectangle.setStyle({
                weight: calculateOptimalBorderWeight(app),
                color: '#00ff88',
                opacity: 0.9
            });
        }
    };
    app.map.off('zoomend', app.updateScanAreaBorder);
    app.map.on('zoomend', updateBorder);
    app.updateScanAreaBorder = updateBorder;
    app.selectedArea = { lat, lon, radius: radiusKm, bounds };
    if (app.updateButtonStates) app.updateButtonStates();
    if (app.updateUrlWithCoordinates) app.updateUrlWithCoordinates(lat, lon);
}

export function zoomToScanArea(app) {
    if (!app.selectedArea?.bounds) {
        console.warn('⚠️ No scan area selected for zooming');
        return;
    }
    const bounds = L.latLngBounds(app.selectedArea.bounds);
    app.map.fitBounds(bounds, {
        padding: [50, 50],
        maxZoom: 16,
        animate: true,
        duration: 1.0
    });
}

export function updateScanAreaLabel(app, resolution = null) {
    if (!app.scanAreaLabel) return;
    const radiusKm = app.selectedArea?.radius || 1;
    let labelText = `📡 Scan Area (${radiusKm}km)`;
    if (resolution && resolution !== 'Determining...') {
        labelText += ` • Res: ${resolution} `;
    }
    const labelElement = document.getElementById('scan-area-label-text');
    if (labelElement) labelElement.innerHTML = labelText;
}

export function calculateScanParameters(app) {
    const zoomLevel = app.map.getZoom();
    const areaKm = app.selectedArea.radius;
    if (zoomLevel >= 16 || areaKm <= 0.5) {
        return { tileSize: 32, requestHighRes: true };
    } else if (zoomLevel >= 14 || areaKm <= 2) {
        return { tileSize: 64, requestHighRes: false };
    } else {
        return { tileSize: 128, requestHighRes: false };
    }
}

export function calculateAreaBounds(lat, lon, radiusKm) {
    const radiusInDegreesLat = radiusKm / 111.32;
    const radiusInDegreesLon = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
    return [
        [lat - radiusInDegreesLat, lon - radiusInDegreesLon],
        [lat + radiusInDegreesLat, lon + radiusInDegreesLon]
    ];
}

function calculateOptimalBorderWeight(app) {
    const zoom = app.map.getZoom();
    if (zoom >= 16) return 3;
    if (zoom >= 14) return 2.5;
    if (zoom >= 12) return 2;
    return 1.5;
}

// Utility functions (coordinate calculations, DOM helpers, etc.)
export function calculateAreaBounds(lat, lon, radiusKm) {
    const radiusInDegreesLat = radiusKm / 111.32;
    const radiusInDegreesLon = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
    return [
        [lat - radiusInDegreesLat, lon - radiusInDegreesLon],
        [lat + radiusInDegreesLat, lon + radiusInDegreesLon]
    ];
}
// Add other utility functions as needed

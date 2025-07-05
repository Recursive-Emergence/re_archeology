// Utility functions (coordinate calculations, DOM helpers, etc.)
export function calculateAreaBounds(lat, lon, radiusKm, width_km = null, height_km = null) {
    if (width_km !== null && height_km !== null) {
        // Rectangular area bounds
        const halfHeightDeg = height_km / 2 / 111.32;
        const halfWidthDeg = width_km / 2 / (111.32 * Math.cos(lat * Math.PI / 180));
        return [
            [lat - halfHeightDeg, lon - halfWidthDeg],
            [lat + halfHeightDeg, lon + halfWidthDeg]
        ];
    } else {
        // Circular/square area bounds (legacy)
        const radiusInDegreesLat = radiusKm / 111.32;
        const radiusInDegreesLon = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
        return [
            [lat - radiusInDegreesLat, lon - radiusInDegreesLon],
            [lat + radiusInDegreesLat, lon + radiusInDegreesLon]
        ];
    }
}
// Add other utility functions as needed

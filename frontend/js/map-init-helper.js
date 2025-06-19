/**
 * Map initialization helper utility
 * Provides safe initialization methods for Leaflet maps
 */

class MapInitHelper {
    /**
     * Safely initialize a Leaflet map with proper error handling
     */
    static async safeMapInit(containerId, options = {}) {
        return new Promise((resolve, reject) => {
            const container = document.getElementById(containerId);
            
            if (!container) {
                reject(new Error(`Container ${containerId} not found`));
                return;
            }
            
            // Ensure container is ready
            MapInitHelper.ensureContainerReady(container);
            
            // Wait for next frame to ensure DOM is fully settled
            requestAnimationFrame(() => {
                try {
                    const map = L.map(container, {
                        center: [52.4751, 4.8156],
                        zoom: 13,
                        dragging: true,
                        touchZoom: true,
                        doubleClickZoom: true,
                        scrollWheelZoom: true,
                        boxZoom: true,
                        keyboard: true,
                        zoomControl: true,
                        attributionControl: true,
                        ...options
                    });
                    
                    console.log('✅ Map initialized successfully');
                    resolve(map);
                } catch (error) {
                    console.error('❌ Map initialization failed:', error);
                    reject(error);
                }
            });
        });
    }
    
    /**
     * Ensure container is properly sized and visible
     */
    static ensureContainerReady(container) {
        // Check if container has dimensions
        if (!container.offsetWidth || !container.offsetHeight) {
            // Apply minimal styling to ensure visibility
            if (!container.style.width) container.style.width = '100%';
            if (!container.style.height) container.style.height = '400px';
            container.style.minHeight = '400px';
            container.style.minWidth = '300px';
            container.style.display = 'block';
            
            // Force reflow
            container.offsetHeight;
        }
        
        // Final check
        if (!container.offsetWidth || !container.offsetHeight) {
            throw new Error('Container has invalid dimensions even after styling');
        }
    }
    
    /**
     * Check if a map instance is properly initialized
     */
    static validateMapInstance(map) {
        if (!map) return false;
        if (!map.getContainer) return false;
        if (!map.getContainer()) return false;
        
        try {
            map.getZoom();
            return true;
        } catch (error) {
            return false;
        }
    }
}

// Make available globally
window.MapInitHelper = MapInitHelper;

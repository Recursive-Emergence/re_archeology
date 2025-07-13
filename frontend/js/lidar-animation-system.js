/**
 * LiDAR Animation System - Clean and Coordinated Visual Effects
 * 
 * This module provides a unified animation system for LiDAR scanning visualization
 * with proper z-index layering, synchronized timing, and clean visual effects.
 */

// Animation Configuration
const ANIMATION_CONFIG = {
    // Z-Index Layers (from bottom to top)
    Z_INDEX: {
        BASE_MAP: 1,
        LIDAR_TILES: 1000,
        CACHED_OVERLAYS: 1100,
        LIDAR_CANVAS: 800,   // Lowered to be below Leaflet map layers
        SATELLITE_BEAMS: 1500,  // High z-index within Leaflet pane system
        SATELLITE_ICON: 1600,
        UI_OVERLAYS: 1700
    },
    
    // Timing Configuration
    TIMING: {
        BEAM_DURATION: 800,            // How long beam is visible
        BEAM_FADE_OUT: 150,            // Beam fade out time
        SATELLITE_ACTIVATION: 200,     // Time to activate satellite visually
        TILE_RENDER_DELAY: 100,        // Delay before tile appears
        TOTAL_CYCLE_TIME: 1000         // Total time for one scan cycle
    },
    
    // Visual Styles
    STYLES: {
        BEAM: {
            color: '#66ff88',
            weight: 2,
            opacity: 0.8,
            dashArray: '8, 4'
        },
        SATELLITE: {
            idle: {
                opacity: 0.7,
                scale: 1.0,
                filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5))'
            },
            active: {
                opacity: 1.0,
                scale: 1.2,
                filter: 'drop-shadow(0 0 12px rgba(102, 255, 136, 0.8))'
            }
        }
    }
};

/**
 * Main LiDAR Animation System Class
 */
export class LidarAnimationSystem {
    constructor(map) {
        this.map = map;
        this.isActive = false;
        this.currentAnimation = null;
        this.satelliteIcon = null;
        this.currentBeam = null;
        this.animationQueue = [];
        this.lastTileTime = null; // Track when last tile was received
        this.panesInitialized = false; // Track pane initialization
        
        // Initialize map panes with proper z-index ordering
        this.initializeMapPanes();
        
        // Create permanent satellite icon
        this.createPermanentSatelliteIcon();
        
        // Start periodic satellite state monitoring
        this.startSatelliteStateMonitoring();
        
        // Bind methods
        this.animateTileScanning = this.animateTileScanning.bind(this);
        this.moveSatelliteToPosition = this.moveSatelliteToPosition.bind(this);
        this.showScanBeam = this.showScanBeam.bind(this);
        this.hideScanBeam = this.hideScanBeam.bind(this);
    }
    
    /**
     * Initialize map panes with proper z-index layering
     */
    initializeMapPanes() {
        if (this.panesInitialized) {
            return; // Already initialized, skip
        }
        
        const panes = [
            { name: 'lidarTiles', zIndex: ANIMATION_CONFIG.Z_INDEX.LIDAR_TILES },
            { name: 'cachedOverlays', zIndex: ANIMATION_CONFIG.Z_INDEX.CACHED_OVERLAYS },
            { name: 'lidarCanvas', zIndex: ANIMATION_CONFIG.Z_INDEX.LIDAR_CANVAS },
            { name: 'satelliteBeams', zIndex: ANIMATION_CONFIG.Z_INDEX.SATELLITE_BEAMS },
            { name: 'satelliteIcon', zIndex: ANIMATION_CONFIG.Z_INDEX.SATELLITE_ICON }
        ];
        
        panes.forEach(pane => {
            if (!this.map.getPane(pane.name)) {
                this.map.createPane(pane.name);
                this.map.getPane(pane.name).style.zIndex = pane.zIndex;
                this.map.getPane(pane.name).style.pointerEvents = 'none';
            }
        });
        
        this.panesInitialized = true;
        console.log('[LIDAR-ANIMATION] Map panes initialized with proper z-index layering');
    }
    
    /**
     * Start the scanning animation system (satellite already visible, just enable beaming)
     */
    startScanning(iconType = 'satellite') {
        if (this.isActive) {
            console.log('[LIDAR-ANIMATION] Scanning already active');
            return;
        }
        
        this.isActive = true;
        
        // Update satellite icon type if needed
        this.updateSatelliteIcon(iconType);
        
        console.log(`[LIDAR-ANIMATION] Started scanning mode - satellite ready for beaming`);
    }
    
    /**
     * Stop the scanning animation system (keep satellite visible, just disable beaming)
     */
    stopScanning() {
        this.isActive = false;
        this.clearAllAnimations();
        // Don't remove satellite icon - keep it permanently visible
        this.animationQueue = [];
        
        console.log('[LIDAR-ANIMATION] Stopped scanning mode - satellite remains visible');
    }
    
    /**
     * Create permanent satellite icon (always visible)
     */
    createPermanentSatelliteIcon(iconType = 'satellite') {
        // Remove any existing satellite
        this.removeSatelliteIcon();
        
        const iconElement = document.createElement('div');
        iconElement.className = `lidar-satellite-icon ${iconType}`;
        iconElement.innerHTML = iconType === 'airplane' ? '🚁' : '🛰️';
        
        // Apply initial styles - always visible but dimmed when not connected
        iconElement.style.cssText = `
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%) scale(1.0) rotate(0deg);
            z-index: ${ANIMATION_CONFIG.Z_INDEX.SATELLITE_ICON};
            pointer-events: none;
            font-size: ${iconType === 'airplane' ? '28px' : '24px'};
            opacity: 0.5;
            filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
            transition: all 0.3s ease;
        `;
        
        // Add ID for state updates
        iconElement.id = 'satellite-icon-element';
        
        this.map.getContainer().appendChild(iconElement);
        this.satelliteIcon = iconElement;
        
        console.log('[LIDAR-ANIMATION] Permanent satellite icon created');
    }

    /**
     * Update satellite icon type (airplane vs satellite)
     */
    updateSatelliteIcon(iconType) {
        if (!this.satelliteIcon) {
            this.createPermanentSatelliteIcon(iconType);
            return;
        }
        
        const currentIconType = this.satelliteIcon.classList.contains('airplane') ? 'airplane' : 'satellite';
        
        if (iconType !== currentIconType) {
            console.log(`[LIDAR-ANIMATION] Switching from ${currentIconType} to ${iconType}`);
            
            // Update icon content and size
            this.satelliteIcon.innerHTML = iconType === 'airplane' ? '🚁' : '🛰️';
            this.satelliteIcon.className = `lidar-satellite-icon ${iconType}`;
            this.satelliteIcon.style.fontSize = iconType === 'airplane' ? '28px' : '24px';
        }
    }
    
    /**
     * Remove satellite icon cleanly
     */
    removeSatelliteIcon() {
        if (this.satelliteIcon && this.satelliteIcon.parentNode) {
            this.satelliteIcon.style.opacity = '0';
            setTimeout(() => {
                if (this.satelliteIcon && this.satelliteIcon.parentNode) {
                    this.satelliteIcon.parentNode.removeChild(this.satelliteIcon);
                }
                this.satelliteIcon = null;
            }, 200);
        }
    }
    
    /**
     * Legacy method - satellite state is now handled by updateSatelliteState()
     */
    startIdleAnimation() {
        // No longer needed - satellite state managed by updateSatelliteState()
        console.log('[LIDAR-ANIMATION] Idle animation handled by state monitoring');
    }
    
    /**
     * Animate beam scanning for a specific tile (satellite stays in place)
     */
    async animateTileScanning(tileData) {
        // Satellite is always visible, just show beam for new tiles
        if (!this.satelliteIcon) return;
        
        try {
            // Extract tile coordinates
            const { centerLat, centerLon } = this.extractTileCoordinates(tileData);
            if (!centerLat || !centerLon) {
                console.warn('[LIDAR-ANIMATION] Invalid tile coordinates');
                return;
            }
            
            // Clear any existing beam
            this.hideScanBeam();
            
            // Show scanning beam from satellite to target
            await this.showScanBeam(centerLat, centerLon);
            
            // Trigger tile rendering immediately
            this.triggerTileRendering(tileData);
            
            // Hide beam after short duration
            setTimeout(() => {
                this.hideScanBeam();
            }, ANIMATION_CONFIG.TIMING.BEAM_DURATION);
            
        } catch (error) {
            console.error('[LIDAR-ANIMATION] Error in tile beam animation:', error);
        }
    }
    
    /**
     * Extract tile coordinates from tile data
     */
    extractTileCoordinates(tileData) {
        let centerLat, centerLon;
        
        if (tileData.tile_bounds) {
            const bounds = tileData.tile_bounds;
            centerLat = (bounds.north + bounds.south) / 2;
            centerLon = (bounds.east + bounds.west) / 2;
        } else if (tileData.center_lat && tileData.center_lon) {
            centerLat = tileData.center_lat;
            centerLon = tileData.center_lon;
        } else if (tileData.lat && tileData.lon) {
            centerLat = tileData.lat;
            centerLon = tileData.lon;
        }
        
        return { centerLat, centerLon };
    }
    
    /**
     * Keep satellite fixed at top and activate scanning state
     */
    async moveSatelliteToPosition(lat, lon) {
        return new Promise((resolve) => {
            if (!this.satelliteIcon) {
                resolve();
                return;
            }
            
            const styles = ANIMATION_CONFIG.STYLES.SATELLITE.active;
            
            // Keep satellite at the top but activate it visually for scanning
            this.satelliteIcon.style.transition = `all ${ANIMATION_CONFIG.TIMING.SATELLITE_ACTIVATION}ms ease`;
            this.satelliteIcon.style.opacity = styles.opacity;
            this.satelliteIcon.style.filter = styles.filter;
            this.satelliteIcon.style.transform = 'translateX(-50%) scale(1.2)'; // Slightly larger when active
            
            setTimeout(resolve, ANIMATION_CONFIG.TIMING.SATELLITE_ACTIVATION);
        });
    }
    
    /**
     * Return satellite to idle state after scanning
     */
    returnSatelliteToIdle() {
        if (!this.satelliteIcon) return;
        
        const styles = ANIMATION_CONFIG.STYLES.SATELLITE.idle;
        
        // Return to idle state
        this.satelliteIcon.style.transition = `all 300ms ease`;
        this.satelliteIcon.style.opacity = styles.opacity;
        this.satelliteIcon.style.filter = styles.filter;
        this.satelliteIcon.style.transform = `translateX(-50%) scale(${styles.scale})`;
    }
    
    /**
     * Show scanning beam from fixed satellite position to target
     */
    async showScanBeam(lat, lon) {
        return new Promise((resolve) => {
            this.hideScanBeam(); // Clear any existing beam
            
            const mapContainer = this.map.getContainer();
            const targetPoint = this.map.latLngToContainerPoint([lat, lon]);
            const bounds = this.map.getBounds();
            
            // Calculate beam origin from satellite position (top center of map)
            const mapCenter = this.map.getCenter();
            const latSpan = bounds.getNorth() - bounds.getSouth();
            const beamOriginLat = bounds.getNorth() - latSpan * 0.05;
            const beamOriginLon = mapCenter.lng;
            const beamOrigin = this.map.latLngToContainerPoint([beamOriginLat, beamOriginLon]);
            
            // Create beam as SVG line element for better z-index control
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.style.position = 'absolute';
            svg.style.top = '0';
            svg.style.left = '0';
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.pointerEvents = 'none';
            svg.style.zIndex = '1300'; // High z-index to appear above canvas
            
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', beamOrigin.x);
            line.setAttribute('y1', beamOrigin.y);
            line.setAttribute('x2', targetPoint.x);
            line.setAttribute('y2', targetPoint.y);
            line.setAttribute('stroke', ANIMATION_CONFIG.STYLES.BEAM.color);
            line.setAttribute('stroke-width', ANIMATION_CONFIG.STYLES.BEAM.weight);
            line.setAttribute('stroke-opacity', ANIMATION_CONFIG.STYLES.BEAM.opacity);
            line.setAttribute('stroke-dasharray', ANIMATION_CONFIG.STYLES.BEAM.dashArray);
            line.style.animation = 'lidar-beam-pulse 0.5s ease-in-out infinite alternate';
            
            svg.appendChild(line);
            mapContainer.appendChild(svg);
            
            this.currentBeam = svg; // Store SVG element instead of Leaflet polyline
            
            resolve();
        });
    }
    
    /**
     * Hide scanning beam with fade effect
     */
    hideScanBeam() {
        if (this.currentBeam) {
            const beam = this.currentBeam;
            
            // Handle SVG element
            if (beam.tagName === 'svg') {
                beam.style.transition = `opacity ${ANIMATION_CONFIG.TIMING.BEAM_FADE_OUT}ms ease`;
                beam.style.opacity = '0';
                
                setTimeout(() => {
                    if (beam.parentNode) {
                        beam.parentNode.removeChild(beam);
                    }
                }, ANIMATION_CONFIG.TIMING.BEAM_FADE_OUT);
            } else {
                // Handle Leaflet polyline (legacy)
                const beamElement = beam.getElement();
                if (beamElement) {
                    beamElement.style.transition = `opacity ${ANIMATION_CONFIG.TIMING.BEAM_FADE_OUT}ms ease`;
                    beamElement.style.opacity = '0';
                }
                
                setTimeout(() => {
                    if (this.map && this.map.hasLayer(beam)) {
                        this.map.removeLayer(beam);
                    }
                }, ANIMATION_CONFIG.TIMING.BEAM_FADE_OUT);
            }
            
            this.currentBeam = null;
        }
    }
    
    /**
     * Update satellite state only - NO TILE RENDERING
     */
    triggerTileRendering(tileData) {
        // Track timing for satellite state updates
        this.lastTileTime = Date.now();
        
        // NEVER call renderLidarSubtile here - creates infinite loop!
        // Just update satellite state
        this.updateSatelliteState();
    }
    
    /**
     * Clear all current animations
     */
    clearCurrentAnimation() {
        if (this.currentAnimation) {
            clearTimeout(this.currentAnimation);
            this.currentAnimation = null;
        }
        
        if (this.idlePulseInterval) {
            clearInterval(this.idlePulseInterval);
            this.idlePulseInterval = null;
        }
    }
    
    /**
     * Clear all animations and effects
     */
    clearAllAnimations() {
        this.clearCurrentAnimation();
        this.hideScanBeam();
        
        // Clear any orphaned beams (Leaflet polylines)
        if (this.map) {
            this.map.eachLayer((layer) => {
                if (layer.options && layer.options.className === 'lidar-scan-beam') {
                    this.map.removeLayer(layer);
                }
            });
        }
        
        // Clear any orphaned SVG beams
        const mapContainer = this.map?.getContainer();
        if (mapContainer) {
            const svgBeams = mapContainer.querySelectorAll('svg[style*="z-index: 1300"]');
            svgBeams.forEach(svg => {
                if (svg.parentNode) {
                    svg.parentNode.removeChild(svg);
                }
            });
        }
    }
    
    /**
     * Update animation for resolution change
     */
    updateForResolution(resolution, isHighRes) {
        if (!this.satelliteIcon) return;
        
        const newIconType = isHighRes ? 'airplane' : 'satellite';
        const currentIconType = this.satelliteIcon.classList.contains('airplane') ? 'airplane' : 'satellite';
        
        if (newIconType !== currentIconType) {
            console.log(`[LIDAR-ANIMATION] Switching from ${currentIconType} to ${newIconType}`);
            
            // Update icon content and size
            this.satelliteIcon.innerHTML = newIconType === 'airplane' ? '🚁' : '🛰️';
            this.satelliteIcon.className = `lidar-satellite-icon ${newIconType}`;
            this.satelliteIcon.style.fontSize = newIconType === 'airplane' ? '28px' : '24px';
        }
    }
    
    /**
     * Get current animation state
     */
    getState() {
        return {
            isActive: this.isActive,
            hasIcon: !!this.satelliteIcon,
            hasBeam: !!this.currentBeam,
            queueLength: this.animationQueue.length
        };
    }

    /**
     * Update satellite visual state based on websocket connection and tiling activity
     */
    updateSatelliteState() {
        const app = window.app || window.App || window.reArchaeologyApp;
        const satelliteElement = document.getElementById('satellite-icon-element');
        
        if (!satelliteElement) return;

        let targetRotation = '0deg';
        let targetOpacity = '0.5'; // Default dimmed state
        let targetScale = '1.0';
        let targetFilter = 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))';
        
        // Check if websocket is connected
        if (app && app.websocket && app.websocket.readyState === WebSocket.OPEN) {
            // Check if we've received tiles recently (within last 3 seconds)
            const now = Date.now();
            const recentTileActivity = this.lastTileTime && (now - this.lastTileTime) < 3000;
            
            if (recentTileActivity) {
                // Active tiling: tilted and glowing (beaming activity)
                targetRotation = '-15deg';
                targetOpacity = '0.95';
                targetScale = '1.1';
                targetFilter = 'drop-shadow(0 0 12px rgba(102, 255, 136, 0.8))';
            } else {
                // Connected but no recent activity: ready state
                targetRotation = '0deg';
                targetOpacity = '0.8';
                targetScale = '1.0';
                targetFilter = 'drop-shadow(0 0 6px rgba(102, 255, 136, 0.4))';
            }
        }
        // If no websocket connection, stays in default dimmed state

        // Apply styles smoothly
        satelliteElement.style.opacity = targetOpacity;
        satelliteElement.style.transform = `translateX(-50%) scale(${targetScale}) rotate(${targetRotation})`;
        satelliteElement.style.filter = targetFilter;
    }

    /**
     * Start periodic monitoring of satellite state
     */
    startSatelliteStateMonitoring() {
        // Update satellite state every 2 seconds
        setInterval(() => {
            this.updateSatelliteState();
        }, 2000);
    }
}

// Export animation configuration for use by other modules
export { ANIMATION_CONFIG };

// Make available globally for backward compatibility
if (typeof window !== 'undefined') {
    window.LidarAnimationSystem = LidarAnimationSystem;
    window.LIDAR_ANIMATION_CONFIG = ANIMATION_CONFIG;
}
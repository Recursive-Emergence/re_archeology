// UI controls, overlays, scan/detection button states, and animations
export function setupUI(app) {
    document.getElementById('startLidarScanBtn')?.addEventListener('click', () => app.startLidarScan?.());
    document.getElementById('stopLidarScanBtn')?.addEventListener('click', () => app.stopLidarScan?.());
    document.getElementById('clearLidarScanBtn')?.addEventListener('click', () => app.clearLidarScan?.());
    document.getElementById('enableDetection')?.addEventListener('change', (e) => {
        updateScanButtonText(app, e.target.checked);
    });
    document.getElementById('chat-input-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        app.handleChatSubmit?.();
    });
    setupCoordinateLinkHandling(app);
}

function setupCoordinateLinkHandling(app) {
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (!link) return;
        const href = link.getAttribute('href');
        if (!href) return;
        const isInternal = href.startsWith('/') || href.startsWith('./') || href.startsWith('?') || (!href.includes('://') && !href.startsWith('mailto:') && !href.startsWith('tel:'));
        if (!isInternal) return;
        const url = new URL(href, window.location.origin);
        const lat = url.searchParams.get('lat');
        const lon = url.searchParams.get('lon');
        if (lat && lon) {
            e.preventDefault();
            if (app.navigateToCoordinates?.(lat, lon, true)) {
                window.Logger?.app('info', `Navigated to coordinates: ${lat}, ${lon}`);
            }
        }
    });
}

export function updateScanButtonText(app, detectionEnabled) {
    const scanButton = document.getElementById('startLidarScanBtn');
    if (scanButton) {
        scanButton.textContent = detectionEnabled ? 'Scan & Detect' : 'Scan';
    }
}

export function updateLidarScanButtonStates(app, isRunning) {
    const startBtn = document.getElementById('startLidarScanBtn');
    const stopBtn = document.getElementById('stopLidarScanBtn');
    if (startBtn && stopBtn) {
        startBtn.disabled = isRunning || !app.currentScanArea;
        stopBtn.disabled = !isRunning;
        if (isRunning) {
            startBtn.textContent = 'Scanning...';
        } else {
            const enableDetection = document.getElementById('enableDetection')?.checked || false;
            updateScanButtonText(app, enableDetection);
        }
    }
}

export function updateButtonStates(app) {
    updateLidarScanButtonStates(app, app.currentLidarSession !== null);
}

export function startScanUI(app) {
    startScanningAnimation(app, 'satellite');
    updateLidarScanButtonStates(app, true);
    const enableDetection = document.getElementById('enableDetection')?.checked || false;
    if (enableDetection) {
        app.startDetectionAnimation?.();
    }
    if (app.scanAreaRectangle) {
        app.scanAreaRectangle.setStyle({
            color: '#00ff88',
            weight: app.calculateOptimalBorderWeight?.(),
            interactive: false
        });
    }
    // Set the current scan area boundary to the active scan area
    app.currentScanArea = app.scanAreaRectangle ? { bounds: app.scanAreaRectangle.getBounds() } : null;
    app.initializeMapVisualization?.();
    if (app.mapVisualization) {
        app.mapVisualization.enableHeatmapMode?.();
    }
}

export function cleanupAfterStop(app) {
    app.isScanning = false;
    app.currentLidarSession = null;
    stopScanningAnimation(app);
    app.stopDetectionAnimation?.();
    updateButtonStates(app);
    if (app.scanAreaRectangle) {
        app.scanAreaRectangle.setStyle({
            color: '#00ff88',
            weight: app.calculateOptimalBorderWeight?.(),
            interactive: false
        });
    }
    // Clear the current scan area boundary when scan stops
    app.currentScanArea = null;
}

export function updateResolutionDisplay(app, actualResolution) {
    if (actualResolution && actualResolution !== 'Determining...') {
        app.updateScanAreaLabel?.(actualResolution);
        window.Logger?.lidar('info', `LiDAR resolution detected: ${actualResolution}`);
    }
}

export function updateAnimationForResolution(app, actualResolution, isHighResolution = null) {
    if (!app.animationState || !actualResolution) return;
    const isHighRes = isHighResolution !== null ? isHighResolution : false;
    const newIconType = isHighRes ? 'airplane' : 'satellite';
    window.Logger?.animation('info', `Resolution update: "${actualResolution}" -> ${isHighRes ? 'HIGH-RES' : 'LOW-RES'} -> ${newIconType.toUpperCase()}`);
    if (app.animationState.iconType !== newIconType) {
        window.Logger?.animation('info', `Switching icon from ${app.animationState.iconType} to ${newIconType}`);
        app.animationState.iconType = newIconType;
        app.animationState.actualResolution = actualResolution;
        if (app.scanningIcon) {
            app.scanningIcon.innerHTML = isHighRes ? '🚁' : '🛰️';
            app.scanningIcon.className = `scanning-icon ${newIconType}`;
            app.scanningIcon.style.fontSize = isHighRes ? '32px' : '28px';
        }
    }
}

export function startScanningAnimation(app, iconType = 'satellite') {
    // Only stop existing animation if we're not already in the process of starting one
    if (app.scanningIcon && app.animationState?.isActive) {
        // Already have an active animation, just update the icon type if needed
        if (app.animationState.iconType === iconType) {
            window.Logger?.animation('info', `Scanning animation already active with ${iconType} icon`);
            return;
        }
    }
    
    // Stop any existing animation
    stopScanningAnimation(app);
    
    // Add a small delay to ensure cleanup is complete before starting new animation
    setTimeout(() => {
        window.Logger?.animation('info', `Starting ${iconType} scanning animation`);
        const scanIcon = document.createElement('div');
        scanIcon.className = `scanning-icon ${iconType}`;
        scanIcon.innerHTML = iconType === 'airplane' ? '🚁' : '🛰️';
        scanIcon.style.cssText = `position: absolute; top: 20px; left: 50%; transform: translateX(-50%); z-index: 3000; pointer-events: none; font-size: ${iconType === 'airplane' ? '32px' : '28px'}; filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 8px rgba(0, 255, 136, 0.6)); transition: all 0.3s ease; opacity: 1; background: transparent; padding: 8px; border-radius: 0; border: none; box-shadow: none;`;
        app.map.getContainer().appendChild(scanIcon);
        app.scanningIcon = scanIcon;
        app.animationState = {
            tileCount: 0,
            startTime: Date.now(),
            isActive: true,
            iconType: iconType,
            isProcessingTile: false
        };
        startIdleAnimation(app, scanIcon);
    }, 50);
}

function startIdleAnimation(app, iconElement) {
    const pulseAnimation = () => {
        if (!app.scanningIcon || !app.animationState?.isActive) return;
        if (!app.animationState.isProcessingTile) {
            iconElement.style.transform = 'translateX(-50%) scale(1.1)';
            iconElement.style.opacity = '0.9';
            setTimeout(() => {
                if (app.scanningIcon && app.animationState?.isActive) {
                    iconElement.style.transform = 'translateX(-50%) scale(1)';
                    iconElement.style.opacity = '0.8';
                }
            }, 800);
        }
        if (app.animationState?.isActive) {
            setTimeout(pulseAnimation, 2000);
        }
    };
    setTimeout(pulseAnimation, 1000);
}

export function stopScanningAnimation(app) {
    if (app.animationState) {
        app.animationState.isActive = false;
    }
    
    if (app.scanningIcon) {
        app.scanningIcon.style.opacity = '0';
        setTimeout(() => {
            if (app.scanningIcon && app.scanningIcon.parentNode) {
                app.scanningIcon.parentNode.removeChild(app.scanningIcon);
            }
            app.scanningIcon = null;
        }, 200);
    }
    
    // Clean up any orphaned icons
    const mapContainer = app.map?.getContainer();
    if (mapContainer) {
        const orphanedIcons = mapContainer.querySelectorAll('.scanning-icon');
        orphanedIcons.forEach(icon => {
            if (icon.parentNode) {
                icon.parentNode.removeChild(icon);
            }
        });
    }
    
    app.animationState = null;
}

export function updateAnimationProgress(app, tileData) {
    if (!app.animationState || !app.animationState.isActive) return;
    app.animationState.tileCount++;
    let tileCenterLat, tileCenterLon;
    if (tileData?.tile_bounds) {
        const bounds = tileData.tile_bounds;
        tileCenterLat = (bounds.north + bounds.south) / 2;
        tileCenterLon = (bounds.east + bounds.west) / 2;
    } else if (tileData?.center_lat && tileData?.center_lon) {
        tileCenterLat = tileData.center_lat;
        tileCenterLon = tileData.center_lon;
    }
    if (tileCenterLat && tileCenterLon) {
        if (!app.animationState) return;
        app.animationState.isProcessingTile = true;
        drawSatelliteBeam(app, L.latLng(tileCenterLat, tileCenterLon));
        if (app.scanningIcon) {
            app.scanningIcon.classList.add('processing');
            app.scanningIcon.style.transform = 'translateX(-50%) scale(1.3)';
            app.scanningIcon.style.filter = 'drop-shadow(0 3px 6px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 15px rgba(255, 255, 255, 1))';
        }
        setTimeout(() => {
            clearSatelliteBeam(app);
            if (!app.animationState) return;
            app.animationState.isProcessingTile = false;
            if (app.scanningIcon) {
                app.scanningIcon.classList.remove('processing');
                app.scanningIcon.style.transform = 'translateX(-50%) scale(1)';
                app.scanningIcon.style.filter = 'drop-shadow(0 3px 6px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 8px rgba(255, 255, 136, 0.6))';
            }
        }, 800); // Reduced from 1200ms to 800ms to clear before satellite moves
    }
}

function drawSatelliteBeam(app, targetLatLng) {
    if (!app.map || !app.scanningIcon || !targetLatLng) return;
    if (app.satelliteBeam) app.map.removeLayer(app.satelliteBeam);

    // Create a custom pane for the beam to ensure it appears above tiles
    if (!app.map.getPane('beamPane')) {
        app.map.createPane('beamPane');
        app.map.getPane('beamPane').style.zIndex = 10000; // Much higher than tiles (2000) and snapshots (1500)
        app.map.getPane('beamPane').style.pointerEvents = 'none'; // Make sure it doesn't block mouse events
    }
    
    // Create beam from a point above the target (simulating satellite beam from orbit)
    const bounds = app.map.getBounds();
    const center = bounds.getCenter();
    
    // Calculate beam origin point north of the target area
    const beamOriginLat = targetLatLng.lat + (bounds.getNorth() - bounds.getSouth()) * 0.15; // 15% above target
    const beamOriginLng = targetLatLng.lng + (Math.random() - 0.5) * 0.002; // Slight horizontal offset for variety
    const beamOriginLatLng = L.latLng(beamOriginLat, beamOriginLng);
    
    app.satelliteBeam = L.polyline([beamOriginLatLng, targetLatLng], {
        color: '#ffff88',
        weight: 4,
        opacity: 0.9,
        dashArray: '8, 4',
        interactive: false,
        className: 'lidar-beam-orbital',
        pane: 'beamPane'
    }).addTo(app.map);
    
    if (app.satelliteBeam) {
        const beamElement = app.satelliteBeam.getElement?.();
        if (beamElement) {
            beamElement.style.animation = 'pulse-beam 0.8s ease-in-out infinite alternate';
            beamElement.style.filter = 'drop-shadow(0 0 6px rgba(255, 255, 136, 0.8))';
        }
    }
}

function clearSatelliteBeam(app) {
    if (app.satelliteBeam) {
        app.map.removeLayer(app.satelliteBeam);
        app.satelliteBeam = null;
    }
}

export function showResolutionBadge(app, resolution) {
    hideResolutionBadge(app);
    const badge = document.createElement('div');
    badge.className = 'lidar-resolution-badge';
    badge.innerHTML = `LiDAR: ${resolution}`;
    app.map.getContainer().appendChild(badge);
    app.resolutionBadge = badge;
}

export function hideResolutionBadge(app) {
    if (app.resolutionBadge) {
        app.resolutionBadge.remove();
        app.resolutionBadge = null;
    }
}

// Add this function to move the satellite icon to the current tile/subtile
export function moveSatelliteAnimationToTile(app, tileInfo) {
    if (!app || !app.map || !app.scanningIcon) return;
    const bounds = app.currentScanArea && app.currentScanArea.bounds;
    if (!bounds) return;
    // Always treat bounds as [SW, NE] and use min/max for safety
    const latMin = Math.min(bounds[0][0], bounds[1][0]);
    const latMax = Math.max(bounds[0][0], bounds[1][0]);
    const lonMin = Math.min(bounds[0][1], bounds[1][1]);
    const lonMax = Math.max(bounds[0][1], bounds[1][1]);
    const gridRows = tileInfo.gridRows || app.lidarGridRows || 10;
    const gridCols = tileInfo.gridCols || app.lidarGridCols || 5;
    const coarseRow = tileInfo.coarseRow || 0;
    const coarseCol = tileInfo.coarseCol || 0;
    const subtiles = tileInfo.subtiles || 1;
    const subtileRow = tileInfo.subtileRow || 0;
    const subtileCol = tileInfo.subtileCol || 0;
    // Compute tile bounds in scan region
    const tileLat0 = latMin + (latMax - latMin) * (coarseRow / gridRows);
    const tileLon0 = lonMin + (lonMax - lonMin) * (coarseCol / gridCols);
    const tileLat1 = latMin + (latMax - latMin) * ((coarseRow + 1) / gridRows);
    const tileLon1 = lonMin + (lonMax - lonMin) * ((coarseCol + 1) / gridCols);
    // Compute subtile center
    const fracY = (subtileRow + 0.5) / subtiles;
    const fracX = (subtileCol + 0.5) / subtiles;
    const lat = tileLat0 + (tileLat1 - tileLat0) * fracY;
    const lon = tileLon0 + (tileLon1 - tileLon0) * fracX;
    // Project to container point
    const pt = app.map.latLngToContainerPoint([lat, lon]);
    // Move the icon
    app.scanningIcon.style.left = pt.x + 'px';
    app.scanningIcon.style.top = pt.y + 'px';
    app.scanningIcon.style.transform = 'translate(-50%, -50%) scale(1.1)';
}

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
        startBtn.disabled = isRunning || !app.selectedArea;
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
    stopScanningAnimation(app);
    window.Logger?.animation('info', `Starting ${iconType} scanning animation`);
    const scanIcon = document.createElement('div');
    scanIcon.className = `scanning-icon ${iconType}`;
    scanIcon.innerHTML = iconType === 'airplane' ? '🚁' : '🛰️';
    scanIcon.style.cssText = `position: absolute; top: 20px; left: 50%; transform: translateX(-50%); z-index: 1500; pointer-events: none; font-size: ${iconType === 'airplane' ? '32px' : '28px'}; filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 8px rgba(0, 255, 136, 0.6)); transition: all 0.3s ease; opacity: 1; background: transparent; padding: 8px; border-radius: 0; border: none; box-shadow: none;`;
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
    if (app.animationState) app.animationState.isActive = false;
    if (app.scanningIcon) {
        app.scanningIcon.style.opacity = '0';
        setTimeout(() => {
            if (app.scanningIcon && app.scanningIcon.parentNode) {
                app.scanningIcon.parentNode.removeChild(app.scanningIcon);
            }
        }, 200);
        app.scanningIcon = null;
    }
    const mapContainer = app.map?.getContainer();
    if (mapContainer) {
        const orphanedIcons = mapContainer.querySelectorAll('.scanning-icon');
        orphanedIcons.forEach(icon => {
            if (icon.parentNode) icon.parentNode.removeChild(icon);
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
        }, 1200);
    }
}

function drawSatelliteBeam(app, targetLatLng) {
    if (!app.map || !app.scanningIcon || !targetLatLng) return;
    if (app.satelliteBeam) app.map.removeLayer(app.satelliteBeam);
    const mapContainer = app.map.getContainer();
    const iconCenterX = mapContainer.offsetWidth / 2 + 10;
    const iconCenterY = 60;
    const iconLatLng = app.map.containerPointToLatLng([iconCenterX, iconCenterY]);
    app.satelliteBeam = L.polyline([iconLatLng, targetLatLng], {
        color: '#ffff88',
        weight: 2,
        opacity: 0.9,
        dashArray: '10, 6',
        interactive: false,
        className: 'lidar-beam'
    }).addTo(app.map);
    if (app.satelliteBeam) {
        const beamElement = app.satelliteBeam.getElement?.();
        if (beamElement) {
            beamElement.style.animation = 'pulse-beam 0.8s ease-in-out infinite alternate';
            beamElement.style.filter = 'drop-shadow(0 0 4px rgba(0, 255, 136, 0.6))';
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

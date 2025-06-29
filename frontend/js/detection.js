// Detection animation, lens, and backend synchronization
export function startDetectionAnimation(app) {
    if (!app.detectionOverlay) {
        app.initializeDetectionOverlay?.();
    }
    const enableDetection = document.getElementById('enableDetection')?.checked || false;
    if (!enableDetection) return;
    app.detectionActive = true;
    app.detectionOverlay.classList.add('active');
    createDetectionLens(app);
    app.processedPatches = new Set();
    app.totalPatches = 0;
    if (app.detectionLens && app.selectedArea) {
        const testLat = app.selectedArea.lat;
        const testLon = app.selectedArea.lon;
        setTimeout(() => {
            if (app.detectionLens && app.map) {
                const testPoint = app.map.latLngToContainerPoint([testLat, testLon]);
                app.detectionLens.style.left = (testPoint.x - 20) + 'px';
                app.detectionLens.style.top = (testPoint.y - 20) + 'px';
            }
        }, 1000);
    }
    window.Logger?.app('info', 'Detection animation initialized - waiting for backend patch_result messages');
}

export function stopDetectionAnimation(app) {
    app.detectionActive = false;
    if (app.detectionOverlay) {
        app.detectionOverlay.classList.remove('active');
    }
    if (app.scanAnimationId) {
        clearTimeout(app.scanAnimationId);
        app.scanAnimationId = null;
    }
    if (app.detectionLens && app.detectionLens.parentNode) {
        app.detectionLens.remove();
        app.detectionLens = null;
    }
    app.processedPatches = new Set();
    app.totalPatches = 0;
    window.Logger?.app('info', 'Detection animation stopped');
}

export function handlePatchResult(app, patchData) {
    if (!app.detectionActive) {
        // console.warn('⚠️ Detection not active, ignoring patch result'); // Suppressed for clean UI
        return;
    }
    if (!app.detectionLens) {
        createDetectionLens(app);
        // console.error('❌ Failed to create detection lens'); // Suppressed for clean UI
        return;
    }
    if (app.lensTimeouts) {
        app.lensTimeouts.forEach(timeout => clearTimeout(timeout));
        app.lensTimeouts = [];
    } else {
        app.lensTimeouts = [];
    }
    const { lat, lon, confidence, is_positive, patch_size_m } = patchData;
    if (!lat || !lon) {
        // console.warn('⚠️ Invalid patch coordinates:', patchData); // Suppressed for clean UI
        return;
    }
    // Use a unique variable name for this function's screenPoint
    const patchScreenPoint = app.map.latLngToContainerPoint([lat, lon]);
    const mapContainer = app.map.getContainer();
    const mapBounds = mapContainer.getBoundingClientRect();
    const isInView = patchScreenPoint.x >= 0 && patchScreenPoint.x <= mapBounds.width && patchScreenPoint.y >= 0 && patchScreenPoint.y <= mapBounds.height;
    const originalTransition = app.detectionLens.style.transition;
    app.detectionLens.style.transition = 'all 80ms ease-in-out';
    app.detectionLens.style.left = (patchScreenPoint.x - 20) + 'px';
    app.detectionLens.style.top = (patchScreenPoint.y - 20) + 'px';
    setTimeout(() => {
        if (app.detectionLens) {
            app.detectionLens.style.transition = originalTransition;
        }
    }, 50);
    updateLensVisualFeedback(app, is_positive, confidence);
    app.processedPatches.add(`${lat},${lon}`);
    window.Logger?.app('info', `Lens moved to patch (${lat.toFixed(6)}, ${lon.toFixed(6)}) - confidence: ${confidence.toFixed(3)}`);
}

export function createDetectionLens(app) {
    if (app.detectionLens && app.detectionLens.parentNode) {
        app.detectionLens.remove();
    }
    if (!app.detectionOverlay) {
        app.initializeDetectionOverlay?.();
        if (!app.detectionOverlay) {
            return;
        }
    }
    const structureType = document.getElementById('structureType')?.value || 'windmill';
    const lensEmoji = getDetectorEmoji(structureType);
    app.detectionLens = document.createElement('div');
    app.detectionLens.className = 'detection-lens';
    app.detectionLens.textContent = lensEmoji;
    app.detectionLens.style.cssText = `
        position: absolute;
        font-size: 28px;
        z-index: 1400;
        pointer-events: none;
        transition: all 80ms ease-in-out;
        opacity: 0.85;
        filter: drop-shadow(0 0 12px rgba(0, 255, 136, 0.8)) drop-shadow(0 0 4px rgba(255, 255, 255, 0.6));
        transform: scale(1);
        background: radial-gradient(circle, rgba(0, 255, 136, 0.15) 0%, transparent 70%);
        border-radius: 50%;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: pulse 2s infinite ease-in-out;
        left: 50px;
        top: 50px;
    `;
    if (!document.getElementById('lens-pulse-style')) {
        const style = document.createElement('style');
        style.id = 'lens-pulse-style';
        style.textContent = `
            @keyframes pulse {
                0%, 100% { 
                    transform: scale(1);
                    box-shadow: 0 0 20px rgba(0, 255, 136, 0.3);
                }
                50% { 
                    transform: scale(1.1);
                    box-shadow: 0 0 30px rgba(0, 255, 136, 0.5);
                }
            }
        `;
        document.head.appendChild(style);
    }
    app.detectionOverlay.appendChild(app.detectionLens);
    window.Logger?.app('debug', 'Detection lens created with enhanced styling');
}

function getDetectorEmoji(structureType) {
    const emojis = {
        'windmill': '🔍',
        'tower': '🔍',
        'mound': '🏺',
        'generic': '🔍'
    };
    return emojis[structureType] || '🔍';
}

export function ensureDetectionLensReady(app) {
    if (!app.detectionActive) {
        startDetectionAnimation(app);
    }
    if (!app.detectionLens) {
        createDetectionLens(app);
    }
    if (app.selectedArea && app.detectionLens) {
        const screenPoint = app.map.latLngToContainerPoint([app.selectedArea.lat, app.selectedArea.lon]);
        app.detectionLens.style.left = (screenPoint.x - 20) + 'px';
        app.detectionLens.style.top = (screenPoint.y - 20) + 'px';
    }
}

export function updateLensVisualFeedback(app, isPositive, confidence) {
    if (!app.detectionLens) return;
    app.detectionLens.style.animation = 'none';
    if (isPositive && confidence > 0.7) {
        app.detectionLens.style.transform = 'scale(1.5)';
        app.detectionLens.style.filter = 'drop-shadow(0 0 20px rgba(255, 215, 0, 1)) drop-shadow(0 0 8px rgba(255, 255, 255, 1))';
        app.detectionLens.textContent = '⭐';
        const timeout1 = setTimeout(() => {
            if (app.detectionLens) {
                app.detectionLens.style.transform = 'scale(1)';
                app.detectionLens.style.filter = 'drop-shadow(0 0 12px rgba(0, 255, 136, 0.8)) drop-shadow(0 0 4px rgba(255, 255, 255, 0.6))';
                const structureType = document.getElementById('structureType')?.value || 'windmill';
                app.detectionLens.textContent = getDetectorEmoji(structureType);
            }
        }, 500);
        if (!app.lensTimeouts) app.lensTimeouts = [];
        app.lensTimeouts.push(timeout1);
    } else if (isPositive && confidence > 0.4) {
        app.detectionLens.style.transform = 'scale(1.2)';
        app.detectionLens.style.filter = 'drop-shadow(0 0 15px rgba(255, 165, 0, 0.8)) drop-shadow(0 0 6px rgba(255, 255, 255, 0.8))';
        const timeout2 = setTimeout(() => {
            if (app.detectionLens) {
                app.detectionLens.style.transform = 'scale(1)';
                app.detectionLens.style.filter = 'drop-shadow(0 0 12px rgba(0, 255, 136, 0.8)) drop-shadow(0 0 4px rgba(255, 255, 255, 0.6))';
            }
        }, 300);
        if (!app.lensTimeouts) app.lensTimeouts = [];
        app.lensTimeouts.push(timeout2);
    } else {
        app.detectionLens.style.animation = 'pulse 1s ease-in-out';
    }
}

export function completeDetectionAnimation(app) {
    if (!app.detectionLens) return;
    app.detectionLens.style.animation = 'none';
    app.detectionLens.style.transition = 'all 1s ease-out';
    app.detectionLens.style.transform = 'scale(1.5) rotate(360deg)';
    app.detectionLens.style.opacity = '1';
    app.detectionLens.style.filter = 'drop-shadow(0 0 20px rgba(0, 255, 136, 1)) drop-shadow(0 0 8px rgba(255, 255, 255, 1))';
    setTimeout(() => {
        if (app.detectionLens) {
            app.detectionLens.style.opacity = '0';
            app.detectionLens.style.transform = 'scale(0.5) rotate(360deg)';
        }
    }, 1000);
    setTimeout(() => {
        if (app.detectionLens && app.detectionLens.parentNode) {
            app.detectionLens.remove();
            app.detectionLens = null;
        }
    }, 2000);
    window.Logger?.app('info', 'Detection animation completed - synchronized with backend');
}

export function updateDetectionProfileText(app, structureType) {
    if (!app.detectionProfileText) return;
    const profileTexts = {
        'windmill': 'Analyzing Windmill Structures',
        'tower': 'Analyzing Tower Structures',
        'mound': 'Analyzing Archaeological Mounds',
        'generic': 'Analyzing Generic Structures'
    };
    app.detectionProfileText.textContent = profileTexts[structureType] || 'Analyzing Structures';
}

/**
 * Discovery Manager
 * Handles archaeological discovery operations and WebSocket communication
 */

class DiscoveryManager extends EventEmitter {
    constructor() {
        super();
        this.statusManager = new StatusManager();
        this.isScanning = false;
        this.currentSession = null;
        this.patches = new Map();
        this.stats = {
            processedPatches: 0,
            totalDetections: 0,
            highConfidenceDetections: 0
        };
        this.mapManager = null;
    }
    
    async init(mapManager) {
        this.mapManager = mapManager;
        await this.statusManager.init();
        this.setupStatusManagerEvents();
        this.setupDiscoveryControls();
    }
    
    setupStatusManagerEvents() {
        this.statusManager.on('connectionEstablished', () => {
            this.emit('connectionEstablished');
        });
        
        this.statusManager.on('disconnected', () => {
            this.emit('disconnected');
        });
        
        this.statusManager.on('sessionStarted', (session) => {
            this.currentSession = session;
            this.isScanning = true;
            this.emit('sessionStarted', session);
        });
        
        this.statusManager.on('sessionCompleted', () => {
            this.isScanning = false;
            this.emit('sessionCompleted');
        });
        
        this.statusManager.on('patchResult', (patch) => {
            this.handlePatchResult(patch);
        });
        
        this.statusManager.on('statusUpdate', (status) => {
            this.emit('statusUpdate', status);
        });
    }
    
    setupDiscoveryControls() {
        // Get current scan area from UI
        this.updateScanAreaFromUI();
        
        // Listen for scan area changes
        ['centerLat', 'centerLon', 'scanRadius'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    this.updateScanAreaFromUI();
                });
            }
        });
    }
    
    updateScanAreaFromUI() {
        const lat = parseFloat(document.getElementById('centerLat')?.value || 52.4751);
        const lon = parseFloat(document.getElementById('centerLon')?.value || 4.8156);
        const radius = parseFloat(document.getElementById('scanRadius')?.value || 2);
        
        this.scanArea = { lat, lon, radius };
        
        // Update map if available
        if (this.mapManager) {
            this.mapManager.updateScanArea(this.scanArea);
        }
    }
    
    setScanArea(bounds) {
        // Convert bounds to center point and radius
        const centerLat = (bounds.north + bounds.south) / 2;
        const centerLon = (bounds.east + bounds.west) / 2;
        
        // Calculate radius from bounds (approximate)
        const latDiff = bounds.north - bounds.south;
        const lonDiff = bounds.east - bounds.west;
        const radius = Math.max(latDiff, lonDiff) * 111.32 / 2; // Convert to km
        
        this.scanArea = {
            lat: centerLat,
            lon: centerLon,
            radius: radius
        };
        
        // Update UI
        const centerLatInput = document.getElementById('centerLat');
        const centerLonInput = document.getElementById('centerLon');
        const radiusInput = document.getElementById('scanRadius');
        
        if (centerLatInput) centerLatInput.value = centerLat.toFixed(6);
        if (centerLonInput) centerLonInput.value = centerLon.toFixed(6);
        if (radiusInput) radiusInput.value = radius.toFixed(1);
        
        // Update map
        if (this.mapManager) {
            this.mapManager.updateScanArea(this.scanArea);
        }
    }
    
    async startScan() {
        if (this.isScanning || !this.statusManager.isConnected()) {
            return;
        }
        
        this.clearResults();
        
        const config = {
            center_lat: this.scanArea.lat,
            center_lon: this.scanArea.lon,
            radius_km: this.scanArea.radius,
            patch_size_m: parseInt(document.getElementById('patchSize')?.value || '40'),
            confidence_threshold: parseFloat(document.getElementById('confidenceThreshold')?.value || '0.7'),
            max_patches: parseInt(document.getElementById('maxPatches')?.value || '100')
        };
        
        try {
            await this.statusManager.startDiscovery(config);
        } catch (error) {
            console.error('Failed to start discovery scan:', error);
            this.emit('scanError', error);
        }
    }
    
    async stopScan() {
        if (!this.statusManager.isConnected()) {
            console.warn('⚠️ Cannot stop scan: not connected');
            return;
        }
        
        console.log('🛑 Stopping discovery scan...');
        
        try {
            await this.statusManager.stopDiscovery(this.currentSession?.session_id);
            console.log('✅ Discovery scan stopped successfully');
        } catch (error) {
            console.error('❌ Failed to stop discovery scan:', error);
            this.emit('scanError', error);
        }
    }
    
    clearResults() {
        console.log('🧹 Clearing discovery results...');
        
        // Clear patches
        this.patches.clear();
        
        // Reset stats
        this.stats = {
            processedPatches: 0,
            totalDetections: 0,
            highConfidenceDetections: 0
        };
        
        // Reset session state
        this.currentSession = null;
        this.isScanning = false;
        
        // Clear map patches
        if (this.mapManager) {
            this.mapManager.clearPatches();
        }
        
        // Reset status manager state without disconnecting WebSocket
        this.statusManager.updateState({
            errors: []
        });
        
        this.emit('resultsCleared');
        
        console.log('✅ Discovery results cleared');
    }
    
    handlePatchResult(patch) {
        console.log('📊 Processing patch result:', patch.patch_id);
        
        // Store patch
        this.patches.set(patch.patch_id, patch);
        
        // Update stats
        this.updateStats();
        
        // Add to map
        if (this.mapManager) {
            this.mapManager.addPatch(patch);
        }
        
        // Emit event
        this.emit('patchDetected', patch);
    }
    
    updateStats() {
        const patchArray = Array.from(this.patches.values());
        
        this.stats.processedPatches = patchArray.length;
        this.stats.totalDetections = patchArray.filter(p => p.is_positive).length;
        this.stats.highConfidenceDetections = patchArray.filter(p => 
            p.is_positive && (p.confidence || 0) >= 0.8
        ).length;
    }
    
    // Public API
    getStats() {
        return { ...this.stats };
    }
    
    getPatches() {
        return new Map(this.patches);
    }
    
    getPatch(patchId) {
        return this.patches.get(patchId);
    }
    
    isConnected() {
        return this.statusManager.isConnected();
    }
    
    getConnectionStatus() {
        return this.statusManager.getConnectionStatus();
    }
    
    getCurrentSession() {
        return this.currentSession;
    }
    
    isCurrentlyScanning() {
        return this.isScanning;
    }
}

// Make available globally
window.DiscoveryManager = DiscoveryManager;

/**
 * Main Application Module
 * Orchestrates all components of the RE-Archaeology Framework
 */

class REArchaeologyApp {
    constructor() {
        // Core components
        this.auth = new AuthManager();
        this.discovery = new DiscoveryManager();
        this.map = new MapManager();
        this.chat = new ChatManager();
        this.ui = new UIManager();
        
        // Application state
        this.isInitialized = false;
        
        this.init();
    }
    
    async init() {
        try {
            console.log('🚀 Initializing RE-Archaeology Framework...');
            
            // Initialize configuration
            if (window.AppConfig) {
                window.AppConfig.log();
            }
            
            // Initialize components in order
            await this.initializeComponents();
            
            // Setup inter-component communication
            this.setupEventHandlers();
            
            this.isInitialized = true;
            console.log('✅ RE-Archaeology Framework initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize application:', error);
            this.ui.showError('Failed to initialize application. Please refresh the page.');
        }
    }
    
    async initializeComponents() {
        // Initialize UI first (no dependencies)
        await this.ui.init();
        
        // Initialize map (depends on UI)
        await this.map.init();
        
        // Initialize authentication (no dependencies on other components)
        await this.auth.init();
        
        // Initialize discovery (depends on map)
        await this.discovery.init(this.map);
        
        // Initialize chat (depends on auth)
        await this.chat.init(this.auth);
    }
    
    setupEventHandlers() {
        // Authentication events
        this.auth.on('loginSuccess', (user) => {
            console.log('🔐 User logged in:', user.name);
            this.chat.onUserAuthenticated(user);
            this.ui.updateHeaderUser(user);
        });
        
        this.auth.on('logout', () => {
            console.log('🚪 User logged out');
            this.chat.onUserLogout();
            this.ui.clearHeaderUser();
        });
        
        // Discovery events
        this.discovery.on('sessionStarted', (session) => {
            console.log('🔍 Discovery session started:', session.session_id);
            this.ui.updateDiscoveryStatus('scanning');
        });
        
        this.discovery.on('sessionCompleted', () => {
            console.log('✅ Discovery session completed');
            this.ui.updateDiscoveryStatus('completed');
        });
        
        this.discovery.on('patchDetected', (patch) => {
            this.map.addPatch(patch);
            this.ui.updateDetectionCounters(this.discovery.getStats());
        });
        
        // Map events
        this.map.on('areaSelected', (bounds) => {
            this.discovery.setScanArea(bounds);
        });
        
        // Compact control events from map manager
        this.map.on('lidarStart', () => {
            console.log('🌍 LiDAR tiling started');
            this.ui.updateDiscoveryStatus('lidar-tiling');
        });
        
        this.map.on('lidarPause', () => {
            console.log('🌍 LiDAR tiling paused');
            this.ui.updateDiscoveryStatus('lidar-paused');
        });
        
        this.map.on('lidarResume', () => {
            console.log('🌍 LiDAR tiling resumed');
            this.ui.updateDiscoveryStatus('lidar-tiling');
        });
        
        this.map.on('lidarStop', () => {
            console.log('🌍 LiDAR tiling stopped');
            this.ui.updateDiscoveryStatus('idle');
        });
        
        this.map.on('scanStart', () => {
            console.log('🔍 Detection scan started');
            this.discovery.startScan();
        });
        
        this.map.on('scanPause', () => {
            console.log('🔍 Detection scan paused');
            this.discovery.pauseScan();
        });
        
        this.map.on('scanResume', () => {
            console.log('🔍 Detection scan resumed');
            this.discovery.resumeScan();
        });
        
        this.map.on('scanStop', () => {
            console.log('🔍 Detection scan stopped');
            this.discovery.stopScan();
        });
        
        // UI events
        this.ui.on('startScan', () => {
            this.discovery.startScan();
        });
        
        this.ui.on('stopScan', () => {
            this.discovery.stopScan();
        });
        
        this.ui.on('clearResults', () => {
            this.discovery.clearResults();
            this.map.clearPatches();
        });
    }
    
    // Public API methods
    goToHomepage() {
        window.location.reload();
    }
    
    getAuthenticatedUser() {
        return this.auth.getCurrentUser();
    }
    
    isUserAuthenticated() {
        return this.auth.isAuthenticated();
    }
}

// Make app available globally
window.REArchaeologyApp = REArchaeologyApp;

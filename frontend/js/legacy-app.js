/**
 * Legacy Compatibility Layer
 * Maintains backwards compatibility with UnifiedREArchaeologyApp
 */

// Legacy compatibility - for backwards compatibility with old UnifiedREArchaeologyApp
class UnifiedREArchaeologyApp {
    constructor() {
        // Check dependencies
        console.log('🔧 Checking dependencies...');
        const dependencies = {
            AuthManager: typeof AuthManager !== 'undefined',
            DiscoveryManager: typeof DiscoveryManager !== 'undefined', 
            MapManager: typeof MapManager !== 'undefined',
            ChatManager: typeof ChatManager !== 'undefined',
            UIManager: typeof UIManager !== 'undefined',
            StatusManager: typeof StatusManager !== 'undefined',
            StatusUIManager: typeof StatusUIManager !== 'undefined'
        };
        
        console.log('Dependencies check:', dependencies);
        
        // Initialize core components directly without extending REArchaeologyApp
        try {
            this.auth = new AuthManager();
            this.discovery = new DiscoveryManager();
            this.map = new MapManager();
            this.chat = new ChatManager();
            this.ui = new UIManager();
        } catch (error) {
            console.error('❌ Failed to initialize core components:', error);
            // Continue with fallback initialization
        }
        
        // Application state
        this.isInitialized = false;
        
        // Initialize both discovery and chat functionality
        this.currentUser = null;
        this.isAuthenticated = false;
        this.apiBase = window.AppConfig ? window.AppConfig.apiBase : '/api/v1';
        
        // Discovery functionality
        try {
            this.statusManager = new StatusManager();
            this.statusUI = new StatusUIManager(this.statusManager);
        } catch (error) {
            console.error('❌ Failed to initialize status managers:', error);
            // Create minimal fallback
            this.statusManager = { 
                connect: () => Promise.resolve(),
                startScan: () => {},
                stopScan: () => {},
                clear: () => {}
            };
            this.statusUI = { 
                init: () => {} 
            };
        }
        this.mapInstance = null; // Renamed to avoid confusion with MapManager
        this.isScanning = false;
        this.currentSession = null;
        this.patches = new Map();
        this.scanAreaCircle = null;
        
        this.init();
    }
    
    async init() {
        try {
            console.log('Initializing unified RE-Archaeology app...');
            
            // Initialize discovery components
            await this.initDiscovery();
            
            // Initialize chat components
            this.initChat();
            
            // Setup authentication
            this.checkAuthState();
            
            console.log('✅ Unified app initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize unified app:', error);
        }
    }
    
    initChat() {
        // Initialize chat functionality
        console.log('Initializing chat...');
        // Chat functionality can be added here later
    }
    
    /**
     * Handle successful Google OAuth login
     */
    handleGoogleLogin(response) {
        console.log('🔐 Google login response received:', response);
        
        try {
            // Decode the JWT token to get user info
            const token = response.credential;
            const payload = JSON.parse(atob(token.split('.')[1]));
            
            console.log('👤 User authenticated:', payload);
            
            // Store user information
            this.currentUser = {
                id: payload.sub,
                email: payload.email,
                name: payload.name,
                picture: payload.picture,
                token: token
            };
            this.isAuthenticated = true;
            
            // Store authentication data for persistence
            this.storeAuthData(this.currentUser, token);
            
            // Update UI to show authenticated state
            this.updateAuthUI();
            
            // Show success message
            console.log('✅ Google authentication successful');
            
            // Optional: Send token to backend for verification
            // this.verifyTokenWithBackend(token);
            
        } catch (error) {
            console.error('❌ Error processing Google login:', error);
            this.handleGoogleError({ error: 'Failed to process login response' });
        }
    }
    
    /**
     * Handle Google OAuth errors
     */
    handleGoogleError(error) {
        console.error('❌ Google authentication error:', error);
        
        // Reset auth state
        this.currentUser = null;
        this.isAuthenticated = false;
        
        // Determine error message based on error type
        let errorMessage = 'Authentication failed. Please try again.';
        
        if (error && typeof error === 'object') {
            if (error.type === 'popup_closed' || error.error === 'popup_closed_by_user') {
                errorMessage = 'Sign-in popup was closed. Please try again.';
            } else if (error.type === 'popup_failed_to_open') {
                errorMessage = 'Unable to open sign-in popup. Please check your popup blocker.';
            } else if (error.error === 'access_denied') {
                errorMessage = 'Access denied. Please grant permission to continue.';
            }
        }
        
        // Show error in UI
        const loginSection = document.getElementById('login-section');
        if (loginSection) {
            // Show temporary error message
            const errorDiv = document.createElement('div');
            errorDiv.className = 'auth-error';
            errorDiv.style.cssText = `
                color: #ff6b6b;
                font-size: 12px;
                margin-top: 8px;
                padding: 8px;
                background: rgba(255, 107, 107, 0.1);
                border-radius: 4px;
                border: 1px solid rgba(255, 107, 107, 0.3);
            `;
            errorDiv.textContent = errorMessage;
            
            // Remove any existing error messages
            const existingError = loginSection.querySelector('.auth-error');
            if (existingError) {
                existingError.remove();
            }
            
            loginSection.appendChild(errorDiv);
            
            // Auto-remove error after 5 seconds
            setTimeout(() => {
                if (errorDiv.parentNode) {
                    errorDiv.remove();
                }
            }, 5000);
        }
    }
    
    /**
     * Update UI based on authentication state
     */
    updateAuthUI() {
        const loginSection = document.getElementById('login-section');
        const chatInputForm = document.getElementById('chat-input-form');
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        const userProfile = document.getElementById('user-profile');
        const chatWelcome = document.getElementById('chat-welcome');
        
        if (this.isAuthenticated && this.currentUser) {
            // Hide login section
            if (loginSection) {
                loginSection.style.display = 'none';
            }
            
            // Show and enable chat input
            if (chatInputForm) {
                chatInputForm.style.display = 'flex';
            }
            if (chatInput) {
                chatInput.disabled = false;
                chatInput.placeholder = 'Ask Bella about discoveries...';
            }
            if (sendBtn) {
                sendBtn.disabled = false;
            }
            
            // Show user profile
            if (userProfile) {
                userProfile.style.display = 'block';
                
                // Update user info
                const avatar = document.getElementById('user-avatar');
                const userName = document.getElementById('user-name');
                const userEmail = document.getElementById('user-email');
                const logoutBtn = document.getElementById('logout-btn');
                
                if (avatar) {
                    avatar.src = this.currentUser.picture || 'images/default-avatar.svg';
                    avatar.alt = this.currentUser.name || 'User';
                }
                if (userName) {
                    userName.textContent = this.currentUser.name || 'User';
                }
                if (userEmail) {
                    userEmail.textContent = this.currentUser.email || '';
                }
                if (logoutBtn) {
                    logoutBtn.style.display = 'block';
                    logoutBtn.onclick = () => this.logout();
                }
            }
            
            // Hide welcome message and show chat
            if (chatWelcome) {
                chatWelcome.style.display = 'none';
            }
            
            console.log('✅ Auth UI updated for authenticated user');
        } else {
            // Show login section
            if (loginSection) {
                loginSection.style.display = 'block';
            }
            
            // Hide or disable chat input
            if (chatInputForm) {
                chatInputForm.style.display = 'none';
            }
            if (chatInput) {
                chatInput.disabled = true;
                chatInput.placeholder = 'Please sign in to chat...';
            }
            if (sendBtn) {
                sendBtn.disabled = true;
            }
            
            // Hide user profile
            if (userProfile) {
                userProfile.style.display = 'none';
            }
            
            // Show welcome message
            if (chatWelcome) {
                chatWelcome.style.display = 'block';
            }
            
            console.log('✅ Auth UI updated for unauthenticated state');
        }
    }
    
    /**
     * Check current authentication state
     */
    checkAuthState() {
        console.log('🔍 Checking authentication state...');
        
        // Check if we have a stored auth state
        try {
            const storedAuth = localStorage.getItem('reArchaeologyAuth');
            if (storedAuth) {
                const authData = JSON.parse(storedAuth);
                if (authData && authData.token && authData.expiry && Date.now() < authData.expiry) {
                    console.log('✅ Found valid stored authentication');
                    this.currentUser = authData.user;
                    this.isAuthenticated = true;
                    this.updateAuthUI();
                    return;
                }
            }
        } catch (error) {
            console.warn('⚠️ Error reading stored auth:', error);
        }
        
        // No valid stored auth, ensure UI is in unauthenticated state
        this.updateAuthUI();
    }
    
    /**
     * Store authentication data
     */
    storeAuthData(user, token) {
        try {
            const authData = {
                user: user,
                token: token,
                expiry: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
            };
            localStorage.setItem('reArchaeologyAuth', JSON.stringify(authData));
            console.log('✅ Authentication data stored');
        } catch (error) {
            console.warn('⚠️ Failed to store auth data:', error);
        }
    }
    
    /**
     * Clear stored authentication data
     */
    clearAuthData() {
        try {
            localStorage.removeItem('reArchaeologyAuth');
            console.log('✅ Authentication data cleared');
        } catch (error) {
            console.warn('⚠️ Failed to clear auth data:', error);
        }
    }
    
    /**
     * Handle logout
     */
    logout() {
        console.log('🔓 Logging out user...');
        
        // Clear user data
        this.currentUser = null;
        this.isAuthenticated = false;
        
        // Clear stored authentication data
        this.clearAuthData();
        
        // Update UI
        this.updateAuthUI();
        
        // Optional: Sign out from Google
        if (window.google && window.google.accounts && window.google.accounts.id) {
            try {
                window.google.accounts.id.disableAutoSelect();
                console.log('✅ Google auto-select disabled');
            } catch (error) {
                console.warn('⚠️ Could not disable Google auto-select:', error);
            }
        }
        
        console.log('✅ User logged out successfully');
    }
    
    /**
     * Add missing method for header link compatibility
     */
    goToHomepage() {
        console.log('🏠 Going to homepage');
        // Reload the page or navigate to home
        window.location.reload();
    }
    
    async initDiscovery() {
        console.log('🔍 Initializing discovery functionality...');
        
        // Initialize the map component
        this.initMap();
        
        // Initialize discovery controls
        this.initDiscoveryControls();
        
        // Start status monitoring
        this.statusUI.init();
        
        // Try to establish WebSocket connection
        try {
            await this.statusManager.connect();
            console.log('✅ WebSocket connection established');
        } catch (error) {
            console.warn('⚠️ WebSocket connection failed (this is normal if no backend is running):', error);
        }
        
        console.log('✅ Discovery functionality initialized');
    }
    
    initMap() {
        console.log('🗺️ Initializing map...');
        
        // Get initial coordinates from input fields
        const centerLat = document.getElementById('centerLat')?.value || 52.4751;
        const centerLon = document.getElementById('centerLon')?.value || 4.8156;
        const scanRadius = document.getElementById('scanRadius')?.value || 2;
        
        // Create the map centered on Netherlands
        this.mapInstance = L.map('map', {
            center: [parseFloat(centerLat), parseFloat(centerLon)], // Center on Netherlands
            zoom: 12,
            minZoom: 2,
            maxZoom: 18
        });
        
        // Initialize scan area circle at startup
        this.scanAreaCircle = L.circle([parseFloat(centerLat), parseFloat(centerLon)], {
            color: '#00ff88',
            fillColor: '#00ff88',
            fillOpacity: 0.2,
            radius: parseFloat(scanRadius) * 1000 // Convert km to meters
        }).addTo(this.mapInstance);
        
        // Store initial selected area
        this.selectedArea = {
            lat: parseFloat(centerLat),
            lng: parseFloat(centerLon),
            radius: parseFloat(scanRadius) * 1000
        };
        
        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.mapInstance);
        
        // Add click handler for area selection
        this.mapInstance.on('click', (e) => {
            this.selectScanArea(e.latlng);
        });
        
        console.log('✅ Map initialized');
    }
    
    selectScanArea(latlng) {
        console.log('📍 Scan area selected:', latlng);
        
        // Remove existing scan area circle if any
        if (this.scanAreaCircle) {
            this.mapInstance.removeLayer(this.scanAreaCircle);
        }
        
        // Add new scan area circle
        this.scanAreaCircle = L.circle(latlng, {
            color: '#00ff88',
            fillColor: '#00ff88',
            fillOpacity: 0.2,
            radius: 1000 // 1km radius
        }).addTo(this.mapInstance);
        
        // Store selected coordinates
        this.selectedArea = {
            lat: latlng.lat,
            lng: latlng.lng,
            radius: 1000
        };
        
        // Update UI
        const coordsElement = document.getElementById('selected-coordinates');
        if (coordsElement) {
            coordsElement.textContent = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
        }
            
        // Enable scan button
        const scanBtn = document.getElementById('startScanBtn');
        if (scanBtn) {
            scanBtn.disabled = false;
        }
    }
    
    initDiscoveryControls() {
        console.log('🎛️ Initializing discovery controls...');
        
        // Scan button
        const scanBtn = document.getElementById('startScanBtn'); // Correct ID from HTML
        if (scanBtn) {
            scanBtn.addEventListener('click', () => {
                if (this.isScanning) {
                    this.stopScan();
                } else {
                    this.startScan();
                }
            });
        }
        
        // Stop button
        const stopBtn = document.getElementById('stopScanBtn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => this.stopScan());
        }
        
        // Clear button
        const clearBtn = document.getElementById('clearResultsBtn'); // Correct ID from HTML
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearResults());
        }
        
        console.log('✅ Discovery controls initialized');
    }
    
    async startScan() {
        if (!this.selectedArea) {
            alert('Please select a scan area on the map first.');
            return;
        }
        
        console.log('🔍 Starting archaeological scan...');
        this.isScanning = true;
        
        // Update UI
        const scanBtn = document.getElementById('startScanBtn');
        const stopBtn = document.getElementById('stopScanBtn');
        if (scanBtn) {
            scanBtn.disabled = true;
        }
        if (stopBtn) {
            stopBtn.disabled = false;
        }
        
        // Start status updates
        this.statusManager.startScan();
        
        // Simulate scan process
        this.currentSession = {
            id: Date.now(),
            startTime: new Date(),
            area: this.selectedArea,
            patches: []
        };
        
        // Simulate discovering patches over time
        this.simulateDiscovery();
    }
    
    stopScan() {
        console.log('⏹️ Stopping archaeological scan...');
        this.isScanning = false;
        
        // Update UI
        const scanBtn = document.getElementById('startScanBtn');
        const stopBtn = document.getElementById('stopScanBtn');
        if (scanBtn) {
            scanBtn.disabled = false;
        }
        if (stopBtn) {
            stopBtn.disabled = true;
        }
        
        // Stop status updates
        this.statusManager.stopScan();
        
        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
            this.discoveryInterval = null;
        }
    }
    
    simulateDiscovery() {
        // Simulate finding archaeological features over time
        this.discoveryInterval = setInterval(() => {
            if (!this.isScanning) return;
            
            // Random chance of discovery
            if (Math.random() < 0.3) {
                const patch = this.generateRandomPatch();
                this.addDiscoveredPatch(patch);
            }
        }, 2000);
    }
    
    generateRandomPatch() {
        const types = ['settlement', 'burial', 'artifact_scatter', 'structure'];
        const confidences = [0.6, 0.7, 0.8, 0.9];
        
        // Generate random position within scan area
        const offsetLat = (Math.random() - 0.5) * 0.01;
        const offsetLng = (Math.random() - 0.5) * 0.01;
        
        return {
            id: `patch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: types[Math.floor(Math.random() * types.length)],
            confidence: confidences[Math.floor(Math.random() * confidences.length)],
            position: {
                lat: this.selectedArea.lat + offsetLat,
                lng: this.selectedArea.lng + offsetLng
            },
            size: Math.floor(Math.random() * 100) + 20,
            discoveredAt: new Date()
        };
    }
    
    addDiscoveredPatch(patch) {
        console.log('🏛️ New archaeological feature discovered:', patch);
        
        // Store patch
        this.patches.set(patch.id, patch);
        if (this.currentSession) {
            this.currentSession.patches.push(patch);
        }
        
        // Add to map
        const marker = L.circleMarker([patch.position.lat, patch.position.lng], {
            color: this.getPatchColor(patch.type),
            fillColor: this.getPatchColor(patch.type),
            fillOpacity: patch.confidence,
            radius: Math.sqrt(patch.size) / 2
        }).addTo(this.mapInstance);
        
        marker.bindPopup(`
            <div class="patch-popup">
                <h4>${patch.type.replace('_', ' ').toUpperCase()}</h4>
                <p><strong>Confidence:</strong> ${(patch.confidence * 100).toFixed(0)}%</p>
                <p><strong>Size:</strong> ${patch.size}m²</p>
                <p><strong>Position:</strong> ${patch.position.lat.toFixed(6)}, ${patch.position.lng.toFixed(6)}</p>
                <button onclick="window.unifiedApp.showPatchDetails('${patch.id}')">Details</button>
            </div>
        `);
        
        // Update status
        this.statusManager.addDiscovery(patch);
    }
    
    getPatchColor(type) {
        const colors = {
            settlement: '#ff6b6b',
            burial: '#4ecdc4',
            artifact_scatter: '#45b7d1',
            structure: '#96ceb4'
        };
        return colors[type] || '#888';
    }
    
    showPatchDetails(patchId) {
        const patch = this.patches.get(patchId);
        if (!patch) return;
        
        console.log('📋 Showing patch details:', patch);
        
        // Create detailed popup or modal
        const detailsHtml = `
            <div class="patch-details">
                <h3>${patch.type.replace('_', ' ').toUpperCase()}</h3>
                <div class="detail-grid">
                    <div class="detail-item">
                        <label>Confidence:</label>
                        <span>${(patch.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <div class="detail-item">
                        <label>Size:</label>
                        <span>${patch.size}m²</span>
                    </div>
                    <div class="detail-item">
                        <label>Position:</label>
                        <span>${patch.position.lat.toFixed(6)}, ${patch.position.lng.toFixed(6)}</span>
                    </div>
                    <div class="detail-item">
                        <label>Discovered:</label>
                        <span>${patch.discoveredAt.toLocaleString()}</span>
                    </div>
                </div>
                <div class="patch-analysis">
                    <h4>Analysis</h4>
                    <p>This ${patch.type.replace('_', ' ')} shows ${patch.confidence > 0.8 ? 'strong' : 'moderate'} archaeological potential.</p>
                </div>
            </div>
        `;
        
        // Show in a modal or update a details panel
        this.showModal('Patch Details', detailsHtml);
    }
    
    showModal(title, content) {
        // Simple modal implementation
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>${title}</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    ${content}
                </div>
            </div>
        `;
        
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        
        document.body.appendChild(modal);
    }
    
    exportResults() {
        if (!this.currentSession || this.currentSession.patches.length === 0) {
            alert('No scan results to export.');
            return;
        }
        
        console.log('📤 Exporting scan results...');
        
        const data = {
            session: this.currentSession,
            patches: Array.from(this.patches.values()),
            exportTime: new Date(),
            format: 'RE-Archaeology v1.0'
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `archaeological_scan_${this.currentSession.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    clearResults() {
        if (!confirm('Are you sure you want to clear all scan results?')) {
            return;
        }
        
        console.log('🧹 Clearing scan results...');
        
        // Clear patches from map
        this.patches.forEach((patch, id) => {
            // Find and remove markers (this is simplified)
            this.mapInstance.eachLayer((layer) => {
                if (layer instanceof L.CircleMarker) {
                    this.mapInstance.removeLayer(layer);
                }
            });
        });
        
        // Clear data
        this.patches.clear();
        this.currentSession = null;
        
        // Clear status
        this.statusManager.clear();
        
        // Reset UI
        const coordsElement = document.getElementById('selected-coordinates');
        if (coordsElement) {
            coordsElement.textContent = 'None selected';
        }
        const scanBtn = document.getElementById('startScanBtn');
        if (scanBtn) {
            scanBtn.disabled = true;
        }
    }
}
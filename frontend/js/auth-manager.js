/**
 * Authentication Manager
 * Handles Google OAuth authentication and user management
 */

class AuthManager extends EventEmitter {
    constructor() {
        super();
        this.currentUser = null;
        this.isAuthenticated = false;
        this.apiBase = window.AppConfig ? window.AppConfig.apiBase : '/api/v1';
    }
    
    async init() {
        console.log('🔐 Initializing authentication...');
        
        // Setup Google OAuth configuration
        this.setupGoogleOAuth();
        
        // Check for existing authentication state
        this.checkAuthState();
        
        // Setup global callbacks for Google OAuth
        this.setupGlobalCallbacks();
        
        console.log('✅ Authentication manager initialized');
    }
    
    setupGoogleOAuth() {
        const googleOnload = document.getElementById('g_id_onload');
        if (googleOnload && window.AppConfig) {
            googleOnload.setAttribute('data-client_id', window.AppConfig.googleClientId);
        }
    }
    
    setupGlobalCallbacks() {
        // Global Google OAuth callbacks
        window.handleGoogleLogin = (response) => {
            this.handleGoogleLogin(response);
        };
        
        window.handleGoogleError = (error) => {
            this.handleGoogleError(error);
        };
    }
    
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
            
            // Update UI
            this.updateAuthUI();
            
            // Emit login success event
            this.emit('loginSuccess', this.currentUser);
            
            console.log('✅ Authentication successful');
            
        } catch (error) {
            console.error('❌ Failed to process Google login:', error);
            this.handleGoogleError(error);
        }
    }
    
    handleGoogleError(error) {
        console.error('❌ Google authentication error:', error);
        
        // Reset auth state
        this.currentUser = null;
        this.isAuthenticated = false;
        
        // Determine error message based on error type
        let errorMessage = 'Authentication failed. Please try again.';
        
        if (error && typeof error === 'object') {
            if (error.type === 'popup_closed') {
                errorMessage = 'Sign-in popup was closed. Please try again.';
            } else if (error.type === 'popup_failed_to_open') {
                errorMessage = 'Failed to open sign-in popup. Please check your popup blocker.';
            } else if (error.type === 'network_error') {
                errorMessage = 'Network error during sign-in. Please check your connection.';
            }
        }
        
        // Show error in UI
        this.showAuthError(errorMessage);
        
        // Emit error event
        this.emit('authError', error);
    }
    
    updateAuthUI() {
        const loginSection = document.getElementById('login-section');
        const chatInputForm = document.getElementById('chat-input-form');
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        const userProfile = document.getElementById('user-profile');
        const chatWelcome = document.getElementById('chat-welcome');
        
        if (this.isAuthenticated && this.currentUser) {
            // Hide login section
            if (loginSection) loginSection.style.display = 'none';
            
            // Show and enable chat input
            if (chatInputForm) chatInputForm.style.display = 'flex';
            if (chatInput) chatInput.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
            
            // Update user profile
            if (userProfile) {
                userProfile.style.display = 'flex';
                const avatar = document.getElementById('user-avatar');
                const name = document.getElementById('user-name');
                const email = document.getElementById('user-email');
                
                if (avatar) avatar.src = this.currentUser.picture || '';
                if (name) name.textContent = this.currentUser.name || 'Unknown User';
                if (email) email.textContent = this.currentUser.email || '';
            }
            
            // Update welcome message
            if (chatWelcome) {
                chatWelcome.innerHTML = `
                    <p>👋 Hi ${this.currentUser.name?.split(' ')[0] || 'there'}! I'm Bella.</p>
                    <p class="small">How can I help you with archaeological discoveries today?</p>
                `;
            }
            
            console.log('✅ Auth UI updated for authenticated user');
        } else {
            // Show login section
            if (loginSection) loginSection.style.display = 'block';
            
            // Hide and disable chat input
            if (chatInputForm) chatInputForm.style.display = 'none';
            if (chatInput) chatInput.disabled = true;
            if (sendBtn) sendBtn.disabled = true;
            
            // Hide user profile
            if (userProfile) userProfile.style.display = 'none';
            
            // Reset welcome message
            if (chatWelcome) {
                chatWelcome.innerHTML = `
                    <p>👋 Hi! I'm Bella, your AI assistant for RE-Archaeology.</p>
                    <p class="small">Sign in to start our conversation!</p>
                `;
            }
            
            console.log('✅ Auth UI updated for guest user');
        }
    }
    
    showAuthError(message) {
        const loginSection = document.getElementById('login-section');
        if (loginSection) {
            // Remove any existing error messages
            const existingError = loginSection.querySelector('.auth-error');
            if (existingError) {
                existingError.remove();
            }
            
            // Add new error message
            const errorDiv = document.createElement('div');
            errorDiv.className = 'auth-error';
            errorDiv.style.cssText = `
                color: #ff4444;
                font-size: 0.8rem;
                margin-top: 0.5rem;
                text-align: center;
                padding: 0.5rem;
                background: rgba(255, 68, 68, 0.1);
                border-radius: 4px;
                border: 1px solid rgba(255, 68, 68, 0.3);
            `;
            errorDiv.textContent = message;
            loginSection.appendChild(errorDiv);
            
            // Auto-remove error after 5 seconds
            setTimeout(() => {
                if (errorDiv.parentNode) {
                    errorDiv.remove();
                }
            }, 5000);
        }
    }
    
    logout() {
        console.log('🚪 User logging out');
        
        // Store email before clearing user data
        const userEmail = this.currentUser?.email;
        
        // Reset auth state
        this.currentUser = null;
        this.isAuthenticated = false;
        
        // Update UI
        this.updateAuthUI();
        
        // Optionally revoke Google token
        if (window.google && window.google.accounts && userEmail) {
            try {
                window.google.accounts.id.revoke(userEmail, () => {
                    console.log('✅ Google token revoked');
                });
            } catch (error) {
                console.warn('⚠️ Failed to revoke Google token:', error);
            }
        }
        
        // Emit logout event
        this.emit('logout');
        
        console.log('✅ Logout completed');
    }
    
    checkAuthState() {
        console.log('🔍 Checking authentication state...');
        
        // Check for pending Google auth from before app was ready
        if (window._pendingGoogleAuth) {
            console.log('🔄 Processing pending Google authentication');
            this.handleGoogleLogin(window._pendingGoogleAuth);
            delete window._pendingGoogleAuth;
        }
        
        // This could check for stored tokens, but for now just ensure UI is in correct state
        this.updateAuthUI();
        
        console.log('✅ Authentication state check completed');
    }
    
    // Public API
    getCurrentUser() {
        return this.currentUser;
    }
    
    isAuthenticated() {
        return this.isAuthenticated;
    }
    
    getUserToken() {
        return this.currentUser?.token;
    }
}

// Make available globally for backwards compatibility
window.AuthManager = AuthManager;

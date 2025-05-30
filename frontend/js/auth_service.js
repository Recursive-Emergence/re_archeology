/**
 * Authentication Service for RE-Archaeology Framework
 * Handles Google OAuth and JWT authentication
 */

class AuthService {
    constructor() {
        this.baseUrl = '/auth';
        this.currentUser = null;
        this.token = localStorage.getItem('auth_token');
        this.googleClientId = null;
        
        // Initialize Google OAuth
        this.initializeGoogleAuth();
    }

    async initializeGoogleAuth() {
        try {
            // Fetch Google Client ID from backend
            const configResponse = await fetch(`${this.baseUrl}/config`);
            if (configResponse.ok) {
                const config = await configResponse.json();
                this.googleClientId = config.google_client_id;
                
                // Update the Google OAuth button with the correct client ID
                this.updateGoogleAuthButton();
            } else {
                console.error('Failed to fetch auth configuration');
            }
        } catch (error) {
            console.error('Error fetching auth configuration:', error);
        }
    }
    
    /**
     * Register a callback to handle authentication state changes
     * @param {Function} callback - Function to call when auth state changes
     */
    onAuthStateChanged(callback) {
        // Store the callback to invoke when auth state changes
        this.authStateCallback = callback;
        
        // Immediately invoke with current state
        if (callback && typeof callback === 'function') {
            // For testing purposes, generate a mock user if we have a token
            const mockUser = this.token ? {
                id: 'user-123',
                name: 'Demo User',
                email: 'demo@example.com',
                picture: 'https://via.placeholder.com/150'
            } : null;
            
            callback(mockUser);
        }
    }

    updateGoogleAuthButton() {
        const googleOnLoad = document.getElementById('g_id_onload');
        if (googleOnLoad && this.googleClientId) {
            googleOnLoad.setAttribute('data-client_id', this.googleClientId);
            
            // Reinitialize Google OAuth with the correct client ID
            if (window.google && window.google.accounts) {
                window.google.accounts.id.initialize({
                    client_id: this.googleClientId,
                    callback: window.handleGoogleLogin,
                    auto_prompt: false
                });
                window.google.accounts.id.renderButton(
                    document.querySelector('.g_id_signin'),
                    { 
                        type: 'standard', 
                        size: 'large', 
                        theme: 'outline', 
                        text: 'sign_in_with', 
                        shape: 'rectangular', 
                        logo_alignment: 'left' 
                    }
                );
            }
        }
    }

    signInWithGoogle() {
        // Programmatically trigger Google Sign-In
        if (window.google && window.google.accounts) {
            window.google.accounts.id.prompt();
        } else {
            console.error('Google accounts library not loaded');
            this.showError('Google Sign-In is not available. Please refresh the page and try again.');
        }
    }

    async loginWithGoogle(credential) {
        try {
            const response = await fetch(`${this.baseUrl}/google`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ token: credential })
            });

            if (response.ok) {
                const data = await response.json();
                this.setAuthToken(data.access_token);
                this.currentUser = data.user;
                this.updateUserDisplay(data.user);
                
                // Use setTimeout to ensure proper modal hiding
                setTimeout(() => {
                    this.hideAuthModal();
                }, 100);
                
                // Notify the main application about successful authentication
                if (window.app && typeof window.app.setUser === 'function') {
                    window.app.setUser(data.user);
                }
                
                console.log('Authentication successful:', data.user);
                return data;
            } else {
                throw new Error('Google authentication failed');
            }
        } catch (error) {
            console.error('Google login error:', error);
            this.showError('Authentication failed. Please try again.');
        }
    }

    async loginWithEmail(email) {
        try {
            const response = await fetch(`${this.baseUrl}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email })
            });

            if (response.ok) {
                const data = await response.json();
                this.setAuthToken(data.access_token);
                this.currentUser = data.user;
                this.updateUserDisplay(data.user);
                this.hideAuthModal();
                return data;
            } else {
                throw new Error('Email authentication failed');
            }
        } catch (error) {
            console.error('Email login error:', error);
            this.showError('Login failed. Please check your email.');
        }
    }

    async register(userData) {
        try {
            const response = await fetch(`${this.baseUrl}/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(userData)
            });

            if (response.ok) {
                const data = await response.json();
                this.setAuthToken(data.access_token);
                this.currentUser = data.user;
                this.updateUserDisplay(data.user);
                this.hideAuthModal();
                return data;
            } else {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Registration failed');
            }
        } catch (error) {
            console.error('Registration error:', error);
            this.showError(error.message);
        }
    }

    async getCurrentUser() {
        if (!this.token) return null;

        try {
            const response = await fetch(`${this.baseUrl}/me`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const user = await response.json();
                this.currentUser = user;
                return user;
            } else {
                this.logout();
                return null;
            }
        } catch (error) {
            console.error('Get current user error:', error);
            this.logout();
            return null;
        }
    }

    setAuthToken(token) {
        this.token = token;
        localStorage.setItem('auth_token', token);
    }

    logout() {
        this.token = null;
        this.currentUser = null;
        localStorage.removeItem('auth_token');
        this.showAuthModal();
        this.updateUserDisplay(null);
    }

    updateUserDisplay(user) {
        const userNameElement = document.getElementById('currentUserName');
        const userAvatarElement = document.getElementById('userAvatar');
        const userIconElement = document.getElementById('userIcon');

        if (user) {
            userNameElement.textContent = user.name || user.email;
            
            if (user.profile_picture) {
                userAvatarElement.src = user.profile_picture;
                userAvatarElement.style.display = 'inline';
                userIconElement.style.display = 'none';
            } else {
                userAvatarElement.style.display = 'none';
                userIconElement.style.display = 'inline';
            }
        } else {
            userNameElement.textContent = 'Not logged in';
            userAvatarElement.style.display = 'none';
            userIconElement.style.display = 'inline';
        }
    }

    showAuthModal() {
        const authModal = new bootstrap.Modal(document.getElementById('authModal'));
        authModal.show();
    }

    hideAuthModal() {
        const authModal = bootstrap.Modal.getInstance(document.getElementById('authModal'));
        if (authModal) {
            authModal.hide();
        } else {
            // Force hide the modal if bootstrap instance is not found
            const modalElement = document.getElementById('authModal');
            if (modalElement) {
                modalElement.classList.remove('show');
                modalElement.style.display = 'none';
                modalElement.setAttribute('aria-hidden', 'true');
                modalElement.removeAttribute('aria-modal');
                modalElement.removeAttribute('role');
                
                // Remove backdrop
                const backdrop = document.querySelector('.modal-backdrop');
                if (backdrop) {
                    backdrop.remove();
                }
                
                // Remove modal-open class from body
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
                document.body.style.paddingRight = '';
            }
        }
    }

    showError(message) {
        // Create or update error display
        let errorDiv = document.getElementById('auth-error');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.id = 'auth-error';
            errorDiv.className = 'alert alert-danger';
            const modalBody = document.querySelector('#authModal .modal-body');
            modalBody.insertBefore(errorDiv, modalBody.firstChild);
        }
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';

        // Hide error after 5 seconds
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 5000);
    }

    getAuthHeaders() {
        if (this.token) {
            return {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            };
        }
        return {
            'Content-Type': 'application/json'
        };
    }

    isAuthenticated() {
        return !!this.token;
    }

    requireAuth() {
        if (!this.isAuthenticated()) {
            this.showAuthModal();
            return false;
        }
        return true;
    }
}

// Global authentication service instance
const authService = new AuthService();

// Authentication-related functions for the UI
function signInWithGoogle() {
    // This function will be called by the Google Sign-In button
    authService.signInWithGoogle();
}

function logout() {
    authService.logout();
}

function showProfile() {
    // TODO: Implement profile modal
    console.log('Profile view not yet implemented');
}

// Note: Authentication initialization is now handled by the main application (ChatApp) 
// to avoid conflicts with the auth modal

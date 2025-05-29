/**
 * Authentication Service for RE-Archaeology Framework
 * Handles Google OAuth and JWT authentication
 */

class AuthService {
    constructor() {
        this.baseUrl = '/api/auth';
        this.currentUser = null;
        this.token = localStorage.getItem('auth_token');
        
        // Initialize Google OAuth
        this.initializeGoogleAuth();
    }

    initializeGoogleAuth() {
        // Google OAuth callback
        window.handleGoogleLogin = (response) => {
            this.loginWithGoogle(response.credential);
        };
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
                this.hideAuthModal();
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
function loginUser() {
    const email = document.getElementById('loginEmail').value;
    if (email) {
        authService.loginWithEmail(email);
    }
}

function registerUser() {
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const role = document.getElementById('registerRole').value;

    if (name && email) {
        authService.register({ name, email, role });
    }
}

function logout() {
    authService.logout();
}

function showRegistration() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
}

function showLogin() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
}

function showProfile() {
    // TODO: Implement profile modal
    console.log('Profile view not yet implemented');
}

// Initialize authentication on page load
document.addEventListener('DOMContentLoaded', async () => {
    const user = await authService.getCurrentUser();
    if (!user) {
        authService.showAuthModal();
    } else {
        authService.updateUserDisplay(user);
    }
});

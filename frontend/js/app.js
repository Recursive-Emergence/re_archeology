/**
 * RE-Archaeology Framework - Main Application
 * Core three-pane interface for archaeological thread discussions and AI assistance
 */

class REArchaeologyApp {
    constructor() {
        this.currentUser = null;
        this.currentCategory = null;
        this.currentThread = null;
        this.isAuthenticated = false;
        this.apiBase = window.AppConfig ? window.AppConfig.apiBase : '/api/v1';
        this.categories = [];
        this.threads = {};
        
        this.init();
    }
    
    async init() {
        // Log OAuth configuration status for development
        this.logOAuthStatus();
        
        this.setupEventListeners();
        await this.loadCategories();
        this.checkAuthState();
    }
    
    logOAuthStatus() {
        console.log('%c📋 RE-Archaeology OAuth Configuration Status', 'color: #2563eb; font-weight: bold; font-size: 14px;');
        console.log(`%c   Client ID: %c${window.AppConfig?.googleClientId || 'Not configured'}`, 'color: #64748b;', 'color: #0f172a;');
        console.log(`%c   Current Origin: %c${window.location.origin}`, 'color: #64748b;', 'color: #0f172a;');
        console.log('');
        
        // Show OAuth configuration notice for localhost
        const configNotice = document.getElementById('oauth-config-notice');
        if (window.location.origin.includes('localhost') && configNotice) {
            configNotice.style.display = 'block';
            
            console.log('%c🔧 Google OAuth Setup Required:', 'color: #dc2626; font-weight: bold;');
            console.log('%c   1. Go to Google Cloud Console', 'color: #64748b;');
            console.log('%c   2. Navigate to APIs & Services → Credentials', 'color: #64748b;');
            console.log('%c   3. Add this origin to authorized JavaScript origins:', 'color: #64748b;');
            console.log(`%c      ${window.location.origin}`, 'color: #059669; background: #ecfdf5; padding: 2px 6px; border-radius: 3px;');
            console.log('%c   4. See GOOGLE_OAUTH_SETUP.md for detailed instructions', 'color: #64748b;');
            console.log('');
            console.log('%c💡 Note: Authentication will work despite 403 warnings', 'color: #0891b2; font-style: italic;');
        } else {
            console.log('%c✅ Production environment detected', 'color: #059669; font-weight: bold;');
        }
        console.log('');
    }
    
    setupEventListeners() {
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        const chatInputForm = document.getElementById('chat-input-form');
        const logoutBtn = document.getElementById('logout-btn');
        
        if (chatInput && sendBtn) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !chatInput.disabled) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
            sendBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.sendMessage();
            });
        }
        
        if (chatInputForm) {
            chatInputForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.sendMessage();
            });
        }
        
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }
    }
    
    async loadCategories() {
        try {
            const response = await fetch(`${this.apiBase}/threads/categories`);
            if (response.ok) {
                this.categories = await response.json();
                this.renderCategories();
            } else {
                throw new Error(`Failed to load categories: ${response.status}`);
            }
        } catch (error) {
            console.error('Failed to load categories:', error);
            this.showError('Failed to load discussion categories. Please check your connection.');
        }
    }
    
    renderCategories() {
        const nav = document.getElementById('categories-nav');
        if (!nav) return;
        
        nav.innerHTML = '';
        
        this.categories.forEach(category => {
            const categoryItem = document.createElement('button');
            categoryItem.className = 'category-item';
            categoryItem.innerHTML = `
                <span class="category-icon">${this.getCategoryIcon(category.name)}</span>
                ${category.name}
                <small class="thread-count">(${category.thread_count || 0})</small>
            `;
            categoryItem.addEventListener('click', () => this.selectCategory(category));
            nav.appendChild(categoryItem);
        });
    }
    
    getCategoryIcon(categoryName) {
        const icons = {
            'Maps': '🗺️',
            'Researches': '📚', 
            'Sites': '🏛️',
            'RE Theory': '🔬'
        };
        return icons[categoryName] || '📁';
    }
    
    async selectCategory(category) {
        // Update UI state
        document.querySelectorAll('.category-item').forEach(item => {
            item.classList.remove('active');
        });
        event.target.classList.add('active');
        
        this.currentCategory = category;
        this.updateContentHeader(category.name, category.description);
        
        await this.loadThreadsForCategory(category);
    }
    
    async loadThreadsForCategory(category) {
        try {
            const response = await fetch(`${this.apiBase}/threads/category/${category.id}`);
            if (response.ok) {
                const threads = await response.json();
                this.threads[category.id] = threads;
                this.renderThreads(threads);
            } else {
                throw new Error(`Failed to load threads: ${response.status}`);
            }
        } catch (error) {
            console.error('Failed to load threads:', error);
            this.showError('Failed to load threads for this category.');
        }
    }
    
    renderThreads(threads) {
        const contentDisplay = document.getElementById('content-display');
        
        if (threads.length === 0) {
            contentDisplay.innerHTML = `
                <div class="empty-state">
                    <p>No discussions found in this category.</p>
                    <p class="text-muted">Be the first to start a conversation!</p>
                </div>
            `;
            return;
        }
        
        const threadsHtml = threads.map(thread => `
            <div class="thread-item" data-thread-id="${thread.id}">
                <div class="thread-title">${thread.title}</div>
                <div class="thread-meta">
                    <span class="thread-author">by ${thread.author || 'Unknown'}</span>
                    <span class="thread-time">${this.formatDate(thread.created_at)}</span>
                </div>
            </div>
        `).join('');
        
        contentDisplay.innerHTML = `
            <div class="threads-container">
                ${threadsHtml}
            </div>
        `;
        
        // Add click handlers
        document.querySelectorAll('.thread-item').forEach(item => {
            item.addEventListener('click', () => {
                const threadId = item.dataset.threadId;
                const thread = threads.find(t => t.id === threadId);
                if (thread) this.selectThread(thread);
            });
        });
    }
    
    async selectThread(thread) {
        document.querySelectorAll('.thread-item').forEach(item => {
            item.classList.remove('active');
        });
        event.target.closest('.thread-item').classList.add('active');
        
        this.currentThread = thread;
        this.updateContentHeader(thread.title, `${this.currentCategory.name} Discussion`);
        
        await this.loadThreadDiscussion(thread);
    }
    
    async loadThreadDiscussion(thread) {
        try {
            const response = await fetch(`${this.apiBase}/threads/${thread.id}/comments`);
            if (response.ok) {
                const messages = await response.json();
                this.renderThreadDiscussion(thread, messages);
            } else {
                throw new Error(`Failed to load discussion: ${response.status}`);
            }
        } catch (error) {
            console.error('Failed to load thread discussion:', error);
            this.showError('Failed to load thread discussion.');
        }
    }
    
    renderThreadDiscussion(thread, messages) {
        const contentDisplay = document.getElementById('content-display');
        
        const messagesHtml = messages.map(msg => `
            <div class="thread-message ${msg.is_user ? 'user-message' : ''}">
                <div class="message-header">
                    <span class="message-author">${msg.author}</span>
                    <span class="message-time">${this.formatDate(msg.created_at)}</span>
                </div>
                <div class="message-content">${msg.content}</div>
            </div>
        `).join('');
        
        contentDisplay.innerHTML = `
            <div class="thread-discussion">
                <div class="discussion-header">
                    <h4>${thread.title}</h4>
                    <p class="text-muted">${messages.length} messages</p>
                </div>
                <div class="messages-container">
                    ${messagesHtml}
                </div>
                ${this.renderDiscussionInput()}
            </div>
        `;
    }
    
    renderDiscussionInput() {
        if (!this.isAuthenticated) {
            return `
                <div class="auth-required">
                    <p class="text-muted">Sign in to participate in the discussion</p>
                </div>
            `;
        }
        
        return `
            <div class="discussion-input">
                <div class="input-group">
                    <textarea id="thread-input" 
                              class="form-control" 
                              placeholder="Add to the discussion..." 
                              rows="2"></textarea>
                    <button class="btn btn-primary" onclick="window.app.addThreadMessage()">
                        Post Reply
                    </button>
                </div>
            </div>
        `;
    }
    
    async addThreadMessage() {
        const input = document.getElementById('thread-input');
        if (!input || !input.value.trim()) return;
        
        const message = input.value.trim();
        input.value = '';
        
        try {
            const response = await fetch(`${this.apiBase}/threads/${this.currentThread.id}/comments`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                },
                body: JSON.stringify({ content: message })
            });
            
            if (response.ok) {
                await this.loadThreadDiscussion(this.currentThread);
            } else {
                throw new Error(`Failed to post message: ${response.status}`);
            }
        } catch (error) {
            console.error('Failed to post message:', error);
            this.showError('Failed to post your message. Please try again.');
        }
    }
    
    updateContentHeader(title, subtitle) {
        const contentHeader = document.querySelector('.content-header h2');
        if (contentHeader) {
            contentHeader.textContent = title;
        }
    }
    
    // Authentication
    checkAuthState() {
        const token = localStorage.getItem('auth_token');
        if (token) {
            this.validateToken(token);
        }
    }
    
    async validateToken(token) {
        try {
            const response = await fetch('/auth/profile', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.ok) {
                const user = await response.json();
                this.currentUser = user;
                this.setAuthenticatedState(true);
            } else {
                localStorage.removeItem('auth_token');
                this.setAuthenticatedState(false);
            }
        } catch (error) {
            console.error('Token validation failed:', error);
            localStorage.removeItem('auth_token');
            this.setAuthenticatedState(false);
        }
    }
    
    async handleGoogleLogin(response) {
        try {
            const authResponse = await fetch('/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: response.credential })
            });
            
            if (authResponse.ok) {
                const data = await authResponse.json();
                this.currentUser = data.user;
                localStorage.setItem('auth_token', data.access_token);
                this.setAuthenticatedState(true);
                this.addChatMessage('ai', 'Welcome! I\'m Bella, your RE-Archaeology assistant.');
            } else {
                const errorData = await authResponse.json().catch(() => ({}));
                throw new Error(errorData.detail || 'Authentication failed');
            }
        } catch (error) {
            console.error('Google login failed:', error);
            let errorMessage = 'Authentication failed. Please try again.';
            
            if (error.message.includes('origin') || error.message.includes('authorized')) {
                errorMessage = 'Google OAuth configuration issue. Please check console for details.';
            }
            
            this.showError(errorMessage);
        }
    }
    
    handleGoogleError(error) {
        console.error('Google Sign-In Error:', error);
        
        // Don't show UI errors for configuration issues that don't block functionality
        if (error.type === 'popup_closed') {
            this.showError('Sign-in was cancelled. Please try again.');
        } else if (error.type === 'popup_failed_to_open') {
            this.showError('Unable to open sign-in window. Please check your popup blocker settings.');
        } else {
            // Log configuration issues but don't show disruptive UI errors
            console.warn('🔧 Google OAuth Configuration Issue Detected:');
            console.warn('   This is a non-blocking configuration warning.');
            console.warn('   Sign-in functionality may still work.');
            console.warn('   See GOOGLE_OAUTH_SETUP.md for configuration instructions.');
            
            // Only show error if sign-in actually fails
            if (error.type && error.type !== 'idpiframe_initialization_failed') {
                this.showError(`
                    <strong>Google OAuth Configuration Issue</strong><br>
                    The application needs to be configured in Google Cloud Console.<br>
                    <details style="margin-top: 10px;">
                        <summary style="cursor: pointer; color: var(--primary-color);">Configuration Instructions</summary>
                        <ol style="text-align: left; margin: 10px 0; padding-left: 20px; font-size: 0.85rem;">
                            <li>Go to <a href="https://console.cloud.google.com/" target="_blank">Google Cloud Console</a></li>
                            <li>Navigate to "APIs & Services" → "Credentials"</li>
                            <li>Find the OAuth 2.0 Client ID: <code>555743158084-ribsom4oerhv0jgohosoit190p8bh72n</code></li>
                            <li>Add <code>${window.location.origin}</code> to "Authorized JavaScript origins"</li>
                            <li>Save the changes and try signing in again</li>
                        </ol>
                    </details>
                `);
            }
        }
    }
    
    setAuthenticatedState(isAuth) {
        this.isAuthenticated = isAuth;
        
        const userProfileSection = document.getElementById('user-profile');
        const loginSection = document.getElementById('login-section');
        const chatWelcome = document.getElementById('chat-welcome');
        const chatInputForm = document.getElementById('chat-input-form');
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        const logoutBtn = document.getElementById('logout-btn');
        
        if (isAuth && this.currentUser) {
            // Hide login, show user profile at bottom
            loginSection.style.display = 'none';
            userProfileSection.style.display = 'block';
            chatWelcome.style.display = 'none';
            chatInputForm.style.display = 'flex';
            
            // Populate user info
            document.getElementById('user-name').textContent = this.currentUser.name;
            document.getElementById('user-email').textContent = this.currentUser.email;
            document.getElementById('user-avatar').src = this.currentUser.profile_picture || '/images/default-avatar.svg';
            if (logoutBtn) logoutBtn.style.display = 'block';
            
            // Enable chat input
            if (chatInput) chatInput.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
        } else {
            // Show login, hide user profile
            loginSection.style.display = 'block';
            userProfileSection.style.display = 'none';
            chatWelcome.style.display = 'block';
            chatInputForm.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'none';
            
            // Disable chat input
            if (chatInput) chatInput.disabled = true;
            if (sendBtn) sendBtn.disabled = true;
        }
        
        // Refresh current view
        if (this.currentThread) {
            this.loadThreadDiscussion(this.currentThread);
        }
    }
    
    async logout() {
        try {
            await fetch('/auth/logout', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
            });
        } catch (error) {
            console.warn('Logout request failed:', error);
        }
        
        this.currentUser = null;
        localStorage.removeItem('auth_token');
        this.setAuthenticatedState(false);
        
        const chatMessages = document.getElementById('chat-messages');
        chatMessages.innerHTML = `
            <div class="chat-welcome" id="chat-welcome">
                <p>👋 Hi! I'm Bella, your AI assistant for RE-Archaeology.</p>
                <p class="small">Sign in to start our conversation!</p>
            </div>
        `;
    }
    
    // AI Chat
    async sendMessage() {
        const input = document.getElementById('chat-input');
        if (!input || !input.value.trim()) return;
        
        const message = input.value.trim();
        input.value = '';
        
        this.addChatMessage('user', message);
        
        try {
            const response = await fetch(`${this.apiBase}/ai/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                },
                body: JSON.stringify({
                    message: message,
                    context: {
                        current_thread: this.currentThread?.id,
                        current_category: this.currentCategory?.id
                    }
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                this.addChatMessage('ai', data.response);
            } else {
                throw new Error(`AI chat failed: ${response.status}`);
            }
        } catch (error) {
            console.error('AI chat error:', error);
            this.addChatMessage('ai', 'Sorry, I\'m having trouble connecting right now. Please try again later.');
        }
    }
    
    addChatMessage(type, content) {
        const chatMessages = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.innerHTML = `
            <div class="message-content">${content}</div>
            <div class="message-time">${new Date().toLocaleTimeString()}</div>
        `;
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    // Utilities
    formatDate(dateString) {
        if (!dateString) return 'Unknown';
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }
    
    showError(message) {
        const contentDisplay = document.getElementById('content-display');
        contentDisplay.innerHTML = `
            <div class="error-state">
                <p class="text-danger">${message}</p>
                <button class="btn btn-secondary" onclick="location.reload()">Refresh Page</button>
            </div>
        `;
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    window.app = new REArchaeologyApp();
});

// Google OAuth callback
window.handleGoogleLogin = function(response) {
    if (window.app) {
        window.app.handleGoogleLogin(response);
    }
};

window.REArchaeologyApp = REArchaeologyApp;

// Suppress Google OAuth console warnings (non-blocking errors)
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.error = function(...args) {
    const message = args.join(' ');
    // Filter out known Google OAuth warnings that don't affect functionality
    if (message.includes('Cross-Origin-Opener-Policy') || 
        message.includes('GSI_LOGGER') || 
        message.includes('accounts.google.com')) {
        return; // Suppress these specific warnings
    }
    originalConsoleError.apply(console, args);
};

console.warn = function(...args) {
    const message = args.join(' ');
    if (message.includes('Cross-Origin-Opener-Policy') || 
        message.includes('GSI_LOGGER')) {
        return; // Suppress these specific warnings
    }
    originalConsoleWarn.apply(console, args);
};

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
        console.log('🔧 RE-Archaeology Framework - Configuration Check');
        console.log(`📍 Current Origin: ${window.location.origin}`);
        console.log(`🔑 Google Client ID: ${this.config?.googleClientId || 'Loading...'}`);
        console.log('');
        console.log('📋 Google OAuth Setup Requirements:');
        console.log('1. Go to Google Cloud Console');
        console.log('2. Navigate to APIs & Services > Credentials');
        console.log(`3. Add ${window.location.origin} to authorized origins`);
        console.log('4. If using different ports, add them all (e.g., :3000, :8080, :8081)');
        console.log('');
        
        this.setupEventListeners();
        await this.loadCategories();
        this.checkAuthState();
    }
    
    setupEventListeners() {
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        const logoutBtn = document.getElementById('logout-btn');
        
        if (chatInput && sendBtn) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !chatInput.disabled) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
            sendBtn.addEventListener('click', () => this.sendMessage());
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
        
        if (error.type === 'popup_blocked_by_browser') {
            this.showError('Pop-up blocked. Please allow pop-ups for this site and try again.');
        } else if (error.type === 'popup_closed_by_user') {
            this.showError('Sign-in cancelled.');
        } else if (error.details && error.details.includes('Not a valid origin')) {
            this.showError(`
                <div>
                    <strong>Google OAuth Configuration Required</strong><br>
                    The current origin (${window.location.origin}) is not authorized.<br>
                    Please add <code>${window.location.origin}</code> to the authorized origins in Google Cloud Console.<br>
                    <small>OAuth Client ID: ${window.AppConfig?.googleClientId || 'Check console for details'}</small>
                </div>
            `);
        } else {
            this.showError('Sign-in failed. Please try again.');
        }
    }
    
    setAuthenticatedState(isAuth) {
        this.isAuthenticated = isAuth;
        
        const userProfile = document.getElementById('user-profile');
        const loginSection = document.getElementById('login-section');
        const chatWelcome = document.getElementById('chat-welcome');
        const chatInputForm = document.getElementById('chat-input-form');
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        
        if (isAuth && this.currentUser) {
            userProfile.style.display = 'flex';
            loginSection.style.display = 'none';
            chatWelcome.style.display = 'none';
            chatInputForm.style.display = 'flex';
            
            document.getElementById('user-name').textContent = this.currentUser.name;
            document.getElementById('user-email').textContent = this.currentUser.email;
            document.getElementById('user-avatar').src = this.currentUser.profile_picture || '/images/default-avatar.svg';
            document.getElementById('logout-btn').style.display = 'block';
            
            if (chatInput) chatInput.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
        } else {
            userProfile.style.display = 'none';
            loginSection.style.display = 'block';
            chatWelcome.style.display = 'block';
            chatInputForm.style.display = 'none';
            document.getElementById('logout-btn').style.display = 'none';
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
            const response = await fetch(`${this.apiBase}/ai-chat/message`, {
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

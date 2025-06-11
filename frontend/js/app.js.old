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
        try {
            // Log OAuth configuration status for development
            this.logOAuthStatus();
            
            this.setupEventListeners();
            await this.loadCategories();
            this.checkAuthState();
            
            // Load Amazon Basin map as homepage default
            console.log('Initializing homepage map...');
            await this.loadAmazonBasinMap();
            
        } catch (error) {
            console.error('App initialization error:', error);
            
            // Show fallback content if map loading fails
            const contentDisplay = document.getElementById('content-display');
            if (contentDisplay) {
                contentDisplay.innerHTML = `
                    <div class="welcome-state">
                        <h2>Welcome to RE-Archaeology Framework</h2>
                        <p>Archaeological AI Assistant and Discussion Platform</p>
                        <p class="text-muted">Select a category from the sidebar to begin.</p>
                        ${error.message.includes('Leaflet') || error.message.includes('map') ? 
                            '<p><small>Note: Map features may be temporarily unavailable.</small></p>' : ''}
                    </div>
                `;
            }
        }
    }
    
    async waitForLeaflet() {
        // Wait for Leaflet to be available
        const maxWait = 10000; // 10 seconds max (increased from 5)
        const start = Date.now();
        
        while (!window.L && (Date.now() - start) < maxWait) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        if (!window.L) {
            console.error('Leaflet not loaded after 10 seconds');
            throw new Error('Leaflet library not available');
        }
        
        // Additional check to ensure Leaflet is fully initialized
        if (typeof window.L.map !== 'function') {
            console.error('Leaflet loaded but not fully functional');
            throw new Error('Leaflet library not fully initialized');
        }
        
        console.log('Leaflet loaded and ready');
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
        
        // Restore the content header when navigating to a category (in case we were in map view)
        const contentHeader = document.querySelector('.content-header');
        if (contentHeader) {
            contentHeader.style.opacity = '1';
            contentHeader.style.height = 'auto';
            contentHeader.style.overflow = 'visible';
            contentHeader.style.padding = '1rem 1.5rem';
            contentHeader.style.borderBottom = '1px solid var(--border-color)';
        }
        
        // Load threads for all categories (removed special Sites map handling)
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
        
        // Add padding class for thread view
        contentDisplay.className = 'has-threads';
        
        // Add "Add new topic" button
        const addTopicButton = `
            <div class="add-topic-section">
                <button class="btn btn-primary add-topic-btn" onclick="window.app.showNewTopicForm()">
                    <i class="fas fa-plus"></i> Add a new topic
                </button>
            </div>
        `;
        
        if (threads.length === 0) {
            contentDisplay.innerHTML = `
                ${addTopicButton}
                <div class="empty-state">
                    <p>No discussions found in this category.</p>
                    <p class="text-muted">Be the first to start a conversation!</p>
                </div>
            `;
            return;
        }
        
        const threadsHtml = threads.map(thread => `
            <div class="thread-item" data-thread-id="${thread.id}">
                <div class="thread-header">
                    <div class="thread-title">${thread.title}</div>
                    <div class="thread-meta">
                        <span class="thread-author">by ${thread.starter_user_name || thread.author || 'Anonymous'}</span>
                        <span class="thread-date">${this.formatDate(thread.created_at)}</span>
                    </div>
                </div>
                <div class="thread-preview">
                    ${thread.content ? thread.content.substring(0, 150) + '...' : 'No content preview'}
                </div>
                <div class="thread-stats">
                    <span class="replies-count">${thread.reply_count || 0} replies</span>
                    <span class="last-activity">Last activity: ${this.formatDate(thread.updated_at || thread.created_at)}</span>
                </div>
            </div>
        `).join('');
        
        contentDisplay.innerHTML = `
            ${addTopicButton}
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
        
        // Ensure the content header is visible when viewing thread discussions
        const contentHeader = document.querySelector('.content-header');
        if (contentHeader) {
            contentHeader.style.opacity = '1';
            contentHeader.style.height = 'auto';
            contentHeader.style.overflow = 'visible';
            contentHeader.style.padding = '1rem 1.5rem';
            contentHeader.style.borderBottom = '1px solid var(--border-color)';
        }
        
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
        
        const messagesHtml = messages.map(msg => {
            // Use author_name from backend or fall back to current user name
            let authorName = msg.author_name || msg.author || 'Anonymous';
            if (msg.is_user && this.currentUser) {
                authorName = this.currentUser.name;
            }
            
            return `
                <div class="thread-message ${msg.is_user ? 'user-message' : ''}">
                    <div class="message-header">
                        <span class="message-author">${authorName}</span>
                        <span class="message-time">${this.formatDate(msg.created_at)}</span>
                    </div>
                    <div class="message-content">${msg.content}</div>
                </div>
            `;
        }).join('');
        
        contentDisplay.innerHTML = `
            <div class="thread-discussion">
                <div class="discussion-header">
                    <button class="btn btn-outline-secondary back-to-threads" 
                            onclick="window.app.loadThreadsForCategory(window.app.currentCategory)">
                        ← Back to ${this.currentCategory?.name || 'Discussions'}
                    </button>
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
    
    showNewTopicForm() {
        if (!this.isAuthenticated) {
            this.showError('Please sign in to create a new topic.');
            return;
        }
        
        const contentDisplay = document.getElementById('content-display');
        contentDisplay.innerHTML = `
            <div class="new-topic-form">
                <div class="form-header">
                    <h4>Create New Topic in ${this.currentCategory?.name || 'Category'}</h4>
                    <button class="btn btn-secondary" onclick="window.app.loadThreadsForCategory(window.app.currentCategory)">
                        Cancel
                    </button>
                </div>
                <form id="new-topic-form">
                    <div class="form-group">
                        <label for="topic-title">Topic Title *</label>
                        <input type="text" id="topic-title" class="form-control" 
                               placeholder="Enter a descriptive title..." required>
                    </div>
                    <div class="form-group">
                        <label for="topic-content">Initial Post *</label>
                        <textarea id="topic-content" class="form-control" rows="6" 
                                  placeholder="Start the discussion..." required></textarea>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary">Create Topic</button>
                        <button type="button" class="btn btn-secondary" 
                                onclick="window.app.loadThreadsForCategory(window.app.currentCategory)">
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        `;
        
        // Add form submission handler
        document.getElementById('new-topic-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createNewTopic();
        });
    }
    
    async createNewTopic() {
        const title = document.getElementById('topic-title').value.trim();
        const content = document.getElementById('topic-content').value.trim();
        
        if (!title || !content) {
            this.showError('Please fill in both title and content.');
            return;
        }
        
        try {
            const response = await fetch(`${this.apiBase}/threads`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                },
                body: JSON.stringify({
                    title: title,
                    content: content,
                    category_id: this.currentCategory.id
                })
            });
            
            if (response.ok) {
                const newThread = await response.json();
                // Refresh the category view to show the new thread
                await this.loadThreadsForCategory(this.currentCategory);
                // Optionally, automatically open the new thread
                // await this.loadThread(newThread.id);
            } else {
                throw new Error(`Failed to create topic: ${response.status}`);
            }
        } catch (error) {
            console.error('Failed to create topic:', error);
            this.showError('Failed to create new topic. Please try again.');
        }
    }
    
    updateContentHeader(title, subtitle) {
        const contentHeader = document.querySelector('.content-header h2');
        if (contentHeader) {
            contentHeader.textContent = title;
        }
    }
    
    goToHomepage() {
        // Clear any active category selection
        document.querySelectorAll('.category-item').forEach(item => {
            item.classList.remove('active');
        });
        
        this.currentCategory = null;
        this.currentThread = null;
        
        // Load the homepage map
        this.loadAmazonBasinMap();
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
    
    async loadAmazonBasinMap() {
        try {
            // Ensure Leaflet is available before proceeding
            if (!window.L) {
                console.log('Leaflet not available, waiting...');
                await this.waitForLeaflet();
            }
            
            // Update the main content header, but we'll also add an in-map title that doesn't move
            this.updateContentHeader('Global Archaeological Map', 'Worldwide Site Discovery & Analysis - Amazon Basin Showcase');
            
            // Get content display and map container
            const contentDisplay = document.getElementById('content-display');
            
            if (!contentDisplay) {
                console.error('Content display not found');
                throw new Error('Map container not found in DOM');
            }
            
            // Clean up existing map instance if it exists
            if (this.amazonBasinMap) {
                try {
                    this.amazonBasinMap.remove();
                    console.log('Existing map removed');
                } catch (e) {
                    console.warn('Error removing existing map:', e);
                }
                this.amazonBasinMap = null;
            }
            
            // Clear any global Leaflet state
            if (window.L && window.L._container) {
                delete window.L._container;
            }
            
            // Force complete cleanup of any existing map containers
            const existingMapContainers = contentDisplay.querySelectorAll('[id*="map"]');
            existingMapContainers.forEach(container => {
                // Remove all Leaflet-specific properties
                if (container._leaflet_id) {
                    delete container._leaflet_id;
                }
                if (container._leaflet) {
                    delete container._leaflet;
                }
                // Clear all attributes that might interfere
                const attrs = container.attributes;
                for (let i = attrs.length - 1; i >= 0; i--) {
                    if (attrs[i].name.startsWith('_leaflet')) {
                        container.removeAttribute(attrs[i].name);
                    }
                }
                // Remove any event listeners by cloning
                const newContainer = container.cloneNode(false);
                if (container.parentNode) {
                    container.parentNode.replaceChild(newContainer, container);
                }
            });
            
            // Additional cleanup - remove any existing map containers
            const existingMaps = contentDisplay.querySelectorAll('[id^="amazon-basin-map"], [id^="netherlands-map"]');
            existingMaps.forEach(mapEl => {
                if (mapEl._leaflet_id) {
                    // Force cleanup of Leaflet internals
                    delete mapEl._leaflet_id;
                }
            });
            
            // Remove thread padding class for map view
            contentDisplay.className = '';
            
            // Hide the standard content header for map view to avoid redundancy with our in-map title
            const contentHeader = document.querySelector('.content-header');
            if (contentHeader) {
                contentHeader.style.opacity = '0'; // Make it invisible
                contentHeader.style.height = '0';  // Remove its height completely
                contentHeader.style.overflow = 'hidden';
                contentHeader.style.padding = '0';
                contentHeader.style.borderBottom = 'none';
                contentHeader.style.position = 'absolute'; // Take it out of the flow
            }
            
            // Use a consistent map ID instead of unique timestamp
            const mapId = 'amazon-basin-map';
            
            // Completely clear and recreate the content using DOM methods for better reliability
            contentDisplay.innerHTML = '';  // Clear first
            
            // Create map container using DOM methods
            const mapContainer = document.createElement('div');
            mapContainer.className = 'map-container';
            mapContainer.style.cssText = 'display: flex; flex-direction: column; width: 100%; height: 100%; flex: 1;';
            
            // Create a fixed map title that won't move when dragging the map
            const mapTitle = document.createElement('div');
            mapTitle.className = 'map-title';
            mapTitle.innerHTML = `
                <h3>Global Archaeological Map</h3>
                <p>Amazon Basin Analysis</p>
            `;
            
            // Create controls - simplified to only show relevant toggles
            const mapControls = document.createElement('div');
            mapControls.className = 'map-controls';
            mapControls.innerHTML = `
                <button id="btn-sites" onclick="window.reApp.toggleLayer('potentialareasarchaeological')">🏛️ Toggle Archaeological Sites</button>
                <button id="btn-vegetation" onclick="window.reApp.toggleLayer('ndvi')">🌿 Toggle Vegetation Analysis</button>
            `;
            
            // Create a simplified legend - only showing toggleable items
            const mapLegend = document.createElement('div');
            mapLegend.className = 'map-legend';
            mapLegend.innerHTML = `
                <strong>Amazon Basin Map</strong><br>
                <small>Archaeological Analysis</small>
                <hr style="margin: 5px 0; border-color: rgba(255,255,255,0.3);">
                <div class="legend-item">
                    <span class="legend-color" style="background-color: orange; opacity: 0.8"></span>
                    <span>Archaeological Sites</span>
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background: linear-gradient(to right, red, yellow, green);"></span>
                    <span>Vegetation Analysis</span>
                </div>
            `;
            
            // Create map element - ensuring it fills the available space
            const mapElement = document.createElement('div');
            mapElement.id = mapId;
            mapElement.style.cssText = 'width: 100%; height: 100%; flex: 1; min-height: calc(100vh - 120px);';
            
            // Assemble the structure
            mapContainer.appendChild(mapTitle); // Add the fixed title
            mapContainer.appendChild(mapControls);
            mapContainer.appendChild(mapLegend);
            mapContainer.appendChild(mapElement);
            contentDisplay.appendChild(mapContainer);
            
            // Force DOM update
            await new Promise(resolve => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(resolve);
                });
            });
            
            // Verify map container exists
            const finalMapElement = document.getElementById(mapId);
            if (!finalMapElement) {
                console.error('Map element still not found after DOM creation');
                console.error('Content display HTML:', contentDisplay.innerHTML);
                throw new Error(`Map element '${mapId}' not found after DOM creation`);
            }
            
            console.log('Map element successfully created:', finalMapElement);
            
            // Fetch map data from Earth Engine API
            console.log('Fetching map data from API...');
            const response = await fetch(`${this.apiBase}/earth-engine/amazon-basin-map`);
            if (!response.ok) {
                throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }
            
            const mapData = await response.json();
            console.log('Map data received:', mapData);
            
            // Initialize Leaflet map with the final map element
            try {
                this.amazonBasinMap = L.map(finalMapElement, {
                    center: mapData.center,
                    zoom: mapData.zoom,
                    zoomControl: true,
                    attributionControl: true
                });
                console.log('Leaflet map initialized successfully');
            } catch (mapError) {
                console.error('Leaflet map initialization error:', mapError);
                throw new Error(`Failed to initialize map: ${mapError.message}`);
            }
            
            // Add base tile layer (satellite imagery) with reduced opacity to better see features
            const satelliteLayer = L.tileLayer(mapData.tile_url, {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                maxZoom: 18,
                opacity: 0.85  // Slightly transparent to better see labels
            }).addTo(this.amazonBasinMap);
            
            // Add standard map features
            if (mapData.show_labels) {
                // Add OpenStreetMap layer with all standard map features (rivers, borders, names)
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                    maxZoom: 19,
                    opacity: 0.7  // Transparent enough to see satellite imagery underneath
                }).addTo(this.amazonBasinMap);
                
                // Add Stamen Terrain layer for better topography - this shows rivers prominently
                L.tileLayer('https://stamen-tiles-{s}.a.ssl.fastly.net/terrain-background/{z}/{x}/{y}{r}.png', {
                    attribution: 'Map tiles by <a href="http://stamen.com">Stamen Design</a>, <a href="http://creativecommons.org/licenses/by/3.0">CC BY 3.0</a> &mdash; Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                    subdomains: 'abcd',
                    minZoom: 0,
                    maxZoom: 18,
                    opacity: 0.4
                }).addTo(this.amazonBasinMap);
                
                // Add ESRI World Transportation to emphasize rivers
                L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
                    attribution: 'Tiles &copy; Esri &mdash; Source: Esri',
                    maxZoom: 19,
                    opacity: 0.7
                }).addTo(this.amazonBasinMap);
            }
            
            // Add overlays if they exist
            if (mapData.overlays && mapData.overlays.length > 0) {
                mapData.overlays.forEach(overlay => {
                    if (overlay.type === 'geojson') {
                        const geoJsonLayer = L.geoJSON(overlay.data, {
                            pointToLayer: (feature, latlng) => {
                                return L.circleMarker(latlng, overlay.style || {
                                    radius: 8,
                                    fillColor: '#ff7800',
                                    color: '#000',
                                    weight: 1,
                                    opacity: 1,
                                    fillOpacity: 0.8
                                });
                            },
                            onEachFeature: (feature, layer) => {
                                if (feature.properties) {
                                    let popupContent = `<strong>${feature.properties.name || 'Unknown Site'}</strong><br>`;
                                    if (feature.properties.type) {
                                        popupContent += `Type: ${feature.properties.type}<br>`;
                                    }
                                    if (feature.properties.elevation) {
                                        popupContent += `Elevation: ${feature.properties.elevation}<br>`;
                                    }
                                    layer.bindPopup(popupContent);
                                }
                            }
                        });
                        geoJsonLayer.addTo(this.amazonBasinMap);
                        
                        // Store reference for layer toggling
                        if (!this.mapLayers) this.mapLayers = {};
                        this.mapLayers[overlay.name.toLowerCase().replace(/\s+/g, '')] = geoJsonLayer;
                    }
                });
            }
            
            // Fit map to bounds if provided
            if (mapData.bounds && mapData.bounds.length === 4) {
                const bounds = L.latLngBounds(
                    [mapData.bounds[1], mapData.bounds[0]], // SW
                    [mapData.bounds[3], mapData.bounds[2]]  // NE
                );
                this.amazonBasinMap.fitBounds(bounds);
            }
            
            // Store reference globally for layer controls
            window.reApp = this;
            
            // Add resize handler to ensure map fills available space
            const handleResize = () => {
                if (this.amazonBasinMap) {
                    this.amazonBasinMap.invalidateSize();
                }
            };
            
            window.addEventListener('resize', handleResize);
            // Initial invalidate size after a brief delay to ensure proper rendering
            setTimeout(() => handleResize(), 100);
            
            console.log('Amazon Basin map loaded successfully');
            
        } catch (error) {
            console.error('Failed to load Amazon Basin map:', error);
            
            // Show specific error message
            const contentDisplay = document.getElementById('content-display');
            if (contentDisplay) {
                let errorMessage = 'Failed to load Global Archaeological Map.';
                
                if (error.message.includes('Leaflet')) {
                    errorMessage += ' Map library not available.';
                } else if (error.message.includes('API request')) {
                    errorMessage += ' Server connection failed.';
                } else if (error.message.includes('DOM')) {
                    errorMessage += ' Interface error.';
                } else {
                    errorMessage += ` Error: ${error.message}`;
                }
                
                contentDisplay.innerHTML = `
                    <div class="error-state">
                        <h4>Map Loading Error</h4>
                        <p>${errorMessage}</p>
                        <button class="btn btn-primary" onclick="window.app.loadAmazonBasinMap()">
                            Try Again
                        </button>
                    </div>
                `;
            }
            
            this.showError(error.message);
        }
    }
    
    toggleLayer(layerName) {
        if (!this.mapLayers) this.mapLayers = {};
        
        const layer = this.mapLayers[layerName];
        if (layer) {
            if (this.amazonBasinMap.hasLayer(layer)) {
                this.amazonBasinMap.removeLayer(layer);
                
                // Visual feedback for toggle button - find the button that toggled this layer
                const buttons = document.querySelectorAll('.map-controls button');
                buttons.forEach(button => {
                    if (button.textContent.toLowerCase().includes(layerName.toLowerCase()) || 
                        button.onclick.toString().includes(layerName)) {
                        button.style.opacity = '0.7';
                        button.style.backgroundColor = '#f1f1f1';
                    }
                });
            } else {
                this.amazonBasinMap.addLayer(layer);
                
                // Visual feedback for toggle button
                const buttons = document.querySelectorAll('.map-controls button');
                buttons.forEach(button => {
                    if (button.textContent.toLowerCase().includes(layerName.toLowerCase()) || 
                        button.onclick.toString().includes(layerName)) {
                        button.style.opacity = '1';
                        button.style.backgroundColor = '#fff';
                    }
                });
            }
        }
    }
    
    toggleBorders() {
        if (this.bordersLayer) {
            if (this.amazonBasinMap.hasLayer(this.bordersLayer)) {
                this.amazonBasinMap.removeLayer(this.bordersLayer);
                if (this.customBordersLayer) {
                    this.amazonBasinMap.removeLayer(this.customBordersLayer);
                }
            } else {
                this.amazonBasinMap.addLayer(this.bordersLayer);
                if (this.customBordersLayer) {
                    this.amazonBasinMap.addLayer(this.customBordersLayer);
                }
            }
        } else {
            this.bordersLayer = L.tileLayer('https://maps.heigit.org/openmapsurfer/tiles/borders/webmercator/{z}/{x}/{y}.png', {
                attribution: 'Borders &copy; <a href="https://heigit.org">HeiGIT</a>',
                maxZoom: 19,
                opacity: 0.8
            }).addTo(this.amazonBasinMap);
        }
    }
    
    toggleLabels() {
        if (this.labelsLayer) {
            if (this.amazonBasinMap.hasLayer(this.labelsLayer)) {
                this.amazonBasinMap.removeLayer(this.labelsLayer);
            } else {
                this.amazonBasinMap.addLayer(this.labelsLayer);
            }
        } else {
            this.labelsLayer = L.tileLayer('https://stamen-tiles-{s}.a.ssl.fastly.net/toner-labels/{z}/{x}/{y}{r}.{ext}', {
                attribution: 'Map labels by <a href="http://stamen.com">Stamen Design</a>',
                subdomains: 'abcd',
                minZoom: 0,
                maxZoom: 20,
                ext: 'png',
                opacity: 0.7
            }).addTo(this.amazonBasinMap);
        }
    }
    
    toggleRivers() {
        if (this.riverNamesLayer) {
            if (this.amazonBasinMap.hasLayer(this.riverNamesLayer)) {
                this.amazonBasinMap.removeLayer(this.riverNamesLayer);
            } else {
                this.amazonBasinMap.addLayer(this.riverNamesLayer);
            }
        }
    }
    
    toggleCountryNames() {
        if (this.countryNamesLayer) {
            if (this.amazonBasinMap.hasLayer(this.countryNamesLayer)) {
                this.amazonBasinMap.removeLayer(this.countryNamesLayer);
            } else {
                this.amazonBasinMap.addLayer(this.countryNamesLayer);
            }
        }
    }
    
    toggleWaterways() {
        if (this.waterwaysLayer) {
            if (this.amazonBasinMap.hasLayer(this.waterwaysLayer)) {
                this.amazonBasinMap.removeLayer(this.waterwaysLayer);
            } else {
                this.amazonBasinMap.addLayer(this.waterwaysLayer);
            }
        } else {
            this.waterwaysLayer = L.tileLayer('https://tileserver.memomaps.de/tilegen/{z}/{x}/{y}.png', {
                attribution: 'Waterways &copy; <a href="https://memomaps.de/">MeMoMaps</a>',
                maxZoom: 18,
                opacity: 0.4
            }).addTo(this.amazonBasinMap);
        }
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

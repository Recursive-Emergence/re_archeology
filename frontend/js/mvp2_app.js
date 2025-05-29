/**
 * MVP2 Main Application for RE-Archaeology Framework
 * Handles authentication, thread management, AI chat, and background tasks
 */

class MVP2App {
    constructor() {
        this.user = null;
        this.currentThread = null;
        this.currentSection = 'thread-list';
        this.websocket = null;
        this.categories = [];
        this.threads = [];
        this.activeTasks = [];
        
        // Service instances
        this.authService = new AuthService();
        this.threadService = new ThreadService();
        this.aiChatService = new AIChatService();
        this.backgroundTasksService = new BackgroundTasksService();
        this.earthEngineService = new EarthEngineService();
        
        this.init();
    }

    async init() {
        try {
            // Show loading
            this.showLoading();
            
            // Initialize services
            await this.initializeServices();
            
            // Set up event listeners
            this.setupEventListeners();
            
            // Check authentication status
            await this.checkAuthStatus();
            
            // Load initial data
            await this.loadInitialData();
            
            // Initialize WebSocket connection
            this.initializeWebSocket();
            
            // Hide loading
            this.hideLoading();
            
            console.log('MVP2 App initialized successfully');
        } catch (error) {
            console.error('Failed to initialize MVP2 App:', error);
            this.showError('Failed to initialize application');
        }
    }

    async initializeServices() {
        // Initialize all service dependencies
        this.authService.setApp(this);
        this.threadService.setApp(this);
        this.aiChatService.setApp(this);
        this.backgroundTasksService.setApp(this);
        this.earthEngineService.setApp(this);
    }

    setupEventListeners() {
        // Navigation
        document.getElementById('back-to-list')?.addEventListener('click', () => {
            this.showSection('thread-list');
        });

        // Thread management
        document.getElementById('create-thread-btn')?.addEventListener('click', () => {
            this.showCreateThreadModal();
        });

        document.getElementById('create-thread-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleCreateThread();
        });

        // Search and filters
        document.getElementById('thread-search')?.addEventListener('input', (e) => {
            this.handleThreadSearch(e.target.value);
        });

        document.getElementById('category-filter')?.addEventListener('change', (e) => {
            this.handleCategoryFilter(e.target.value);
        });

        // Chat
        document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendChatMessage();
            }
        });

        document.getElementById('send-chat-btn')?.addEventListener('click', () => {
            this.sendChatMessage();
        });

        document.getElementById('clear-chat-btn')?.addEventListener('click', () => {
            this.clearChat();
        });

        // Tasks
        document.getElementById('view-tasks-btn')?.addEventListener('click', () => {
            this.showSection('tasks-panel');
        });

        document.getElementById('task-indicator')?.addEventListener('click', () => {
            this.showSection('tasks-panel');
        });

        document.getElementById('refresh-tasks-btn')?.addEventListener('click', () => {
            this.loadBackgroundTasks();
        });

        // Maps
        document.getElementById('add-map-btn')?.addEventListener('click', () => {
            this.showAddMapModal();
        });

        document.getElementById('add-map-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAddMap();
        });

        // Modal event listeners
        this.setupModalEventListeners();
        
        // Window events
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
    }

    setupModalEventListeners() {
        // Close modals when clicking outside
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal.id);
                }
            });
        });

        // Close buttons
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.closeModal(modal.id);
                }
            });
        });
    }

    async checkAuthStatus() {
        try {
            const user = await this.authService.getCurrentUser();
            if (user) {
                this.setUser(user);
            } else {
                this.renderAuthSection();
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            this.renderAuthSection();
        }
    }

    async loadInitialData() {
        try {
            // Load categories
            this.categories = await this.threadService.getCategories();
            this.renderCategories();

            // Load threads
            await this.loadThreads();

            // Load background tasks if user is authenticated
            if (this.user) {
                await this.loadBackgroundTasks();
            }
        } catch (error) {
            console.error('Failed to load initial data:', error);
        }
    }

    async loadThreads(categoryFilter = null, searchQuery = null) {
        try {
            this.threads = await this.threadService.getThreads({
                category: categoryFilter,
                search: searchQuery
            });
            this.renderThreadList();
        } catch (error) {
            console.error('Failed to load threads:', error);
            this.showError('Failed to load threads');
        }
    }

    async loadBackgroundTasks() {
        try {
            this.activeTasks = await this.backgroundTasksService.getTasks();
            this.renderBackgroundTasks();
            this.updateTaskIndicator();
        } catch (error) {
            console.error('Failed to load background tasks:', error);
        }
    }

    initializeWebSocket() {
        if (!this.user) return;

        try {
            const wsUrl = `ws://localhost:8000/api/background-tasks/ws/${this.user.user_id}`;
            this.websocket = new WebSocket(wsUrl);

            this.websocket.onopen = () => {
                console.log('WebSocket connected');
            };

            this.websocket.onmessage = (event) => {
                const message = JSON.parse(event.data);
                this.handleWebSocketMessage(message);
            };

            this.websocket.onclose = () => {
                console.log('WebSocket disconnected');
                // Attempt to reconnect after 5 seconds
                setTimeout(() => {
                    if (this.user) {
                        this.initializeWebSocket();
                    }
                }, 5000);
            };

            this.websocket.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        } catch (error) {
            console.error('Failed to initialize WebSocket:', error);
        }
    }

    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'task_progress':
                this.updateTaskProgress(message.task_id, message.progress, message.current_step);
                break;
            case 'task_completed':
                this.handleTaskCompleted(message.task_id, message.result);
                break;
            case 'task_failed':
                this.handleTaskFailed(message.task_id, message.error);
                break;
            case 'task_cancelled':
                this.handleTaskCancelled(message.task_id);
                break;
            case 'pong':
                // Keep-alive response
                break;
            default:
                console.log('Unknown WebSocket message:', message);
        }
    }

    // UI Management Methods

    showSection(sectionId) {
        // Hide all sections
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });

        // Show target section
        const targetSection = document.getElementById(`${sectionId}-section`);
        if (targetSection) {
            targetSection.classList.add('active');
            this.currentSection = sectionId;
        }
    }

    showLoading(text = 'Loading...') {
        const overlay = document.getElementById('loading-overlay');
        const textEl = overlay.querySelector('.loading-text');
        if (textEl) textEl.textContent = text;
        overlay.classList.add('active');
    }

    hideLoading() {
        document.getElementById('loading-overlay')?.classList.remove('active');
    }

    showError(message) {
        // Create a simple error notification
        const notification = document.createElement('div');
        notification.className = 'error-notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--error-color);
            color: white;
            padding: 1rem;
            border-radius: var(--border-radius);
            z-index: 10000;
            box-shadow: var(--shadow-lg);
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    showSuccess(message) {
        // Create a simple success notification
        const notification = document.createElement('div');
        notification.className = 'success-notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--success-color);
            color: white;
            padding: 1rem;
            border-radius: var(--border-radius);
            z-index: 10000;
            box-shadow: var(--shadow-lg);
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
        }
    }

    // Authentication Methods

    setUser(user) {
        this.user = user;
        this.renderUserInfo();
        this.initializeWebSocket();
        this.loadBackgroundTasks();
    }

    logout() {
        this.user = null;
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
        this.authService.logout();
        this.renderAuthSection();
        this.activeTasks = [];
        this.updateTaskIndicator();
    }

    // Rendering Methods

    renderAuthSection() {
        const authSection = document.getElementById('auth-section');
        if (!authSection) return;

        if (this.user) {
            this.renderUserInfo();
        } else {
            authSection.innerHTML = `
                <button id="google-signin-btn" class="btn btn-primary">
                    Sign in with Google
                </button>
            `;
            
            // Set up Google Sign-In
            document.getElementById('google-signin-btn')?.addEventListener('click', () => {
                this.authService.signInWithGoogle();
            });
        }
    }

    renderUserInfo() {
        const authSection = document.getElementById('auth-section');
        if (!authSection || !this.user) return;

        authSection.innerHTML = `
            <div class="user-info">
                <img src="${this.user.profile_picture || '/static/default-avatar.png'}" 
                     alt="${this.user.display_name}" class="user-avatar">
                <span class="user-name">${this.user.display_name}</span>
                <button id="logout-btn" class="btn btn-ghost">Logout</button>
            </div>
        `;

        document.getElementById('logout-btn')?.addEventListener('click', () => {
            this.logout();
        });
    }

    renderCategories() {
        const categoryList = document.getElementById('category-list');
        const categoryFilter = document.getElementById('category-filter');
        const threadCategoryInput = document.getElementById('thread-category-input');
        
        if (!categoryList) return;

        // Render sidebar categories
        categoryList.innerHTML = this.categories.map(category => `
            <div class="category-item" data-category="${category.name}">
                <span class="category-name">${category.name}</span>
                <span class="thread-count">${category.thread_count || 0}</span>
            </div>
        `).join('');

        // Set up category click handlers
        categoryList.querySelectorAll('.category-item').forEach(item => {
            item.addEventListener('click', () => {
                const categoryName = item.dataset.category;
                this.handleCategoryFilter(categoryName);
                
                // Update active state
                categoryList.querySelectorAll('.category-item').forEach(cat => {
                    cat.classList.remove('active');
                });
                item.classList.add('active');
            });
        });

        // Populate filter dropdown
        if (categoryFilter) {
            categoryFilter.innerHTML = `
                <option value="">All Categories</option>
                ${this.categories.map(cat => 
                    `<option value="${cat.name}">${cat.name}</option>`
                ).join('')}
            `;
        }

        // Populate create thread category dropdown
        if (threadCategoryInput) {
            threadCategoryInput.innerHTML = this.categories.map(cat => 
                `<option value="${cat.category_id}">${cat.name}</option>`
            ).join('');
        }
    }

    renderThreadList() {
        const threadList = document.getElementById('thread-list');
        if (!threadList) return;

        if (this.threads.length === 0) {
            threadList.innerHTML = `
                <div class="empty-state">
                    <p>No threads found. Create the first one!</p>
                    <button class="btn btn-primary" onclick="app.showCreateThreadModal()">
                        Create Thread
                    </button>
                </div>
            `;
            return;
        }

        threadList.innerHTML = this.threads.map(thread => `
            <div class="thread-card" data-thread-id="${thread.thread_id}">
                <div class="thread-header">
                    <div>
                        <div class="thread-title">${thread.title}</div>
                        <div class="thread-category">${thread.category?.name || 'Uncategorized'}</div>
                    </div>
                </div>
                <div class="thread-description">${thread.description}</div>
                <div class="thread-meta">
                    <div class="thread-stats">
                        <div class="thread-stat">
                            <span>${thread.comment_count || 0}</span>
                            <span>comments</span>
                        </div>
                        <div class="thread-stat">
                            <span>${thread.map_count || 0}</span>
                            <span>maps</span>
                        </div>
                    </div>
                    <div class="thread-date">
                        ${this.formatDate(thread.created_at)}
                    </div>
                </div>
            </div>
        `).join('');

        // Set up click handlers
        threadList.querySelectorAll('.thread-card').forEach(card => {
            card.addEventListener('click', () => {
                const threadId = card.dataset.threadId;
                this.openThread(threadId);
            });
        });
    }

    renderBackgroundTasks() {
        const tasksContainer = document.getElementById('tasks-container');
        if (!tasksContainer) return;

        if (this.activeTasks.length === 0) {
            tasksContainer.innerHTML = `
                <div class="empty-state">
                    <p>No background tasks running.</p>
                </div>
            `;
            return;
        }

        tasksContainer.innerHTML = this.activeTasks.map(task => `
            <div class="task-card" data-task-id="${task.task_id}">
                <div class="task-header">
                    <div>
                        <div class="task-title">${this.formatTaskTitle(task.task_type)}</div>
                        <div class="task-type">${task.entity_type} - ${task.entity_id}</div>
                    </div>
                    <div class="task-status ${task.status.toLowerCase()}">${task.status}</div>
                </div>
                
                ${task.status === 'RUNNING' ? `
                    <div class="task-progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${task.metadata?.progress || 0}%"></div>
                        </div>
                        <div class="progress-text">
                            ${task.metadata?.current_step || 'Processing...'} 
                            (${task.metadata?.progress || 0}%)
                        </div>
                    </div>
                ` : ''}
                
                <div class="task-actions">
                    ${task.status === 'RUNNING' ? `
                        <button class="btn btn-error btn-sm" onclick="app.cancelTask('${task.task_id}')">
                            Cancel
                        </button>
                    ` : ''}
                    ${task.status === 'COMPLETED' ? `
                        <button class="btn btn-primary btn-sm" onclick="app.viewTaskResult('${task.task_id}')">
                            View Result
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('');
    }

    updateTaskIndicator() {
        const activeCount = this.activeTasks.filter(task => 
            task.status === 'RUNNING' || task.status === 'PENDING'
        ).length;
        
        const countElement = document.getElementById('active-tasks-count');
        if (countElement) {
            countElement.textContent = activeCount;
        }
    }

    // Event Handlers

    async handleCreateThread() {
        try {
            const form = document.getElementById('create-thread-form');
            const formData = new FormData(form);
            
            const threadData = {
                title: formData.get('title'),
                description: formData.get('description'),
                category_id: formData.get('category_id'),
                requires_auth: formData.get('requires_auth') === 'on'
            };

            const newThread = await this.threadService.createThread(threadData);
            
            this.closeModal('create-thread-modal');
            this.showSuccess('Thread created successfully!');
            
            // Refresh thread list
            await this.loadThreads();
            
            // Open the new thread
            this.openThread(newThread.thread_id);
            
        } catch (error) {
            console.error('Failed to create thread:', error);
            this.showError('Failed to create thread');
        }
    }

    async openThread(threadId) {
        try {
            this.showLoading('Loading thread...');
            
            this.currentThread = await this.threadService.getThread(threadId);
            
            // Render thread details
            this.renderThreadDetail();
            
            // Load thread comments
            await this.loadThreadComments(threadId);
            
            // Load thread maps
            await this.loadThreadMaps(threadId);
            
            this.showSection('thread-detail');
            this.hideLoading();
            
        } catch (error) {
            console.error('Failed to open thread:', error);
            this.showError('Failed to load thread');
            this.hideLoading();
        }
    }

    async sendChatMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        
        if (!message) return;
        
        // Clear input
        input.value = '';
        
        try {
            // Add user message to chat
            this.addChatMessage(message, 'user');
            
            // Send to AI service
            const response = await this.aiChatService.sendMessage(message, {
                thread_id: this.currentThread?.thread_id,
                use_semantic_search: document.getElementById('toggle-semantic-search')?.classList.contains('active')
            });
            
            // Add AI response to chat
            this.addChatMessage(response.response, 'ai');
            
        } catch (error) {
            console.error('Failed to send chat message:', error);
            this.addChatMessage('Sorry, I encountered an error. Please try again.', 'ai');
        }
    }

    // Utility Methods

    formatDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now - date);
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) {
            return 'Today';
        } else if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays < 7) {
            return `${diffDays} days ago`;
        } else {
            return date.toLocaleDateString();
        }
    }

    formatTaskTitle(taskType) {
        const titles = {
            'earth_engine_analysis': 'Earth Engine Analysis',
            'data_processing': 'Data Processing',
            'semantic_search': 'Semantic Search'
        };
        return titles[taskType] || taskType.replace('_', ' ').toUpperCase();
    }

    addChatMessage(message, sender) {
        const messagesContainer = document.getElementById('chat-messages');
        if (!messagesContainer) return;

        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${sender}`;
        messageEl.innerHTML = `
            <div class="message-avatar">${sender === 'user' ? 'U' : 'AI'}</div>
            <div class="message-content">
                <div class="message-text">${message}</div>
                <div class="message-time">${new Date().toLocaleTimeString()}</div>
            </div>
        `;

        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    clearChat() {
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) {
            messagesContainer.innerHTML = '';
        }
    }

    cleanup() {
        if (this.websocket) {
            this.websocket.close();
        }
    }

    // Placeholder methods for features to be implemented
    handleThreadSearch(query) {
        this.loadThreads(null, query);
    }

    handleCategoryFilter(category) {
        this.loadThreads(category);
    }

    showCreateThreadModal() {
        this.openModal('create-thread-modal');
    }

    showAddMapModal() {
        this.openModal('add-map-modal');
    }

    async handleAddMap() {
        // Implementation pending
        console.log('Add map functionality to be implemented');
    }

    renderThreadDetail() {
        // Implementation pending
        console.log('Thread detail rendering to be implemented');
    }

    async loadThreadComments(threadId) {
        // Implementation pending
        console.log('Thread comments loading to be implemented');
    }

    async loadThreadMaps(threadId) {
        // Implementation pending
        console.log('Thread maps loading to be implemented');
    }

    updateTaskProgress(taskId, progress, currentStep) {
        // Find and update task
        const task = this.activeTasks.find(t => t.task_id === taskId);
        if (task) {
            task.metadata = { ...task.metadata, progress, current_step: currentStep };
            this.renderBackgroundTasks();
        }
    }

    handleTaskCompleted(taskId, result) {
        const task = this.activeTasks.find(t => t.task_id === taskId);
        if (task) {
            task.status = 'COMPLETED';
            task.metadata = { ...task.metadata, result };
            this.renderBackgroundTasks();
            this.updateTaskIndicator();
            this.showSuccess(`Task "${this.formatTaskTitle(task.task_type)}" completed!`);
        }
    }

    handleTaskFailed(taskId, error) {
        const task = this.activeTasks.find(t => t.task_id === taskId);
        if (task) {
            task.status = 'FAILED';
            task.metadata = { ...task.metadata, error };
            this.renderBackgroundTasks();
            this.updateTaskIndicator();
            this.showError(`Task "${this.formatTaskTitle(task.task_type)}" failed: ${error}`);
        }
    }

    handleTaskCancelled(taskId) {
        const task = this.activeTasks.find(t => t.task_id === taskId);
        if (task) {
            task.status = 'CANCELLED';
            this.renderBackgroundTasks();
            this.updateTaskIndicator();
            this.showSuccess('Task cancelled successfully');
        }
    }

    async cancelTask(taskId) {
        try {
            await this.backgroundTasksService.cancelTask(taskId);
        } catch (error) {
            console.error('Failed to cancel task:', error);
            this.showError('Failed to cancel task');
        }
    }

    async viewTaskResult(taskId) {
        // Implementation pending
        console.log('View task result to be implemented');
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new MVP2App();
});

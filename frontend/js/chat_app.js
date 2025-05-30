/**
 * Main Chat Application for RE-Archaeology Framework
 * Handles authentication, thread management, AI chat, and background tasks
 */

class ChatApp {
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
        
        // DOM elements
        this.container = document.getElementById('app');
        this.authSection = document.getElementById('auth-section');
        this.chatAuthSection = document.getElementById('chat-auth-section');
        this.chatInput = document.getElementById('chat-input');
        this.sendChatBtn = document.getElementById('send-chat-btn');
        this.taskIndicator = document.getElementById('active-tasks-count');
        
        // Initialize
        this.init();
    }
    
    async init() {
        console.log('ChatApp: Starting initialization...');
        
        // Setup event listeners
        this.setupEventListeners();
        this.setupMobileNavigation();
        
        // Initialize services
        console.log('ChatApp: Initializing services...');
        await this.initializeServices();
        
        // Set default view for three-pane layout
        this.showSection('thread-list');
        
        // Auth state
        this.authService.onAuthStateChanged((user) => {
            this.user = user;
            this.renderAuthUI();
            this.updateChatInputState();
            this.updateActiveTasks();
        });
        
        // Start websocket
        this.initializeWebsocket();
        
        console.log('ChatApp: Initialization complete!');
    }
    
    setupEventListeners() {
        console.log('ChatApp: Setting up event listeners...');
        
        // Helper function to safely add event listener
        const safeAddEventListener = (elementId, event, handler) => {
            const element = document.getElementById(elementId);
            if (element) {
                element.addEventListener(event, handler);
            } else {
                console.warn(`Element with ID '${elementId}' not found`);
            }
        };
        
        // Navigation
        safeAddEventListener('create-thread-btn', 'click', () => this.openModal('create-thread-modal'));
        safeAddEventListener('back-to-list', 'click', () => this.showSection('thread-list'));
        safeAddEventListener('view-tasks-btn', 'click', () => this.showSection('tasks-panel'));
        
        // Thread creation
        safeAddEventListener('create-thread-form', 'submit', (e) => {
            e.preventDefault();
            this.handleCreateThread();
        });
        
        // Thread actions
        safeAddEventListener('add-map-btn', 'click', () => this.openModal('add-map-modal'));
        safeAddEventListener('share-thread-btn', 'click', () => this.shareThread());
        
        // Map form
        safeAddEventListener('add-map-form', 'submit', (e) => {
            e.preventDefault();
            this.handleAddMap();
        });
        
        // AI Chat
        safeAddEventListener('chat-input', 'keydown', (e) => {
            if (e.key === 'Enter') {
                this.sendChatMessage();
            }
        });
        safeAddEventListener('send-chat-btn', 'click', () => this.sendChatMessage());
        safeAddEventListener('clear-chat-btn', 'click', () => this.clearChat());
        safeAddEventListener('toggle-semantic-search', 'click', () => this.toggleSemanticSearch());
        
        // Modal close buttons
        const modalCloseButtons = document.querySelectorAll('.modal-close');
        if (modalCloseButtons && modalCloseButtons.length) {
            modalCloseButtons.forEach(button => {
                button.addEventListener('click', () => this.closeAllModals());
            });
        } else {
            console.warn('No modal close buttons found');
        }
        
        // Background tasks
        safeAddEventListener('refresh-tasks-btn', 'click', () => this.refreshTasks());
    }
    
    setupMobileNavigation() {
        // Create mobile menu toggle button if it doesn't exist
        if (!document.querySelector('.mobile-menu-toggle')) {
            const mobileToggle = document.createElement('button');
            mobileToggle.className = 'mobile-menu-toggle';
            mobileToggle.innerHTML = '☰';
            mobileToggle.setAttribute('aria-label', 'Toggle menu');
            
            document.querySelector('.header-content').prepend(mobileToggle);
            
            // Add event listener to toggle sidebar
            mobileToggle.addEventListener('click', () => this.toggleMobileMenu());
        }
        
        // Create back button for chat on mobile
        if (!document.querySelector('.mobile-back-button')) {
            const backButton = document.createElement('button');
            backButton.className = 'mobile-back-button';
            backButton.innerHTML = '←';
            backButton.setAttribute('aria-label', 'Back to threads');
            
            // Add to chat header
            document.querySelector('.chat-header').prepend(backButton);
            
            // Add event listener
            backButton.addEventListener('click', () => this.showSection('thread-list'));
        }
        
        // Handle viewport height for mobile browsers
        this.setMobileViewportHeight();
        window.addEventListener('resize', () => this.setMobileViewportHeight());
    }
    
    setMobileViewportHeight() {
        // Fix for mobile viewport height issues
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
    }
    
    toggleMobileMenu() {
        const sidebar = document.querySelector('.sidebar');
        sidebar.classList.toggle('active');
        
        // Add overlay when menu is open
        let overlay = document.querySelector('.mobile-menu-overlay');
        
        if (!overlay && sidebar.classList.contains('active')) {
            overlay = document.createElement('div');
            overlay.className = 'mobile-menu-overlay';
            document.body.appendChild(overlay);
            
            overlay.addEventListener('click', () => this.toggleMobileMenu());
        } else if (overlay && !sidebar.classList.contains('active')) {
            overlay.remove();
        }
    }
    
    async initializeServices() {
        try {
            console.log('ChatApp: Loading categories...');
            // Load categories first
            this.categories = await this.threadService.getCategories();
            console.log('ChatApp: Categories loaded:', this.categories);
            this.renderCategories();
            console.log('ChatApp: Categories rendered');
            
            console.log('ChatApp: Loading threads...');
            // Load threads
            this.threads = await this.threadService.getThreads();
            console.log('ChatApp: Threads loaded:', this.threads);
            this.renderThreads();
            console.log('ChatApp: Threads rendered');
            
            // Initialize earth engine
            await this.earthEngineService.initialize();
            
            // Get active tasks
            this.updateActiveTasks();
        } catch (error) {
            console.error('Error initializing services:', error);
            this.showNotification('Failed to load data. Please try refreshing the page.', 'error');
        }
    }
    
    initializeWebsocket() {
        try {
            // Check if we're in development/testing mode without a backend
            const isLocalDevelopment = window.location.hostname === 'localhost' && 
                                       !window.RE_ARCHAEOLOGY_CONFIG?.enableBackend;
                                       
            if (isLocalDevelopment) {
                console.log('Running in local development mode without backend. WebSocket disabled.');
                this.websocket = {
                    // Mock WebSocket methods to avoid errors
                    send: () => console.log('WebSocket send called in development mode'),
                    close: () => console.log('WebSocket close called in development mode')
                };
                return;
            }
            
            // Normal WebSocket initialization for production
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws/threads`;
            
            console.log(`Attempting to connect to WebSocket at: ${wsUrl}`);
            this.websocket = new WebSocket(wsUrl);
            
            this.websocket.onopen = () => {
                console.log('WebSocket connection established');
            };
            
            this.websocket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            };
            
            this.websocket.onerror = (error) => {
                console.warn('WebSocket error - server might not be available:', error);
            };
            
            this.websocket.onclose = () => {
                console.log('WebSocket connection closed');
                // Try to reconnect after a delay, but not too frequently to avoid console spam
                setTimeout(() => this.initializeWebsocket(), 10000);
            };
        } catch (error) {
            console.warn('Error initializing WebSocket, continuing without real-time updates:', error);
        }
    }
    
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'thread_created':
                this.threads.unshift(data.thread);
                this.renderThreads();
                break;
            case 'thread_updated':
                this.updateThread(data.thread);
                break;
            case 'comment_added':
                this.addComment(data.comment);
                break;
            case 'task_update':
                this.updateTask(data.task);
                break;
            default:
                console.log('Unknown websocket message type:', data.type);
        }
    }
    
    showSection(sectionId) {
        // Hide all sections
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });
        
        // Show the selected section
        document.getElementById(`${sectionId}-section`).classList.add('active');
        this.currentSection = sectionId;
        
        // Special handling for thread detail
        if (sectionId === 'thread-detail') {
            this.loadThreadDetails(this.currentThread);
        }
    }
    
    openModal(modalId) {
        // Close any open modals
        this.closeAllModals();
        
        // Open the requested modal
        const modal = document.getElementById(modalId);
        modal.classList.add('active');
        
        // Special handling for add map modal
        if (modalId === 'add-map-modal') {
            setTimeout(() => this.earthEngineService.initializeMapSelector(), 100);
        }
    }
    
    closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('active');
        });
    }
    
    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
    }
    
    showLoading(message = 'Loading...') {
        const overlay = document.getElementById('loading-overlay');
        const loadingText = overlay.querySelector('.loading-text');
        loadingText.textContent = message;
        overlay.classList.add('active');
    }
    
    hideLoading() {
        document.getElementById('loading-overlay').classList.remove('active');
    }
    
    showNotification(message, type = 'info') {
        // Create or get notification container
        let container = document.querySelector('.notification-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'notification-container';
            document.body.appendChild(container);
        }
        
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Add close button
        const closeButton = document.createElement('button');
        closeButton.className = 'notification-close';
        closeButton.innerHTML = '&times;';
        closeButton.addEventListener('click', () => notification.remove());
        
        notification.appendChild(closeButton);
        container.appendChild(notification);
        
        // Auto-remove after delay
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 500);
        }, 5000);
    }
    
    renderCategories() {
        console.log('ChatApp: renderCategories called with categories:', this.categories);
        
        const categoryList = document.getElementById('category-list');
        const categoryFilter = document.getElementById('category-filter');
        const threadCategoryInput = document.getElementById('thread-category-input');
        
        console.log('ChatApp: Found category-list element:', categoryList);
        console.log('ChatApp: Found category-filter element:', categoryFilter);
        console.log('ChatApp: Found thread-category-input element:', threadCategoryInput);
        
        if (!categoryList) {
            console.error('ChatApp: category-list element not found!');
            return;
        }
        
        if (!this.categories || this.categories.length === 0) {
            console.warn('ChatApp: No categories available to render');
            categoryList.innerHTML = '<div class="no-categories">No categories available</div>';
            return;
        }
        
        // Clear existing options
        categoryList.innerHTML = '';
        
        // Keep the first option in the filter
        if (categoryFilter) {
            categoryFilter.innerHTML = '<option value="">All Categories</option>';
        }
        if (threadCategoryInput) {
            threadCategoryInput.innerHTML = '';
        }
        
        // Add categories
        this.categories.forEach(category => {
            console.log('ChatApp: Processing category:', category);
            
            // Add to sidebar
            const categoryItem = document.createElement('div');
            categoryItem.className = 'category-item';
            categoryItem.dataset.id = category.id;
            categoryItem.innerHTML = `
                <span class="category-icon">${category.icon || '📁'}</span>
                <span>${category.name}</span>
            `;
            categoryItem.addEventListener('click', () => {
                this.showSection('thread-list');
                this.filterThreadsByCategory(category.id);
            });
            categoryList.appendChild(categoryItem);
            console.log('ChatApp: Added category item to DOM:', categoryItem);
            
            // Add to filter dropdown
            if (categoryFilter) {
                const filterOption = document.createElement('option');
                filterOption.value = category.id;
                filterOption.textContent = category.name;
                categoryFilter.appendChild(filterOption);
            }
            
            // Add to thread creation form
            if (threadCategoryInput) {
                const formOption = document.createElement('option');
                formOption.value = category.id;
                formOption.textContent = category.name;
                threadCategoryInput.appendChild(formOption);
            }
        });
    }
    
    renderThreads(filterCategoryId = null, searchTerm = '') {
        const threadList = document.getElementById('thread-list');
        if (!threadList) {
            console.error('ChatApp: thread-list element not found!');
            return;
        }
        threadList.innerHTML = '';
        
        let filteredThreads = this.threads;
        
        // Apply category filter
        if (filterCategoryId) {
            filteredThreads = filteredThreads.filter(thread => thread.category_id === filterCategoryId);
        }
        
        // Apply search filter
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filteredThreads = filteredThreads.filter(thread => 
                thread.title.toLowerCase().includes(term) || 
                thread.description.toLowerCase().includes(term)
            );
        }
        
        if (filteredThreads.length === 0) {
            threadList.innerHTML = `
                <div class="empty-state">
                    <p>No threads found</p>
                </div>
            `;
            return;
        }
        
        filteredThreads.forEach(thread => {
            const threadCard = document.createElement('div');
            threadCard.className = 'thread-card';
            threadCard.dataset.id = thread.id;
            
            const category = this.categories.find(c => c.id === thread.category_id) || { name: 'Uncategorized', icon: '📁' };
            
            threadCard.innerHTML = `
                <div class="thread-card-header">
                    <h3 class="thread-title">${thread.title}</h3>
                    <span class="thread-category">${category.icon || '📁'} ${category.name}</span>
                </div>
                <div class="thread-excerpt">${thread.description}</div>
                <div class="thread-meta">
                    <span class="thread-meta-item">
                        <span>👤</span>
                        <span>${thread.author_name || 'Anonymous'}</span>
                    </span>
                    <span class="thread-meta-item">
                        <span>💬</span>
                        <span>${thread.comment_count || 0}</span>
                    </span>
                    <span class="thread-meta-item">
                        <span>🗺️</span>
                        <span>${thread.map_count || 0}</span>
                    </span>
                </div>
            `;
            
            threadCard.addEventListener('click', () => {
                this.currentThread = thread;
                this.showSection('thread-detail');
            });
            
            threadList.appendChild(threadCard);
        });
    }
    
    filterThreadsByCategory(categoryId) {
        document.getElementById('category-filter').value = categoryId;
        this.renderThreads(categoryId);
        
        // Update active state in UI
        document.querySelectorAll('.category-item').forEach(item => {
            item.classList.toggle('active', item.dataset.id === categoryId);
        });
    }
    
    async loadThreadDetails(thread) {
        if (!thread) return;
        
        try {
            this.showLoading('Loading thread details...');
            
            // Get full thread data
            const fullThread = await this.threadService.getThreadById(thread.id);
            this.currentThread = fullThread;
            
            // Update UI
            document.getElementById('thread-title').textContent = fullThread.title;
            document.getElementById('thread-description').innerHTML = fullThread.description;
            
            // Load comments
            const comments = await this.threadService.getComments(thread.id);
            this.renderComments(comments);
            
            // Load maps
            const maps = await this.earthEngineService.getMaps(thread.id);
            this.renderMaps(maps);
            
            this.hideLoading();
        } catch (error) {
            console.error('Error loading thread details:', error);
            this.hideLoading();
            this.showNotification('Failed to load thread details', 'error');
        }
    }
    
    renderComments(comments) {
        const commentsContainer = document.getElementById('comments-container');
        const commentForm = document.getElementById('comment-form');
        
        commentsContainer.innerHTML = '';
        
        if (comments.length === 0) {
            commentsContainer.innerHTML = `
                <div class="empty-state">
                    <p>No comments yet</p>
                </div>
            `;
        } else {
            comments.forEach(comment => {
                const commentItem = document.createElement('div');
                commentItem.className = 'comment-item';
                commentItem.innerHTML = `
                    <div class="comment-header">
                        <span class="comment-user">${comment.author_name || 'Anonymous'}</span>
                        <span class="comment-timestamp">${new Date(comment.created_at).toLocaleString()}</span>
                    </div>
                    <div class="comment-content">${comment.content}</div>
                `;
                commentsContainer.appendChild(commentItem);
            });
        }
        
        // Render comment form based on authentication state
        commentForm.innerHTML = '';
        
        if (this.user) {
            commentForm.innerHTML = `
                <textarea class="form-textarea" id="comment-input" placeholder="Add a comment..." rows="3"></textarea>
                <div class="form-actions">
                    <button type="button" id="submit-comment-btn" class="btn btn-primary">Post Comment</button>
                </div>
            `;
            
            document.getElementById('submit-comment-btn').addEventListener('click', () => this.submitComment());
        } else {
            commentForm.innerHTML = `
                <div class="auth-prompt">
                    <p>Please sign in to comment</p>
                    <button type="button" id="comment-signin-btn" class="btn btn-secondary">Sign In</button>
                </div>
            `;
            
            document.getElementById('comment-signin-btn').addEventListener('click', () => this.authService.signIn());
        }
    }
    
    renderMaps(maps) {
        const mapsContainer = document.getElementById('maps-container');
        mapsContainer.innerHTML = '';
        
        if (maps.length === 0) {
            mapsContainer.innerHTML = `
                <div class="empty-state">
                    <p>No maps yet</p>
                </div>
            `;
            return;
        }
        
        maps.forEach(map => {
            const mapItem = document.createElement('div');
            mapItem.className = 'map-item';
            
            mapItem.innerHTML = `
                <div class="map-header">
                    <span class="map-title">${map.title}</span>
                    <div class="map-controls">
                        <button class="btn-icon map-expand-btn" title="Expand Map">
                            <span>⤢</span>
                        </button>
                    </div>
                </div>
                <div class="map-container" id="map-${map.id}"></div>
            `;
            
            mapsContainer.appendChild(mapItem);
            
            // Initialize the map after it's added to DOM
            setTimeout(() => {
                this.earthEngineService.renderMap(map, `map-${map.id}`);
            }, 100);
        });
    }
    
    async handleCreateThread() {
        const titleInput = document.getElementById('thread-title-input');
        const categoryInput = document.getElementById('thread-category-input');
        const descriptionInput = document.getElementById('thread-description-input');
        const requiresAuthInput = document.getElementById('thread-requires-auth');
        
        const threadData = {
            title: titleInput.value,
            category_id: categoryInput.value,
            description: descriptionInput.value,
            requires_auth: requiresAuthInput.checked
        };
        
        try {
            this.showLoading('Creating thread...');
            
            const newThread = await this.threadService.createThread(threadData);
            this.threads.unshift(newThread);
            this.renderThreads();
            
            this.closeAllModals();
            this.showNotification('Thread created successfully', 'success');
            
            // Clear form
            titleInput.value = '';
            descriptionInput.value = '';
            
            this.hideLoading();
            
            // Navigate to the new thread
            this.currentThread = newThread;
            this.showSection('thread-detail');
        } catch (error) {
            console.error('Error creating thread:', error);
            this.hideLoading();
            this.showNotification('Failed to create thread', 'error');
        }
    }
    
    async submitComment() {
        if (!this.currentThread) return;
        
        const commentInput = document.getElementById('comment-input');
        const content = commentInput.value.trim();
        
        if (!content) {
            this.showNotification('Comment cannot be empty', 'warning');
            return;
        }
        
        try {
            this.showLoading('Posting comment...');
            
            const comment = await this.threadService.createComment(this.currentThread.id, { content });
            
            commentInput.value = '';
            
            // Update the comments list
            const comments = await this.threadService.getComments(this.currentThread.id);
            this.renderComments(comments);
            
            this.hideLoading();
            this.showNotification('Comment posted', 'success');
        } catch (error) {
            console.error('Error posting comment:', error);
            this.hideLoading();
            this.showNotification('Failed to post comment', 'error');
        }
    }
    
    async handleAddMap() {
        if (!this.currentThread) return;
        
        const analysisType = document.getElementById('analysis-type-select').value;
        const areaOfInterest = this.earthEngineService.getSelectedArea();
        
        if (!areaOfInterest) {
            this.showNotification('Please select an area on the map', 'warning');
            return;
        }
        
        try {
            this.showLoading('Creating map analysis...');
            
            // Get additional parameters based on analysis type
            const parameters = this.earthEngineService.getAnalysisParameters(analysisType);
            
            // Create the map analysis task
            const task = await this.earthEngineService.createMapAnalysis(
                this.currentThread.id,
                analysisType,
                areaOfInterest,
                parameters
            );
            
            this.closeAllModals();
            this.hideLoading();
            
            this.showNotification('Map analysis started. This may take a few minutes.', 'success');
            
            // Update active tasks
            this.updateActiveTasks();
        } catch (error) {
            console.error('Error creating map analysis:', error);
            this.hideLoading();
            this.showNotification('Failed to create map analysis', 'error');
        }
    }
    
    async sendChatMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        
        if (!message) return;
        
        try {
            // Clear input
            input.value = '';
            
            // Add user message to UI first
            this.aiChatService.addUserMessage(message);
            
            // Scroll to bottom of chat
            this.scrollChatToBottom();
            
            // Show typing indicator while waiting for response
            this.aiChatService.showTypingIndicator();
            
            // Send message to API
            const response = await this.aiChatService.sendMessage(message);
            
            // Remove typing indicator
            this.aiChatService.hideTypingIndicator();
            
            // Add AI response to UI
            if (response.message) {
                this.aiChatService.addAIMessage(response.message);
            } else {
                throw new Error('Invalid response from AI service');
            }
            
            // Scroll to bottom of chat
            this.scrollChatToBottom();
        } catch (error) {
            console.error('Error sending message:', error);
            this.aiChatService.hideTypingIndicator();
            this.aiChatService.addSystemMessage('Sorry, there was an error processing your message. Please try again.');
        }
    }
    
    scrollChatToBottom() {
        const chatMessages = document.getElementById('chat-messages');
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    clearChat() {
        this.aiChatService.clearChat();
    }
    
    toggleSemanticSearch() {
        const button = document.getElementById('toggle-semantic-search');
        const isEnabled = this.aiChatService.toggleSemanticSearch();
        
        if (isEnabled) {
            button.classList.add('active');
            this.showNotification('Semantic search enabled', 'success');
        } else {
            button.classList.remove('active');
            this.showNotification('Semantic search disabled', 'info');
        }
    }
    
    shareThread() {
        if (!this.currentThread) return;
        
        // Create a short URL for sharing
        const shareUrl = `${window.location.origin}/thread/${this.currentThread.id}`;
        
        // Copy to clipboard
        navigator.clipboard.writeText(shareUrl)
            .then(() => {
                this.showNotification('Thread link copied to clipboard', 'success');
            })
            .catch(() => {
                // Fallback if clipboard API fails
                this.showNotification('Share URL: ' + shareUrl, 'info');
            });
    }
    
    async updateActiveTasks() {
        try {
            const tasks = await this.backgroundTasksService.getActiveTasks();
            this.activeTasks = tasks;
            
            // Update indicator
            this.taskIndicator.textContent = tasks.length;
            
            // Update tasks panel if visible
            if (this.currentSection === 'tasks-panel') {
                this.renderTasks();
            }
        } catch (error) {
            console.error('Error updating tasks:', error);
        }
    }
    
    async refreshTasks() {
        this.showLoading('Refreshing tasks...');
        await this.updateActiveTasks();
        this.renderTasks();
        this.hideLoading();
    }
    
    renderTasks() {
        const tasksContainer = document.getElementById('tasks-container');
        tasksContainer.innerHTML = '';
        
        if (this.activeTasks.length === 0) {
            tasksContainer.innerHTML = `
                <div class="empty-state">
                    <p>No active tasks</p>
                </div>
            `;
            return;
        }
        
        this.activeTasks.forEach(task => {
            const taskCard = document.createElement('div');
            taskCard.className = 'task-card';
            taskCard.dataset.id = task.id;
            
            const statusClass = task.status === 'COMPLETED' ? 'completed' : 
                                task.status === 'FAILED' ? 'failed' : 'pending';
            
            const progress = task.progress || 0;
            
            taskCard.innerHTML = `
                <div class="task-header">
                    <h3 class="task-title">${task.title}</h3>
                    <span class="task-status ${statusClass}">${task.status}</span>
                </div>
                <div class="task-meta">
                    <span>Started: ${new Date(task.created_at).toLocaleString()}</span>
                </div>
                <div class="task-progress-bar">
                    <div class="task-progress-fill" style="width: ${progress}%"></div>
                </div>
            `;
            
            tasksContainer.appendChild(taskCard);
        });
    }
    
    updateTask(task) {
        // Update the task in our list
        const index = this.activeTasks.findIndex(t => t.id === task.id);
        
        if (index >= 0) {
            this.activeTasks[index] = task;
        } else {
            this.activeTasks.push(task);
        }
        
        // Update UI
        this.taskIndicator.textContent = this.activeTasks.length;
        
        // If task is completed and it's a map task, reload maps if we're viewing the thread
        if (task.status === 'COMPLETED' && task.type === 'MAP_ANALYSIS' && 
            this.currentThread && this.currentThread.id === task.thread_id) {
            this.loadThreadDetails(this.currentThread);
        }
        
        // Update tasks panel if visible
        if (this.currentSection === 'tasks-panel') {
            this.renderTasks();
        }
        
        // Show notification for completed tasks
        if (task.status === 'COMPLETED') {
            this.showNotification(`Task completed: ${task.title}`, 'success');
        } else if (task.status === 'FAILED') {
            this.showNotification(`Task failed: ${task.title}`, 'error');
        }
    }
    
    updateThread(thread) {
        // Update in our list
        const index = this.threads.findIndex(t => t.id === thread.id);
        if (index >= 0) {
            this.threads[index] = thread;
        }
        
        // Update UI if we're viewing this thread
        if (this.currentThread && this.currentThread.id === thread.id) {
            this.currentThread = thread;
            document.getElementById('thread-title').textContent = thread.title;
            document.getElementById('thread-description').innerHTML = thread.description;
        }
        
        // Update thread list if visible
        if (this.currentSection === 'thread-list') {
            this.renderThreads();
        }
    }
    
    addComment(comment) {
        // If we're viewing this thread, add the comment to UI
        if (this.currentThread && this.currentThread.id === comment.thread_id) {
            const commentsContainer = document.getElementById('comments-container');
            
            // Remove empty state if present
            const emptyState = commentsContainer.querySelector('.empty-state');
            if (emptyState) {
                emptyState.remove();
            }
            
            // Create new comment element
            const commentItem = document.createElement('div');
            commentItem.className = 'comment-item';
            commentItem.innerHTML = `
                <div class="comment-header">
                    <span class="comment-user">${comment.author_name || 'Anonymous'}</span>
                    <span class="comment-timestamp">${new Date(comment.created_at).toLocaleString()}</span>
                </div>
                <div class="comment-content">${comment.content}</div>
            `;
            
            commentsContainer.appendChild(commentItem);
        }
        
        // Update the comment count in the thread list
        const thread = this.threads.find(t => t.id === comment.thread_id);
        if (thread) {
            thread.comment_count = (thread.comment_count || 0) + 1;
            this.renderThreads();
        }
    }
    
    renderAuthUI() {
        // Render auth UI in the header
        this.renderHeaderAuthSection();
        
        // Render auth UI in the chat section
        this.renderChatAuthSection();
    }
    
    renderHeaderAuthSection() {
        if (!this.authSection) return;
        
        if (this.user) {
            this.authSection.innerHTML = `
                <div class="user-info">
                    <span class="user-name">${this.user.name}</span>
                    <button id="logout-btn" class="btn btn-ghost btn-sm">Sign Out</button>
                </div>
            `;
            
            document.getElementById('logout-btn').addEventListener('click', () => this.authService.signOut());
        } else {
            this.authSection.innerHTML = `
                <button id="login-btn" class="btn btn-primary">Sign In</button>
            `;
            
            document.getElementById('login-btn').addEventListener('click', () => this.authService.signIn());
        }
    }
    
    renderChatAuthSection() {
        if (!this.chatAuthSection) return;
        
        if (this.user) {
            this.chatAuthSection.innerHTML = `
                <div class="chat-user-info">
                    <img src="${this.user.picture || 'https://via.placeholder.com/30'}" class="user-avatar" alt="${this.user.name}">
                    <span class="user-name">${this.user.name}</span>
                </div>
            `;
        } else {
            this.chatAuthSection.innerHTML = `
                <button id="chat-login-btn" class="btn btn-primary btn-sm">Sign In to Chat with Bella</button>
            `;
            
            document.getElementById('chat-login-btn').addEventListener('click', () => this.authService.signIn());
        }
    }
    
    updateChatInputState() {
        if (this.user) {
            this.chatInput.disabled = false;
            this.sendChatBtn.disabled = false;
            this.chatInput.placeholder = "Type a message to Bella...";
        } else {
            this.chatInput.disabled = true;
            this.sendChatBtn.disabled = true;
            this.chatInput.placeholder = "Please login to chat with Bella...";
        }
    }
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ChatApp();
});

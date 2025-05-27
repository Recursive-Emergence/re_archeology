/**
 * RE-Archaeology MVP1 Main Application
 * Handles the three-pane interface with Neo4j backend
 */

class MVP1App {
    constructor() {
        this.map = null;
        this.currentThread = null;
        this.currentUser = null;
        this.threads = [];
        this.hypotheses = [];
        this.sites = [];
    }

    async init() {
        console.log('Initializing MVP1 App...');
        
        // Check for existing user session
        this.currentUser = neo4jAPI.getCurrentUser();
        this.updateUserInterface();
        
        // Initialize data if user is logged in
        if (this.currentUser) {
            await this.loadData();
        }
        
        // Initialize map when map tab is shown
        document.getElementById('map-tab').addEventListener('click', () => {
            setTimeout(() => this.initializeMap(), 100);
        });
        
        console.log('MVP1 App initialized');
    }

    updateUserInterface() {
        const userInfo = document.getElementById('userInfo');
        const loginSection = document.getElementById('loginSection');
        const userName = document.getElementById('userName');
        
        if (this.currentUser) {
            userName.textContent = this.currentUser.name;
            userInfo.style.display = 'block';
            loginSection.style.display = 'none';
        } else {
            userInfo.style.display = 'none';
            loginSection.style.display = 'block';
        }
    }

    async loadData() {
        try {
            // Load threads
            this.threads = await neo4jAPI.getAllThreads();
            this.renderThreadsList();
            
            // Load hypotheses
            this.hypotheses = await neo4jAPI.getAllHypotheses();
            this.renderHypothesesList();
            
            // Load sites
            this.sites = await neo4jAPI.getAllSites();
            this.renderSitesList();
            
        } catch (error) {
            console.error('Error loading data:', error);
            this.showError('Failed to load data: ' + error.message);
        }
    }

    renderThreadsList() {
        const threadsList = document.getElementById('threadsList');
        
        if (this.threads.length === 0) {
            threadsList.innerHTML = `
                <div class="text-center text-muted py-3">
                    <i class="fas fa-comments-slash fa-2x mb-2"></i>
                    <p>No threads yet</p>
                    <small>Create your first discussion thread</small>
                </div>
            `;
            return;
        }
        
        threadsList.innerHTML = this.threads.map(thread => `
            <div class="thread-item ${this.currentThread?.id === thread.id ? 'active' : ''}" 
                 onclick="app.selectThread('${thread.id}')">
                <div class="fw-bold">${this.escapeHtml(thread.title)}</div>
                <div class="text-muted small">
                    <i class="fas fa-clock"></i> ${this.formatDate(thread.created_at)}
                </div>
                ${thread.tags && thread.tags.length > 0 ? `
                    <div class="mt-1">
                        ${thread.tags.map(tag => `<span class="badge bg-secondary me-1">${this.escapeHtml(tag)}</span>`).join('')}
                    </div>
                ` : ''}
            </div>
        `).join('');
    }

    async selectThread(threadId) {
        try {
            this.currentThread = await neo4jAPI.getThread(threadId);
            neo4jAPI.setCurrentThread(this.currentThread);
            
            this.renderThreadsList(); // Update active state
            this.renderThreadContent();
            
            // Switch to discussion tab
            const discussionTab = document.getElementById('discussion-tab');
            const discussionTabTrigger = new bootstrap.Tab(discussionTab);
            discussionTabTrigger.show();
            
        } catch (error) {
            console.error('Error selecting thread:', error);
            this.showError('Failed to load thread: ' + error.message);
        }
    }

    renderThreadContent() {
        const threadContent = document.getElementById('threadContent');
        
        if (!this.currentThread) {
            threadContent.innerHTML = `
                <div class="text-center text-muted py-5">
                    <i class="fas fa-comments fa-3x mb-3"></i>
                    <h5>Select a thread to start discussing</h5>
                    <p>Choose a thread from the left panel or create a new one</p>
                </div>
            `;
            return;
        }
        
        threadContent.innerHTML = `
            <div class="thread-header mb-4">
                <h4>${this.escapeHtml(this.currentThread.title)}</h4>
                <div class="text-muted">
                    <i class="fas fa-user"></i> Started by User ${this.currentThread.starter_user_id}
                    <span class="ms-3">
                        <i class="fas fa-clock"></i> ${this.formatDate(this.currentThread.created_at)}
                    </span>
                </div>
                ${this.currentThread.tags && this.currentThread.tags.length > 0 ? `
                    <div class="mt-2">
                        ${this.currentThread.tags.map(tag => `<span class="badge bg-primary me-1">${this.escapeHtml(tag)}</span>`).join('')}
                    </div>
                ` : ''}
            </div>
            
            <div class="discussion-content">
                <div class="text-center text-muted py-4">
                    <i class="fas fa-comments fa-2x mb-3"></i>
                    <p>Discussion content will be implemented in the next iteration</p>
                    <small>This thread is ready for messages and hypothesis discussions</small>
                </div>
            </div>
        `;
    }

    renderHypothesesList() {
        const hypothesesList = document.getElementById('hypothesesList');
        
        if (this.hypotheses.length === 0) {
            hypothesesList.innerHTML = `
                <div class="text-center text-muted py-3">
                    <i class="fas fa-lightbulb fa-lg mb-2"></i>
                    <p>No hypotheses yet</p>
                </div>
            `;
            return;
        }
        
        hypothesesList.innerHTML = this.hypotheses.map(hypothesis => `
            <div class="hypothesis-card">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <span class="confidence-badge">${Math.round(hypothesis.confidence_score * 100)}%</span>
                    <span class="status-badge status-${hypothesis.status}">${hypothesis.status}</span>
                </div>
                <p class="mb-1">${this.escapeHtml(hypothesis.statement)}</p>
                <small class="text-muted">
                    <i class="fas fa-clock"></i> ${this.formatDate(hypothesis.created_at)}
                </small>
            </div>
        `).join('');
    }

    renderSitesList() {
        const rightSitesList = document.getElementById('rightSitesList');
        const sitesList = document.getElementById('sitesList');
        
        if (this.sites.length === 0) {
            const emptyContent = `
                <div class="text-center text-muted py-3">
                    <i class="fas fa-map-marker-alt fa-lg mb-2"></i>
                    <p>No sites yet</p>
                </div>
            `;
            if (rightSitesList) rightSitesList.innerHTML = emptyContent;
            if (sitesList) sitesList.innerHTML = emptyContent;
            return;
        }
        
        const sitesHTML = this.sites.map(site => `
            <div class="artifact-item" onclick="app.selectSite('${site.id}')">
                <i class="fas fa-map-marker-alt text-success"></i>
                <div>
                    <div class="fw-bold">${this.escapeHtml(site.name)}</div>
                    <small class="text-muted">
                        ${site.latitude.toFixed(6)}, ${site.longitude.toFixed(6)}
                        <span class="badge bg-${site.status === 'confirmed' ? 'success' : 'warning'} ms-1">
                            ${site.status}
                        </span>
                    </small>
                </div>
            </div>
        `).join('');
        
        if (rightSitesList) rightSitesList.innerHTML = sitesHTML;
        if (sitesList) sitesList.innerHTML = sitesHTML;
    }

    selectSite(siteId) {
        const site = this.sites.find(s => s.id === siteId);
        if (site && this.map) {
            // Switch to map tab and center on site
            const mapTab = document.getElementById('map-tab');
            const mapTabTrigger = new bootstrap.Tab(mapTab);
            mapTabTrigger.show();
            
            setTimeout(() => {
                this.map.setView([site.latitude, site.longitude], 15);
            }, 100);
        }
    }

    initializeMap() {
        if (this.map) return; // Already initialized
        
        const mapContainer = document.getElementById('mapContainer');
        if (!mapContainer) return;
        
        this.map = L.map('mapContainer').setView([-10.0, -60.0], 6); // Amazon region
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);
        
        // Add sites to map
        this.sites.forEach(site => {
            const marker = L.marker([site.latitude, site.longitude])
                .addTo(this.map)
                .bindPopup(`
                    <strong>${this.escapeHtml(site.name)}</strong><br>
                    Status: ${site.status}<br>
                    <small>${site.latitude.toFixed(6)}, ${site.longitude.toFixed(6)}</small>
                `);
        });
        
        console.log('Map initialized with', this.sites.length, 'sites');
    }

    // Modal handlers
    showLoginModal() {
        const modal = new bootstrap.Modal(document.getElementById('loginModal'));
        modal.show();
    }

    async handleLogin() {
        const name = document.getElementById('userNameInput').value.trim();
        const email = document.getElementById('userEmailInput').value.trim();
        const role = document.getElementById('userRoleInput').value;
        
        if (!name || !email) {
            this.showError('Please fill in all fields');
            return;
        }
        
        try {
            // Try to get existing user first
            let user;
            try {
                user = await neo4jAPI.getUserByEmail(email);
                console.log('Found existing user:', user);
            } catch (error) {
                // User doesn't exist, create new one
                console.log('Creating new user...');
                user = await neo4jAPI.createUser({ name, email, role });
                console.log('Created new user:', user);
            }
            
            this.currentUser = user;
            neo4jAPI.setCurrentUser(user);
            this.updateUserInterface();
            
            // Close modal and load data
            const modal = bootstrap.Modal.getInstance(document.getElementById('loginModal'));
            modal.hide();
            
            await this.loadData();
            this.showSuccess('Welcome, ' + user.name + '!');
            
        } catch (error) {
            console.error('Login error:', error);
            this.showError('Login failed: ' + error.message);
        }
    }

    logout() {
        this.currentUser = null;
        neo4jAPI.clearCurrentUser();
        this.updateUserInterface();
        
        // Clear data
        this.threads = [];
        this.hypotheses = [];
        this.sites = [];
        this.currentThread = null;
        
        this.renderThreadsList();
        this.renderHypothesesList();
        this.renderSitesList();
        this.renderThreadContent();
    }

    showCreateThreadModal() {
        if (!this.currentUser) {
            this.showError('Please login first');
            return;
        }
        
        const modal = new bootstrap.Modal(document.getElementById('createThreadModal'));
        modal.show();
    }

    async handleCreateThread() {
        const title = document.getElementById('threadTitleInput').value.trim();
        const tagsInput = document.getElementById('threadTagsInput').value.trim();
        const tags = tagsInput ? tagsInput.split(',').map(tag => tag.trim()) : [];
        
        if (!title) {
            this.showError('Please enter a thread title');
            return;
        }
        
        try {
            const thread = await neo4jAPI.createThread({
                title,
                tags,
                starter_user_id: this.currentUser.id
            });
            
            this.threads.unshift(thread);
            this.renderThreadsList();
            
            // Close modal and select the new thread
            const modal = bootstrap.Modal.getInstance(document.getElementById('createThreadModal'));
            modal.hide();
            
            // Clear form
            document.getElementById('threadTitleInput').value = '';
            document.getElementById('threadTagsInput').value = '';
            
            await this.selectThread(thread.id);
            this.showSuccess('Thread created successfully!');
            
        } catch (error) {
            console.error('Error creating thread:', error);
            this.showError('Failed to create thread: ' + error.message);
        }
    }

    showCreateHypothesisModal() {
        if (!this.currentUser) {
            this.showError('Please login first');
            return;
        }
        
        if (!this.currentThread) {
            this.showError('Please select a thread first');
            return;
        }
        
        const modal = new bootstrap.Modal(document.getElementById('createHypothesisModal'));
        modal.show();
    }

    async handleCreateHypothesis() {
        const statement = document.getElementById('hypothesisStatementInput').value.trim();
        const confidence_score = parseFloat(document.getElementById('confidenceScoreInput').value);
        
        if (!statement) {
            this.showError('Please enter a hypothesis statement');
            return;
        }
        
        try {
            const hypothesis = await neo4jAPI.createHypothesis({
                statement,
                confidence_score,
                proposed_by_user: this.currentUser.id,
                emerged_from_thread: this.currentThread.id
            });
            
            this.hypotheses.unshift(hypothesis);
            this.renderHypothesesList();
            
            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('createHypothesisModal'));
            modal.hide();
            
            // Clear form
            document.getElementById('hypothesisStatementInput').value = '';
            document.getElementById('confidenceScoreInput').value = '0.5';
            
            this.showSuccess('Hypothesis created successfully!');
            
        } catch (error) {
            console.error('Error creating hypothesis:', error);
            this.showError('Failed to create hypothesis: ' + error.message);
        }
    }

    showCreateSiteModal() {
        if (!this.currentUser) {
            this.showError('Please login first');
            return;
        }
        
        const modal = new bootstrap.Modal(document.getElementById('createSiteModal'));
        modal.show();
    }

    async handleCreateSite() {
        const name = document.getElementById('siteNameInput').value.trim();
        const latitude = parseFloat(document.getElementById('siteLatitudeInput').value);
        const longitude = parseFloat(document.getElementById('siteLongitudeInput').value);
        const status = document.getElementById('siteStatusInput').value;
        
        if (!name || isNaN(latitude) || isNaN(longitude)) {
            this.showError('Please fill in all fields with valid values');
            return;
        }
        
        try {
            const site = await neo4jAPI.createSite({
                name,
                latitude,
                longitude,
                status
            });
            
            this.sites.unshift(site);
            this.renderSitesList();
            
            // Add to map if initialized
            if (this.map) {
                const marker = L.marker([site.latitude, site.longitude])
                    .addTo(this.map)
                    .bindPopup(`
                        <strong>${this.escapeHtml(site.name)}</strong><br>
                        Status: ${site.status}<br>
                        <small>${site.latitude.toFixed(6)}, ${site.longitude.toFixed(6)}</small>
                    `);
            }
            
            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('createSiteModal'));
            modal.hide();
            
            // Clear form
            document.getElementById('siteNameInput').value = '';
            document.getElementById('siteLatitudeInput').value = '';
            document.getElementById('siteLongitudeInput').value = '';
            document.getElementById('siteStatusInput').value = 'candidate';
            
            this.showSuccess('Site created successfully!');
            
        } catch (error) {
            console.error('Error creating site:', error);
            this.showError('Failed to create site: ' + error.message);
        }
    }

    // Utility methods
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    showError(message) {
        // Simple alert for now - could be replaced with toast notifications
        alert('Error: ' + message);
    }

    showSuccess(message) {
        // Simple alert for now - could be replaced with toast notifications
        alert('Success: ' + message);
    }
}

// Global functions for HTML onclick handlers
function showLoginModal() {
    app.showLoginModal();
}

function handleLogin() {
    app.handleLogin();
}

function logout() {
    app.logout();
}

function showCreateThreadModal() {
    app.showCreateThreadModal();
}

function handleCreateThread() {
    app.handleCreateThread();
}

function showCreateHypothesisModal() {
    app.showCreateHypothesisModal();
}

function handleCreateHypothesis() {
    app.handleCreateHypothesis();
}

function showCreateSiteModal() {
    app.showCreateSiteModal();
}

function handleCreateSite() {
    app.handleCreateSite();
}

// Initialize app when DOM is loaded
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new MVP1App();
    app.init();
});

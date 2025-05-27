/**
 * Neo4j API client for RE-Archaeology MVP1
 */

class Neo4jAPI {
    constructor() {
        this.baseURL = '/api/v1';
        this.currentUser = null;
        this.currentThread = null;
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
            },
        };

        const mergedOptions = { ...defaultOptions, ...options };
        
        try {
            const response = await fetch(url, mergedOptions);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error(`API request failed: ${endpoint}`, error);
            throw error;
        }
    }

    // User Management
    async createUser(userData) {
        return this.request('/users/', {
            method: 'POST',
            body: JSON.stringify(userData)
        });
    }

    async getUserByEmail(email) {
        return this.request(`/users/email/${encodeURIComponent(email)}`);
    }

    async getAllUsers() {
        return this.request('/users/');
    }

    // Thread Management
    async createThread(threadData) {
        return this.request('/threads/', {
            method: 'POST',
            body: JSON.stringify(threadData)
        });
    }

    async getAllThreads() {
        return this.request('/threads/');
    }

    async getThread(threadId) {
        return this.request(`/threads/${threadId}`);
    }

    async getThreadsByUser(userId) {
        return this.request(`/threads/user/${userId}`);
    }

    // Hypothesis Management
    async createHypothesis(hypothesisData) {
        return this.request('/hypotheses/', {
            method: 'POST',
            body: JSON.stringify(hypothesisData)
        });
    }

    async getAllHypotheses() {
        return this.request('/hypotheses/');
    }

    async getHypothesis(hypothesisId) {
        return this.request(`/hypotheses/${hypothesisId}`);
    }

    // Site Management
    async createSite(siteData) {
        return this.request('/sites/', {
            method: 'POST',
            body: JSON.stringify(siteData)
        });
    }

    async getAllSites() {
        return this.request('/sites/');
    }

    async getSite(siteId) {
        return this.request(`/sites/${siteId}`);
    }

    async getSitesNearLocation(latitude, longitude, radiusKm = 10) {
        return this.request(`/sites/near/?latitude=${latitude}&longitude=${longitude}&radius_km=${radiusKm}`);
    }

    // Authentication helpers
    setCurrentUser(user) {
        this.currentUser = user;
        localStorage.setItem('currentUser', JSON.stringify(user));
    }

    getCurrentUser() {
        if (!this.currentUser) {
            const stored = localStorage.getItem('currentUser');
            if (stored) {
                this.currentUser = JSON.parse(stored);
            }
        }
        return this.currentUser;
    }

    clearCurrentUser() {
        this.currentUser = null;
        localStorage.removeItem('currentUser');
    }

    setCurrentThread(thread) {
        this.currentThread = thread;
    }

    getCurrentThread() {
        return this.currentThread;
    }
}

// Global API instance
window.neo4jAPI = new Neo4jAPI();

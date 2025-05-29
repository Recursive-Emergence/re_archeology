/**
 * Thread Service for RE-Archaeology Framework
 * Handles thread operations like creating, updating, and managing discussion threads
 */

class ThreadService {
    constructor() {
        this.baseUrl = '/api/v1/threads';
        this.authService = null; // Will be set by the main app
    }

    setAuthService(authService) {
        this.authService = authService;
    }

    getAuthHeaders() {
        if (this.authService && this.authService.isAuthenticated()) {
            return this.authService.getAuthHeaders();
        }
        return {
            'Content-Type': 'application/json'
        };
    }

    /**
     * Get all threads for the current user
     */
    async getThreads() {
        try {
            const response = await fetch(this.baseUrl, {
                headers: this.getAuthHeaders()
            });

            if (response.ok) {
                return await response.json();
            } else {
                throw new Error('Failed to fetch threads');
            }
        } catch (error) {
            console.error('Error fetching threads:', error);
            return [];
        }
    }

    /**
     * Get a specific thread by ID
     */
    async getThread(threadId) {
        try {
            const response = await fetch(`${this.baseUrl}/${threadId}`, {
                headers: this.getAuthHeaders()
            });

            if (response.ok) {
                return await response.json();
            } else {
                throw new Error('Failed to fetch thread');
            }
        } catch (error) {
            console.error('Error fetching thread:', error);
            return null;
        }
    }

    /**
     * Create a new thread
     */
    async createThread(threadData) {
        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify(threadData)
            });

            if (response.ok) {
                return await response.json();
            } else {
                throw new Error('Failed to create thread');
            }
        } catch (error) {
            console.error('Error creating thread:', error);
            throw error;
        }
    }

    /**
     * Update an existing thread
     */
    async updateThread(threadId, updates) {
        try {
            const response = await fetch(`${this.baseUrl}/${threadId}`, {
                method: 'PUT',
                headers: this.getAuthHeaders(),
                body: JSON.stringify(updates)
            });

            if (response.ok) {
                return await response.json();
            } else {
                throw new Error('Failed to update thread');
            }
        } catch (error) {
            console.error('Error updating thread:', error);
            throw error;
        }
    }

    /**
     * Delete a thread
     */
    async deleteThread(threadId) {
        try {
            const response = await fetch(`${this.baseUrl}/${threadId}`, {
                method: 'DELETE',
                headers: this.getAuthHeaders()
            });

            if (response.ok) {
                return true;
            } else {
                throw new Error('Failed to delete thread');
            }
        } catch (error) {
            console.error('Error deleting thread:', error);
            return false;
        }
    }

    /**
     * Get comments for a thread
     */
    async getThreadComments(threadId) {
        try {
            const response = await fetch(`${this.baseUrl}/${threadId}/comments`, {
                headers: this.getAuthHeaders()
            });

            if (response.ok) {
                return await response.json();
            } else {
                throw new Error('Failed to fetch thread comments');
            }
        } catch (error) {
            console.error('Error fetching thread comments:', error);
            return [];
        }
    }

    /**
     * Add a comment to a thread
     */
    async addComment(threadId, commentData) {
        try {
            const response = await fetch(`${this.baseUrl}/${threadId}/comments`, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify(commentData)
            });

            if (response.ok) {
                return await response.json();
            } else {
                throw new Error('Failed to add comment');
            }
        } catch (error) {
            console.error('Error adding comment:', error);
            throw error;
        }
    }

    /**
     * Update a comment
     */
    async updateComment(threadId, commentId, updates) {
        try {
            const response = await fetch(`${this.baseUrl}/${threadId}/comments/${commentId}`, {
                method: 'PUT',
                headers: this.getAuthHeaders(),
                body: JSON.stringify(updates)
            });

            if (response.ok) {
                return await response.json();
            } else {
                throw new Error('Failed to update comment');
            }
        } catch (error) {
            console.error('Error updating comment:', error);
            throw error;
        }
    }

    /**
     * Delete a comment
     */
    async deleteComment(threadId, commentId) {
        try {
            const response = await fetch(`${this.baseUrl}/${threadId}/comments/${commentId}`, {
                method: 'DELETE',
                headers: this.getAuthHeaders()
            });

            if (response.ok) {
                return true;
            } else {
                throw new Error('Failed to delete comment');
            }
        } catch (error) {
            console.error('Error deleting comment:', error);
            return false;
        }
    }

    /**
     * Get thread categories
     */
    async getCategories() {
        try {
            const response = await fetch(`${this.baseUrl}/categories`, {
                headers: this.getAuthHeaders()
            });

            if (response.ok) {
                return await response.json();
            } else {
                throw new Error('Failed to fetch categories');
            }
        } catch (error) {
            console.error('Error fetching categories:', error);
            return [];
        }
    }
}

// Global thread service instance
const threadService = new ThreadService();

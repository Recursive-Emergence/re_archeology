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
            // Skip API call if we're in development mode
            if (this.isDevMode()) {
                console.log('Development mode: Returning mock thread data');
                return this.getMockThreads();
            }
            
            // Try to fetch from API
            try {
                const response = await fetch(this.baseUrl, {
                    headers: this.getAuthHeaders()
                });

                if (response.ok) {
                    return await response.json();
                }
            } catch (error) {
                console.warn('API not available, using mock thread data');
            }
            
            // If API fails, return mock data for UI development/testing
            return this.getMockThreads();
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
     * Create a new comment on a thread
     */
    async createComment(threadId, data) {
        try {
            // Try to post to API
            try {
                const response = await fetch(`${this.baseUrl}/${threadId}/comments`, {
                    method: 'POST',
                    headers: this.getAuthHeaders(),
                    body: JSON.stringify(data)
                });

                if (response.ok) {
                    return await response.json();
                }
            } catch (error) {
                console.warn('API not available, using mock comment creation');
            }
            
            // If API fails, return mock data
            return {
                id: 'comment-' + Date.now(),
                thread_id: threadId,
                content: data.content,
                author_name: 'Current User',
                created_at: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error creating comment:', error);
            throw error;
        }
    }
    
    /**
     * Create a new thread
     */
    async createThread(threadData) {
        try {
            // Try to post to API
            try {
                const response = await fetch(this.baseUrl, {
                    method: 'POST',
                    headers: this.getAuthHeaders(),
                    body: JSON.stringify(threadData)
                });

                if (response.ok) {
                    return await response.json();
                }
            } catch (error) {
                console.warn('API not available, using mock thread creation');
            }
            
            // If API fails, return mock data
            return {
                id: 'thread-' + Date.now(),
                title: threadData.title,
                description: threadData.description,
                category_id: threadData.category_id,
                author_name: 'Current User',
                comment_count: 0,
                map_count: 0,
                created_at: new Date().toISOString()
            };
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
     * Get a thread by ID
     */
    async getThreadById(threadId) {
        try {
            // Try to fetch from API
            try {
                const response = await fetch(`${this.baseUrl}/${threadId}`, {
                    headers: this.getAuthHeaders()
                });

                if (response.ok) {
                    return await response.json();
                }
            } catch (error) {
                console.warn('API not available, using mock thread data');
            }
            
            // If API fails, return mock data
            const mockThreads = [
                {
                    id: 'thread-1',
                    title: 'Mock Thread 1',
                    description: 'This is a mock thread for testing the UI when API is unavailable. This description contains more details about the archaeological findings discussed in this thread.',
                    category_id: 'cat-1',
                    author_name: 'Test User',
                    comment_count: 3,
                    map_count: 1,
                    created_at: new Date().toISOString()
                },
                {
                    id: 'thread-2',
                    title: 'Mock Thread 2',
                    description: 'Another mock thread for UI testing. This thread discusses potential excavation sites near ancient settlements.',
                    category_id: 'cat-2',
                    author_name: 'Test User',
                    comment_count: 0,
                    map_count: 0,
                    created_at: new Date().toISOString()
                }
            ];
            
            const thread = mockThreads.find(t => t.id === threadId);
            if (thread) {
                return thread;
            } else {
                throw new Error('Thread not found');
            }
        } catch (error) {
            console.error('Error fetching thread details:', error);
            throw error;
        }
    }
    
    /**
     * Get comments for a thread
     */
    async getComments(threadId) {
        try {
            // Try to fetch from API
            try {
                const response = await fetch(`${this.baseUrl}/${threadId}/comments`, {
                    headers: this.getAuthHeaders()
                });

                if (response.ok) {
                    return await response.json();
                }
            } catch (error) {
                console.warn('API not available, using mock comment data');
            }
            
            // If API fails, return mock data
            if (threadId === 'thread-1') {
                return [
                    {
                        id: 'comment-1',
                        thread_id: threadId,
                        content: 'This is a very interesting discovery!',
                        author_name: 'Researcher 1',
                        created_at: new Date().toISOString()
                    },
                    {
                        id: 'comment-2',
                        thread_id: threadId,
                        content: 'I agree, we should investigate further with ground-penetrating radar.',
                        author_name: 'Researcher 2',
                        created_at: new Date().toISOString()
                    },
                    {
                        id: 'comment-3',
                        thread_id: threadId,
                        content: 'The dating methods used here seem appropriate for the context.',
                        author_name: 'Researcher 3',
                        created_at: new Date().toISOString()
                    }
                ];
            } else {
                return [];
            }
        } catch (error) {
            console.error('Error fetching comments:', error);
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
            // Skip API call if we're in development mode
            if (this.isDevMode()) {
                console.log('Development mode: Returning mock category data');
                return this.getMockCategories();
            }
            
            // Try to fetch from API
            try {
                const response = await fetch(`${this.baseUrl}/categories`, {
                    headers: this.getAuthHeaders()
                });

                if (response.ok) {
                    return await response.json();
                }
            } catch (error) {
                console.warn('API not available, using mock categories data');
            }
            
            // If API fails, return mock data for UI development/testing
            return this.getMockCategories();
        } catch (error) {
            console.error('Error fetching categories:', error);
            return [];
        }
    }
    
    /**
     * Get mock threads for development
     */
    getMockThreads() {
        return [
            {
                id: 'thread-1',
                title: 'Mock Thread 1',
                description: 'This is a mock thread for testing the UI when API is unavailable',
                category_id: 'cat-1',
                author_name: 'Test User',
                comment_count: 3,
                map_count: 1,
                created_at: new Date().toISOString()
            },
            {
                id: 'thread-2',
                title: 'Mock Thread 2',
                description: 'Another mock thread for UI testing',
                category_id: 'cat-2',
                author_name: 'Test User',
                comment_count: 0,
                map_count: 0,
                created_at: new Date().toISOString()
            }
        ];
    }
    
    /**
     * Get mock categories for development
     */
    getMockCategories() {
        return [
            {
                id: 'cat-1',
                name: 'Surveys',
                icon: '🔍'
            },
            {
                id: 'cat-2',
                name: 'Excavations',
                icon: '⛏️'
            },
            {
                id: 'cat-3',
                name: 'Artifacts',
                icon: '🏺'
            },
            {
                id: 'cat-4',
                name: 'Dating Methods',
                icon: '📅'
            }
        ];
    }
    
    /**
     * Check if we're running in development mode without backend
     */
    isDevMode() {
        return window.location.hostname === 'localhost' && 
               !window.RE_ARCHAEOLOGY_CONFIG?.enableBackend;
    }
}

// Global thread service instance
const threadService = new ThreadService();

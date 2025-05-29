/**
 * AI Chat Service for RE-Archaeology Framework
 * Handles chat with OpenAI integration and semantic search
 * Optimized for performance with caching and retry logic
 */

class AIChatService {
    constructor() {
        this.baseUrl = '/api/ai-chat';
        this.messages = [];
        this.isLoading = false;
        
        // Performance optimizations
        this.messageCache = new Map();
        this.requestQueue = [];
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second
        this.rateLimitDelay = 2000; // 2 seconds between requests
        this.lastRequestTime = 0;
        
        // Debouncing for rapid inputs
        this.sendMessageDebounced = this.debounce(this.sendMessage.bind(this), 300);
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    async sendMessage(message, useSemanticSearch = true, threadId = null) {
        if (this.isLoading || !message.trim()) return;

        // Check cache first
        const cacheKey = `${message}-${useSemanticSearch}-${threadId}`;
        if (this.messageCache.has(cacheKey)) {
            const cachedResponse = this.messageCache.get(cacheKey);
            this.addMessageToDisplay(cachedResponse);
            return cachedResponse;
        }

        // Rate limiting
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.rateLimitDelay) {
            await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay - timeSinceLastRequest));
        }

        // Add user message to display
        this.addMessageToDisplay({
            content: message,
            role: 'user',
            timestamp: new Date().toISOString()
        });

        this.setLoading(true);
        let retryCount = 0;

        while (retryCount < this.maxRetries) {
            try {
                this.lastRequestTime = Date.now();
                
                const response = await fetch(`${this.baseUrl}/chat`, {
                    method: 'POST',
                    headers: authService.getAuthHeaders(),
                    body: JSON.stringify({
                        message: message,
                        use_semantic_search: useSemanticSearch,
                        thread_id: threadId
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    
                    const assistantMessage = {
                        content: data.response,
                        role: 'assistant',
                        timestamp: data.timestamp,
                        sources: data.sources,
                        context_used: data.context_used
                    };

                    // Cache the response
                    this.messageCache.set(cacheKey, assistantMessage);
                    
                    // Limit cache size
                    if (this.messageCache.size > 100) {
                        const firstKey = this.messageCache.keys().next().value;
                        this.messageCache.delete(firstKey);
                    }

                    // Add assistant response to display
                    this.addMessageToDisplay(assistantMessage);

                    return data;
                } else if (response.status === 429) {
                    // Rate limited - wait longer
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay * (retryCount + 1)));
                    retryCount++;
                } else {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
            } catch (error) {
                retryCount++;
                console.error(`AI chat error (attempt ${retryCount}):`, error);
                
                if (retryCount < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay * retryCount));
                } else {
                    this.addMessageToDisplay({
                        content: 'Sorry, I encountered an error processing your request. Please try again later.',
                        role: 'assistant',
                        timestamp: new Date().toISOString(),
                        error: true
                    });
                }
            }
        }
        
        this.setLoading(false);
    }

    async getChatHistory(threadId = null) {
        try {
            const url = threadId 
                ? `${this.baseUrl}/history?thread_id=${threadId}`
                : `${this.baseUrl}/history`;

            const response = await fetch(url, {
                headers: authService.getAuthHeaders()
            });

            if (response.ok) {
                const data = await response.json();
                this.messages = data.messages;
                this.displayChatHistory();
                return data;
            } else {
                throw new Error('Failed to get chat history');
            }
        } catch (error) {
            console.error('Get chat history error:', error);
        }
    }

    async clearChatHistory(threadId = null) {
        try {
            const url = threadId 
                ? `${this.baseUrl}/clear?thread_id=${threadId}`
                : `${this.baseUrl}/clear`;

            const response = await fetch(url, {
                method: 'DELETE',
                headers: authService.getAuthHeaders()
            });

            if (response.ok) {
                this.messages = [];
                this.clearChatDisplay();
                return true;
            } else {
                throw new Error('Failed to clear chat history');
            }
        } catch (error) {
            console.error('Clear chat history error:', error);
            return false;
        }
    }

    addMessageToDisplay(message) {
        const messagesContainer = document.getElementById('chatMessages');
        const messageElement = this.createMessageElement(message);
        messagesContainer.appendChild(messageElement);
        
        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Add to messages array
        this.messages.push(message);
    }

    createMessageElement(message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${message.role}`;
        
        if (message.error) {
            messageDiv.classList.add('text-danger');
        }

        let messageHtml = `
            <div class="message-header">
                <small class="text-muted">
                    ${message.role === 'user' ? 'You' : 'AI Assistant'} 
                    - ${new Date(message.timestamp).toLocaleTimeString()}
                </small>
            </div>
            <div class="message-content">${this.formatMessageContent(message.content)}</div>
        `;

        // Add sources if available
        if (message.sources && message.sources.length > 0) {
            messageHtml += `
                <div class="message-sources mt-2">
                    <small class="text-muted">Sources:</small>
                    <ul class="list-unstyled">
                        ${message.sources.map(source => `
                            <li><small><i class="fas fa-link"></i> ${source.title || source.content.substring(0, 50)}...</small></li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }

        // Add context indicator if semantic search was used
        if (message.context_used) {
            messageHtml += `
                <div class="message-context mt-1">
                    <small class="text-info"><i class="fas fa-search"></i> Used semantic search context</small>
                </div>
            `;
        }

        messageDiv.innerHTML = messageHtml;
        return messageDiv;
    }

    formatMessageContent(content) {
        // Simple markdown-style formatting
        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>')
            .replace(/`(.*?)`/g, '<code>$1</code>');
    }

    displayChatHistory() {
        const messagesContainer = document.getElementById('chatMessages');
        messagesContainer.innerHTML = '';
        
        // Add welcome message if no history
        if (this.messages.length === 0) {
            const welcomeMessage = {
                content: "Hello! I'm your AI research assistant. I can help you with archaeological questions, analyze data, and provide insights. How can I assist you today?",
                role: 'assistant',
                timestamp: new Date().toISOString()
            };
            this.addMessageToDisplay(welcomeMessage);
        } else {
            this.messages.forEach(message => {
                const messageElement = this.createMessageElement(message);
                messagesContainer.appendChild(messageElement);
            });
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    clearChatDisplay() {
        const messagesContainer = document.getElementById('chatMessages');
        messagesContainer.innerHTML = '';
        this.displayChatHistory(); // Show welcome message
    }

    setLoading(loading) {
        this.isLoading = loading;
        const sendButton = document.querySelector('#ai-chat .btn-primary');
        const chatInput = document.getElementById('chatInput');
        
        if (loading) {
            sendButton.disabled = true;
            sendButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            chatInput.disabled = true;
            
            // Add typing indicator
            this.addTypingIndicator();
        } else {
            sendButton.disabled = false;
            sendButton.innerHTML = '<i class="fas fa-paper-plane"></i>';
            chatInput.disabled = false;
            
            // Remove typing indicator
            this.removeTypingIndicator();
        }
    }

    addTypingIndicator() {
        const messagesContainer = document.getElementById('chatMessages');
        const typingDiv = document.createElement('div');
        typingDiv.id = 'typing-indicator';
        typingDiv.className = 'message assistant';
        typingDiv.innerHTML = `
            <div class="message-content">
                <i class="fas fa-ellipsis-h"></i> AI Assistant is thinking...
            </div>
        `;
        messagesContainer.appendChild(typingDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    removeTypingIndicator() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }
}

// Global AI chat service instance
const aiChatService = new AIChatService();

// Chat-related functions for the UI
function sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    const message = chatInput.value.trim();
    
    if (message && !aiChatService.isLoading) {
        const useSemanticSearch = document.getElementById('enableSemanticSearch').checked;
        aiChatService.sendMessage(message, useSemanticSearch);
        chatInput.value = '';
    }
}

function handleChatKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
    }
}

function clearChatHistory() {
    if (confirm('Are you sure you want to clear the chat history?')) {
        aiChatService.clearChatHistory();
    }
}

function toggleSemanticSearch() {
    const checkbox = document.getElementById('enableSemanticSearch');
    checkbox.checked = !checkbox.checked;
    
    // Update button text
    const button = document.getElementById('toggle-semantic-search');
    if (button) {
        button.textContent = checkbox.checked ? 'Disable Semantic Search' : 'Enable Semantic Search';
    }
}

// Initialize chat on page load
document.addEventListener('DOMContentLoaded', () => {
    // Load chat history when the AI chat tab is shown
    const aiChatTab = document.getElementById('ai-chat-tab');
    if (aiChatTab) {
        aiChatTab.addEventListener('shown.bs.tab', () => {
            aiChatService.getChatHistory();
        });
    }
    
    // Initialize with welcome message
    aiChatService.displayChatHistory();
});

/**
 * RE-Archaeology Chat Interface
 * Provides contextual AI assistant for archaeological research
 */

class REChatInterface {
    constructor() {
        this.isOpen = false;
        this.isConnected = true;
        this.isLoading = false;
        this.messages = [];
        this.currentContext = null;
        this.sessionId = this.generateSessionId();
        
        this.init();
    }

    init() {
        this.createChatInterface();
        this.bindEvents();
        this.loadWelcomeMessage();
    }

    generateSessionId() {
        return 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    createChatInterface() {
        const chatHTML = `
            <div id="re-chat-container" class="chat-container minimized">
                <div class="chat-header" onclick="reChat.toggle()">
                    <div class="chat-title">
                        <i class="fas fa-robot"></i>
                        <span>RE Agent</span>
                        <div class="chat-status">
                            <div class="status-indicator" id="chat-status-indicator"></div>
                        </div>
                    </div>
                    <button class="chat-toggle" id="chat-toggle-btn">
                        <i class="fas fa-chevron-up"></i>
                    </button>
                </div>
                <div class="chat-body" id="chat-body" style="display: none;">
                    <div class="chat-messages" id="chat-messages">
                        <!-- Messages will be dynamically inserted here -->
                    </div>
                    <div class="chat-input-container">
                        <div class="chat-input-wrapper">
                            <textarea 
                                id="chat-input" 
                                class="chat-input" 
                                placeholder="Ask about sites, discoveries, hypotheses..."
                                rows="1"></textarea>
                            <button id="chat-send-btn" class="chat-send-btn" disabled>
                                <i class="fas fa-paper-plane"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', chatHTML);
    }

    bindEvents() {
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('chat-send-btn');
        
        // Input events
        chatInput.addEventListener('input', () => {
            this.autoResizeTextarea(chatInput);
            sendBtn.disabled = !chatInput.value.trim();
        });
        
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        sendBtn.addEventListener('click', () => this.sendMessage());
        
        // Prevent chat header click from bubbling when clicking toggle button
        document.getElementById('chat-toggle-btn').addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 80) + 'px';
    }

    toggle() {
        const container = document.getElementById('re-chat-container');
        const chatBody = document.getElementById('chat-body');
        const toggleBtn = document.getElementById('chat-toggle-btn');
        
        this.isOpen = !this.isOpen;
        
        if (this.isOpen) {
            container.classList.remove('minimized');
            container.classList.add('maximized');
            chatBody.style.display = 'flex';
            toggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
            this.scrollToBottom();
        } else {
            container.classList.remove('maximized');
            container.classList.add('minimized');
            chatBody.style.display = 'none';
            toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
        }
    }

    setContext(context) {
        this.currentContext = context;
        // Notify user about context change if chat is open
        if (this.isOpen && context) {
            this.addContextMessage(context);
        }
    }

    addContextMessage(context) {
        const contextMsg = this.formatContextMessage(context);
        this.addMessage('agent', contextMsg, 'context');
    }

    formatContextMessage(context) {
        switch (context.type) {
            case 'site':
                return `🏛️ Now viewing site: **${context.name}**. I can help you analyze this archaeological site, its discoveries, and related hypotheses.`;
            case 'thread':
                return `💬 Switched to thread: **${context.title}**. I can assist with discussion points and related archaeological data.`;
            case 'hypothesis':
                return `🔬 Examining hypothesis: **${context.statement}**. Ask me about evidence, related sites, or research implications.`;
            default:
                return `📍 Context updated. I'm ready to help with your archaeological research.`;
        }
    }

    loadWelcomeMessage() {
        const welcomeMsg = `Hello! I'm your RE (Reverse Engineering) archaeology assistant. I can help you with:

• **Site Analysis** - Explore archaeological sites and their characteristics
• **Discovery Insights** - Analyze artifacts and findings
• **Hypothesis Testing** - Evaluate theories and evidence
• **Data Correlation** - Find patterns across sites and time periods

What would you like to explore today?`;

        this.addMessage('agent', welcomeMsg, 'welcome');
        this.addSuggestions([
            'Show me recent discoveries',
            'Analyze site patterns',
            'List active hypotheses',
            'Help with data visualization'
        ]);
    }

    addSuggestions(suggestions) {
        const messagesContainer = document.getElementById('chat-messages');
        const suggestionHTML = `
            <div class="suggestions">
                ${suggestions.map(suggestion => 
                    `<div class="suggestion-chip" onclick="reChat.selectSuggestion('${suggestion}')">${suggestion}</div>`
                ).join('')}
            </div>
        `;
        messagesContainer.insertAdjacentHTML('beforeend', suggestionHTML);
        this.scrollToBottom();
    }

    selectSuggestion(suggestion) {
        document.getElementById('chat-input').value = suggestion;
        this.sendMessage();
    }

    async sendMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        
        if (!message || this.isLoading) return;
        
        // Add user message
        this.addMessage('user', message);
        input.value = '';
        input.style.height = 'auto';
        document.getElementById('chat-send-btn').disabled = true;
        
        // Show typing indicator
        this.showTyping();
        this.setLoading(true);
        
        try {
            const response = await this.sendToREAgent(message);
            this.hideTyping();
            this.addMessage('agent', response.content, response.type);
            
            if (response.suggestions) {
                this.addSuggestions(response.suggestions);
            }
        } catch (error) {
            this.hideTyping();
            this.addMessage('agent', 'I apologize, but I encountered an error. Please try again or rephrase your question.', 'error');
            console.error('Chat error:', error);
            this.setConnectionStatus(false);
        } finally {
            this.setLoading(false);
        }
    }

    async sendToREAgent(message) {
        const payload = {
            message: message,
            context: this.currentContext,
            session_id: this.sessionId,
            user_id: neo4jAPI.getCurrentUser()?.id
        };

        const response = await fetch('/api/v1/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    }

    addMessage(sender, content, type = 'text') {
        const timestamp = new Date();
        const message = { sender, content, timestamp, type };
        this.messages.push(message);
        
        const messagesContainer = document.getElementById('chat-messages');
        const messageHTML = this.renderMessage(message);
        messagesContainer.insertAdjacentHTML('beforeend', messageHTML);
        
        this.scrollToBottom();
    }

    renderMessage(message) {
        const timeStr = message.timestamp.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        const contextClass = message.type && message.type !== 'text' ? `context-${message.type}` : '';
        
        return `
            <div class="message ${message.sender}">
                <div class="message-content ${contextClass}">
                    ${this.formatMessageContent(message.content, message.type)}
                </div>
                <div class="message-timestamp">${timeStr}</div>
            </div>
        `;
    }

    formatMessageContent(content, type) {
        // Handle markdown-like formatting
        let formatted = content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
        
        // Handle special content types
        if (type === 'data') {
            formatted = `<div class="data-content">${formatted}</div>`;
        } else if (type === 'visualization') {
            formatted = `<div class="viz-content">${formatted}</div>`;
        }
        
        return formatted;
    }

    showTyping() {
        const messagesContainer = document.getElementById('chat-messages');
        const typingHTML = `
            <div class="message agent" id="typing-indicator">
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;
        messagesContainer.insertAdjacentHTML('beforeend', typingHTML);
        this.scrollToBottom();
    }

    hideTyping() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    setLoading(loading) {
        this.isLoading = loading;
        const statusIndicator = document.getElementById('chat-status-indicator');
        
        if (loading) {
            statusIndicator.classList.add('loading');
        } else {
            statusIndicator.classList.remove('loading');
        }
    }

    setConnectionStatus(connected) {
        this.isConnected = connected;
        const statusIndicator = document.getElementById('chat-status-indicator');
        
        statusIndicator.classList.remove('loading', 'error');
        if (!connected) {
            statusIndicator.classList.add('error');
        }
    }

    scrollToBottom() {
        const messagesContainer = document.getElementById('chat-messages');
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
    }

    // Public API methods
    minimize() {
        if (this.isOpen) {
            this.toggle();
        }
    }

    maximize() {
        if (!this.isOpen) {
            this.toggle();
        }
    }

    clearMessages() {
        this.messages = [];
        document.getElementById('chat-messages').innerHTML = '';
        this.loadWelcomeMessage();
    }
}

// Initialize chat interface when DOM is loaded
let reChat;

document.addEventListener('DOMContentLoaded', function() {
    // Wait a bit to ensure other components are loaded
    setTimeout(() => {
        reChat = new REChatInterface();
        
        // Make it globally accessible
        window.reChat = reChat;
    }, 1000);
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = REChatInterface;
}

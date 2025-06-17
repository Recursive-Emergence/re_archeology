/**
 * Chat Manager
 * Handles chat functionality and AI assistant interactions
 */

class ChatManager extends EventEmitter {
    constructor() {
        super();
        this.authManager = null;
        this.messages = [];
        this.isInitialized = false;
    }
    
    async init(authManager) {
        console.log('💬 Initializing chat manager...');
        
        this.authManager = authManager;
        
        // Setup chat UI event handlers
        this.setupChatEvents();
        
        // Initialize chat interface
        this.initializeChatInterface();
        
        this.isInitialized = true;
        console.log('✅ Chat manager initialized');
    }
    
    setupChatEvents() {
        // Setup chat form submission
        const chatForm = document.getElementById('chat-input-form');
        if (chatForm) {
            chatForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.sendMessage();
            });
        }
        
        // Setup enter key for sending messages
        const chatInput = document.getElementById('chat-input');
        if (chatInput) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }
    }
    
    initializeChatInterface() {
        // Initialize the chat welcome message
        this.updateWelcomeMessage();
    }
    
    onUserAuthenticated(user) {
        console.log('👤 Chat: User authenticated:', user.name);
        
        // Update welcome message with user's name
        this.updateWelcomeMessage(user);
        
        // Enable chat input
        this.enableChatInput();
        
        // Add authentication success message
        this.addSystemMessage(`Welcome back, ${user.name?.split(' ')[0] || 'Explorer'}! I'm here to help you discover archaeological structures.`);
    }
    
    onUserLogout() {
        console.log('🚪 Chat: User logged out');
        
        // Clear messages
        this.clearMessages();
        
        // Update welcome message for guest
        this.updateWelcomeMessage();
        
        // Disable chat input
        this.disableChatInput();
    }
    
    updateWelcomeMessage(user = null) {
        const chatWelcome = document.getElementById('chat-welcome');
        if (!chatWelcome) return;
        
        if (user) {
            chatWelcome.innerHTML = `
                <p>👋 Hi ${user.name?.split(' ')[0] || 'there'}! I'm Bella.</p>
                <p class="small">How can I help you with archaeological discoveries today?</p>
            `;
        } else {
            chatWelcome.innerHTML = `
                <p>👋 Hi! I'm Bella, your AI assistant for RE-Archaeology.</p>
                <p class="small">Sign in to start our conversation!</p>
            `;
        }
    }
    
    enableChatInput() {
        const chatForm = document.getElementById('chat-input-form');
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        
        if (chatForm) chatForm.style.display = 'flex';
        if (chatInput) {
            chatInput.disabled = false;
            chatInput.placeholder = 'Ask Bella about discoveries...';
        }
        if (sendBtn) sendBtn.disabled = false;
    }
    
    disableChatInput() {
        const chatForm = document.getElementById('chat-input-form');
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        
        if (chatForm) chatForm.style.display = 'none';
        if (chatInput) {
            chatInput.disabled = true;
            chatInput.placeholder = 'Sign in to chat...';
        }
        if (sendBtn) sendBtn.disabled = true;
    }
    
    async sendMessage() {
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        
        if (!chatInput || !sendBtn) return;
        
        const message = chatInput.value.trim();
        if (!message) return;
        
        // Check authentication
        if (!this.authManager || !this.authManager.isAuthenticated()) {
            this.addSystemMessage('Please sign in to chat with Bella.');
            return;
        }
        
        // Disable input while processing
        chatInput.disabled = true;
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending...';
        
        try {
            // Add user message to chat
            this.addUserMessage(message);
            
            // Clear input
            chatInput.value = '';
            
            // Send message to AI (placeholder for now)
            await this.processAIResponse(message);
            
        } catch (error) {
            console.error('❌ Failed to send message:', error);
            this.addSystemMessage('Sorry, I encountered an error. Please try again.');
        } finally {
            // Re-enable input
            chatInput.disabled = false;
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send';
            chatInput.focus();
        }
    }
    
    async processAIResponse(userMessage) {
        // Add typing indicator
        const typingElement = this.addTypingIndicator();
        
        try {
            // Simulate AI processing (replace with actual AI integration)
            await this.simulateAIThinking();
            
            // Remove typing indicator
            this.removeTypingIndicator(typingElement);
            
            // Generate contextual response
            const response = this.generateContextualResponse(userMessage);
            
            // Add AI response
            this.addAIMessage(response);
            
        } catch (error) {
            console.error('❌ AI response error:', error);
            this.removeTypingIndicator(typingElement);
            this.addAIMessage('I apologize, but I\'m having trouble responding right now. Please try again in a moment.');
        }
    }
    
    generateContextualResponse(userMessage) {
        const message = userMessage.toLowerCase();
        
        // Context-aware responses based on user input
        if (message.includes('scan') || message.includes('discover') || message.includes('search')) {
            return "I can help you with archaeological discoveries! Use the Discovery Panel on the left to start scanning for structures. You can adjust the scan area by clicking on the map or changing the coordinates. What type of structures are you looking for?";
        }
        
        if (message.includes('patch') || message.includes('detection') || message.includes('result')) {
            return "Great question about detections! Each patch on the map represents a potential archaeological structure. Green patches indicate higher confidence detections, while the intensity shows the G₂ analysis scores. Click on any patch to see detailed elevation data and feature analysis.";
        }
        
        if (message.includes('g2') || message.includes('kernel') || message.includes('algorithm')) {
            return "The G₂ modular kernel system is our advanced detection algorithm! It analyzes elevation patterns, geometric features, and spatial coherence to identify potential archaeological structures. The system looks for planarity, volume distribution, and compactness signatures typical of human-made structures.";
        }
        
        if (message.includes('help') || message.includes('how') || message.includes('tutorial')) {
            return "I'd be happy to help! Here's how to get started:\n\n1. 📍 Click on the map to set your scan area\n2. ⚙️ Adjust detection settings in the Discovery Panel\n3. 🚀 Click 'Start Scan' to begin discovery\n4. 📊 Click on detected patches to see detailed analysis\n\nWhat would you like to explore first?";
        }
        
        if (message.includes('lidar') || message.includes('elevation') || message.includes('data')) {
            return "We use high-resolution LiDAR elevation data for our analysis! The system processes elevation grids to identify subtle patterns that might indicate buried or hidden structures. You can see the elevation heatmaps and distribution charts when you click on any detected patch.";
        }
        
        if (message.includes('history') || message.includes('archaeological') || message.includes('ancient')) {
            return "How exciting! Archaeological discovery is my passion. This system has been designed to help uncover hidden structures from various time periods. The Netherlands region we're exploring is rich with historical sites. What time period or type of structures interest you most?";
        }
        
        // Default responses
        const defaultResponses = [
            "That's fascinating! The RE-Archaeology Framework can help you explore that further. Try starting a scan in an area that interests you.",
            "Interesting question! I'm here to help you discover archaeological structures. Would you like me to explain how the detection system works?",
            "Great to chat with you! I specialize in helping with archaeological discoveries. Feel free to ask me about the scanning process, G₂ detection, or how to interpret the results.",
            "I love discussing archaeology! The discovery system uses advanced algorithms to detect potential structures. What aspect would you like to know more about?"
        ];
        
        return defaultResponses[Math.floor(Math.random() * defaultResponses.length)];
    }
    
    addUserMessage(message) {
        const messageData = {
            type: 'user',
            content: message,
            timestamp: new Date()
        };
        
        this.messages.push(messageData);
        this.renderMessage(messageData);
        this.scrollToBottom();
    }
    
    addAIMessage(message) {
        const messageData = {
            type: 'ai',
            content: message,
            timestamp: new Date()
        };
        
        this.messages.push(messageData);
        this.renderMessage(messageData);
        this.scrollToBottom();
    }
    
    addSystemMessage(message) {
        const messageData = {
            type: 'system',
            content: message,
            timestamp: new Date()
        };
        
        this.messages.push(messageData);
        this.renderMessage(messageData);
        this.scrollToBottom();
    }
    
    addTypingIndicator() {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return null;
        
        const typingElement = document.createElement('div');
        typingElement.className = 'message ai typing-indicator';
        typingElement.innerHTML = `
            <div class="message-content">
                <div class="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;
        
        // Add typing animation styles
        const style = document.createElement('style');
        style.textContent = `
            .typing-indicator .typing-dots {
                display: inline-flex;
                gap: 4px;
            }
            .typing-indicator .typing-dots span {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background-color: #00ff88;
                animation: typing 1.4s infinite ease-in-out;
            }
            .typing-indicator .typing-dots span:nth-child(1) { animation-delay: -0.32s; }
            .typing-indicator .typing-dots span:nth-child(2) { animation-delay: -0.16s; }
            .typing-indicator .typing-dots span:nth-child(3) { animation-delay: 0s; }
            @keyframes typing {
                0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
                40% { opacity: 1; transform: scale(1); }
            }
        `;
        document.head.appendChild(style);
        
        chatMessages.appendChild(typingElement);
        this.scrollToBottom();
        
        return typingElement;
    }
    
    removeTypingIndicator(typingElement) {
        if (typingElement && typingElement.parentNode) {
            typingElement.remove();
        }
    }
    
    renderMessage(messageData) {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return;
        
        // Remove welcome message if this is the first real message
        if (this.messages.length === 1) {
            const welcome = document.getElementById('chat-welcome');
            if (welcome) welcome.style.display = 'none';
        }
        
        const messageElement = document.createElement('div');
        messageElement.className = `message ${messageData.type}`;
        
        const timeString = messageData.timestamp.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        if (messageData.type === 'system') {
            messageElement.innerHTML = `
                <div class="message-content" style="font-style: italic; color: #00ff88;">
                    ${this.formatMessageContent(messageData.content)}
                </div>
                <div class="message-time">${timeString}</div>
            `;
        } else {
            messageElement.innerHTML = `
                <div class="message-content">
                    ${this.formatMessageContent(messageData.content)}
                </div>
                <div class="message-time">${timeString}</div>
            `;
        }
        
        chatMessages.appendChild(messageElement);
    }
    
    formatMessageContent(content) {
        // Simple formatting for line breaks and basic styling
        return content
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
    }
    
    clearMessages() {
        this.messages = [];
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            // Clear all messages except welcome
            const messages = chatMessages.querySelectorAll('.message');
            messages.forEach(msg => msg.remove());
            
            // Show welcome message again
            const welcome = document.getElementById('chat-welcome');
            if (welcome) welcome.style.display = 'block';
        }
    }
    
    scrollToBottom() {
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }
    
    async simulateAIThinking() {
        // Simulate realistic thinking time
        const thinkingTime = 800 + Math.random() * 1200; // 0.8-2.0 seconds
        return new Promise(resolve => setTimeout(resolve, thinkingTime));
    }
    
    // Public API
    getMessages() {
        return [...this.messages];
    }
    
    isReady() {
        return this.isInitialized && this.authManager && this.authManager.isAuthenticated();
    }
}

// Make available globally
window.ChatManager = ChatManager;

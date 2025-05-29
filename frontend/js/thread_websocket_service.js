/**
 * WebSocket service for real-time thread communications
 * Handles live comments, typing indicators, and thread updates
 */

class ThreadWebSocketService {
    constructor() {
        this.socket = null;
        this.threadId = null;
        this.token = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.heartbeatInterval = null;
        this.typingTimeout = null;
        this.isTyping = false;
        
        // Event handlers
        this.onMessageReceived = null;
        this.onUserJoined = null;
        this.onUserLeft = null;
        this.onTypingIndicator = null;
        this.onConnectionStateChanged = null;
        this.onCommentReceived = null;
        this.onCommentUpdated = null;
        this.onThreadUpdated = null;
        
        // Connection state
        this.isConnected = false;
        this.isConnecting = false;
    }
    
    /**
     * Connect to a thread's WebSocket
     * @param {string} threadId - Thread ID to connect to
     * @param {string} token - Optional authentication token
     */
    connect(threadId, token = null) {
        if (this.isConnecting || (this.isConnected && this.threadId === threadId)) {
            return;
        }
        
        this.disconnect(); // Disconnect from any existing connection
        
        this.threadId = threadId;
        this.token = token;
        this.isConnecting = true;
        
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsHost = window.location.host;
        let wsUrl = `${wsProtocol}//${wsHost}/ws/threads/${threadId}`;
        
        if (token) {
            wsUrl += `?token=${encodeURIComponent(token)}`;
        }
        
        try {
            console.log('Connecting to WebSocket:', wsUrl);
            this.socket = new WebSocket(wsUrl);
            
            this.socket.onopen = (event) => {
                console.log('WebSocket connected to thread:', threadId);
                this.isConnected = true;
                this.isConnecting = false;
                this.reconnectAttempts = 0;
                
                // Start heartbeat
                this.startHeartbeat();
                
                // Notify listeners
                if (this.onConnectionStateChanged) {
                    this.onConnectionStateChanged('connected');
                }
                
                // Request current participants
                this.requestParticipants();
            };
            
            this.socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };
            
            this.socket.onclose = (event) => {
                console.log('WebSocket connection closed:', event.code, event.reason);
                this.isConnected = false;
                this.isConnecting = false;
                
                this.stopHeartbeat();
                
                if (this.onConnectionStateChanged) {
                    this.onConnectionStateChanged('disconnected');
                }
                
                // Attempt reconnection if not intentional disconnect
                if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.attemptReconnection();
                }
            };
            
            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.isConnecting = false;
                
                if (this.onConnectionStateChanged) {
                    this.onConnectionStateChanged('error');
                }
            };
            
        } catch (error) {
            console.error('Error creating WebSocket connection:', error);
            this.isConnecting = false;
            
            if (this.onConnectionStateChanged) {
                this.onConnectionStateChanged('error');
            }
        }
    }
    
    /**
     * Disconnect from WebSocket
     */
    disconnect() {
        if (this.socket) {
            this.socket.close(1000, 'Client disconnect');
            this.socket = null;
        }
        
        this.stopHeartbeat();
        this.isConnected = false;
        this.isConnecting = false;
        this.threadId = null;
        this.token = null;
        this.reconnectAttempts = 0;
    }
    
    /**
     * Attempt to reconnect to WebSocket
     */
    attemptReconnection() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('Max reconnection attempts reached');
            return;
        }
        
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
        
        console.log(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
        
        if (this.onConnectionStateChanged) {
            this.onConnectionStateChanged('reconnecting');
        }
        
        setTimeout(() => {
            if (this.threadId) {
                this.connect(this.threadId, this.token);
            }
        }, delay);
    }
    
    /**
     * Handle incoming WebSocket messages
     * @param {Object} data - Parsed message data
     */
    handleMessage(data) {
        const { type } = data;
        
        switch (type) {
            case 'new_comment':
                if (this.onCommentReceived) {
                    this.onCommentReceived(data.comment, data.thread_id);
                }
                break;
                
            case 'comment_updated':
                if (this.onCommentUpdated) {
                    this.onCommentUpdated(data.comment, data.thread_id);
                }
                break;
                
            case 'thread_updated':
                if (this.onThreadUpdated) {
                    this.onThreadUpdated(data.thread, data.thread_id);
                }
                break;
                
            case 'user_joined':
                if (this.onUserJoined) {
                    this.onUserJoined(data.user_id, data.thread_id);
                }
                break;
                
            case 'user_left':
                if (this.onUserLeft) {
                    this.onUserLeft(data.user_id, data.thread_id);
                }
                break;
                
            case 'typing_indicator':
                if (this.onTypingIndicator) {
                    this.onTypingIndicator(data.user_id, data.is_typing, data.thread_id);
                }
                break;
                
            case 'participants':
                this.handleParticipants(data.participants);
                break;
                
            case 'heartbeat':
                // Server heartbeat - respond with pong
                this.sendMessage({
                    type: 'pong',
                    timestamp: new Date().toISOString()
                });
                break;
                
            case 'pong':
                // Server responded to our ping
                console.log('Received pong from server');
                break;
                
            default:
                console.log('Unknown message type:', type, data);
        }
        
        // Notify general message handler
        if (this.onMessageReceived) {
            this.onMessageReceived(data);
        }
    }
    
    /**
     * Send a message through WebSocket
     * @param {Object} message - Message object to send
     */
    sendMessage(message) {
        if (!this.isConnected || !this.socket) {
            console.warn('Cannot send message: WebSocket not connected');
            return false;
        }
        
        try {
            this.socket.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('Error sending WebSocket message:', error);
            return false;
        }
    }
    
    /**
     * Send typing start indicator
     */
    startTyping() {
        if (this.isTyping) return;
        
        this.isTyping = true;
        this.sendMessage({
            type: 'typing_start',
            timestamp: new Date().toISOString()
        });
        
        // Auto-stop typing after 3 seconds of inactivity
        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.stopTyping();
        }, 3000);
    }
    
    /**
     * Send typing stop indicator
     */
    stopTyping() {
        if (!this.isTyping) return;
        
        this.isTyping = false;
        clearTimeout(this.typingTimeout);
        
        this.sendMessage({
            type: 'typing_stop',
            timestamp: new Date().toISOString()
        });
    }
    
    /**
     * Request current thread participants
     */
    requestParticipants() {
        this.sendMessage({
            type: 'get_participants',
            timestamp: new Date().toISOString()
        });
    }
    
    /**
     * Handle participants list
     * @param {Array} participants - List of thread participants
     */
    handleParticipants(participants) {
        console.log('Thread participants:', participants);
        // TODO: Update UI with participant list
    }
    
    /**
     * Start heartbeat ping to keep connection alive
     */
    startHeartbeat() {
        this.stopHeartbeat();
        
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected) {
                this.sendMessage({
                    type: 'ping',
                    timestamp: new Date().toISOString()
                });
            }
        }, 30000); // Ping every 30 seconds
    }
    
    /**
     * Stop heartbeat ping
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    
    /**
     * Get connection status
     * @returns {Object} Connection status information
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            isConnecting: this.isConnecting,
            threadId: this.threadId,
            reconnectAttempts: this.reconnectAttempts,
            hasToken: !!this.token
        };
    }
}

// Global instance
const threadWebSocketService = new ThreadWebSocketService();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ThreadWebSocketService, threadWebSocketService };
}

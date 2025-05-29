"""
WebSocket manager for real-time thread comments and updates.
Handles live commenting, thread updates, and real-time notifications.
"""

import json
import logging
from typing import Dict, Set, Optional, List
from datetime import datetime
import asyncio
from fastapi import WebSocket, WebSocketDisconnect
import uuid

logger = logging.getLogger(__name__)

class ThreadWebSocketManager:
    """Manages WebSocket connections for real-time thread updates."""
    
    def __init__(self):
        # Store active connections by thread_id
        self.thread_connections: Dict[str, Set[WebSocket]] = {}
        # Store user connections for direct messaging
        self.user_connections: Dict[str, WebSocket] = {}
        # Store connection metadata
        self.connection_metadata: Dict[WebSocket, Dict] = {}
    
    async def connect_to_thread(self, websocket: WebSocket, thread_id: str, user_id: Optional[str] = None):
        """Connect a user to a specific thread for real-time updates."""
        await websocket.accept()
        
        # Add to thread connections
        if thread_id not in self.thread_connections:
            self.thread_connections[thread_id] = set()
        self.thread_connections[thread_id].add(websocket)
        
        # Store user connection if authenticated
        if user_id:
            self.user_connections[user_id] = websocket
        
        # Store metadata
        self.connection_metadata[websocket] = {
            "thread_id": thread_id,
            "user_id": user_id,
            "connected_at": datetime.utcnow().isoformat(),
            "last_activity": datetime.utcnow().isoformat()
        }
        
        logger.info(f"User {user_id or 'Anonymous'} connected to thread {thread_id}")
        
        # Notify other users in the thread about new connection
        await self.broadcast_to_thread(thread_id, {
            "type": "user_joined",
            "thread_id": thread_id,
            "user_id": user_id,
            "timestamp": datetime.utcnow().isoformat()
        }, exclude=websocket)
    
    async def disconnect_from_thread(self, websocket: WebSocket):
        """Disconnect a user from their thread."""
        if websocket not in self.connection_metadata:
            return
        
        metadata = self.connection_metadata[websocket]
        thread_id = metadata.get("thread_id")
        user_id = metadata.get("user_id")
        
        # Remove from thread connections
        if thread_id and thread_id in self.thread_connections:
            self.thread_connections[thread_id].discard(websocket)
            if not self.thread_connections[thread_id]:
                del self.thread_connections[thread_id]
        
        # Remove from user connections
        if user_id and user_id in self.user_connections:
            del self.user_connections[user_id]
        
        # Remove metadata
        del self.connection_metadata[websocket]
        
        logger.info(f"User {user_id or 'Anonymous'} disconnected from thread {thread_id}")
        
        # Notify other users in the thread about disconnection
        if thread_id:
            await self.broadcast_to_thread(thread_id, {
                "type": "user_left",
                "thread_id": thread_id,
                "user_id": user_id,
                "timestamp": datetime.utcnow().isoformat()
            })
    
    async def broadcast_to_thread(self, thread_id: str, message: Dict, exclude: Optional[WebSocket] = None):
        """Broadcast a message to all users in a specific thread."""
        if thread_id not in self.thread_connections:
            return
        
        # Convert message to JSON
        message_text = json.dumps(message)
        
        # Get connections for this thread
        connections = self.thread_connections[thread_id].copy()
        
        # Remove the excluded connection if specified
        if exclude and exclude in connections:
            connections.remove(exclude)
        
        # Send to all connections
        disconnected = []
        for websocket in connections:
            try:
                await websocket.send_text(message_text)
                
                # Update last activity
                if websocket in self.connection_metadata:
                    self.connection_metadata[websocket]["last_activity"] = datetime.utcnow().isoformat()
                    
            except WebSocketDisconnect:
                disconnected.append(websocket)
            except Exception as e:
                logger.error(f"Error broadcasting to websocket: {e}")
                disconnected.append(websocket)
        
        # Clean up disconnected websockets
        for websocket in disconnected:
            await self.disconnect_from_thread(websocket)
    
    async def send_to_user(self, user_id: str, message: Dict):
        """Send a direct message to a specific user."""
        if user_id not in self.user_connections:
            return False
        
        websocket = self.user_connections[user_id]
        message_text = json.dumps(message)
        
        try:
            await websocket.send_text(message_text)
            
            # Update last activity
            if websocket in self.connection_metadata:
                self.connection_metadata[websocket]["last_activity"] = datetime.utcnow().isoformat()
            
            return True
        except WebSocketDisconnect:
            await self.disconnect_from_thread(websocket)
            return False
        except Exception as e:
            logger.error(f"Error sending to user {user_id}: {e}")
            return False
    
    async def broadcast_new_comment(self, thread_id: str, comment_data: Dict, author_id: Optional[str] = None):
        """Broadcast a new comment to all thread participants."""
        message = {
            "type": "new_comment",
            "thread_id": thread_id,
            "comment": comment_data,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        # Don't send to the comment author
        exclude_websocket = None
        if author_id and author_id in self.user_connections:
            exclude_websocket = self.user_connections[author_id]
        
        await self.broadcast_to_thread(thread_id, message, exclude=exclude_websocket)
    
    async def broadcast_comment_update(self, thread_id: str, comment_data: Dict):
        """Broadcast a comment update (edit, delete) to all thread participants."""
        message = {
            "type": "comment_updated",
            "thread_id": thread_id,
            "comment": comment_data,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        await self.broadcast_to_thread(thread_id, message)
    
    async def broadcast_thread_update(self, thread_id: str, thread_data: Dict):
        """Broadcast thread metadata updates to all participants."""
        message = {
            "type": "thread_updated",
            "thread_id": thread_id,
            "thread": thread_data,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        await self.broadcast_to_thread(thread_id, message)
    
    async def send_typing_notification(self, thread_id: str, user_id: str, is_typing: bool):
        """Send typing indicator to thread participants."""
        message = {
            "type": "typing_indicator",
            "thread_id": thread_id,
            "user_id": user_id,
            "is_typing": is_typing,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        # Don't send to the typing user
        exclude_websocket = None
        if user_id in self.user_connections:
            exclude_websocket = self.user_connections[user_id]
        
        await self.broadcast_to_thread(thread_id, message, exclude=exclude_websocket)
    
    def get_thread_participants(self, thread_id: str) -> List[Dict]:
        """Get list of active participants in a thread."""
        if thread_id not in self.thread_connections:
            return []
        
        participants = []
        for websocket in self.thread_connections[thread_id]:
            if websocket in self.connection_metadata:
                metadata = self.connection_metadata[websocket]
                participants.append({
                    "user_id": metadata.get("user_id"),
                    "connected_at": metadata.get("connected_at"),
                    "last_activity": metadata.get("last_activity")
                })
        
        return participants
    
    def get_connection_stats(self) -> Dict:
        """Get statistics about active connections."""
        total_connections = len(self.connection_metadata)
        total_threads = len(self.thread_connections)
        total_users = len(self.user_connections)
        
        thread_stats = {}
        for thread_id, connections in self.thread_connections.items():
            thread_stats[thread_id] = len(connections)
        
        return {
            "total_connections": total_connections,
            "total_threads": total_threads,
            "total_authenticated_users": total_users,
            "threads": thread_stats,
            "timestamp": datetime.utcnow().isoformat()
        }

# Global WebSocket manager instance
thread_ws_manager = ThreadWebSocketManager()

async def handle_websocket_message(websocket: WebSocket, message: str):
    """Handle incoming WebSocket messages from clients."""
    try:
        data = json.loads(message)
        message_type = data.get("type")
        
        if websocket not in thread_ws_manager.connection_metadata:
            logger.warning("Received message from unregistered websocket")
            return
        
        metadata = thread_ws_manager.connection_metadata[websocket]
        thread_id = metadata.get("thread_id")
        user_id = metadata.get("user_id")
        
        if message_type == "typing_start":
            if user_id:
                await thread_ws_manager.send_typing_notification(thread_id, user_id, True)
        
        elif message_type == "typing_stop":
            if user_id:
                await thread_ws_manager.send_typing_notification(thread_id, user_id, False)
        
        elif message_type == "ping":
            # Respond with pong to keep connection alive
            await websocket.send_text(json.dumps({
                "type": "pong",
                "timestamp": datetime.utcnow().isoformat()
            }))
        
        elif message_type == "get_participants":
            # Send current thread participants
            participants = thread_ws_manager.get_thread_participants(thread_id)
            await websocket.send_text(json.dumps({
                "type": "participants",
                "thread_id": thread_id,
                "participants": participants,
                "timestamp": datetime.utcnow().isoformat()
            }))
        
        else:
            logger.warning(f"Unknown message type: {message_type}")
    
    except json.JSONDecodeError:
        logger.error("Invalid JSON received from WebSocket")
    except Exception as e:
        logger.error(f"Error handling WebSocket message: {e}")

async def websocket_heartbeat():
    """Send periodic heartbeat to detect dead connections."""
    while True:
        await asyncio.sleep(30)  # Send heartbeat every 30 seconds
        
        disconnected = []
        for websocket in list(thread_ws_manager.connection_metadata.keys()):
            try:
                await websocket.send_text(json.dumps({
                    "type": "heartbeat",
                    "timestamp": datetime.utcnow().isoformat()
                }))
            except:
                disconnected.append(websocket)
        
        # Clean up disconnected websockets
        for websocket in disconnected:
            await thread_ws_manager.disconnect_from_thread(websocket)

# Start heartbeat task
asyncio.create_task(websocket_heartbeat())

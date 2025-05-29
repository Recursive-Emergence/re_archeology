"""
WebSocket endpoints for real-time thread functionality.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from typing import Optional
import logging

from backend.websockets.thread_ws import thread_ws_manager, handle_websocket_message
from backend.api.routers.auth import get_current_user_optional

logger = logging.getLogger(__name__)

router = APIRouter()

@router.websocket("/ws/threads/{thread_id}")
async def websocket_thread_endpoint(
    websocket: WebSocket,
    thread_id: str,
    token: Optional[str] = Query(None)
):
    """WebSocket endpoint for real-time thread updates."""
    
    # Validate user authentication if token provided
    user_id = None
    if token:
        try:
            # Note: In production, implement proper JWT validation here
            # For now, we'll extract user_id from token (simplified)
            user_id = token  # Simplified - should decode JWT
        except Exception as e:
            logger.warning(f"Invalid token in WebSocket connection: {e}")
    
    try:
        # Connect to thread
        await thread_ws_manager.connect_to_thread(websocket, thread_id, user_id)
        
        # Listen for messages
        while True:
            try:
                # Receive message from client
                message = await websocket.receive_text()
                await handle_websocket_message(websocket, message)
                
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.error(f"Error in WebSocket loop: {e}")
                break
    
    except Exception as e:
        logger.error(f"WebSocket connection error: {e}")
    
    finally:
        # Cleanup connection
        await thread_ws_manager.disconnect_from_thread(websocket)

@router.get("/ws/stats")
async def get_websocket_stats():
    """Get WebSocket connection statistics."""
    return thread_ws_manager.get_connection_stats()

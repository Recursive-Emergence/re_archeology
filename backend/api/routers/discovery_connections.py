import time
from datetime import datetime
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.websockets import WebSocketState
from typing import List, Dict, Any

class EnhancedConnectionManager:
    """Enhanced WebSocket connection manager with better status tracking"""
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.connection_metadata: Dict[WebSocket, Dict] = {}
        self.session_connections: Dict[str, List[WebSocket]] = {}
        self.last_heartbeat: Dict[WebSocket, float] = {}

    async def connect(self, websocket: WebSocket, user_id: str = None):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_metadata[websocket] = {
            'user_id': user_id,
            'connected_at': datetime.now(),
            'last_seen': datetime.now(),
            'messages_sent': 0,
            'messages_received': 0
        }
        self.last_heartbeat[websocket] = time.time()
        await self.send_to_connection(websocket, {
            'type': 'connection_established',
            'timestamp': datetime.now().isoformat(),
            'total_connections': len(self.active_connections)
        })

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        self.connection_metadata.pop(websocket, None)
        self.last_heartbeat.pop(websocket, None)

    async def send_to_connection(self, websocket: WebSocket, message: dict):
        try:
            if websocket.client_state != WebSocketState.CONNECTED:
                return False
            import json
            try:
                message_json = json.dumps(message)
            except Exception:
                message_json = json.dumps({'type': 'error', 'message': 'Serialization error in server message', 'timestamp': datetime.now().isoformat()})
            await websocket.send_text(message_json)
            if websocket in self.connection_metadata:
                self.connection_metadata[websocket]['messages_sent'] += 1
                self.connection_metadata[websocket]['last_seen'] = datetime.now()
            return True
        except WebSocketDisconnect:
            self.disconnect(websocket)
            return False
        except Exception:
            return False

    async def send_message(self, message: dict):
        if not self.active_connections:
            return 0
        successful_sends = 0
        failed_connections = []
        for connection in self.active_connections:
            success = await self.send_to_connection(connection, message)
            if success:
                successful_sends += 1
            else:
                if connection.client_state != WebSocketState.CONNECTED:
                    failed_connections.append(connection)
        for connection in failed_connections:
            self.disconnect(connection)
        return successful_sends

    async def send_heartbeat(self):
        await self.send_message({
            'type': 'heartbeat',
            'timestamp': datetime.now().isoformat(),
            'total_connections': len(self.active_connections)
        })

    def get_connection_stats(self):
        return {
            'total_connections': len(self.active_connections),
            'connections_by_user': {},
            'average_messages_sent': sum(meta['messages_sent'] for meta in self.connection_metadata.values()) / max(len(self.connection_metadata), 1)
        }

discovery_manager = EnhancedConnectionManager()

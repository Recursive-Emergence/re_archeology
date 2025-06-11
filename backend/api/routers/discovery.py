"""
Discovery router for real-time archaeological structure detection.
"""

import asyncio
import json
import logging
import uuid
import time
from datetime import datetime
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.responses import JSONResponse
import numpy as np

from backend.api.routers.auth import get_current_user_optional

logger = logging.getLogger(__name__)

def safe_serialize(obj):
    """Convert object to JSON-serializable format"""
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, datetime):
        return obj.isoformat()
    elif hasattr(obj, '__dict__'):
        return {k: safe_serialize(v) for k, v in obj.__dict__.items()}
    elif isinstance(obj, dict):
        return {k: safe_serialize(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [safe_serialize(item) for item in obj]
    else:
        return obj

def safe_asdict(dataclass_obj):
    """Convert dataclass to dict with safe JSON serialization"""
    data = asdict(dataclass_obj)
    return safe_serialize(data)

@dataclass
class ScanPatch:
    """Information about a single scanned patch"""
    session_id: str
    patch_id: str
    lat: float
    lon: float
    timestamp: str
    is_positive: bool
    confidence: float
    detection_result: Optional[Dict] = None
    elevation_data: Optional[List] = None
    patch_size_m: int = 64

@dataclass
class DiscoverySession:
    """Represents an active discovery session"""
    session_id: str
    region_name: str
    start_time: str
    status: str  # 'active', 'completed', 'failed', 'stopped'
    total_patches: int
    processed_patches: int
    positive_detections: int
    bounds: Dict[str, float]
    config: Dict[str, Any]
    end_time: Optional[str] = None
    error_message: Optional[str] = None

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
        
        # Store connection metadata
        self.connection_metadata[websocket] = {
            'user_id': user_id,
            'connected_at': datetime.now(),
            'last_seen': datetime.now(),
            'messages_sent': 0,
            'messages_received': 0
        }
        
        self.last_heartbeat[websocket] = time.time()
        
        logger.info(f"WebSocket connected. Total connections: {len(self.active_connections)}")
        
        # Send connection confirmation
        await self.send_to_connection(websocket, {
            'type': 'connection_established',
            'timestamp': datetime.now().isoformat(),
            'connection_id': id(websocket)
        })
    
    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        
        # Clean up metadata
        self.connection_metadata.pop(websocket, None)
        self.last_heartbeat.pop(websocket, None)
        
        logger.info(f"WebSocket disconnected. Total connections: {len(self.active_connections)}")
    
    async def send_to_connection(self, websocket: WebSocket, message: dict):
        """Send message to specific connection with error handling"""
        try:
            await websocket.send_text(json.dumps(message, default=safe_serialize))
            
            # Update metadata
            if websocket in self.connection_metadata:
                self.connection_metadata[websocket]['messages_sent'] += 1
                self.connection_metadata[websocket]['last_seen'] = datetime.now()
            
            return True
        except Exception as e:
            logger.warning(f"Failed to send message to connection: {e}")
            self.disconnect(websocket)
            return False
    
    async def send_message(self, message: dict):
        """Broadcast message to all connected clients with better error handling"""
        if not self.active_connections:
            return 0
            
        successful_sends = 0
        failed_connections = []
        
        for connection in self.active_connections:
            success = await self.send_to_connection(connection, message)
            if success:
                successful_sends += 1
            else:
                failed_connections.append(connection)
        
        # Clean up failed connections
        for connection in failed_connections:
            self.disconnect(connection)
        
        return successful_sends
    
    async def send_heartbeat(self):
        """Send heartbeat to all connections"""
        await self.send_message({
            'type': 'heartbeat',
            'timestamp': datetime.now().isoformat(),
            'total_connections': len(self.active_connections)
        })
    
    def get_connection_stats(self):
        """Get connection statistics"""
        return {
            'total_connections': len(self.active_connections),
            'connections_by_user': {},
            'average_messages_sent': sum(meta['messages_sent'] for meta in self.connection_metadata.values()) / max(len(self.connection_metadata), 1)
        }

# Global manager instance
discovery_manager = EnhancedConnectionManager()
active_sessions: Dict[str, DiscoverySession] = {}

router = APIRouter()

# =============================================================================
# WEBSOCKET ENDPOINT
# =============================================================================

@router.websocket("/ws/discovery")
async def websocket_discovery_endpoint(
    websocket: WebSocket,
    user_id: Optional[str] = None
):
    """Enhanced WebSocket endpoint for real-time discovery updates"""
    await discovery_manager.connect(websocket, user_id)
    logger.info(f"Discovery WebSocket client connected from {websocket.client}")
    
    try:
        while True:
            # Wait for client messages
            data = await websocket.receive_text()
            message = json.loads(data)
            
            logger.info(f"Received WebSocket message: {message.get('type')}")
            
            # Update message received count
            if websocket in discovery_manager.connection_metadata:
                discovery_manager.connection_metadata[websocket]['messages_received'] += 1
                discovery_manager.connection_metadata[websocket]['last_seen'] = datetime.now()
            
            # Handle different message types
            if message.get('type') == 'ping':
                await discovery_manager.send_to_connection(websocket, {
                    'type': 'pong',
                    'timestamp': datetime.now().isoformat()
                })
            elif message.get('type') == 'pong':
                # Update heartbeat timestamp
                discovery_manager.last_heartbeat[websocket] = time.time()
            elif message.get('type') == 'get_status':
                await discovery_manager.send_to_connection(websocket, {
                    'type': 'status_update',
                    'active_sessions': len(active_sessions),
                    'total_connections': len(discovery_manager.active_connections),
                    'connection_stats': discovery_manager.get_connection_stats(),
                    'timestamp': datetime.now().isoformat()
                })
            else:
                logger.warning(f"Unknown WebSocket message type: {message.get('type')}")
                await discovery_manager.send_to_connection(websocket, {
                    'type': 'error',
                    'message': f'Unknown message type: {message.get("type")}'
                })
                
    except WebSocketDisconnect:
        logger.info(f"Discovery WebSocket client disconnected")
        discovery_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"Discovery WebSocket error: {e}")
        discovery_manager.disconnect(websocket)

# =============================================================================
# DISCOVERY SESSION API ENDPOINTS
# =============================================================================

@router.post("/discovery/start")
async def start_discovery_session(config: Dict[str, Any]):
    """Start a new discovery session"""
    try:
        session_id = str(uuid.uuid4())
        
        # Create discovery session
        session = DiscoverySession(
            session_id=session_id,
            region_name=config.get('region_name', 'Unknown Region'),
            start_time=datetime.now().isoformat(),
            status='active',
            total_patches=config.get('expected_patches', 400),  # Default grid size
            processed_patches=0,
            positive_detections=0,
            bounds=config.get('bounds', {}),
            config=config
        )
        
        active_sessions[session_id] = session
        
        # Start discovery in background
        asyncio.create_task(run_discovery_session(session, discovery_manager))
        
        return {
            'status': 'success',
            'session_id': session_id,
            'message': 'Discovery session started'
        }
        
    except Exception as e:
        logger.error(f"Failed to start discovery session: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/discovery/stop/{session_id}")
async def stop_discovery_session(session_id: str):
    """Stop an active discovery session"""
    try:
        if session_id not in active_sessions:
            raise HTTPException(status_code=404, detail="Session not found")
        
        session = active_sessions[session_id]
        session.status = 'stopped'
        session.end_time = datetime.now().isoformat()
        
        await discovery_manager.send_message({
            'type': 'session_stopped',
            'session_id': session_id,
            'timestamp': datetime.now().isoformat()
        })
        
        return {
            'status': 'success',
            'message': f'Discovery session {session_id} stopped'
        }
        
    except Exception as e:
        logger.error(f"Failed to stop discovery session: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/discovery/sessions")
async def get_active_sessions():
    """Get list of active discovery sessions"""
    try:
        sessions_data = {}
        for session_id, session in active_sessions.items():
            sessions_data[session_id] = safe_asdict(session)
        
        return {
            'status': 'success',
            'sessions': sessions_data,
            'total_active': len([s for s in active_sessions.values() if s.status == 'active'])
        }
        
    except Exception as e:
        logger.error(f"Failed to get sessions: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/discovery/session/{session_id}")
async def get_session_details(session_id: str):
    """Get details of a specific discovery session"""
    try:
        if session_id not in active_sessions:
            raise HTTPException(status_code=404, detail="Session not found")
        
        session = active_sessions[session_id]
        return {
            'status': 'success',
            'session': safe_asdict(session)
        }
        
    except Exception as e:
        logger.error(f"Failed to get session details: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# =============================================================================
# KERNEL MANAGEMENT API ENDPOINTS
# =============================================================================

@router.get("/discovery/kernels")
async def get_cached_kernels(structure_type: str = None):
    """Get list of cached kernels"""
    try:
        # This would need to be implemented to work with the phi0_core module
        # For now, return a placeholder
        return {
            'status': 'success',
            'kernels': [],
            'total_count': 0,
            'message': 'Kernel management integration pending'
        }
    except Exception as e:
        logger.error(f"Failed to get cached kernels: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/discovery/kernels/clear")
async def clear_kernel_cache(structure_type: str = None, confirm: bool = False):
    """Clear cached kernels"""
    try:
        # This would need to be implemented to work with the phi0_core module
        # For now, return a placeholder
        return {
            'status': 'success',
            'removed_count': 0,
            'message': 'Kernel cache clearing integration pending'
        }
    except Exception as e:
        logger.error(f"Failed to clear kernel cache: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# =============================================================================
# DISCOVERY SIMULATION (Placeholder for actual discovery logic)
# =============================================================================

async def run_discovery_session(session: DiscoverySession, manager: EnhancedConnectionManager):
    """Run a discovery session with simulated patch scanning"""
    try:
        logger.info(f"Starting discovery session {session.session_id}")
        
        # Send session started message
        await manager.send_message({
            'type': 'session_started',
            'session': safe_asdict(session),
            'timestamp': datetime.now().isoformat()
        })
        
        # Extract configuration
        config = session.config
        center_lat = config.get('center_lat', 52.4751)
        center_lon = config.get('center_lon', 4.8156)
        scan_radius_km = config.get('scan_radius_km', 2.0)
        patch_size_m = config.get('patch_size_m', 64)
        
        # Calculate patch grid
        patches_per_side = int(np.sqrt(session.total_patches))
        lat_step = (scan_radius_km * 2) / (patches_per_side * 111)  # Rough conversion
        lon_step = (scan_radius_km * 2) / (patches_per_side * 111 * np.cos(np.radians(center_lat)))
        
        # Simulate scanning patches
        for i in range(patches_per_side):
            for j in range(patches_per_side):
                if session.status != 'active':
                    break
                
                # Calculate patch location
                lat = center_lat - scan_radius_km/111 + i * lat_step
                lon = center_lon - scan_radius_km/(111 * np.cos(np.radians(center_lat))) + j * lon_step
                
                # Simulate detection (random for now)
                is_positive = np.random.random() < 0.1  # 10% chance of detection
                confidence = np.random.random() if is_positive else 0.0
                
                # Create patch result
                patch = ScanPatch(
                    session_id=session.session_id,
                    patch_id=f"{session.session_id}_{i}_{j}",
                    lat=lat,
                    lon=lon,
                    timestamp=datetime.now().isoformat(),
                    is_positive=is_positive,
                    confidence=confidence,
                    detection_result={
                        'phi0': confidence * 0.8 if is_positive else 0.1,
                        'psi0': confidence * 0.9 if is_positive else 0.15
                    },
                    patch_size_m=patch_size_m
                )
                
                # Update session
                session.processed_patches += 1
                if is_positive:
                    session.positive_detections += 1
                
                # Send patch result
                await manager.send_message({
                    'type': 'patch_result',
                    'patch': safe_asdict(patch),
                    'session_progress': {
                        'processed': session.processed_patches,
                        'total': session.total_patches,
                        'percentage': (session.processed_patches / session.total_patches) * 100
                    },
                    'timestamp': datetime.now().isoformat()
                })
                
                # Small delay to simulate processing time
                await asyncio.sleep(0.1)
            
            if session.status != 'active':
                break
        
        # Complete session
        if session.status == 'active':
            session.status = 'completed'
            session.end_time = datetime.now().isoformat()
            
            await manager.send_message({
                'type': 'session_completed',
                'session': safe_asdict(session),
                'timestamp': datetime.now().isoformat()
            })
        
        logger.info(f"Discovery session {session.session_id} completed")
        
    except Exception as e:
        logger.error(f"Error in discovery session {session.session_id}: {e}")
        session.status = 'failed'
        session.error_message = str(e)
        session.end_time = datetime.now().isoformat()
        
        await manager.send_message({
            'type': 'session_failed',
            'session_id': session.session_id,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        })

# =============================================================================
# STATUS AND HEALTH ENDPOINTS
# =============================================================================

@router.get("/discovery/status")
async def get_discovery_status():
    """Get current discovery system status"""
    try:
        return {
            'status': 'healthy',
            'active_sessions': len([s for s in active_sessions.values() if s.status == 'active']),
            'total_sessions': len(active_sessions),
            'websocket_connections': len(discovery_manager.active_connections),
            'connection_stats': discovery_manager.get_connection_stats(),
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Failed to get discovery status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

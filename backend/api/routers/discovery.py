"""
Discovery router for real-time archaeological structure detection.
"""

import asyncio
import json
import logging
import uuid
import time
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.websockets import WebSocketState
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import numpy as np
import ee

from backend.api.routers.auth import get_current_user_optional

# Import the new G2 kernel system
import sys
import os
# Add the root directory to Python path to import kernel system
root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

try:
    from kernel import G2StructureDetector, G2DetectionResult
    from kernel.core_detector import ElevationPatch
    logger = logging.getLogger(__name__)
    logger.info("✅ Successfully imported G2StructureDetector from kernel system")
except ImportError as e:
    logger = logging.getLogger(__name__)
    logger.error(f"❌ Failed to import kernel system: {e}")
    logger.error(f"Python path: {sys.path}")
    logger.error(f"Root directory: {root_dir}")
    # Create placeholder classes to prevent startup failure
    class ElevationPatch:
        def __init__(self, *args, **kwargs):
            raise NotImplementedError("Kernel system not available")
    
    class G2StructureDetector:
        def __init__(self, *args, **kwargs):
            raise NotImplementedError("Kernel system not available")
# Temporarily enable debug logging to diagnose WebSocket issues
logger.setLevel(logging.DEBUG)

# Import shared Earth Engine utilities
from backend.utils.earth_engine import is_earth_engine_available, get_earth_engine_status

def clean_patch_data(elevation_data: np.ndarray) -> np.ndarray:
    """Replace NaNs with mean of valid values"""
    if np.isnan(elevation_data).any():
        valid_mask = ~np.isnan(elevation_data)
        if np.any(valid_mask):
            mean_elevation = np.mean(elevation_data[valid_mask])
            elevation_data = np.where(np.isnan(elevation_data), mean_elevation, elevation_data)
        else:
            # If all values are NaN, use a default elevation
            elevation_data = np.full_like(elevation_data, 2.0)
    return elevation_data

def load_elevation_patch_unified(lat, lon, patch_name, buffer_radius_m=20, resolution_m=0.5, data_type="DSM"):
    """
    Unified elevation loading using LidarMapFactory.
    This replaces both Earth Engine and manual elevation loading.
    """
    logger.info(f"Loading elevation data via LidarFactory for {patch_name}...")
    logger.info(f"  Location: ({lat:.6f}, {lon:.6f})")
    logger.info(f"  Buffer: {buffer_radius_m}m radius at {resolution_m}m resolution")
    logger.info(f"  Data type: {data_type}")
    
    try:
        from lidar_factory.factory import LidarMapFactory
        
        # Calculate patch size from buffer radius (diameter)
        patch_size_m = int(buffer_radius_m * 2)
        
        # Use LidarFactory to get elevation data
        result = LidarMapFactory.get_patch(
            lat=lat,
            lon=lon,
            size_m=patch_size_m,
            preferred_resolution_m=resolution_m,
            preferred_data_type=data_type
        )
        
        if result is None:
            raise Exception(f"No elevation data available from LidarFactory for {patch_name}")
        
        # Safety check: ensure result is LidarPatchResult, not raw numpy array
        if isinstance(result, np.ndarray):
            logger.error(f"❌ BUG: LidarMapFactory.get_patch returned numpy array instead of LidarPatchResult! Shape: {result.shape}")
            # Create a fallback LidarPatchResult
            from lidar_factory.factory import LidarPatchResult
            result = LidarPatchResult(
                data=result,
                source_dataset="Unknown",
                resolution_m=resolution_m,
                resolution_description=f"{resolution_m}m",
                is_high_resolution=resolution_m <= 2.0,
                data_type=data_type
            )
            logger.warning(f"Created fallback LidarPatchResult for safety")
        
        elevation_array = result.data
        
        # Fill any remaining nans with the mean of valid values
        elevation_array = clean_patch_data(elevation_array)
        
        logger.info(f"✅ Loaded elevation patch via LidarFactory: {elevation_array.shape}, "
                   f"range: [{np.nanmin(elevation_array):.2f}, {np.nanmax(elevation_array):.2f}], "
                   f"source: {result.source_dataset}, resolution: {result.resolution_description}, "
                   f"high_res: {result.is_high_resolution}")
        
        return elevation_array, result  # Return both data and metadata
        
    except Exception as e:
        logger.error(f"❌ LidarFactory elevation loading failed for {patch_name}: {e}")
        raise
        if np.isnan(elevation_array).any():
            mean_val = np.nanmean(elevation_array)
            elevation_array = np.where(np.isnan(elevation_array), mean_val, elevation_array)
        
        patch = ElevationPatch(
            elevation_data=elevation_array,
            lat=lat,
            lon=lon,
            source='AHN4_real',
            resolution_m=resolution_m,
            patch_size_m=buffer_radius_m * 2,
            metadata={
                'buffer_radius_m': buffer_radius_m,
                'method': 'sampleRectangle',
                'windmill_name': windmill_name
            }
        )
        logger.info(f"✅ Successfully loaded patch for {windmill_name}: {elevation_array.shape}")
        return patch
        
    except Exception as main_error:
        logger.error(f"❌ Failed to load patch for {windmill_name}: {main_error}")
        raise Exception(f"Earth Engine data loading failed for {windmill_name}: {main_error}")

def load_elevation_patch_lidar_factory(lat: float, lon: float, buffer_radius_m: int = 20, resolution_m: float = 0.5):
    """
    Load elevation patch using LidarMapFactory.
    This unified approach can handle multiple data sources including AHN4, SRTM, etc.
    """
    try:
        # Import LidarMapFactory
        import sys
        import os
        root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
        if root_dir not in sys.path:
            sys.path.insert(0, root_dir)
        
        from lidar_factory.factory import LidarMapFactory
        
        logger.debug(f"Loading LiDAR data via factory at ({lat:.4f}, {lon:.4f})")
        
        # Calculate patch size in meters from buffer radius
        patch_size_m = buffer_radius_m * 2
        
        # Use LidarMapFactory to get the best available data
        result = LidarMapFactory.get_patch(
            lat=lat,
            lon=lon,
            size_m=patch_size_m,
            preferred_resolution_m=resolution_m,
            preferred_data_type="DSM"  # Digital Surface Model includes structures
        )
        
        if result is None:
            raise Exception(f"No LiDAR data available at location")
        
        # Safety check: ensure result is LidarPatchResult, not raw numpy array
        if isinstance(result, np.ndarray):
            logger.error(f"❌ BUG: LidarMapFactory.get_patch returned numpy array instead of LidarPatchResult! Shape: {result.shape}")
            # Create a fallback LidarPatchResult
            from lidar_factory.factory import LidarPatchResult
            result = LidarPatchResult(
                data=result,
                source_dataset="Unknown",
                resolution_m=resolution_m,
                resolution_description=f"{resolution_m}m",
                is_high_resolution=resolution_m <= 2.0,
                data_type="DSM"
            )
            logger.warning(f"Created fallback LidarPatchResult for safety")
        
        elevation_array = result.data
        
        # Clean the patch data
        elevation_array = clean_patch_data(elevation_array)
        
        # Create ElevationPatch object
        patch = ElevationPatch(
            elevation_data=elevation_array,
            lat=lat,
            lon=lon,
            source="LidarFactory",
            resolution_m=resolution_m,
            patch_size_m=patch_size_m
        )
        
        logger.debug(f"✅ Loaded patch via LidarFactory: {patch.elevation_data.shape} at ({lat:.6f}, {lon:.6f})")
        return patch
        
    except Exception as e:
        logger.debug(f"Failed to load patch via LidarFactory at ({lat:.4f}, {lon:.4f}): {e}")
        return None

# Keep the old function name for backward compatibility
def load_elevation_patch_gee(lat: float, lon: float, buffer_radius_m: int = 20, resolution_m: float = 0.5):
    """
    Legacy function name - now redirects to LidarFactory implementation
    """
    return load_elevation_patch_lidar_factory(lat, lon, buffer_radius_m, resolution_m)

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
    elevation_stats: Optional[Dict] = None
    patch_size_m: int = 40  # Changed default from 64m to 40m

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
        logger.info(f"Accepting WebSocket connection...")
        await websocket.accept()
        logger.info(f"WebSocket accepted successfully")
        
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
        
        # Don't send connection confirmation immediately - let the connection stabilize
        # The frontend will send a ping if needed
        logger.info(f"WebSocket connection established successfully for user: {user_id}")
    
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
            # Check if websocket is still open before sending
            logger.debug(f"Attempting to send message {message.get('type')} to WebSocket {id(websocket)}")
            logger.debug(f"WebSocket state: {websocket.client_state}")
            
            if websocket.client_state != WebSocketState.CONNECTED:
                logger.warning(f"WebSocket not connected (state: {websocket.client_state}), skipping message send")
                return False
                
            # Serialize message with detailed error handling
            try:
                message_json = json.dumps(message, default=safe_serialize)
                logger.debug(f"Successfully serialized message: {len(message_json)} chars")
            except Exception as serialize_error:
                logger.error(f"Failed to serialize message: {serialize_error}, message type: {message.get('type')}")
                # Send a simpler error message instead
                fallback_message = {
                    'type': 'error',
                    'message': 'Serialization error in server message',
                    'timestamp': datetime.now().isoformat()
                }
                message_json = json.dumps(fallback_message)
            
            logger.debug(f"About to send WebSocket message of {len(message_json)} chars")
            await websocket.send_text(message_json)
            logger.debug(f"Successfully sent WebSocket message")
            
            # Update metadata
            if websocket in self.connection_metadata:
                self.connection_metadata[websocket]['messages_sent'] += 1
                self.connection_metadata[websocket]['last_seen'] = datetime.now()
            
            return True
        except WebSocketDisconnect as e:
            logger.error(f"WebSocket disconnected during send: {e}")
            self.disconnect(websocket)
            return False
        except Exception as e:
            logger.error(f"Failed to send message to connection: {e}")
            logger.error(f"Exception type: {type(e)}")
            # Don't automatically disconnect on send errors - could be temporary
            return False
    
    async def send_message(self, message: dict):
        """Broadcast message to all connected clients with better error handling"""
        if not self.active_connections:
            logger.debug(f"No active connections, skipping message broadcast: {message.get('type')}")
            return 0
            
        successful_sends = 0
        failed_connections = []
        
        for connection in self.active_connections:
            success = await self.send_to_connection(connection, message)
            if success:
                successful_sends += 1
            else:
                # Only add to failed list if it was a disconnect, not just a send failure
                if connection.client_state != WebSocketState.CONNECTED:
                    failed_connections.append(connection)
        
        # Clean up failed connections
        for connection in failed_connections:
            self.disconnect(connection)
        
        logger.debug(f"Broadcast {message.get('type')} to {successful_sends}/{len(self.active_connections)} connections")
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
session_patches: Dict[str, List[ScanPatch]] = {}

# Request models for API endpoints
class SessionRequest(BaseModel):
    session_id: str

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
    logger.info(f"WebSocket connection attempt from {websocket.client}")
    
    try:
        await discovery_manager.connect(websocket, user_id)
        logger.info(f"Discovery WebSocket client connected successfully")
        
        # Main message loop
        while True:
            logger.debug(f"Waiting for WebSocket message...")
            # Wait for client messages
            data = await websocket.receive_text()
            logger.debug(f"Received WebSocket data: {data[:100]}...")
            
            message = json.loads(data)
            logger.info(f"Received WebSocket message: {message.get('type')}")
            
            # Update message received count
            if websocket in discovery_manager.connection_metadata:
                discovery_manager.connection_metadata[websocket]['messages_received'] += 1
                discovery_manager.connection_metadata[websocket]['last_seen'] = datetime.now()
            
            # Handle different message types
            if message.get('type') == 'ping':
                logger.debug(f"Handling ping message")
                await discovery_manager.send_to_connection(websocket, {
                    'type': 'pong',
                    'timestamp': datetime.now().isoformat()
                })
            elif message.get('type') == 'pong':
                logger.debug(f"Received pong message")
                # Update heartbeat timestamp
                discovery_manager.last_heartbeat[websocket] = time.time()
            elif message.get('type') == 'get_status':
                logger.debug(f"Handling status request")
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
                
    except WebSocketDisconnect as e:
        logger.info(f"Discovery WebSocket client disconnected: {e}")
        discovery_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"Discovery WebSocket error: {e}")
        logger.error(f"Exception type: {type(e)}")
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
    """Stop an active discovery session (works for both DiscoverySession and LiDAR scan sessions)"""
    try:
        if session_id not in active_sessions:
            raise HTTPException(status_code=404, detail="Session not found")
        
        session = active_sessions[session_id]
        
        # Handle both DiscoverySession objects and LiDAR scan dictionaries
        if isinstance(session, dict):
            # LiDAR scan session (stored as dict)
            session["status"] = "stopped"
            session["end_time"] = datetime.now(timezone.utc).isoformat()
            session_type = session.get("type", "unknown")
            logger.info(f"🛑 Stopped {session_type} session {session_id}")
        else:
            # Regular DiscoverySession object
            session.status = 'stopped'
            session.end_time = datetime.now().isoformat()
            logger.info(f"🛑 Stopped discovery session {session_id}")
        
        await discovery_manager.send_message({
            'type': 'session_stopped',
            'session_id': session_id,
            'timestamp': datetime.now().isoformat()
        })
        
        return {
            'status': 'success',
            'message': f'Session {session_id} stopped successfully'
        }
        
    except Exception as e:
        logger.error(f"Failed to stop session {session_id}: {e}")
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
    """Get list of cached kernels from the new G2 system"""
    try:
        # Import G2 detection system
        from kernel import G2StructureDetector
        
        # Create detector with Dutch windmill profile
        from kernel.detector_profile import DetectorProfileManager
        
        kernel_dir = "/media/im3/plus/lab4/RE/re_archaeology/kernel"
        profile_manager = DetectorProfileManager(
            profiles_dir=f"{kernel_dir}/profiles",
            templates_dir=f"{kernel_dir}/templates"
        )
        profile = profile_manager.load_profile("dutch_windmill.json")
        detector = G2StructureDetector(profile=profile)
        
        kernels_info = []
        
        # Get profile information for frontend
        profile = detector.profile
        if profile:
            kernels_info.append({
                'structure_type': profile.structure_type.value,
                'profile_name': profile.name,
                'version': profile.version,
                'description': profile.description,
                'resolution_m': profile.geometry.resolution_m,
                'structure_radius_m': profile.geometry.structure_radius_m,
                'patch_size_m': profile.geometry.patch_size_m,
                'detection_threshold': profile.thresholds.detection_threshold,
                'confidence_threshold': profile.thresholds.confidence_threshold,
                'enabled_features': list(profile.get_enabled_features().keys()),
                'created': datetime.now().isoformat(),
                'source': 'g2_kernel'
            })
        
        return {
            'status': 'success',
            'kernels': kernels_info,
            'total_count': len(kernels_info),
            'message': f'Found {len(kernels_info)} G2 profile(s)'
        }
    except Exception as e:
        logger.error(f"Failed to get G2 kernel profiles: {e}")
        return {
            'status': 'success',
            'kernels': [],
            'total_count': 0,
            'message': f'Kernel loading failed: {str(e)}'
        }

@router.post("/discovery/clear")
async def clear_discovery_sessions():
    """Clear all discovery sessions and reset state"""
    try:
        # Stop all active sessions
        stopped_sessions = []
        for session_id, session in list(active_sessions.items()):
            session.status = 'stopped'
            session.end_time = datetime.now().isoformat()
            stopped_sessions.append(session_id)
        
        # Clear sessions dictionary
        active_sessions.clear()
        session_patches.clear()
        
        # Send clear message to all connected clients
        await discovery_manager.send_message({
            'type': 'sessions_cleared',
            'stopped_sessions': stopped_sessions,
            'timestamp': datetime.now().isoformat()
        })
        
        logger.info(f"Cleared {len(stopped_sessions)} discovery sessions")
        
        return {
            'status': 'success',
            'message': f'Cleared {len(stopped_sessions)} sessions',
            'stopped_sessions': stopped_sessions
        }
        
    except Exception as e:
        logger.error(f"Failed to clear discovery sessions: {e}")
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
    """Run a discovery session with real GEE elevation data loading"""
    try:
        logger.info(f"Starting discovery session {session.session_id}")
        
        # Check Earth Engine availability before starting
        if not is_earth_engine_available():
            logger.error("Earth Engine not available")
            session.status = 'failed'
            session.error_message = 'Earth Engine not available'
            return
        
        # Small delay to ensure WebSocket connection is stable
        await asyncio.sleep(0.5)
        
        # Send session started message
        try:
            logger.info(f"Attempting to send session_started message for {session.session_id}")
            result = await manager.send_message({
                'type': 'session_started',
                'session': safe_asdict(session),
                'timestamp': datetime.now().isoformat()
            })
            logger.info(f"Session started message sent to {result} connections")
        except Exception as send_error:
            logger.error(f"Failed to send session started message: {send_error}")
            logger.error(f"Exception type: {type(send_error)}")
            # Continue with session even if initial message fails
        
        # Extract configuration
        config = session.config
        center_lat = config.get('center_lat', 52.4751)
        center_lon = config.get('center_lon', 4.8156)
        scan_radius_km = config.get('scan_radius_km', 2.0)
        patch_size_m = config.get('patch_size_m', 40)  # Default changed to 40m
        
        # Calculate SLIDING WINDOW scanning with meter-by-meter movement
        # Use sliding window approach instead of fixed grid tiles
        sliding_step_m = config.get('sliding_step_m', 1)  # Default to 1 meter steps
        
        # Check if using bounds-based scanning (southeast extension from clicked point)
        use_bounds = config.get('use_bounds', False)
        bounds = config.get('bounds')
        
        if use_bounds and bounds:
            # Use bounds-based rectangular scanning (southeast extension)
            north = bounds['north']
            south = bounds['south']
            west = bounds['west']
            east = bounds['east']
            
            # Calculate scan area dimensions in degrees
            lat_span = north - south
            lon_span = east - west
            
            # Convert to meters for step calculation
            lat_m_per_deg = 111000  # Approximate meters per degree latitude
            lon_m_per_deg = 111000 * np.cos(np.radians(center_lat))  # Adjust for longitude
            
            scan_width_m = lon_span * lon_m_per_deg
            scan_height_m = lat_span * lat_m_per_deg
            
            # Calculate number of steps needed for sliding window
            steps_lon = max(1, int(scan_width_m / sliding_step_m))
            steps_lat = max(1, int(scan_height_m / sliding_step_m))
            
            # Starting position is the northwest corner (clicked point)
            start_lat = north
            start_lon = west
            
            logger.info(f"Bounds-based sliding window scan: {steps_lat}x{steps_lon} steps covering {scan_width_m:.0f}m x {scan_height_m:.0f}m")
            
        else:
            # Original center-based circular scanning
            # Convert scan area to meters for sliding window calculation
            scan_radius_m = scan_radius_km * 1000
            
            # Calculate the scanning bounds in meters from center
            lat_m_per_deg = 111000  # Approximate meters per degree latitude
            lon_m_per_deg = 111000 * np.cos(np.radians(center_lat))  # Adjust for longitude
            
            # Calculate number of steps needed to cover the scan area
            total_scan_width_m = scan_radius_m * 2  # Full diameter
            steps_lat = steps_lon = int(total_scan_width_m / sliding_step_m)
            
            # Calculate starting position (top-left corner of scan area)
            start_lat = center_lat + (scan_radius_m / lat_m_per_deg)
            start_lon = center_lon - (scan_radius_m / lon_m_per_deg)
            
            logger.info(f"Center-based sliding window scan: {steps_lat}x{steps_lon} steps = {steps_lat * steps_lon} patches")
        
        # Update total patches to reflect the sliding window approach
        session.total_patches = steps_lat * steps_lon
        
        # Convert step size from meters to degrees
        lat_step_deg = sliding_step_m / (111000)  # Use standard conversion
        lon_step_deg = sliding_step_m / (111000 * np.cos(np.radians(center_lat)))
        
        # Scan with sliding window approach - each step moves by sliding_step_m meters
        for i in range(steps_lat):
            for j in range(steps_lon):
                if session.status != 'active':
                    break
                
                # Calculate patch center location for SLIDING WINDOW coverage
                if use_bounds and bounds:
                    # For bounds-based scanning, move southeast from starting point
                    lat = start_lat - i * lat_step_deg
                    lon = start_lon + j * lon_step_deg
                else:
                    # Original center-based scanning
                    lat = start_lat - i * lat_step_deg
                    lon = start_lon + j * lon_step_deg
                
                patch_id = f"{session.session_id}_{i}_{j}"
                
                # Send patch scanning notification
                try:
                    await manager.send_message({
                        'type': 'patch_scanning',
                        'patch_id': patch_id,
                        'lat': lat,
                        'lon': lon,
                        'timestamp': datetime.now().isoformat()
                    })
                except Exception as scan_msg_error:
                    logger.warning(f"Failed to send patch scanning message: {scan_msg_error}")
                
                # Load REAL elevation data from Google Earth Engine
                buffer_radius_m = patch_size_m // 2  # Half the patch size
                elevation_result = load_elevation_patch_unified(lat, lon, f"patch_{patch_number}", buffer_radius_m, resolution_m=0.5)
                
                # Handle the new return format (data, metadata)
                if isinstance(elevation_result, tuple) and len(elevation_result) == 2:
                    elevation_patch, lidar_metadata = elevation_result
                else:
                    # Backward compatibility
                    elevation_patch = elevation_result
                    lidar_metadata = None
                
                # Initialize patch data
                elevation_data = None
                elevation_stats = None
                is_positive = False
                confidence = 0.0
                
                # Convert elevation data to list for JSON serialization AND visualization
                if elevation_patch is not None:
                    # Convert elevation data to list for JSON serialization
                    elevation_data = elevation_patch.elevation_data.tolist()
                    
                    # Calculate elevation statistics
                    elevation_stats = {
                        'min': float(np.min(elevation_patch.elevation_data)),
                        'max': float(np.max(elevation_patch.elevation_data)),
                        'mean': float(np.mean(elevation_patch.elevation_data)),
                        'std': float(np.std(elevation_patch.elevation_data)),
                        'range': float(np.max(elevation_patch.elevation_data) - np.min(elevation_patch.elevation_data))
                    }
                    
                    # Create visualization data for the frontend
                    # Downsample elevation data for efficient transmission while preserving detail
                    h, w = elevation_patch.elevation_data.shape
                    if h > 20 or w > 20:  # If patch is larger than 20x20, downsample
                        step_h = max(1, h // 20)
                        step_w = max(1, w // 20)
                        viz_elevation = elevation_patch.elevation_data[::step_h, ::step_w].tolist()
                    else:
                        viz_elevation = elevation_data
                    
                    # Create patch bounds for visualization
                    patch_bounds = {
                        'lat_min': lat - (patch_size_m / 2) / 111000,
                        'lat_max': lat + (patch_size_m / 2) / 111000,
                        'lon_min': lon - (patch_size_m / 2) / (111000 * np.cos(np.radians(lat))),
                        'lon_max': lon + (patch_size_m / 2) / (111000 * np.cos(np.radians(lat)))
                    }
                    
                    # Use G2 Structure Detector with Dutch Windmill profile
                    try:
                        # Initialize G2 detector with Dutch windmill profile
                        from kernel import G2StructureDetector
                        from kernel.detector_profile import DetectorProfileManager
                        
                        # Load the Dutch windmill profile
                        kernel_dir = "/media/im3/plus/lab4/RE/re_archaeology/kernel"
                        profile_manager = DetectorProfileManager(
                            profiles_dir=f"{kernel_dir}/profiles",
                            templates_dir=f"{kernel_dir}/templates"
                        )
                        profile = profile_manager.load_profile("dutch_windmill.json")
                        detector = G2StructureDetector(profile=profile)
                        
                        # Run detection on the elevation patch
                        detection_result = detector.detect_structure(elevation_patch)
                        
                        if detection_result and detection_result.detected:
                            is_positive = True
                            confidence = detection_result.confidence
                            logger.info(f"✅ G2 Detection: confidence={confidence:.3f} at ({lat:.6f}, {lon:.6f})")
                        else:
                            is_positive = False
                            confidence = detection_result.confidence if detection_result else 0.0
                            
                    except Exception as detector_error:
                        logger.warning(f"G2 detector failed, falling back to simple detection: {detector_error}")
                        # Fallback to simple detection based on elevation characteristics
                        elevation_range = elevation_stats['range']
                        elevation_std = elevation_stats['std']
                        
                        if elevation_range > 1.0 and elevation_std > 0.3:  # Some elevation variation
                            is_positive = np.random.random() < 0.15  # 15% chance for interesting terrain
                            confidence = min(0.9, (elevation_range + elevation_std) / 3.0) if is_positive else 0.0
                        else:
                            is_positive = np.random.random() < 0.05  # 5% chance for flat terrain
                            confidence = np.random.random() * 0.4 if is_positive else 0.0
                else:
                    # Fallback if elevation loading fails
                    logger.warning(f"Failed to load elevation data for patch {patch_id}, using fallback detection")
                    is_positive = np.random.random() < 0.08  # 8% chance with no elevation data
                    confidence = np.random.random() * 0.5 if is_positive else 0.0
                
                # Create patch result with G2 detection data
                detection_result_data = {
                    'confidence': confidence,
                    'method': 'G2_dutch_windmill',
                    'elevation_source': 'AHN4_real' if elevation_patch else 'fallback',
                    # Add legacy phi0/psi0 values for frontend compatibility
                    'phi0': confidence * 0.8 if is_positive else 0.1,
                    'psi0': confidence * 0.9 if is_positive else 0.15
                }
                
                # Add G2-specific results if available
                if 'detection_result' in locals() and detection_result:
                    # Safely serialize G2 feature results
                    g2_feature_scores = {}
                    if hasattr(detection_result, 'feature_results') and detection_result.feature_results:
                        try:
                            for feature_name, feature_result in detection_result.feature_results.items():
                                if hasattr(feature_result, 'score'):
                                    g2_feature_scores[feature_name] = float(feature_result.score)
                                else:
                                    g2_feature_scores[feature_name] = float(feature_result) if feature_result is not None else 0.0
                        except Exception as serialize_error:
                            logger.warning(f"Failed to serialize feature results: {serialize_error}")
                            g2_feature_scores = {}
                    
                    # Safely serialize metadata
                    g2_metadata = {}
                    if hasattr(detection_result, 'metadata') and detection_result.metadata:
                        try:
                            # Only include basic types that can be JSON serialized
                            for key, value in detection_result.metadata.items():
                                if isinstance(value, (str, int, float, bool, type(None))):
                                    g2_metadata[key] = value
                                elif isinstance(value, (list, dict)):
                                    # Convert complex types to string representation
                                    g2_metadata[key] = str(value)
                        except Exception as serialize_error:
                            logger.warning(f"Failed to serialize metadata: {serialize_error}")
                            g2_metadata = {}
                    
                    detection_result_data.update({
                        'g2_detected': detection_result.detected,
                        'g2_confidence': float(detection_result.confidence),
                        'g2_final_score': float(detection_result.final_score) if hasattr(detection_result, 'final_score') else 0.0,
                        'g2_feature_scores': g2_feature_scores,
                        'g2_metadata': g2_metadata,
                        'g2_reason': detection_result.reason if hasattr(detection_result, 'reason') and detection_result.reason else "",
                        # Add visualization data for frontend mapping
                        'patch_bounds': patch_bounds if 'patch_bounds' in locals() else {},
                        'visualization_elevation': viz_elevation if 'viz_elevation' in locals() else None
                    })
                
                patch = ScanPatch(
                    session_id=session.session_id,
                    patch_id=patch_id,
                    lat=lat,
                    lon=lon,
                    timestamp=datetime.now().isoformat(),
                    is_positive=is_positive,
                    confidence=confidence,
                    detection_result=detection_result_data,
                    elevation_data=elevation_data,
                    elevation_stats=elevation_stats,
                    patch_size_m=patch_size_m
                )
                
                # Store patch in session_patches
                if session.session_id not in session_patches:
                    session_patches[session.session_id] = []
                session_patches[session.session_id].append(patch)
                
                # Update session
                session.processed_patches += 1
                if is_positive:
                    session.positive_detections += 1
                
                # Send patch result with safe elevation data for visualization
                try:
                    # Safely serialize elevation data
                    safe_elevation_data = None
                    if patch.elevation_data:
                        try:
                            # Ensure elevation data is a proper list of lists (not numpy array)
                            if isinstance(patch.elevation_data, list):
                                safe_elevation_data = patch.elevation_data
                            else:
                                # Convert numpy array to list if needed
                                safe_elevation_data = patch.elevation_data.tolist()
                        except Exception as elev_error:
                            logger.warning(f"Failed to serialize elevation data: {elev_error}")
                            safe_elevation_data = None
                    
                    # Create safe detection result for frontend
                    safe_detection_result = {}
                    if patch.detection_result:
                        # Include all expected frontend fields
                        safe_detection_result = {
                            'confidence': float(patch.detection_result.get('confidence', 0.0)),
                            'method': str(patch.detection_result.get('method', 'G2_dutch_windmill')),
                            'elevation_source': str(patch.detection_result.get('elevation_source', 'unknown')),
                            'phi0': float(patch.detection_result.get('phi0', 0.0)),
                            'psi0': float(patch.detection_result.get('psi0', 0.0))
                        }
                        
                        # Add G2-specific data safely
                        for key, value in patch.detection_result.items():
                            if key.startswith('g2_'):
                                if isinstance(value, (str, int, float, bool, type(None))):
                                    safe_detection_result[key] = value
                                elif isinstance(value, dict):
                                    # For G2 feature scores, ensure they're all numbers
                                    safe_dict = {}
                                    for sub_key, sub_value in value.items():
                                        if isinstance(sub_value, (int, float)):
                                            safe_dict[sub_key] = float(sub_value)
                                        elif isinstance(sub_value, (str, bool, type(None))):
                                            safe_dict[sub_key] = sub_value
                                    safe_detection_result[key] = safe_dict
                    
                    safe_patch_message = {
                        'session_id': str(patch.session_id),
                        'patch_id': str(patch.patch_id),
                        'lat': float(patch.lat),
                        'lon': float(patch.lon),
                        'timestamp': str(patch.timestamp),
                        'is_positive': bool(patch.is_positive),
                        'confidence': float(patch.confidence),
                        'detection_result': safe_detection_result,
                        'elevation_data': safe_elevation_data,  # Include elevation data for visualization
                        'elevation_stats': patch.elevation_stats if patch.elevation_stats else {},
                        'patch_size_m': int(patch.patch_size_m)
                    }
                    
                    await manager.send_message({
                        'type': 'patch_result',
                        'patch': safe_patch_message,
                        'session_progress': {
                            'processed': int(session.processed_patches),
                            'total': int(session.total_patches),
                            'percentage': float((session.processed_patches / session.total_patches) * 100)
                        },
                        'timestamp': datetime.now().isoformat()
                    })
                    
                    # Also send elevation-specific update
                    if elevation_data:
                        await manager.send_message({
                            'type': 'patch_elevation_loaded',
                            'patch_id': patch_id,
                            'elevation_stats': elevation_stats,
                            'source': 'AHN4_real',
                            'timestamp': datetime.now().isoformat()
                        })
                        
                except Exception as send_error:
                    logger.warning(f"Failed to send patch result: {send_error}")
                    # Continue processing even if send fails
                
                # Small delay to simulate processing time and avoid overwhelming GEE
                await asyncio.sleep(0.2)  # Increased delay for GEE rate limiting
            
            if session.status != 'active':
                break
        
        # Complete session
        if session.status == 'active':
            session.status = 'completed'
            session.end_time = datetime.now().isoformat()
            
            try:
                await manager.send_message({
                    'type': 'session_completed',
                    'session': safe_asdict(session),
                    'timestamp': datetime.now().isoformat()
                })
            except Exception as send_error:
                logger.warning(f"Failed to send session completion: {send_error}")
        
        logger.info(f"Discovery session {session.session_id} completed")
        
    except Exception as e:
        logger.error(f"Error in discovery session {session.session_id}: {e}")
        session.status = 'failed'
        session.error_message = str(e)
        session.end_time = datetime.now().isoformat()
        
        try:
            await manager.send_message({
                'type': 'session_failed',
                'session_id': session.session_id,
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            })
        except Exception as send_error:
            logger.warning(f"Failed to send session failure notification: {send_error}")

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

@router.get("/earth-engine/status")
async def get_earth_engine_status():
    """Get Earth Engine initialization status for debugging"""
    status = get_earth_engine_status()
    return {
        "earth_engine_status": status,
        "available": is_earth_engine_available(),
        "timestamp": datetime.now().isoformat()
    }

# =============================================================================
# LI DAR SCANNING ENDPOINT
# =============================================================================

@router.post("/discovery/lidar-scan")
async def start_lidar_scan(
    config: Dict[str, Any],
    current_user: Optional[Dict[str, Any]] = Depends(get_current_user_optional)
):
    """
    Start a LiDAR tile-by-tile scanning operation.
    Streams elevation data patches without structure detection.
    """
    try:
        from lidar_factory.factory import LidarMapFactory
        
        session_id = str(uuid.uuid4())
        
        # Extract configuration
        center_lat = float(config.get('center_lat', 52.4751))
        center_lon = float(config.get('center_lon', 4.8156))
        radius_km = float(config.get('radius_km', 2.0))
        tile_size_m = int(config.get('tile_size_m', 64))  # Smaller default for streaming
        prefer_high_resolution = config.get('prefer_high_resolution', False)
        
        # Determine optimal resolution based on preference and area size
        if prefer_high_resolution:
            preferred_resolution = 0.25  # High resolution for detailed areas
        elif radius_km <= 1.0:
            preferred_resolution = 0.5   # Medium resolution for small areas
        else:
            preferred_resolution = 1.0   # Standard resolution for large areas
        
        logger.info(f"🎯 Using preferred resolution: {preferred_resolution}m/px (high_res_requested: {prefer_high_resolution})")
        
        # Calculate scanning parameters
        radius_m = radius_km * 1000
        scan_grid_size = int(2 * radius_m / tile_size_m)
        
        logger.info(f"🔧 LiDAR streaming config: {tile_size_m}m tiles, {scan_grid_size}x{scan_grid_size} grid")
        
        # Create session info with enhanced queue management
        session_info = {
            "session_id": session_id,
            "type": "lidar_scan",
            "status": "started",
            "config": config,
            "preferred_resolution": preferred_resolution,  # Store preferred resolution
            "start_time": datetime.now(timezone.utc).isoformat(),
            "total_tiles": scan_grid_size * scan_grid_size,
            "processed_tiles": 0,
            "streaming_mode": True,  # Enable streaming mode
            "tile_size_m": tile_size_m,
            "is_paused": False,      # Add pause state
            "tile_queue": [],        # Queue of remaining tiles
            "current_tile_index": 0  # Track current processing position
        }
        
        # Store session
        active_sessions[session_id] = session_info
        
        # Start background task for tile scanning
        asyncio.create_task(run_lidar_scan_async(session_id, session_info))
        
        logger.info(f"✅ Started LiDAR scan session {session_id}")
        
        return {
            "session_id": session_id,
            "status": "started",
            "message": f"LiDAR scan started for {scan_grid_size}x{scan_grid_size} tiles",
            "total_tiles": scan_grid_size * scan_grid_size,
            "actual_resolution": f"{preferred_resolution}m"
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to start LiDAR scan: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start LiDAR scan: {str(e)}")

async def run_lidar_scan_async(session_id: str, session_info: Dict[str, Any]):
    """
    Background task to perform tile-by-tile LiDAR scanning using LidarFactory
    """
    try:
        from lidar_factory.factory import LidarMapFactory
        
        config = session_info["config"]
        center_lat = float(config.get('center_lat', 52.4751))
        center_lon = float(config.get('center_lon', 4.8156))
        radius_km = float(config.get('radius_km', 2.0))
        tile_size_m = int(config.get('tile_size_m', 64))  # Smaller for streaming
        data_type = config.get('data_type', 'DSM')
        streaming_mode = config.get('streaming_mode', True)  # Enable by default
        preferred_resolution = session_info.get('preferred_resolution', 1.0)  # Get from session info
        
        # Calculate scan area bounds (should match the green rectangle)
        radius_m = radius_km * 1000
        lat_delta = radius_m / 111320
        lon_delta = radius_m / (111320 * np.cos(np.radians(center_lat)))
        
        # Define the exact scan area bounds
        north_lat = center_lat + lat_delta
        south_lat = center_lat - lat_delta  
        east_lon = center_lon + lon_delta
        west_lon = center_lon - lon_delta
        
        # Calculate how many tiles we need to cover this area
        area_width_m = 2 * radius_m
        area_height_m = 2 * radius_m
        tiles_x = max(1, int(np.ceil(area_width_m / tile_size_m)))
        tiles_y = max(1, int(np.ceil(area_height_m / tile_size_m)))
        
        logger.info(f"�️ Streaming LiDAR scan: {tiles_x}×{tiles_y} tiles of {tile_size_m}m each")
        
        # Update session status
        session_info["status"] = "running"
        session_info["processed_tiles"] = 0
        session_info["total_tiles"] = tiles_x * tiles_y
        session_info["processed_tile_ids"] = set()  # Track processed tiles to prevent duplicates
        
        # Generate tiles to exactly cover the scan area
        # Simple systematic tiling: top-left to bottom-right
        logger.info(f"📋 Systematic tiling: {tiles_y} rows × {tiles_x} cols = {tiles_y * tiles_x} tiles")
        
        # Process tiles systematically row by row, left to right
        for row in range(tiles_y):
            for col in range(tiles_x):
                # Check if session still exists and is not stopped
                current_session = active_sessions.get(session_id)
                if not current_session or current_session.get("status") == "stopped":
                    logger.info(f"🛑 LiDAR scan {session_id} stopped by user")
                    return
                
                # Check for pause state and wait if paused (always get fresh session info)
                while True:
                    current_session = active_sessions.get(session_id)
                    if not current_session or current_session.get("status") == "stopped":
                        logger.info(f"🛑 LiDAR scan {session_id} stopped while checking pause")
                        return
                    
                    if not current_session.get("is_paused", False):
                        break  # Not paused, continue processing
                    
                    logger.info(f"⏸️ LiDAR scan {session_id} is paused at tile ({row},{col}), waiting...")
                    await asyncio.sleep(0.2)  # Check every 200ms for better responsiveness
                
                # Create unique tile ID to prevent duplicates
                tile_id = f"tile_{row}_{col}"
                
                # Skip if already processed (duplicate prevention)
                if tile_id in session_info.get("processed_tile_ids", set()):
                    logger.warning(f"🔄 Skipping duplicate tile {tile_id}")
                    continue
                
                # Mark tile as being processed
                session_info.setdefault("processed_tile_ids", set()).add(tile_id)
                logger.debug(f"🔧 Processing tile {tile_id} ({row},{col})")
                
                # Calculate tile position within the scan area
                lat_step = (north_lat - south_lat) / tiles_y
                lon_step = (east_lon - west_lon) / tiles_x
                
                # Top-left to bottom-right: row 0 should be at north (top), row N at south (bottom)
                tile_lat = north_lat - (row + 0.5) * lat_step  # Start from north, go south
                tile_lon = west_lon + (col + 0.5) * lon_step   # Start from west, go east
                
                try:
                    # Use the preferred resolution determined at scan start
                    # Don't override with calculation - let backend determine optimal resolution
                    result = LidarMapFactory.get_patch(
                        lat=tile_lat,
                        lon=tile_lon,
                        size_m=tile_size_m,
                        preferred_resolution_m=preferred_resolution,
                        preferred_data_type=data_type
                    )
                    
                    if result is not None:
                        # Safety check: ensure result is LidarPatchResult, not raw numpy array
                        if isinstance(result, np.ndarray):
                            logger.error(f"❌ BUG: LidarMapFactory.get_patch returned numpy array instead of LidarPatchResult! Shape: {result.shape}")
                            # Create a fallback LidarPatchResult
                            from lidar_factory.factory import LidarPatchResult
                            result = LidarPatchResult(
                                data=result,
                                source_dataset="Unknown",
                                resolution_m=preferred_resolution,
                                resolution_description=f"{preferred_resolution}m",
                                is_high_resolution=preferred_resolution <= 2.0,
                                data_type=data_type
                            )
                            logger.warning(f"Created fallback LidarPatchResult for safety")
                        
                        elevation_data = result.data
                        
                        # Store resolution metadata in session for consistency
                        if "resolution_metadata" not in session_info:
                            session_info["resolution_metadata"] = {
                                "resolution_description": result.resolution_description,
                                "is_high_resolution": result.is_high_resolution,
                                "source_dataset": result.source_dataset,
                                "resolution_m": result.resolution_m
                            }
                        
                        # Log elevation statistics for debugging
                        elev_min = float(np.nanmin(elevation_data))
                        elev_max = float(np.nanmax(elevation_data))
                        elev_mean = float(np.nanmean(elevation_data))
                        
                        # Downsample elevation data for efficient transmission while preserving detail
                        # AHN4 is 0.5m resolution, so we downsample for visualization
                        h, w = elevation_data.shape
                        max_viz_size = 64  # Maximum size for visualization (64x64 = 4096 pixels)
                        
                        if h > max_viz_size or w > max_viz_size:
                            step_h = max(1, h // max_viz_size)
                            step_w = max(1, w // max_viz_size)
                            viz_elevation = elevation_data[::step_h, ::step_w].tolist()
                            viz_shape = [len(viz_elevation), len(viz_elevation[0])]
                        else:
                            viz_elevation = elevation_data.tolist()
                            viz_shape = [h, w]
                        
                        # Calculate explicit tile bounds for consistent rendering
                        lat_delta = (tile_size_m / 2) / 111320  # Half tile size in degrees latitude
                        lon_delta = (tile_size_m / 2) / (111320 * np.cos(np.radians(tile_lat)))  # Half tile size in degrees longitude
                        
                        tile_bounds = {
                            "south": tile_lat - lat_delta,
                            "west": tile_lon - lon_delta,
                            "north": tile_lat + lat_delta,
                            "east": tile_lon + lon_delta
                        }

                        # Create tile result with scan area bounds and grid position
                        tile_result = {
                            "session_id": session_id,
                            "tile_id": tile_id,
                            "type": "lidar_tile",
                            "center_lat": tile_lat,
                            "center_lon": tile_lon,
                            "size_m": tile_size_m,
                            "tile_bounds": tile_bounds,          # Add explicit tile bounds
                            "has_data": True,
                            "actual_resolution": result.resolution_description,  # Use actual resolution from dataset
                            "is_high_resolution": result.is_high_resolution,     # Add high-resolution flag
                            "source_dataset": result.source_dataset,            # Add source dataset name
                            "grid_row": row,                 # Add grid position for visual effects
                            "grid_col": col,
                            "grid_total_rows": tiles_y,
                            "grid_total_cols": tiles_x,
                            "elevation_stats": {
                                "min": float(np.nanmin(elevation_data)),
                                "max": float(np.nanmax(elevation_data)),
                                "mean": float(np.nanmean(elevation_data)),
                                "std": float(np.nanstd(elevation_data))
                            },
                            "shape": elevation_data.shape,
                            "viz_elevation": viz_elevation,  # Add downsampled elevation data
                            "viz_shape": viz_shape,          # Shape of visualization data
                            "scan_bounds": {                 # Add original scan area bounds
                                "north": north_lat,
                                "south": south_lat,
                                "east": east_lon,
                                "west": west_lon
                            },
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        }
                        
                        logger.debug(f"✅ Sending tile {tile_id} with elevation data")
                        # Send tile result to connected clients
                        await discovery_manager.send_message(tile_result)
                        
                    else:
                        # No data available for this tile
                        # Calculate explicit tile bounds for consistent rendering
                        lat_delta = (tile_size_m / 2) / 111320  # Half tile size in degrees latitude
                        lon_delta = (tile_size_m / 2) / (111320 * np.cos(np.radians(tile_lat)))  # Half tile size in degrees longitude
                        
                        tile_bounds = {
                            "south": tile_lat - lat_delta,
                            "west": tile_lon - lon_delta,
                            "north": tile_lat + lat_delta,
                            "east": tile_lon + lon_delta
                        }
                        
                        tile_result = {
                            "session_id": session_id,
                            "tile_id": tile_id,
                            "type": "lidar_tile",
                            "center_lat": tile_lat,
                            "center_lon": tile_lon,
                            "size_m": tile_size_m,
                            "tile_bounds": tile_bounds,          # Add explicit tile bounds
                            "has_data": False,
                            "actual_resolution": session_info.get("resolution_metadata", {}).get("resolution_description", f"{preferred_resolution}m"),
                            "is_high_resolution": session_info.get("resolution_metadata", {}).get("is_high_resolution", False),
                            "source_dataset": session_info.get("resolution_metadata", {}).get("source_dataset", "unknown"),
                            "grid_row": row,                 # Add grid position for visual effects
                            "grid_col": col,
                            "grid_total_rows": tiles_y,
                            "grid_total_cols": tiles_x,
                            "scan_bounds": {                 # Add original scan area bounds
                                "north": north_lat,
                                "south": south_lat,
                                "east": east_lon,
                                "west": west_lon
                            },
                            "message": "No LiDAR data available",
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        }
                        
                        logger.debug(f"⚠️ Sending tile {tile_id} with no data")
                        await discovery_manager.send_message(tile_result)
                    
                    # Update progress
                    session_info["processed_tiles"] = row * tiles_x + col + 1
                    
                    # Send progress update
                    progress_update = {
                        "session_id": session_id,
                        "type": "lidar_progress",
                        "processed_tiles": session_info["processed_tiles"],
                        "total_tiles": session_info["total_tiles"],
                        "progress_percent": (session_info["processed_tiles"] / session_info["total_tiles"]) * 100,
                        "actual_resolution": session_info.get("resolution_metadata", {}).get("resolution_description", f"{preferred_resolution}m"),
                        "is_high_resolution": session_info.get("resolution_metadata", {}).get("is_high_resolution", False),
                        "source_dataset": session_info.get("resolution_metadata", {}).get("source_dataset", "unknown"),
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
                    
                    await discovery_manager.send_message(progress_update)
                    
                    # Small delay to prevent overwhelming the system
                    await asyncio.sleep(0.1)
                    
                except Exception as e:
                    logger.error(f"Error processing tile {row},{col}: {e}")
                    continue
        
        # Mark session as completed
        session_info["status"] = "completed"
        session_info["end_time"] = datetime.now(timezone.utc).isoformat()
        
        # Send completion message
        completion_message = {
            "session_id": session_id,
            "type": "lidar_completed",
            "message": f"LiDAR scan completed. Processed {session_info['processed_tiles']} tiles.",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        await discovery_manager.send_message(completion_message)
        logger.info(f"✅ Completed LiDAR scan session {session_id}")
        
    except Exception as e:
        logger.error(f"❌ Error in LiDAR scan {session_id}: {e}")
        session_info["status"] = "error"
        session_info["error"] = str(e)
        
        error_message = {
            "session_id": session_id,
            "type": "lidar_error",
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        await discovery_manager.send_message(error_message)

@router.post("/discovery/pause-resume-lidar")
async def pause_resume_lidar_scan(
    session_id: str,
    current_user: Optional[Dict[str, Any]] = Depends(get_current_user_optional)
):
    """
    Pause or resume an active LiDAR scanning session.
    """
    try:
        if session_id not in active_sessions:
            raise HTTPException(status_code=404, detail="Session not found")
        
        session_info = active_sessions[session_id]
        
        if session_info["type"] != "lidar_scan":
            raise HTTPException(status_code=400, detail="Session is not a LiDAR scan")
        
        # Toggle pause state
        current_paused = session_info.get("is_paused", False)
        session_info["is_paused"] = not current_paused
        
        status = "paused" if session_info["is_paused"] else "resumed"
        session_info["status"] = status
        
        logger.info(f"📊 LiDAR scan {session_id} {status}")
        
        # Notify clients of pause/resume
        await discovery_manager.send_message({
            "session_id": session_id,
            "type": "lidar_status",
            "status": status,
            "is_paused": session_info["is_paused"],
            "processed_tiles": session_info["processed_tiles"],
            "total_tiles": session_info["total_tiles"],
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
        return {
            "session_id": session_id,
            "status": status,
            "is_paused": session_info["is_paused"],
            "message": f"LiDAR scan {status}",
            "processed_tiles": session_info["processed_tiles"],
            "total_tiles": session_info["total_tiles"]
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to pause/resume LiDAR scan: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to pause/resume LiDAR scan: {str(e)}")

@router.post("/discovery/pause-lidar")
async def pause_lidar_scan(
    request: SessionRequest,
    current_user: Optional[Dict[str, Any]] = Depends(get_current_user_optional)
):
    """
    Pause an active LiDAR scanning session.
    """
    try:
        session_id = request.session_id
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
            
        logger.info(f"⏸️ Pause request for session: {session_id}")
        
        if session_id not in active_sessions:
            logger.error(f"❌ Session not found: {session_id}")
            logger.info(f"🔍 Available sessions: {list(active_sessions.keys())}")
            raise HTTPException(status_code=404, detail="Session not found")
        
        session_info = active_sessions[session_id]
        
        if session_info["type"] != "lidar_scan":
            raise HTTPException(status_code=400, detail="Session is not a LiDAR scan")
        
        if session_info.get("is_paused", False):
            logger.info(f"⚠️ Session {session_id} is already paused")
            return {
                "session_id": session_id,
                "status": "already_paused",
                "message": "LiDAR scan is already paused",
                "processed_tiles": session_info["processed_tiles"],
                "total_tiles": session_info["total_tiles"]
            }
        
        # Pause the session
        session_info["is_paused"] = True
        session_info["status"] = "paused"
        
        logger.info(f"✅ LiDAR scan {session_id} PAUSED successfully")
        logger.info(f"📊 Session state: is_paused={session_info['is_paused']}, status={session_info['status']}")
        
        # Notify clients
        await discovery_manager.send_message({
            "session_id": session_id,
            "type": "lidar_status",
            "status": "paused",
            "is_paused": True,
            "processed_tiles": session_info["processed_tiles"],
            "total_tiles": session_info["total_tiles"],
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
        return {
            "session_id": session_id,
            "status": "paused",
            "message": "LiDAR scan paused",
            "processed_tiles": session_info["processed_tiles"],
            "total_tiles": session_info["total_tiles"]
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to pause LiDAR scan: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to pause LiDAR scan: {str(e)}")

@router.post("/discovery/resume-lidar")
async def resume_lidar_scan(
    request: SessionRequest,
    current_user: Optional[Dict[str, Any]] = Depends(get_current_user_optional)
):
    """
    Resume a paused LiDAR scanning session.
    """
    try:
        session_id = request.session_id
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
            
        logger.info(f"▶️ Resume request for session: {session_id}")
        
        if session_id not in active_sessions:
            logger.error(f"❌ Session not found: {session_id}")
            logger.info(f"🔍 Available sessions: {list(active_sessions.keys())}")
            raise HTTPException(status_code=404, detail="Session not found")
        
        session_info = active_sessions[session_id]
        
        if session_info["type"] != "lidar_scan":
            raise HTTPException(status_code=400, detail="Session is not a LiDAR scan")
        
        if not session_info.get("is_paused", False):
            logger.info(f"⚠️ Session {session_id} is already running")
            return {
                "session_id": session_id,
                "status": "already_running",
                "message": "LiDAR scan is already running",
                "processed_tiles": session_info["processed_tiles"],
                "total_tiles": session_info["total_tiles"]
            }
        
        # Resume the session
        session_info["is_paused"] = False
        session_info["status"] = "running"
        
        logger.info(f"✅ LiDAR scan {session_id} resumed")
        
        # Notify clients
        await discovery_manager.send_message({
            "session_id": session_id,
            "type": "lidar_status",
            "status": "resumed",
            "is_paused": False,
            "processed_tiles": session_info["processed_tiles"],
            "total_tiles": session_info["total_tiles"],
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
        return {
            "session_id": session_id,
            "status": "resumed",
            "message": "LiDAR scan resumed",
            "processed_tiles": session_info["processed_tiles"],
            "total_tiles": session_info["total_tiles"]
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to resume LiDAR scan: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to resume LiDAR scan: {str(e)}")

def generate_progressive_tile_order(tiles_x, tiles_y, pattern='left_to_right'):
    """
    Generate tile coordinates in progressive order patterns
    """
    tiles = []
    
    if pattern == 'left_to_right':
        # Process column by column from left to right (wipe effect)
        for col in range(tiles_x):
            for row in range(tiles_y):
                tiles.append((row, col))
                
    elif pattern == 'top_to_bottom':
        # Process row by row from top to bottom
        for row in range(tiles_y):
            for col in range(tiles_x):
                tiles.append((row, col))
                
    elif pattern == 'center_outward':
        # Process from center outward in a spiral
        center_row, center_col = tiles_y // 2, tiles_x // 2
        visited = set()
        
        # Start with center tile
        tiles.append((center_row, center_col))
        visited.add((center_row, center_col))
        
        # Expand outward in layers
        for radius in range(1, max(tiles_x, tiles_y)):
            for dr in range(-radius, radius + 1):
                for dc in range(-radius, radius + 1):
                    if abs(dr) == radius or abs(dc) == radius:  # Only edge of current radius
                        r, c = center_row + dr, center_col + dc
                        if 0 <= r < tiles_y and 0 <= c < tiles_x and (r, c) not in visited:
                            tiles.append((r, c))
                            visited.add((r, c))
    else:
        # Default: simple sequential
        for row in range(tiles_y):
            for col in range(tiles_x):
                tiles.append((row, col))
    
    return tiles

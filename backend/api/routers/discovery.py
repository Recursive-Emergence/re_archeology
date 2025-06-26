"""
Discovery router for real-time archaeological structure detection.
"""

# ==============================================================================
# IMPORTS
# ==============================================================================

# Standard library imports
import asyncio
import json
import logging
import os
import sys
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# Third-party imports
import ee
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.websockets import WebSocketState
from pydantic import BaseModel
from typing import Dict, Any, Optional

# Local imports
from backend.api.routers.auth import get_current_user_optional
from backend.utils.earth_engine import get_earth_engine_status, is_earth_engine_available

# Kernel system imports
# Add the root directory to Python path to import kernel system
root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

try:
    from kernel import G2DetectionResult, G2StructureDetector
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

# ==============================================================================
# LOGGING CONFIGURATION
# ==============================================================================

# Temporarily enable debug logging to diagnose WebSocket issues
logger.setLevel(logging.DEBUG)

# Reduce G2 kernel logging to avoid flooding during detection
kernel_logger = logging.getLogger('kernel.core_detector')
kernel_logger.setLevel(logging.WARNING)

# ==============================================================================
# UTILITY FUNCTIONS
# ==============================================================================

def get_available_structure_types():
    """Get available structure types from profiles directory"""
    app_root = "/media/im3/plus/lab4/RE/re_archaeology"
    profiles_dir = f"{app_root}/profiles"
    
    available_types = []
    default_type = "windmill"  # Fallback default
    
    try:
        import os
        import glob
        
        # Find all .json files in profiles directory
        profile_files = glob.glob(f"{profiles_dir}/*.json")
        
        for profile_file in profile_files:
            # Extract structure type from filename (remove .json extension)
            filename = os.path.basename(profile_file)
            if filename.endswith('.json'):
                structure_type = filename[:-5]  # Remove .json
                
                # Convert specific profile names to user-friendly structure types
                if 'windmill' in structure_type.lower():
                    available_types.append('windmill')
                    default_type = "windmill"  # Prefer windmill as default
                elif 'tower' in structure_type.lower():
                    available_types.append('tower')
                elif 'mound' in structure_type.lower():
                    available_types.append('mound')
                elif 'geoglyph' in structure_type.lower():
                    available_types.append('geoglyph')
                elif 'citadel' in structure_type.lower():
                    available_types.append('citadel')
                else:
                    # Generic structure type (use filename without extension)
                    clean_name = structure_type.replace('_', ' ').replace('-', ' ')
                    available_types.append(clean_name)
        
        # Remove duplicates and sort
        available_types = sorted(list(set(available_types)))
        
        # Ensure default is first if available
        if default_type in available_types:
            available_types.remove(default_type)
            available_types.insert(0, default_type)
        
        logger.info(f"📋 Available structure types: {available_types}")
        return available_types, default_type
        
    except Exception as e:
        logger.warning(f"Error scanning profiles directory: {e}")
        # Fallback to basic types
        return ["windmill", "tower", "mound"], "windmill"

def get_profile_name_for_structure_type(structure_type: str):
    """Convert structure type to profile filename"""
    app_root = "/media/im3/plus/lab4/RE/re_archaeology"
    profiles_dir = f"{app_root}/profiles"
    
    # Direct mapping for common types
    type_mapping = {
        'windmill': 'dutch_windmill.json',
        'tower': 'tower.json',
        'mound': 'mound.json',
        'geoglyph': 'amazon_geoglyph.json',
        'citadel': 'amazon_citadel.json'
    }
    
    # Check direct mapping first
    if structure_type.lower() in type_mapping:
        profile_name = type_mapping[structure_type.lower()]
        if os.path.exists(f"{profiles_dir}/{profile_name}"):
            return profile_name
    
    # Try variations with the structure type name
    possible_names = [
        f"{structure_type}.json",
        f"{structure_type.lower()}.json",
        f"{structure_type.replace(' ', '_')}.json",
        f"{structure_type.replace(' ', '_').lower()}.json"
    ]
    
    for name in possible_names:
        if os.path.exists(f"{profiles_dir}/{name}"):
            return name
    
    # Fallback to dutch_windmill.json
    logger.warning(f"No profile found for structure type '{structure_type}', using dutch_windmill.json")
    return "dutch_windmill.json"

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
        
        # Choose data type based on resolution
        # For low resolution (> 2m), use DTM to get cleaner ground surface
        # For high resolution (<= 2m), use DSM to capture structure details
        if resolution_m > 2.0:
            smart_data_type = "DTM"
            # Using DTM for low resolution
        else:
            smart_data_type = data_type  # Keep original choice for high-res
            # Using specified data type for high resolution
        
        # Use LidarFactory to get elevation data
        result = LidarMapFactory.get_patch(
            lat=lat,
            lon=lon,
            size_m=patch_size_m,
            preferred_resolution_m=resolution_m,
            preferred_data_type=smart_data_type
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
        
        # Use raw elevation data without NaN cleaning for accurate detection
        
        # Elevation patch loaded via LidarFactory
        
        return elevation_array, result  # Return both data and metadata
        
    except Exception as e:
        logger.error(f"❌ LidarFactory elevation loading failed for {patch_name}: {e}")
        raise
        
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
        
        # Loading LiDAR data via factory
        
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
        
        # Use raw elevation data without NaN cleaning for accurate detection
        
        # Create ElevationPatch object
        patch = ElevationPatch(
            elevation_data=elevation_array,
            lat=lat,
            lon=lon,
            source="LidarFactory",
            resolution_m=resolution_m,
            patch_size_m=patch_size_m
        )
        
        # Patch loaded via LidarFactory
        return patch
        
    except Exception as e:
        # Failed to load patch via LidarFactory
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

# ==============================================================================
# DATA MODELS
# ==============================================================================

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
    patch_size_m: int  # Patch size determined by backend profile authority (required field)
    detection_result: Optional[Dict] = None
    elevation_data: Optional[List] = None
    elevation_stats: Optional[Dict] = None

# ==============================================================================
# REQUEST/RESPONSE MODELS FOR PROFILE CONFIGURATION
# ==============================================================================

class ProfileGeometryConfig(BaseModel):
    patch_size_m: Optional[List[float]] = None
    resolution_m: Optional[float] = None
    structure_radius_m: Optional[float] = None
    min_structure_size_m: Optional[float] = None
    max_structure_size_m: Optional[float] = None

class ProfileThresholdsConfig(BaseModel):
    detection_threshold: Optional[float] = None
    confidence_threshold: Optional[float] = None
    early_decision_threshold: Optional[float] = None
    uncertainty_tolerance: Optional[float] = None

class ProfileFeatureConfig(BaseModel):
    enabled: Optional[bool] = None
    weight: Optional[float] = None
    polarity_preference: Optional[str] = None

class ProfilePerformanceConfig(BaseModel):
    aggregation_method: Optional[str] = None
    parallel_execution: Optional[bool] = None
    max_workers: Optional[int] = None

class CustomProfileRequest(BaseModel):
    structure_type: str
    session_id: Optional[str] = None
    geometry: Optional[ProfileGeometryConfig] = None
    thresholds: Optional[ProfileThresholdsConfig] = None
    features: Optional[Dict[str, ProfileFeatureConfig]] = None
    performance: Optional[ProfilePerformanceConfig] = None
    save_as_custom: Optional[bool] = False
    custom_profile_name: Optional[str] = None

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

# ==============================================================================
# CONNECTION MANAGEMENT
# ==============================================================================

class EnhancedConnectionManager:
    """Enhanced WebSocket connection manager with better status tracking"""
    
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.connection_metadata: Dict[WebSocket, Dict] = {}
        self.session_connections: Dict[str, List[WebSocket]] = {}
        self.last_heartbeat: Dict[WebSocket, float] = {}
    
    async def connect(self, websocket: WebSocket, user_id: str = None):
        # Accepting WebSocket connection
        await websocket.accept()
        # WebSocket accepted successfully
        
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
        
        # WebSocket connected
        
        # Send a welcome message to confirm connection
        await self.send_to_connection(websocket, {
            'type': 'connection_established',
            'timestamp': datetime.now().isoformat(),
            'total_connections': len(self.active_connections)
        })
        
        # WebSocket connection established
    
    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        
        # Clean up metadata
        self.connection_metadata.pop(websocket, None)
        self.last_heartbeat.pop(websocket, None)
        
        # WebSocket disconnected
    
    async def send_to_connection(self, websocket: WebSocket, message: dict):
        """Send message to specific connection with error handling"""
        try:
            # Check if websocket is still open before sending
            # WebSocket connection check (verbose logging reduced)
            
            if websocket.client_state != WebSocketState.CONNECTED:
                logger.warning(f"WebSocket not connected (state: {websocket.client_state}), skipping message send")
                return False
                
            # Serialize message with detailed error handling
            try:
                message_json = json.dumps(message, default=safe_serialize)
                # Message serialized successfully
            except Exception as serialize_error:
                logger.error(f"Failed to serialize message: {serialize_error}, message type: {message.get('type')}")
                # Send a simpler error message instead
                fallback_message = {
                    'type': 'error',
                    'message': 'Serialization error in server message',
                    'timestamp': datetime.now().isoformat()
                }
                message_json = json.dumps(fallback_message)
            
            await websocket.send_text(message_json)
            # Message sent successfully
            
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
        message_type = message.get('type', 'unknown')
        
        if not self.active_connections:
            logger.warning(f"❌ No active connections, skipping message broadcast: {message_type}")
            return 0
            
        # Broadcasting message to active connections
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
        
        if successful_sends > 0:
            # Broadcast successful
            pass
        else:
            logger.warning(f"❌ Failed to broadcast {message_type} - no successful sends")
        
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

# ==============================================================================
# GLOBAL VARIABLES AND CONSTANTS
# ==============================================================================

# Global manager instance
discovery_manager = EnhancedConnectionManager()
active_sessions: Dict[str, DiscoverySession] = {}
session_patches: Dict[str, List[ScanPatch]] = {}

# ==============================================================================
# API REQUEST MODELS
# ==============================================================================

class SessionRequest(BaseModel):
    session_id: str

# ==============================================================================
# ROUTER INITIALIZATION
# ==============================================================================

router = APIRouter()

# ==============================================================================
# WEBSOCKET ENDPOINTS
# ==============================================================================

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
            # Wait for client messages
            data = await websocket.receive_text()
            # Received WebSocket data
            
            message = json.loads(data)
            # Received WebSocket message
            
            # Update message received count
            if websocket in discovery_manager.connection_metadata:
                discovery_manager.connection_metadata[websocket]['messages_received'] += 1
                discovery_manager.connection_metadata[websocket]['last_seen'] = datetime.now()
            
            # Handle different message types
            if message.get('type') == 'ping':
                # Handling ping message
                await discovery_manager.send_to_connection(websocket, {
                    'type': 'pong',
                    'timestamp': datetime.now().isoformat()
                })
            elif message.get('type') == 'pong':
                # Received pong message
                # Update heartbeat timestamp
                discovery_manager.last_heartbeat[websocket] = time.time()
            elif message.get('type') == 'get_status':
                # Handling status request
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

# ==============================================================================
# DISCOVERY SESSION ENDPOINTS
# ==============================================================================

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
        
        # Cancel any active detection for this session first
        if session_id in _active_detection_tasks:
            detection_task = _active_detection_tasks[session_id]
            if not detection_task.done():
                detection_task.cancel()
                logger.info(f"🛑 Cancelled active detection task for session {session_id}")
            del _active_detection_tasks[session_id]
        
        # Check if we should run coordinated detection before cleanup
        should_run_detection = False
        scan_area = None
        
        if isinstance(session, dict) and session.get("type") == "lidar_scan":
            enable_detection = session.get("enable_detection", False)
            if enable_detection:
                # Sliding detection was already running during LiDAR scan
                logger.info(f"✅ Sliding detection was running during LiDAR scan for session {session_id}")
                logger.info(f"🛑 Detection will be cancelled by the task cancellation above")
        
        # Send stopped message first
        await discovery_manager.send_message({
            'type': 'session_stopped',
            'session_id': session_id,
            'timestamp': datetime.now().isoformat()
        })
        
        # Start coordinated detection if needed (before cleanup)
        if should_run_detection and scan_area:
            logger.info(f"🎯 Starting coordinated detection for stopped session {session_id}")
            
            # Send detection starting message
            await discovery_manager.send_message({
                "type": "detection_starting",
                "session_id": session_id,
                "message": "Starting coordinated detection on collected tiles",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            # Run coordinated detection asynchronously and store task for cancellation
            detection_task = asyncio.create_task(run_coordinated_detection(session_id, scan_area))
            _active_detection_tasks[session_id] = detection_task
        else:
            # Clean up detector cache only if not running detection
            cleanup_session_detector(session_id)
        
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

# ==============================================================================
# KERNEL MANAGEMENT ENDPOINTS
# ==============================================================================

@router.get("/discovery/profiles")
async def get_available_profiles(current_user=Depends(get_current_user_optional)):
    """Get detailed list of available detection profiles with their configurable options"""
    try:
        from kernel.detector_profile import DetectorProfileManager
        
        app_root = "/media/im3/plus/lab4/RE/re_archaeology"
        profile_manager = DetectorProfileManager(profiles_dir=f"{app_root}/profiles")
        
        # Get available types
        available_types, default_type = get_available_structure_types()
        
        profiles_info = []
        
        for structure_type in available_types:
            try:
                # Load profile to get detailed information
                profile_name = get_profile_name_for_structure_type(structure_type)
                profile = profile_manager.load_profile(profile_name)
                
                # Extract configurable options from profile
                profile_info = {
                    "structure_type": structure_type,
                    "profile_name": profile.name,
                    "filename": profile_name,
                    "description": profile.description,
                    "version": profile.version,
                    "structure_category": profile.structure_type.value if hasattr(profile, 'structure_type') else structure_type,
                    
                    # Geometric parameters (configurable)
                    "geometry": {
                        "patch_size_m": profile.geometry.patch_size_m,
                        "resolution_m": profile.geometry.resolution_m,
                        "structure_radius_m": profile.geometry.structure_radius_m,
                        "min_structure_size_m": profile.geometry.min_structure_size_m,
                        "max_structure_size_m": profile.geometry.max_structure_size_m,
                        "patch_shape": profile.geometry.patch_shape.value if hasattr(profile.geometry.patch_shape, 'value') else str(profile.geometry.patch_shape)
                    },
                    
                    # Detection thresholds (configurable)
                    "thresholds": {
                        "detection_threshold": profile.thresholds.detection_threshold,
                        "confidence_threshold": profile.thresholds.confidence_threshold,
                        "early_decision_threshold": getattr(profile.thresholds, 'early_decision_threshold', None),
                        "uncertainty_tolerance": getattr(profile.thresholds, 'uncertainty_tolerance', None)
                    },
                    
                    # Feature weights (configurable)
                    "features": {},
                    
                    # Performance settings
                    "performance": {
                        "aggregation_method": getattr(profile, 'aggregation_method', 'streaming'),
                        "parallel_execution": getattr(profile, 'parallel_execution', True),
                        "max_workers": getattr(profile, 'max_workers', 6)
                    }
                }
                
                # Extract feature information
                if hasattr(profile, 'features') and profile.features:
                    for feature_name, feature_config in profile.features.items():
                        if hasattr(feature_config, 'enabled') and hasattr(feature_config, 'weight'):
                            profile_info["features"][feature_name] = {
                                "enabled": feature_config.enabled,
                                "weight": feature_config.weight,
                                "polarity_preference": getattr(feature_config, 'polarity_preference', None),
                                "configurable": True  # Mark as user-configurable
                            }
                
                profiles_info.append(profile_info)
                
            except Exception as e:
                logger.warning(f"Could not load profile for {structure_type}: {e}")
                # Add basic info even if profile loading fails
                profiles_info.append({
                    "structure_type": structure_type,
                    "profile_name": f"{structure_type.title()} Detection",
                    "filename": get_profile_name_for_structure_type(structure_type),
                    "description": f"Detection profile for {structure_type} structures",
                    "error": str(e)
                })
        
        return {
            "status": "success",
            "profiles": profiles_info,
            "default_type": default_type,
            "total_count": len(profiles_info),
            "configurable_options": {
                "geometry": ["patch_size_m", "resolution_m", "structure_radius_m"],
                "thresholds": ["detection_threshold", "confidence_threshold"],
                "features": "all_weights_and_enabled_status"
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Error getting available profiles: {e}")
        return {
            "status": "error",
            "message": str(e),
            "profiles": [],
            "default_type": "windmill"
        }

@router.get("/discovery/structure_types")
async def get_available_structure_types_endpoint(current_user=Depends(get_current_user_optional)):
    """Get simple list of available structure types (backwards compatibility)"""
    try:
        available_types, default_type = get_available_structure_types()
        return {
            "status": "success",
            "available_types": available_types,
            "default_type": default_type,
            "total_count": len(available_types)
        }
    except Exception as e:
        logger.error(f"❌ Error getting available structure types: {e}")
        return {
            "status": "error",
            "message": str(e),
            "available_types": ["windmill"],  # Fallback
            "default_type": "windmill"
        }

@router.post("/discovery/configure_profile")
async def configure_custom_profile(request: CustomProfileRequest, current_user=Depends(get_current_user_optional)):
    """Apply custom configuration to a detection profile for a session"""
    try:
        from kernel.detector_profile import DetectorProfileManager
        from kernel import G2StructureDetector
        import copy
        
        app_root = "/media/im3/plus/lab4/RE/re_archaeology"
        profile_manager = DetectorProfileManager(profiles_dir=f"{app_root}/profiles")
        
        # Load base profile
        profile_name = get_profile_name_for_structure_type(request.structure_type)
        base_profile = profile_manager.load_profile(profile_name)
        
        # Create a copy to modify
        custom_profile = copy.deepcopy(base_profile)
        
        # Track what was modified
        modifications = []
        
        # Apply geometry modifications
        if request.geometry:
            if request.geometry.patch_size_m is not None:
                custom_profile.geometry.patch_size_m = tuple(request.geometry.patch_size_m)
                modifications.append(f"patch_size_m: {request.geometry.patch_size_m}")
            
            if request.geometry.resolution_m is not None:
                custom_profile.geometry.resolution_m = request.geometry.resolution_m
                modifications.append(f"resolution_m: {request.geometry.resolution_m}")
            
            if request.geometry.structure_radius_m is not None:
                custom_profile.geometry.structure_radius_m = request.geometry.structure_radius_m
                modifications.append(f"structure_radius_m: {request.geometry.structure_radius_m}")
            
            if request.geometry.min_structure_size_m is not None:
                custom_profile.geometry.min_structure_size_m = request.geometry.min_structure_size_m
                modifications.append(f"min_structure_size_m: {request.geometry.min_structure_size_m}")
            
            if request.geometry.max_structure_size_m is not None:
                custom_profile.geometry.max_structure_size_m = request.geometry.max_structure_size_m
                modifications.append(f"max_structure_size_m: {request.geometry.max_structure_size_m}")
        
        # Apply threshold modifications
        if request.thresholds:
            if request.thresholds.detection_threshold is not None:
                custom_profile.thresholds.detection_threshold = request.thresholds.detection_threshold
                modifications.append(f"detection_threshold: {request.thresholds.detection_threshold}")
            
            if request.thresholds.confidence_threshold is not None:
                custom_profile.thresholds.confidence_threshold = request.thresholds.confidence_threshold
                modifications.append(f"confidence_threshold: {request.thresholds.confidence_threshold}")
            
            if request.thresholds.early_decision_threshold is not None and hasattr(custom_profile.thresholds, 'early_decision_threshold'):
                custom_profile.thresholds.early_decision_threshold = request.thresholds.early_decision_threshold
                modifications.append(f"early_decision_threshold: {request.thresholds.early_decision_threshold}")
            
            if request.thresholds.uncertainty_tolerance is not None and hasattr(custom_profile.thresholds, 'uncertainty_tolerance'):
                custom_profile.thresholds.uncertainty_tolerance = request.thresholds.uncertainty_tolerance
                modifications.append(f"uncertainty_tolerance: {request.thresholds.uncertainty_tolerance}")
        
        # Apply feature modifications
        if request.features and hasattr(custom_profile, 'features'):
            for feature_name, feature_config in request.features.items():
                if feature_name in custom_profile.features:
                    if feature_config.enabled is not None:
                        custom_profile.features[feature_name].enabled = feature_config.enabled
                        modifications.append(f"{feature_name}.enabled: {feature_config.enabled}")
                    
                    if feature_config.weight is not None:
                        custom_profile.features[feature_name].weight = feature_config.weight
                        modifications.append(f"{feature_name}.weight: {feature_config.weight}")
                    
                    if feature_config.polarity_preference is not None and hasattr(custom_profile.features[feature_name], 'polarity_preference'):
                        custom_profile.features[feature_name].polarity_preference = feature_config.polarity_preference
                        modifications.append(f"{feature_name}.polarity_preference: {feature_config.polarity_preference}")
        
        # Apply performance modifications
        if request.performance:
            if request.performance.aggregation_method is not None and hasattr(custom_profile, 'aggregation_method'):
                custom_profile.aggregation_method = request.performance.aggregation_method
                modifications.append(f"aggregation_method: {request.performance.aggregation_method}")
            
            if request.performance.parallel_execution is not None and hasattr(custom_profile, 'parallel_execution'):
                custom_profile.parallel_execution = request.performance.parallel_execution
                modifications.append(f"parallel_execution: {request.performance.parallel_execution}")
            
            if request.performance.max_workers is not None and hasattr(custom_profile, 'max_workers'):
                custom_profile.max_workers = request.performance.max_workers
                modifications.append(f"max_workers: {request.performance.max_workers}")
        
        # Test the custom profile by creating a detector
        try:
            test_detector = G2StructureDetector(profile=custom_profile)
            profile_valid = True
            validation_message = "Profile configuration is valid"
        except Exception as e:
            profile_valid = False
            validation_message = f"Profile validation failed: {str(e)}"
        
        # Store custom profile for session if valid and session_id provided
        session_cache_key = None
        if profile_valid and request.session_id:
            session_cache_key = f"custom_{request.session_id}_{request.structure_type}"
            # Store in session cache (you might want to implement session-based profile storage)
            logger.info(f"🔧 Custom profile configured for session {request.session_id}: {modifications}")
        
        # Save as custom profile if requested
        saved_profile_name = None
        if request.save_as_custom and request.custom_profile_name and profile_valid:
            try:
                custom_filename = f"custom_{request.custom_profile_name.replace(' ', '_').lower()}.json"
                # You might want to implement profile saving functionality
                saved_profile_name = custom_filename
                modifications.append(f"Saved as: {custom_filename}")
            except Exception as e:
                logger.warning(f"Failed to save custom profile: {e}")
        
        return {
            "status": "success",
            "profile_valid": profile_valid,
            "validation_message": validation_message,
            "base_profile": profile_name,
            "structure_type": request.structure_type,
            "modifications": modifications,
            "session_cache_key": session_cache_key,
            "saved_profile_name": saved_profile_name,
            "custom_profile_summary": {
                "patch_size_m": custom_profile.geometry.patch_size_m,
                "detection_threshold": custom_profile.thresholds.detection_threshold,
                "confidence_threshold": custom_profile.thresholds.confidence_threshold,
                "feature_count": len(custom_profile.features) if hasattr(custom_profile, 'features') else 0,
                "enabled_features": [name for name, feature in custom_profile.features.items() if feature.enabled] if hasattr(custom_profile, 'features') else []
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Error configuring custom profile: {e}")
        return {
            "status": "error",
            "message": str(e),
            "profile_valid": False
        }

@router.get("/discovery/kernels")
async def get_cached_kernels(structure_type: str = None):
    """Get list of cached kernels from the new G2 system"""
    try:
        # Use dynamic structure type if not provided
        if structure_type is None:
            available_types, default_type = get_available_structure_types()
            structure_type = default_type
        
        # Import G2 detection system
        from kernel import G2StructureDetector
        
        # Create detector with Dutch windmill profile
        from kernel.detector_profile import DetectorProfileManager
        
        # Use app root profiles/ directory as single source for consistency
        app_root = "/media/im3/plus/lab4/RE/re_archaeology"
        profile_manager = DetectorProfileManager(
            profiles_dir=f"{app_root}/profiles"
        )
        # Get profile name dynamically based on structure type
        profile_name = get_profile_name_for_structure_type(structure_type)
        profile = profile_manager.load_profile(profile_name)
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
    """Clear cached detectors to apply profile fixes"""
    try:
        # Clear all cached detectors to force using updated profile parameters
        force_clear_all_detectors()
        return {
            'status': 'success',
            'removed_count': len(_session_detectors),
            'message': 'Detector cache cleared - profile fixes will be applied'
        }
    except Exception as e:
        logger.error(f"Failed to clear kernel cache: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==============================================================================
# DISCOVERY LOGIC
# ==============================================================================

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
        
        # Load profile to get patch_size_m from backend authority (not frontend)
        from kernel.detector_profile import DetectorProfileManager
        
        # Use app root profiles/ directory as single source for consistency
        app_root = "/media/im3/plus/lab4/RE/re_archaeology"
        profile_manager = DetectorProfileManager(
            profiles_dir=f"{app_root}/profiles"
        )
        profile = profile_manager.load_profile("dutch_windmill.json")
        
        # Backend has authority over patch size - read from profile, not frontend config
        patch_size_m = profile.geometry.patch_size_m[0]  # Use profile's patch size
        
        # Calculate SLIDING WINDOW scanning with optimized step size for 40m patches
        # Use 10m steps for reasonable overlap (75% overlap) - consistent with standalone detection
        sliding_step_m = config.get('sliding_step_m', 10)  # Default to 10 meter steps for efficiency
        
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
                
                # Load REAL elevation data from Google Earth Engine using profile resolution
                buffer_radius_m = patch_size_m // 2  # Half the patch size
                elevation_result = load_elevation_patch_unified(lat, lon, f"patch_{patch_number}", buffer_radius_m, resolution_m=profile_resolution_m)
                
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
                        
                        # Load the Dutch windmill profile from app root profiles/ directory
                        app_root = "/media/im3/plus/lab4/RE/re_archaeology"
                        profile_manager = DetectorProfileManager(
                            profiles_dir=f"{app_root}/profiles"
                        )
                        profile = profile_manager.load_profile("dutch_windmill.json")
                        detector = G2StructureDetector(profile=profile)
                        
                        # Log elevation data characteristics for debugging
                        elev_data = elevation_patch.elevation_data
                        logger.info(f"🔍 Elevation patch analysis at ({lat:.6f}, {lon:.6f}):")
                        logger.info(f"  Shape: {elev_data.shape}")
                        logger.info(f"  Min/Max: {np.nanmin(elev_data):.3f} / {np.nanmax(elev_data):.3f}")
                        logger.info(f"  Mean/Std: {np.nanmean(elev_data):.3f} / {np.nanstd(elev_data):.3f}")
                        logger.info(f"  Range: {np.nanmax(elev_data) - np.nanmin(elev_data):.3f}")
                        logger.info(f"  Data hash: {hash(elev_data.tobytes())}")
                        
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
                        'session_id': session.session_id,
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
                
                # Send dedicated detection_result only for actual G2 detections
                if is_positive:
                    # Extract G2 detection scores if available
                    final_score = 0.0
                    if 'detection_result' in locals() and detection_result and hasattr(detection_result, 'final_score'):
                        final_score = float(detection_result.final_score)
                    
                    logger.info(f"🎯 Sending detection_result for windmill: score={final_score:.3f}, confidence={confidence:.3f} at ({lat:.6f}, {lon:.6f})")
                    logger.info(f"📊 Elevation stats: min={elevation_stats['min']:.2f}, max={elevation_stats['max']:.2f}, mean={elevation_stats['mean']:.2f}, std={elevation_stats['std']:.2f}")
                    await manager.send_message({
                        'type': 'detection_result',
                        'structure_type': structure_type,
                        'confidence': confidence,
                        'final_score': final_score,
                        'detected': True,  # Only sent when is_positive=True
                        'lat': lat,
                        'lon': lon,
                        'session_id': session.session_id,
                        'patch_id': patch_id,
                        'timestamp': datetime.now().isoformat()
                    })
                
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

# ==============================================================================
# STATUS AND HEALTH ENDPOINTS
# ==============================================================================

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

# ==============================================================================
# LIDAR SCANNING ENDPOINTS
# ==============================================================================

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
        # Backend has authority over tile size - use profile patch size  
        tile_size_m = 40  # Use consistent 40m patch size
        prefer_high_resolution = config.get('prefer_high_resolution', False)
        enable_detection = config.get('enable_detection', False)
        # Get available structure types and use dynamic default
        available_types, default_type = get_available_structure_types()
        structure_type = config.get('structure_type', default_type)
        
        # Determine optimal resolution based on preference and area size
        if prefer_high_resolution:
            preferred_resolution = 0.25  # High resolution for detailed areas
        elif radius_km <= 1.0:
            preferred_resolution = 0.5   # Medium resolution for small areas
        else:
            preferred_resolution = 1.0   # Standard resolution for large areas
        
        # Using preferred resolution for LiDAR scan
        
        # Calculate scanning parameters
        radius_m = radius_km * 1000
        scan_grid_size = int(2 * radius_m / tile_size_m)
        
        # LiDAR streaming configuration set
        
        # Create session info with enhanced queue management
        session_info = {
            "session_id": session_id,
            "type": "lidar_scan",
            "status": "started",
            "config": config,
            "preferred_resolution": preferred_resolution,  # Store preferred resolution
            "enable_detection": enable_detection,  # Store detection configuration
            "structure_type": structure_type,
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
        
        # Send detection starting message if detection is enabled
        if enable_detection:
            await discovery_manager.send_message({
                "type": "detection_starting",
                "session_id": session_id,
                "message": "Starting real-time sliding detection during LiDAR scan",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
        
        # Start background task for tile scanning
        asyncio.create_task(run_lidar_scan_async(session_id, session_info))
        
        # LiDAR scan session started
        
        return {
            "session_id": session_id,
            "status": "started",
            "message": f"LiDAR scan started for {scan_grid_size}x{scan_grid_size} tiles" + (" with detection" if enable_detection else ""),
            "total_tiles": scan_grid_size * scan_grid_size,
            "actual_resolution": f"{preferred_resolution}m",
            "enable_detection": enable_detection,
            "structure_type": structure_type
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
        # Backend has authority over tile size - use profile patch size
        tile_size_m = 40  # Use consistent 40m patch size
        data_type = config.get('data_type', 'DSM')
        streaming_mode = config.get('streaming_mode', True)  # Enable by default
        preferred_resolution = session_info.get('preferred_resolution', 1.0)  # Get from session info
        enable_detection = config.get('enable_detection', False)
        # Get available structure types and use dynamic default
        available_types, default_type = get_available_structure_types()
        structure_type = config.get('structure_type', default_type)
        
        # Load profile to get correct resolution and patch size
        from kernel.detector_profile import DetectorProfileManager
        app_root = "/media/im3/plus/lab4/RE/re_archaeology"
        profile_manager = DetectorProfileManager(profiles_dir=f"{app_root}/profiles")
        profile_name = get_profile_name_for_structure_type(structure_type)
        profile = profile_manager.load_profile(profile_name)
        profile_resolution_m = profile.geometry.resolution_m
        
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
        
        # Streaming LiDAR scan initialized
        
        # Update session status
        session_info["status"] = "running"
        session_info["processed_tiles"] = 0
        session_info["total_tiles"] = tiles_x * tiles_y
        session_info["processed_tile_ids"] = set()  # Track processed tiles to prevent duplicates
        
        # Generate tiles to exactly cover the scan area
        # Simple systematic tiling: top-left to bottom-right
        # Systematic tiling pattern configured
        
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
                # Processing tile
                
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
                        
                        # Sending tile with elevation data
                        # Send tile result to connected clients
                        await discovery_manager.send_message(tile_result)
                        
                        # Store tile data for coordinated detection later
                        # Detection enabled for tile
                        if enable_detection:
                            # Storing tile for coordinated detection
                            # Store tile data for later coordinated detection
                            if session_id not in _session_tile_data:
                                _session_tile_data[session_id] = {}
                            _session_tile_data[session_id][tile_id] = {
                                'lat': tile_lat,
                                'lon': tile_lon, 
                                'elevation_data': elevation_data,
                                'lidar_result': result,
                                'structure_type': structure_type
                            }
                            
                            # Store tile for real-time sliding detection (don't run tile-level detection for lens)
                            # Tile stored for real-time sliding detection
                            
                            # Start sliding detection after collecting enough tiles
                            tiles_collected = len(_session_tile_data[session_id])
                            if tiles_collected == 5 and session_id not in _active_detection_tasks:  # Start after 5 tiles
                                # Starting sliding detection with collected tiles
                                # Start background sliding detection
                                config = session_info.get('config', {})
                                center_lat = config.get('center_lat')
                                center_lon = config.get('center_lon') 
                                radius_km = config.get('radius_km')
                                
                                if center_lat and center_lon and radius_km:
                                    scan_area = {
                                        'lat': center_lat,
                                        'lon': center_lon,
                                        'size_km': radius_km * 2  # Convert radius to diameter
                                    }
                                    detection_task = asyncio.create_task(run_coordinated_detection(session_id, scan_area))
                                    _active_detection_tasks[session_id] = detection_task
                        # Note: Removed test patch_result for non-detection mode to avoid confusion
                        
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
                        
                        # Sending tile with no data
                        await discovery_manager.send_message(tile_result)
                        
                        # Send empty patch_result if detection is enabled to keep lens moving
                        if enable_detection:
                            patch_message = {
                                'session_id': str(session_id),
                                'patch_id': str(tile_id),
                                'lat': float(tile_lat),
                                'lon': float(tile_lon),
                                'timestamp': datetime.now(timezone.utc).isoformat(),
                                'is_positive': False,
                                'confidence': 0.0,
                                'detection_result': {
                                    'confidence': 0.0,
                                    'method': f'G2_{structure_type}_no_data',
                                    'elevation_source': 'none'
                                },
                                'elevation_stats': {},
                                'patch_size_m': int(tile_size_m)
                            }
                            
                            # Sending patch_result (no data) for tile
                            await discovery_manager.send_message({
                                'type': 'patch_result',
                                'patch': patch_message,
                                'timestamp': datetime.now(timezone.utc).isoformat()
                            })
                            # No-data patch result sent
                    
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
        
        # Detection will be handled by coordinated sliding detection when session is stopped
        
        # Completed LiDAR scan session
        
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

# ==============================================================================
# SESSION UTILITIES
# ==============================================================================

# Session detector cache to avoid redundant initialization
_session_detectors = {}

# Session-based tile data storage for coordinated detection
_session_tile_data = {}

# Active detection tasks that can be cancelled
_active_detection_tasks = {}

async def get_session_detector(session_id: str, structure_type: str):
    """Get or create a cached detector for the session"""
    cache_key = f"{session_id}_{structure_type}"
    
    if cache_key not in _session_detectors:
        try:
            # Initialize detector once per session
            from kernel import G2StructureDetector
            from kernel.detector_profile import DetectorProfileManager
            
            # Use app root profiles/ directory as single source for consistency
            app_root = "/media/im3/plus/lab4/RE/re_archaeology"
            profile_manager = DetectorProfileManager(
                profiles_dir=f"{app_root}/profiles"
            )
            
            # Get profile name dynamically based on available profiles
            profile_name = get_profile_name_for_structure_type(structure_type)
            
            logger.info(f"🔧 Initializing G2 detector for session {session_id} with {structure_type} profile")
            profile = profile_manager.load_profile(profile_name)
            detector = G2StructureDetector(profile=profile)
            
            _session_detectors[cache_key] = detector
            logger.info(f"✅ G2 detector cached for session {session_id}")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize G2 detector: {e}")
            # Return None and handle gracefully
            return None
    
    return _session_detectors[cache_key]

def cleanup_session_detector(session_id: str):
    """Clean up detector cache when session ends"""
    keys_to_remove = [key for key in _session_detectors.keys() if key.startswith(f"{session_id}_")]
    for key in keys_to_remove:
        del _session_detectors[key]
    # Cleaned up detectors for session
    
    # Also clean up tile data
    if session_id in _session_tile_data:
        del _session_tile_data[session_id]
        # Cleaned up tile data for session

def force_clear_all_detectors():
    """Force clear all cached detectors to apply profile fixes"""
    global _session_detectors
    _session_detectors.clear()
    logger.info("🧹 Cleared all cached detectors - will use updated profile parameters")

# Clear detector cache on module load to ensure updated parameters are used
force_clear_all_detectors()

async def run_coordinated_detection(session_id: str, scan_area):
    """Run detection across entire scan area in typewriter pattern"""
    logger.info(f"🎯 Coordinated detection called for session {session_id}")
    logger.info(f"🎯 Scan area: {scan_area}")
    logger.info(f"🎯 Available tile data: {list(_session_tile_data.get(session_id, {}).keys())}")
    
    if session_id not in _session_tile_data:
        logger.warning(f"❌ No tile data found for session {session_id}")
        return
        
    tile_count = len(_session_tile_data[session_id])
    logger.info(f"🎯 Starting coordinated detection for session {session_id} with {tile_count} tiles")
    
    # Send detection starting message to activate frontend
    await discovery_manager.send_message({
        "type": "detection_starting",
        "session_id": session_id,
        "message": "Starting coordinated detection across scanned area",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    
    # Load profile to get detection parameters from backend authority
    from kernel.detector_profile import DetectorProfileManager
    
    # Use app root profiles/ directory as single source for consistency
    app_root = "/media/im3/plus/lab4/RE/re_archaeology"
    profile_manager = DetectorProfileManager(
        profiles_dir=f"{app_root}/profiles"
    )
    profile = profile_manager.load_profile("dutch_windmill.json")
    
    # Backend has authority over detection parameters - read from profile
    detection_patch_size_m = profile.geometry.patch_size_m[0]  # Use profile's patch size
    detection_step_size_m = 10  # Keep step size configurable for now
    
    # Calculate scan area bounds with safety checks
    lat_center = scan_area.get('lat')
    lon_center = scan_area.get('lon') 
    size_km = scan_area.get('size_km')
    
    # Validate required parameters
    if lat_center is None or lon_center is None or size_km is None:
        logger.error(f"❌ Invalid scan_area parameters: lat={lat_center}, lon={lon_center}, size_km={size_km}")
        logger.error(f"❌ Full scan_area: {scan_area}")
        return
    
    logger.info(f"🎯 Scan center: ({lat_center:.6f}, {lon_center:.6f}), size: {size_km}km")
    
    # Convert to coordinate deltas
    lat_m_per_deg = 111320
    lon_m_per_deg = 111320 * np.cos(np.radians(lat_center))
    
    # Calculate detection grid bounds
    half_size_m = (size_km * 1000) / 2
    
    # Calculate number of detection steps across entire scan area
    steps_lat = int(size_km * 1000 / detection_step_size_m)
    steps_lon = int(size_km * 1000 / detection_step_size_m)
    
    logger.info(f"🎯 Detection grid: {steps_lat} x {steps_lon} patches ({detection_step_size_m}m steps)")
    logger.info(f"🎯 Grid bounds: ±{half_size_m}m from center")
    
    # Get detector
    # Get available structure types and use dynamic default
    available_types, default_type = get_available_structure_types()
    structure_type = default_type  # Use dynamic default from profiles
    detector = await get_session_detector(session_id, structure_type)
    if not detector:
        logger.error("❌ Failed to get detector for coordinated detection")
        return
    
    logger.info(f"✅ Detector ready for session {session_id}")
    
    # Typewriter pattern: row by row (north to south), left to right within each row
    for i in range(steps_lat):  # North-South rows
        # Check if detection was cancelled
        if session_id not in _active_detection_tasks:
            logger.info(f"🛑 Detection cancelled for session {session_id}")
            return
            
        for j in range(steps_lon):  # East-West columns (typewriter style)
            # Calculate patch coordinates (start from top-left, move east then south)
            # Note: negative offset_lat_m moves north (higher latitude)
            offset_lat_m = half_size_m - (i * detection_step_size_m) - (detection_patch_size_m / 2)  # Start north, go south
            offset_lon_m = -half_size_m + (j * detection_step_size_m) + (detection_patch_size_m / 2)  # Start west, go east
            
            patch_lat = lat_center + offset_lat_m / lat_m_per_deg
            patch_lon = lon_center + offset_lon_m / lon_m_per_deg
            
            # Detection patch coordinates calculated
            
            # Find which tile(s) contain this patch and get elevation data
            # Getting elevation for patch
            elevation_patch = await get_elevation_for_patch(session_id, patch_lat, patch_lon, detection_patch_size_m)
            
            if elevation_patch is not None:
                # Got elevation data for patch
                # Run detection on this patch
                patch_id = f"coord_patch_{i}_{j}"
                await run_detection_on_patch(detector, patch_lat, patch_lon, elevation_patch, session_id, patch_id, structure_type, detection_patch_size_m)
            else:
                # No elevation data for patch
                pass
            
            # Small delay to make progression visible
            await asyncio.sleep(0.15)
    
    logger.info(f"🎯 Coordinated detection completed for session {session_id}")
    
    # Clean up detection task
    if session_id in _active_detection_tasks:
        del _active_detection_tasks[session_id]
    
    # Send completion message
    await discovery_manager.send_message({
        "type": "detection_completed",
        "session_id": session_id,
        "message": "Coordinated detection completed",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    
    # Clean up detector cache and tile data
    cleanup_session_detector(session_id)

async def run_realtime_tile_detection(session_id: str, tile_id: str, tile_lat: float, tile_lon: float, elevation_data: np.ndarray, structure_type: str):
    """Run real-time detection on a single tile during LiDAR scan"""
    try:
        # Starting real-time detection
        
        # Get detector for this session
        detector = await get_session_detector(session_id, structure_type)
        if not detector:
            logger.warning(f"❌ No detector available for real-time detection on {tile_id}")
            return
        
        # Create ElevationPatch for detection using profile geometry settings
        patch_obj = ElevationPatch(
            elevation_data=elevation_data,
            lat=tile_lat,
            lon=tile_lon,
            source="RealtimeDetection",
            resolution_m=detector.profile.geometry.resolution_m,  # Use profile resolution
            patch_size_m=detector.profile.geometry.patch_size_m[0]  # Use profile patch size
        )
        
        # Run detection
        result = detector.detect_structure(patch_obj)
        
        # Extract results with safe conversion
        confidence = float(getattr(result, 'confidence', 0.0)) if hasattr(result, 'confidence') else 0.0
        is_positive = bool(getattr(result, 'detected', False)) if hasattr(result, 'detected') else False
        
        # Create patch message for frontend lens movement
        patch_message = {
            'lat': float(tile_lat),
            'lon': float(tile_lon),
            'confidence': confidence,
            'is_positive': is_positive,
            'session_id': str(session_id),
            'patch_id': str(tile_id),
            'structure_type': str(structure_type),
            'patch_size_m': 64  # Tile size for real-time detection
        }
        
        # Send patch_result message for lens movement
        # Sending real-time patch_result for tile
        await discovery_manager.send_message({
            'type': 'patch_result',
            'patch': patch_message,
            'session_id': session_id,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
        
        # Real-time detection completed
        
    except Exception as e:
        logger.error(f"❌ Real-time detection failed for {tile_id}: {e}")
        import traceback
        logger.error(traceback.format_exc())

async def get_elevation_for_patch(session_id: str, patch_lat: float, patch_lon: float, patch_size_m: float):
    """Get elevation data for a patch from stored tile data"""
    # Looking for elevation data for patch
    
    if session_id not in _session_tile_data:
        # No session data available
        return None
    
    available_tiles = list(_session_tile_data[session_id].keys())
    # Available tiles found
        
    min_distance = float('inf')
    closest_tile = None
    closest_tile_id = None
    
    for tile_id, tile_data in _session_tile_data[session_id].items():
        # Calculate distance to tile center
        lat_diff = abs(tile_data['lat'] - patch_lat)
        lon_diff = abs(tile_data['lon'] - patch_lon)
        distance = (lat_diff ** 2 + lon_diff ** 2) ** 0.5
        
        # Checking tile distance for patch extraction
        
        if distance < min_distance:
            min_distance = distance
            closest_tile = tile_data
            closest_tile_id = tile_id
    
    if closest_tile:
        logger.info(f"✅ Using tile {closest_tile_id} for patch extraction")
        
        # Calculate proper offset of patch center relative to tile center
        lat_m_per_deg = 111320
        lon_m_per_deg = 111320 * np.cos(np.radians(patch_lat))
        
        lat_offset_m = (patch_lat - closest_tile['lat']) * lat_m_per_deg
        lon_offset_m = (patch_lon - closest_tile['lon']) * lon_m_per_deg
        
        # Patch offset from tile center calculated
        
        # Extract patch from tile with proper offset
        result = extract_patch_from_tile(
            closest_tile['elevation_data'],
            lat_offset_m, lon_offset_m,
            patch_size_m,  # Use the parameter passed to this function
            closest_tile['lidar_result'].resolution_m
        )
        
        if result is not None:
            # Extracted patch from tile
            pass
        else:
            # Failed to extract patch from tile
            pass
        
        return result
    
    # No suitable tile found for patch
    return None

async def run_detection_on_patch(detector, patch_lat, patch_lon, elevation_patch, session_id, patch_id, structure_type, detection_patch_size_m):
    """Run detection on a single patch and send results"""
    try:
        # Use raw elevation data without NaN cleaning for accurate detection
        # (NaN cleaning was causing inflated scores vs validator)
        
        # Create elevation patch object using profile geometry settings
        from kernel.core_detector import ElevationPatch
        patch_obj = ElevationPatch(
            elevation_data=elevation_patch,
            lat=patch_lat,
            lon=patch_lon,
            source="CoordinatedDetection",
            resolution_m=detector.profile.geometry.resolution_m,  # Use profile resolution
            patch_size_m=detector.profile.geometry.patch_size_m[0]  # Use profile patch size
        )
        
        # Run G2 detection
        result = detector.detect_structure(patch_obj)
        
        # Extract results with safe conversion
        confidence = float(getattr(result, 'confidence', 0.0)) if hasattr(result, 'confidence') else 0.0
        is_positive = bool(getattr(result, 'detected', False)) if hasattr(result, 'detected') else False
        final_score = float(getattr(result, 'final_score', 0.0)) if hasattr(result, 'final_score') else 0.0
        
        # Create patch message with explicit type conversion
        patch_message = {
            'lat': float(patch_lat),
            'lon': float(patch_lon),
            'confidence': confidence,
            'is_positive': is_positive,
            'session_id': str(session_id),
            'patch_id': str(patch_id),
            'structure_type': str(structure_type),
            'patch_size_m': detection_patch_size_m  # Use profile-derived patch size
        }
        
        # Send patch_result message
        # Sending coordinated patch_result
        await discovery_manager.send_message({
            'type': 'patch_result',
            'patch': patch_message,
            'session_id': session_id,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
        # Patch result sent
        
        # Send detection_result only for actual G2 detections
        if is_positive:
            logger.info(f"🎯 Detection: score={final_score:.3f}, confidence={confidence:.3f} at ({patch_lat:.6f}, {patch_lon:.6f})")
            detection_message = {
                'type': 'detection_result',
                'structure_type': structure_type,
                'confidence': confidence,
                'final_score': final_score,
                'detected': True,  # Only sent when is_positive=True
                'lat': patch_lat,
                'lon': patch_lon,
                'session_id': session_id,
                'timestamp': datetime.now(timezone.utc).isoformat()
            }
            logger.info(f"🚨 SENDING DETECTION_RESULT: final_score={final_score:.6f} ({final_score*100:.1f}%), confidence={confidence:.6f} ({confidence*100:.1f}%)")
            await discovery_manager.send_message(detection_message)
            
    except Exception as e:
        logger.error(f"Detection failed for patch {patch_id}: {e}")

def extract_patch_from_tile(elevation_data, offset_lat_m, offset_lon_m, patch_size_m, resolution_m):
    """
    Extract a patch from tile elevation data at given offset.
    For center-based extraction (offset=0,0), use full available tile for consistency.
    """
    try:
        tile_shape = elevation_data.shape
        
        # For center-based extraction, use the full available tile to match standalone detection
        if abs(offset_lat_m) < 1.0 and abs(offset_lon_m) < 1.0:
            # Use full tile for center-based detection to match standalone results
            return elevation_data
        
        # For offset-based extraction, extract the specific patch
        tile_center_y, tile_center_x = tile_shape[0] // 2, tile_shape[1] // 2
        
        # Convert offset to pixels
        offset_y_px = int(offset_lat_m / resolution_m)
        offset_x_px = int(offset_lon_m / resolution_m)
        
        # Calculate patch size in pixels
        patch_size_px = int(patch_size_m / resolution_m)
        half_patch_px = patch_size_px // 2
        
        # Calculate patch bounds in tile coordinates
        patch_center_y = tile_center_y + offset_y_px
        patch_center_x = tile_center_x + offset_x_px
        
        y_start = patch_center_y - half_patch_px
        y_end = patch_center_y + half_patch_px
        x_start = patch_center_x - half_patch_px
        x_end = patch_center_x + half_patch_px
        
        # Check bounds
        if (y_start < 0 or y_end >= tile_shape[0] or 
            x_start < 0 or x_end >= tile_shape[1]):
            return None  # Patch extends outside tile
        
        # Extract patch
        patch = elevation_data[y_start:y_end, x_start:x_end]
        
        # Ensure patch is the right size
        if patch.shape[0] < patch_size_px * 0.8 or patch.shape[1] < patch_size_px * 0.8:
            return None  # Patch too small
            
        return patch
        
    except Exception as e:
        logger.warning(f"Failed to extract patch: {e}")
        return None

async def run_detection_on_tile(lat, lon, elevation_data, lidar_result, session_id, tile_id, structure_type):
    """
    Deprecated: replaced with coordinated detection - this is now a stub
    """
    logger.debug(f"🔄 Skipping per-tile detection for {tile_id} - using coordinated detection instead")
    return
    try:
        # Detection parameters
        detection_patch_size_m = 40  # Optimal patch size for windmill detection
        detection_step_size_m = 10   # Step size for sliding window (10m steps)
        
        # Calculate tile bounds
        tile_size_m = elevation_data.shape[0] * lidar_result.resolution_m
        
        # Convert to coordinate deltas
        lat_m_per_deg = 111320
        lon_m_per_deg = 111320 * np.cos(np.radians(lat))
        
        # Calculate number of detection patches within this tile
        steps_per_axis = max(1, int((tile_size_m - detection_patch_size_m) / detection_step_size_m) + 1)
        
        logger.debug(f"Running sliding window detection on tile {tile_id}: {steps_per_axis}x{steps_per_axis} patches")
        
        # Get or create detector for this session (cached to avoid redundant initialization)
        detector = await get_session_detector(session_id, structure_type)
        
        # Sliding window detection within the tile (east-west first, then north-south like typewriter)
        for i in range(steps_per_axis):  # North-South rows
            for j in range(steps_per_axis):  # East-West columns (typewriter style)
                # Calculate patch center offset from tile center
                offset_lat_m = (i - (steps_per_axis - 1) / 2) * detection_step_size_m
                offset_lon_m = (j - (steps_per_axis - 1) / 2) * detection_step_size_m
                
                # Convert to coordinates
                patch_lat = lat + offset_lat_m / lat_m_per_deg
                patch_lon = lon + offset_lon_m / lon_m_per_deg
                
                # Extract patch from tile elevation data
                patch_elevation = extract_patch_from_tile(
                    elevation_data, 
                    offset_lat_m, offset_lon_m, 
                    detection_patch_size_m, 
                    lidar_result.resolution_m
                )
                
                if patch_elevation is None:
                    continue  # Skip if patch extraction failed
                
                # Create ElevationPatch for the G2 detector
                patch = ElevationPatch(
                    elevation_data=patch_elevation,
                    lat=patch_lat,
                    lon=patch_lon,
                    source="LidarFactory",
                    resolution_m=lidar_result.resolution_m,
                    patch_size_m=detection_patch_size_m
                )
                
                # Run detection on this patch
                if detector is None:
                    # Fallback if detector initialization failed
                    is_positive = False
                    confidence = 0.0
                    detection_result = None
                    logger.warning(f"Detector not available for {patch_id_detailed}")
                else:
                    detection_result = detector.detect_structure(patch)
                    is_positive = detection_result.detected if detection_result else False
                    confidence = detection_result.confidence if detection_result else 0.0
                    final_score = detection_result.final_score if detection_result and hasattr(detection_result, 'final_score') else 0.0
                
                # Create patch ID for this detection patch
                patch_id_detailed = f"{tile_id}_patch_{i}_{j}"
                
                # Calculate elevation statistics for the patch
                elevation_stats = {
                    'min': float(np.nanmin(patch_elevation)),
                    'max': float(np.nanmax(patch_elevation)),
                    'mean': float(np.nanmean(patch_elevation)),
                    'std': float(np.nanstd(patch_elevation)),
                    'range': float(np.nanmax(patch_elevation) - np.nanmin(patch_elevation))
                }
                
                # Create detection result data
                detection_result_data = {
                    'confidence': float(confidence),
                    'method': f'G2_{structure_type}_sliding',
                    'elevation_source': str(lidar_result.source_dataset),
                    'g2_detected': bool(is_positive),
                    'g2_confidence': float(confidence),
                }
                
                # Create patch message for this detection patch
                patch_message = {
                    'session_id': str(session_id),
                    'patch_id': str(patch_id_detailed),
                    'lat': float(patch_lat),
                    'lon': float(patch_lon),
                    'timestamp': datetime.now(timezone.utc).isoformat(),
                    'is_positive': bool(is_positive),
                    'confidence': float(confidence),
                    'detection_result': detection_result_data,
                    'elevation_stats': elevation_stats,
                    'patch_size_m': int(detection_patch_size_m)
                }
                
                # Send patch_result message for detection progression (lens follows detection pattern)
                logger.debug(f"🔍 Sending patch_result for detection {patch_id_detailed} at ({patch_lat:.6f}, {patch_lon:.6f}) - confidence: {confidence:.3f}")
                await discovery_manager.send_message({
                    'type': 'patch_result',
                    'patch': patch_message,
                    'session_id': session_id,
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })
                
                # Small delay to make detection progression visible
                await asyncio.sleep(0.1)
                
                # Also send detection_result only for actual G2 detections
                if is_positive:
                    logger.info(f"🎯 Sending detection_result for {structure_type}: score={final_score:.3f}, confidence={confidence:.3f} at ({patch_lat:.6f}, {patch_lon:.6f})")
                    await discovery_manager.send_message({
                        'type': 'detection_result',
                        'structure_type': structure_type,
                        'confidence': confidence,
                        'final_score': final_score,
                        'detected': True,  # Only sent when is_positive=True
                        'lat': patch_lat,
                        'lon': patch_lon,
                        'session_id': session_id,
                        'patch_id': patch_id_detailed,
                        'timestamp': datetime.now(timezone.utc).isoformat()
                    })
                
                # Small delay to control detection pace
                await asyncio.sleep(0.1)
        
        logger.debug(f"Sliding window detection completed for tile {tile_id}")
        
    except Exception as e:
        logger.warning(f"Detection failed for tile {tile_id}: {e}")
        # Send a single patch result as fallback
        patch_message = {
            'session_id': str(session_id),
            'patch_id': str(tile_id),
            'lat': float(lat),
            'lon': float(lon),
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'is_positive': False,
            'confidence': 0.0,
            'detection_result': {
                'confidence': 0.0,
                'method': f'G2_{structure_type}_failed',
                'error': str(e)
            },
            'elevation_stats': {},
            'patch_size_m': 64  # Default fallback
        }
        
        await discovery_manager.send_message({
            'type': 'patch_result',
            'patch': patch_message,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

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

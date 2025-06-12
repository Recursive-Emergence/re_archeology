"""
Discovery router for real-time archaeological structure detection.
"""

import asyncio
import json
import logging
import uuid
import time
import os
from datetime import datetime
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.websockets import WebSocketState
from fastapi.responses import JSONResponse
import numpy as np
import ee

from backend.api.routers.auth import get_current_user_optional

# Import the ElevationPatch class from phi0_core
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))))
from phi0_core import ElevationPatch

logger = logging.getLogger(__name__)
# Temporarily enable debug logging to diagnose WebSocket issues
logger.setLevel(logging.DEBUG)

# Global flag to track Earth Engine initialization
_ee_initialized = False

def initialize_earth_engine():
    """Initialize Earth Engine with service account authentication"""
    global _ee_initialized
    if _ee_initialized:
        return True
        
    try:
        # Try service account first (preferred for production)
        service_account_path = "/media/im3/plus/lab4/RE/re_archaeology/sage-striker-294302-b89a8b7e205b.json"
        if os.path.exists(service_account_path):
            credentials = ee.ServiceAccountCredentials(
                'elevation-pattern-detection@sage-striker-294302.iam.gserviceaccount.com',
                service_account_path
            )
            ee.Initialize(credentials)
            logger.info("✅ Earth Engine initialized with service account credentials")
        else:
            # Fallback to default authentication
            ee.Initialize()
            logger.info("✅ Earth Engine initialized with default authentication")
        
        _ee_initialized = True
        return True
        
    except Exception as ee_error:
        logger.error(f"❌ Earth Engine initialization failed: {ee_error}")
        return False

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

def load_real_elevation_patch(lat, lon, windmill_name, buffer_radius_m=20, resolution_m=0.5):
    """
    Load elevation patch using Earth Engine AHN4 DSM data.
    Uses sampleRectangle to fetch the entire grid in one request.
    """
    logger.info(f"Loading REAL AHN4 data for {windmill_name}...")
    logger.info(f"  Location: ({lat:.6f}, {lon:.6f})")
    logger.info(f"  Buffer: {buffer_radius_m}m radius at {resolution_m}m resolution")
    
    try:
        # Ensure Earth Engine is initialized
        try:
            ee.Number(1).getInfo()  # Test if EE is initialized
        except:
            initialize_earth_engine()
        
        center = ee.Geometry.Point([lon, lat])
        polygon = center.buffer(buffer_radius_m).bounds()
        
        # Load AHN4 DSM data
        ahn4_dsm = ee.ImageCollection("AHN/AHN4").select('dsm').median()
        ahn4_dsm = ahn4_dsm.reproject(crs='EPSG:28992', scale=resolution_m)
        
        # Use sampleRectangle to fetch the entire grid in one request
        rect = ahn4_dsm.sampleRectangle(region=polygon, defaultValue=-9999, properties=[])
        elev_block = rect.get('dsm').getInfo()
        elevation_array = np.array(elev_block, dtype=np.float32)
        
        # Replace sentinel value with np.nan for further processing
        elevation_array = np.where(elevation_array == -9999, np.nan, elevation_array)
        
        # If all values are nan, raise error
        if np.isnan(elevation_array).all():
            raise Exception(f"No valid elevation data for {windmill_name}")
        
        # Fill any remaining nans with the mean of valid values
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

def load_elevation_patch_gee(lat: float, lon: float, buffer_radius_m: int = 20, resolution_m: float = 0.5):
    """
    Load elevation patch using Earth Engine AHN4 DSM data.
    Uses the same proven method as validate_phi0.py
    """
    try:
        logger.debug(f"Loading REAL AHN4 data at ({lat:.4f}, {lon:.4f})")
        
        # Create geometry using the CONFIRMED method from validation
        center = ee.Geometry.Point([lon, lat])
        polygon = center.buffer(buffer_radius_m).bounds()
        
        # Load AHN4 DSM data (includes structures) for accurate detection
        ahn4_dsm = ee.ImageCollection("AHN/AHN4").select('dsm').median()
        ahn4_dsm = ahn4_dsm.reproject(crs='EPSG:28992', scale=resolution_m)
        
        # Use sampleRectangle to fetch the entire grid in one request (CONFIRMED METHOD)
        rect = ahn4_dsm.sampleRectangle(region=polygon, defaultValue=-9999, properties=[])
        
        # Get elevation data with timeout protection
        elev_block = rect.get('dsm').getInfo()
        elevation_array = np.array(elev_block, dtype=np.float32)
        
        # Replace sentinel value with np.nan for further processing (CONFIRMED METHOD)
        elevation_array = np.where(elevation_array == -9999, np.nan, elevation_array)
        
        # If all values are nan, raise error
        if np.isnan(elevation_array).all():
            raise Exception(f"No valid elevation data at location")
        
        # Clean the patch data using the confirmed method
        elevation_array = clean_patch_data(elevation_array)
        
        # Create ElevationPatch object using the confirmed structure
        patch = ElevationPatch(
            elevation_data=elevation_array,
            lat=lat,
            lon=lon,
            source="AHN4_real",
            resolution_m=resolution_m,
            patch_size_m=buffer_radius_m * 2
        )
        
        logger.debug(f"✅ Loaded patch: {patch.elevation_data.shape} at ({lat:.6f}, {lon:.6f})")
        return patch
        
    except Exception as e:
        logger.debug(f"Failed to load patch at ({lat:.4f}, {lon:.4f}): {e}")
        return None

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
        # Import phi0_core to get real kernel data
        from phi0_core import PhiZeroStructureDetector
        
        # Try to load existing kernel
        detector = PhiZeroStructureDetector(structure_type=structure_type or "windmill")
        
        kernels_info = []
        
        # Check if kernel exists and get its data
        if hasattr(detector, 'elevation_kernel') and detector.elevation_kernel is not None:
            # Calculate histogram from elevation kernel for frontend
            elevation_kernel = detector.elevation_kernel
            kernel_range = np.max(elevation_kernel) - np.min(elevation_kernel)
            
            if kernel_range >= 0.5:
                # Apply same normalization as phi0_core
                kernel_relative = elevation_kernel - np.min(elevation_kernel)
                kernel_max_rel = np.max(kernel_relative)
                
                if kernel_max_rel >= 0.1:
                    kernel_normalized = kernel_relative / kernel_max_rel
                    
                    # Create histogram with 16 bins
                    num_bins = 16
                    bin_edges = np.linspace(0, 1, num_bins + 1)
                    hist, _ = np.histogram(kernel_normalized.flatten(), bins=bin_edges, density=True)
                    
                    # Normalize to probability distribution
                    hist = hist / (np.sum(hist) + 1e-8)
                    
                    kernels_info.append({
                        'structure_type': structure_type or "windmill",
                        'kernel_size': detector.kernel_size,
                        'elevation_histogram': hist.tolist(),
                        'elevation_range': kernel_range,
                        'created': datetime.now().isoformat(),
                        'source': 'phi0_core'
                    })
        
        return {
            'status': 'success',
            'kernels': kernels_info,
            'total_count': len(kernels_info),
            'message': f'Found {len(kernels_info)} kernel(s)'
        }
    except Exception as e:
        logger.error(f"Failed to get cached kernels: {e}")
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
        
        # Initialize Earth Engine before starting
        if not initialize_earth_engine():
            logger.error("Failed to initialize Earth Engine")
            session.status = 'failed'
            session.error_message = 'Earth Engine initialization failed'
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
        
        # Calculate patch grid with CONTIGUOUS coverage (0m gaps)
        patches_per_side = int(np.sqrt(session.total_patches))
        patch_size_km = patch_size_m / 1000  # Convert to km
        
        # Calculate step size to ensure EXACT contiguous coverage (no gaps)
        # Each patch should be exactly adjacent to the next
        lat_step_deg = (patch_size_m / 111000)  # Convert meters to degrees latitude
        lon_step_deg = (patch_size_m / (111000 * np.cos(np.radians(center_lat))))  # Adjust for longitude
        
        # Starting coordinates (top-left corner of the grid)
        start_lat = center_lat + (patches_per_side * lat_step_deg) / 2
        start_lon = center_lon - (patches_per_side * lon_step_deg) / 2
        
        # Scan patches in a grid pattern with real elevation data
        for i in range(patches_per_side):
            for j in range(patches_per_side):
                if session.status != 'active':
                    break
                
                # Calculate patch center location for CONTIGUOUS coverage
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
                elevation_patch = load_elevation_patch_gee(lat, lon, buffer_radius_m, resolution_m=0.5)
                
                # Initialize patch data
                elevation_data = None
                elevation_stats = None
                is_positive = False
                confidence = 0.0
                
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
                    
                    # Simple detection logic (could be enhanced with actual phi0 detection)
                    # For now, use elevation variation as a proxy for structure detection
                    elevation_range = elevation_stats['range']
                    elevation_std = elevation_stats['std']
                    
                    # Detect based on elevation characteristics
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
                
                # Create patch result with real elevation data
                patch = ScanPatch(
                    session_id=session.session_id,
                    patch_id=patch_id,
                    lat=lat,
                    lon=lon,
                    timestamp=datetime.now().isoformat(),
                    is_positive=is_positive,
                    confidence=confidence,
                    detection_result={
                        'phi0': confidence * 0.8 if is_positive else 0.1,
                        'psi0': confidence * 0.9 if is_positive else 0.15,
                        'elevation_source': 'AHN4_real' if elevation_patch else 'fallback'
                    },
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
                
                # Send patch result with elevation data
                try:
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

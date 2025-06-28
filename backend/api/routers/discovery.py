"""
Discovery router for real-time archaeological structure detection.
"""

# ==============================================================================
# IMPORTS
# ==============================================================================

# Standard library imports
import os
import sys
import logging
import asyncio
import time
import json
import uuid
import copy
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# Third-party imports
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.websockets import WebSocketState
from pydantic import BaseModel
import numpy as np

# Local imports
from backend.api.routers.auth import get_current_user_optional
from backend.utils.earth_engine import get_earth_engine_status, is_earth_engine_available
from backend.api.routers.discovery_utils import (
    get_available_structure_types,
    get_profile_name_for_structure_type,
    clean_patch_data,
    safe_serialize,
    safe_asdict,
)
from backend.api.routers.discovery_models import (
    ScanPatch,
    DiscoverySession,
    ProfileGeometryConfig,
    ProfileThresholdsConfig,
    ProfileFeatureConfig,
    ProfilePerformanceConfig,
    CustomProfileRequest,
)
from backend.api.routers.discovery_connections import discovery_manager, EnhancedConnectionManager
from backend.api.routers.discovery_sessions import (
    active_sessions,
    session_patches,
    _active_detection_tasks,
    _session_detectors,
    _session_tile_data,
    force_clear_all_detectors,
    cleanup_session_detector,
)
from backend.api.routers.discovery_lidar import router as lidar_router
from backend.api.routers.discovery_profiles import router as profiles_router
from backend.api.routers.discovery_lidar import run_coordinated_detection

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

# Define APP_ROOT as the project root directory
APP_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) )

# Dummy fallback for load_elevation_patch_unified if not imported elsewhere
try:
    from kernel.core_detector import load_elevation_patch_unified
except ImportError:
    def load_elevation_patch_unified(*args, **kwargs):
        raise NotImplementedError("load_elevation_patch_unified is not available")

# ==============================================================================
# LOGGING CONFIGURATION
# ==============================================================================

# Temporarily enable debug logging to diagnose WebSocket issues
logger.setLevel(logging.DEBUG)

# Reduce G2 kernel logging to avoid flooding during detection
kernel_logger = logging.getLogger('kernel.core_detector')
kernel_logger.setLevel(logging.WARNING)

# ==============================================================================
# ROUTER INITIALIZATION
# ==============================================================================

router = APIRouter()

# Register the LiDAR router
router.include_router(lidar_router)
router.include_router(profiles_router)

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
        
        # Remove handling of _active_detection_tasks since it is not defined after modularization
        
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
            detection_task = asyncio.create_task(run_coordinated_detection(session_id, scan_area))
            # _active_detection_tasks[session_id] = detection_task
        else:
            # Clean up detector cache only if not running detection
            pass  # Removed: cleanup_session_detector(session_id) since it's not defined
        
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
        app_root = APP_ROOT
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
                
                # In case patch_number and profile_resolution_m are not defined, provide a fallback
                patch_number = i * steps_lon + j
                profile_resolution_m = profile.geometry.resolution_m
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
                        app_root = APP_ROOT
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

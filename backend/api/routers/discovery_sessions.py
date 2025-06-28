"""
Session management logic for discovery API.
Contains session state, helper functions, and session-related globals.
"""
from typing import Dict, List, Any, Optional
from .discovery_models import DiscoverySession, ScanPatch
import asyncio

# Global session state (move from discovery.py)
active_sessions: Dict[str, DiscoverySession] = {}
session_patches: Dict[str, List[ScanPatch]] = {}

# Background detection task management (centralized here for modularity)
_active_detection_tasks: Dict[str, asyncio.Task] = {}
_session_detectors: Dict[str, Any] = {}
_session_tile_data: Dict[str, Dict[str, Any]] = {}

# You can add session helper functions here as needed, e.g.:
def get_active_sessions_dict() -> Dict[str, Any]:
    """Return a dict of all active sessions as dicts."""
    from .discovery_utils import safe_asdict
    return {sid: safe_asdict(sess) for sid, sess in active_sessions.items()}

def clear_all_sessions():
    """Clear all session state."""
    active_sessions.clear()
    session_patches.clear()

def force_clear_all_detectors():
    """Clear all cached detectors for all sessions."""
    _session_detectors.clear()

def cleanup_session_detector(session_id: str):
    """Clean up detector and tile cache for a session."""
    keys_to_remove = [key for key in _session_detectors.keys() if key.startswith(f"{session_id}_")]
    for key in keys_to_remove:
        del _session_detectors[key]
    if session_id in _session_tile_data:
        del _session_tile_data[session_id]

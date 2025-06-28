import os
import glob
import logging
import traceback
import numpy as np
from datetime import datetime
from dataclasses import asdict
from typing import Any, Dict, List, Optional, Tuple

"""
This module provides utility functions for the discovery API.
All functions are stateless and require explicit arguments for logger and app_root.
Usage example:
    from .discovery_utils import get_available_structure_types
    available_types, default_type = get_available_structure_types(APP_ROOT, logger)
"""

def get_available_structure_types(app_root: str, logger: logging.Logger) -> Tuple[List[str], str]:
    """Get available structure types from profiles directory.
    Args:
        app_root: Root directory of the application.
        logger: Logger instance for logging.
    Returns:
        Tuple of (list of available types, default type)
    """
    profiles_dir = f"{app_root}/profiles"
    available_types = []
    default_type = "windmill"  # Fallback default
    try:
        logger.info(f"🔍 Scanning profiles directory: {profiles_dir}")
        logger.info(f"🔍 Directory exists: {os.path.exists(profiles_dir)}")
        if os.path.exists(profiles_dir):
            logger.info(f"🔍 Directory contents: {os.listdir(profiles_dir)}")
        profile_files = glob.glob(f"{profiles_dir}/*.json")
        logger.info(f"🔍 Found profile files: {profile_files}")
        for profile_file in profile_files:
            filename = os.path.basename(profile_file)
            if filename.endswith('.json'):
                structure_type = filename[:-5]
                if 'windmill' in structure_type.lower():
                    available_types.append('windmill')
                    default_type = "windmill"
                elif 'tower' in structure_type.lower():
                    available_types.append('tower')
                elif 'mound' in structure_type.lower():
                    available_types.append('mound')
                elif 'geoglyph' in structure_type.lower():
                    available_types.append('geoglyph')
                elif 'citadel' in structure_type.lower():
                    available_types.append('citadel')
                else:
                    clean_name = structure_type.replace('_', ' ').replace('-', ' ')
                    available_types.append(clean_name)
        available_types = sorted(list(set(available_types)))
        if default_type in available_types:
            available_types.remove(default_type)
            available_types.insert(0, default_type)
        logger.info(f"📋 Available structure types: {available_types}")
        return available_types, default_type
    except Exception as e:
        logger.error(f"❌ Error scanning profiles directory: {e}")
        logger.error(f"❌ Exception type: {type(e)}")
        logger.error(f"❌ Traceback: {traceback.format_exc()}")
        return ["windmill", "tower", "mound"], "windmill"

def get_profile_name_for_structure_type(structure_type: str, app_root: str, logger: logging.Logger) -> str:
    """Convert structure type to profile filename.
    Args:
        structure_type: The type of structure (e.g., 'windmill').
        app_root: Root directory of the application.
        logger: Logger instance for logging.
    Returns:
        Profile filename (str)
    """
    profiles_dir = f"{app_root}/profiles"
    type_mapping = {
        'windmill': 'dutch_windmill.json',
        'tower': 'tower.json',
        'mound': 'mound.json',
        'geoglyph': 'amazon_geoglyph.json',
        'citadel': 'amazon_citadel.json'
    }
    if structure_type.lower() in type_mapping:
        profile_name = type_mapping[structure_type.lower()]
        if os.path.exists(f"{profiles_dir}/{profile_name}"):
            return profile_name
    possible_names = [
        f"{structure_type}.json",
        f"{structure_type.lower()}.json",
        f"{structure_type.replace(' ', '_')}.json",
        f"{structure_type.replace(' ', '_').lower()}.json"
    ]
    for name in possible_names:
        if os.path.exists(f"{profiles_dir}/{name}"):
            return name
    logger.warning(f"No profile found for structure type '{structure_type}', using dutch_windmill.json")
    return "dutch_windmill.json"

def clean_patch_data(elevation_data: np.ndarray) -> np.ndarray:
    """Replace NaNs in elevation data with mean of valid values, or 2.0 if all NaN."""
    if np.isnan(elevation_data).any():
        valid_mask = ~np.isnan(elevation_data)
        if np.any(valid_mask):
            mean_elevation = np.mean(elevation_data[valid_mask])
            elevation_data = np.where(np.isnan(elevation_data), mean_elevation, elevation_data)
        else:
            elevation_data = np.full_like(elevation_data, 2.0)
    return elevation_data

def safe_serialize(obj: Any) -> Any:
    """Convert object to JSON-serializable format recursively."""
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

def safe_asdict(dataclass_obj: Any) -> Any:
    """Convert dataclass to dict with safe JSON serialization."""
    data = asdict(dataclass_obj)
    return safe_serialize(data)

"""
Simple Bitmap Cache for LiDAR Heatmaps

Maintains one server-side bitmap image per task showing all accumulated scanning progress.
Much simpler than multi-resolution approach - just one image that grows as tiles are added.
"""

import numpy as np
import json
import hashlib
import logging
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Any
from datetime import datetime, timezone
from PIL import Image, ImageDraw
import io
import os
import asyncio
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

class SimpleBitmapCache:
    """
    Simple bitmap cache that accumulates LiDAR tiles into one bitmap image per task.
    Shows all scanning progress including incomplete areas.
    """
    
    def __init__(self, cache_dir: str = None, max_resolution: int = 2048):
        """
        Initialize simple bitmap cache.
        
        Args:
            cache_dir: Directory for cache storage
            max_resolution: Maximum bitmap dimension (pixels)
        """
        self.cache_dir = Path(cache_dir or "data/bitmap_cache")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        self.max_resolution = max_resolution
        self.executor = ThreadPoolExecutor(max_workers=2)
        
        # Simple configuration - one size fits all
        self.pixels_per_meter = 1.0  # 1 pixel per meter resolution
        
        logger.info(f"🗺️ Simple bitmap cache initialized at {self.cache_dir}")
    
    def _get_cache_key(self, task_id: str) -> str:
        """Generate cache key for task (much simpler - just hash the task ID)."""
        return hashlib.md5(task_id.encode()).hexdigest()[:16]
    
    def _calculate_bitmap_dimensions(self, area_bounds: Dict[str, float]) -> Tuple[int, int]:
        """Calculate bitmap dimensions for given area."""
        # Calculate area size in meters
        lat_diff = area_bounds['north'] - area_bounds['south']
        lon_diff = area_bounds['east'] - area_bounds['west']
        
        height_m = lat_diff * 111320  # degrees to meters
        width_m = lon_diff * 111320 * np.cos(np.radians(area_bounds['south']))
        
        # Convert to pixels
        height_px = int(height_m * self.pixels_per_meter)
        width_px = int(width_m * self.pixels_per_meter)
        
        # Clamp to maximum resolution
        if height_px > self.max_resolution:
            scale_factor = self.max_resolution / height_px
            height_px = self.max_resolution
            width_px = int(width_px * scale_factor)
        
        if width_px > self.max_resolution:
            scale_factor = self.max_resolution / width_px
            width_px = self.max_resolution
            height_px = int(height_px * scale_factor)
        
        return width_px, height_px
    
    def _tile_to_bitmap_coords(self, tile_bounds: Dict[str, float], 
                             area_bounds: Dict[str, float], 
                             bitmap_width: int, bitmap_height: int) -> Tuple[int, int, int, int]:
        """Convert tile geographic bounds to bitmap pixel coordinates."""
        
        # Normalize tile bounds to area bounds (0-1)
        norm_west = (tile_bounds['west'] - area_bounds['west']) / (area_bounds['east'] - area_bounds['west'])
        norm_east = (tile_bounds['east'] - area_bounds['west']) / (area_bounds['east'] - area_bounds['west'])
        norm_south = (tile_bounds['south'] - area_bounds['south']) / (area_bounds['north'] - area_bounds['south'])
        norm_north = (tile_bounds['north'] - area_bounds['south']) / (area_bounds['north'] - area_bounds['south'])
        
        # Convert to pixel coordinates (note: bitmap Y is inverted)
        x1 = int(norm_west * bitmap_width)
        x2 = int(norm_east * bitmap_width)
        y1 = int((1 - norm_north) * bitmap_height)  # Invert Y
        y2 = int((1 - norm_south) * bitmap_height)
        
        # Ensure valid bounds
        x1 = max(0, min(x1, bitmap_width - 1))
        x2 = max(x1 + 1, min(x2, bitmap_width))
        y1 = max(0, min(y1, bitmap_height - 1))
        y2 = max(y1 + 1, min(y2, bitmap_height))
        
        return x1, y1, x2, y2
    
    def _elevation_to_color(self, elevation_data: np.ndarray, 
                          global_min: float, global_max: float) -> np.ndarray:
        """Convert elevation data to RGB color array using terrain colormap."""
        if global_max == global_min:
            # Single elevation value
            normalized = np.full_like(elevation_data, 0.5)
        else:
            normalized = (elevation_data - global_min) / (global_max - global_min)
        
        # Apply terrain colormap (blue to green to yellow to red)
        colors = np.zeros((*elevation_data.shape, 3), dtype=np.uint8)
        
        for i in range(elevation_data.shape[0]):
            for j in range(elevation_data.shape[1]):
                value = np.clip(normalized[i, j], 0, 1)
                
                if value < 0.25:
                    # Deep blue to blue
                    t = value / 0.25
                    r = np.clip(int(30 * t), 0, 255)
                    g = np.clip(int(100 * t), 0, 255)
                    b = np.clip(int(120 + 135 * t), 0, 255)
                elif value < 0.5:
                    # Blue to cyan
                    t = (value - 0.25) / 0.25
                    r = np.clip(30, 0, 255)
                    g = np.clip(int(100 + 155 * t), 0, 255)
                    b = np.clip(255, 0, 255)
                elif value < 0.75:
                    # Cyan to green
                    t = (value - 0.5) / 0.25
                    r = np.clip(int(30 * (1 - t)), 0, 255)
                    g = np.clip(255, 0, 255)
                    b = np.clip(int(255 * (1 - t)), 0, 255)
                else:
                    # Green to yellow to red
                    t = (value - 0.75) / 0.25
                    r = np.clip(int(255 * min(1, t * 2)), 0, 255)
                    g = np.clip(int(255 * max(0, 1 - (t - 0.5) * 2)), 0, 255)
                    b = 0
                
                colors[i, j] = [r, g, b]
        
        return colors
    
    async def add_tile(self, task_id: str, tile_data: Dict[str, Any]) -> bool:
        """
        Add a new tile to the bitmap cache for this task.
        
        Args:
            task_id: Task identifier
            tile_data: Tile data containing bounds, elevation, etc.
            
        Returns:
            True if tile was successfully cached
        """
        try:
            # Extract required data
            tile_bounds = tile_data.get('tile_bounds') or tile_data.get('bounds')
            elevation_data = tile_data.get('viz_elevation') or tile_data.get('elevation_data')
            
            if not tile_bounds or elevation_data is None:
                logger.warning(f"Missing required tile data for {task_id}")
                return False
            
            # Load or create cache
            cache_info = await self._load_or_create_cache(task_id, tile_bounds)
            if not cache_info:
                logger.error(f"Failed to load/create cache for task {task_id}")
                return False
            
            # Add tile in background thread
            loop = asyncio.get_event_loop()
            success = await loop.run_in_executor(
                self.executor, 
                self._add_tile_to_bitmap, 
                cache_info, tile_data, tile_bounds
            )
            
            if success:
                # Save updated cache
                await self._save_cache(cache_info)
                logger.debug(f"✅ Updated bitmap cache for task {task_id} (now {cache_info['tiles_added']} tiles)")
                return True
            else:
                logger.warning(f"⚠️ Failed to add tile to bitmap cache for task {task_id}")
                return False
            
        except Exception as e:
            logger.error(f"❌ Failed to add tile to bitmap cache: {e}")
            return False
    
    def _add_tile_to_bitmap(self, cache_info: Dict[str, Any], 
                          tile_data: Dict[str, Any], 
                          tile_bounds: Dict[str, float]) -> bool:
        """Add tile to bitmap (runs in thread pool)."""
        try:
            elevation_data = np.array(tile_data.get('viz_elevation') or tile_data.get('elevation_data'))
            
            # Update global elevation range
            tile_min = float(np.nanmin(elevation_data))
            tile_max = float(np.nanmax(elevation_data))
            
            if cache_info['global_elevation_min'] is None:
                cache_info['global_elevation_min'] = tile_min
                cache_info['global_elevation_max'] = tile_max
            else:
                cache_info['global_elevation_min'] = min(float(cache_info['global_elevation_min']), tile_min)
                cache_info['global_elevation_max'] = max(float(cache_info['global_elevation_max']), tile_max)
            
            # Convert tile bounds to bitmap coordinates
            x1, y1, x2, y2 = self._tile_to_bitmap_coords(
                tile_bounds, cache_info['area_bounds'], 
                cache_info['bitmap_width'], cache_info['bitmap_height']
            )
            
            # Convert elevation to colors
            colors = self._elevation_to_color(
                elevation_data, 
                cache_info['global_elevation_min'], 
                cache_info['global_elevation_max']
            )
            
            # Resize colors to fit bitmap tile area
            tile_height = y2 - y1
            tile_width = x2 - x1
            
            if colors.shape[0] != tile_height or colors.shape[1] != tile_width:
                # Resize using PIL for better quality
                color_img = Image.fromarray(colors, 'RGB')
                color_img = color_img.resize((tile_width, tile_height), Image.Resampling.LANCZOS)
                colors = np.array(color_img)
            
            # Ensure colors array has correct shape (height, width, 3)
            if len(colors.shape) == 2:
                # Convert grayscale to RGB
                colors = np.stack([colors, colors, colors], axis=2)
            elif colors.shape[2] == 4:
                # Convert RGBA to RGB
                colors = colors[:, :, :3]
            
            # Update bitmap - ensure we don't go out of bounds
            actual_height = min(colors.shape[0], cache_info['bitmap'].shape[0] - y1)
            actual_width = min(colors.shape[1], cache_info['bitmap'].shape[1] - x1)
            
            cache_info['bitmap'][y1:y1+actual_height, x1:x1+actual_width] = colors[:actual_height, :actual_width]
            
            # Mark area as having data
            cache_info['data_mask'][y1:y1+actual_height, x1:x1+actual_width] = True
            
            # Update statistics
            cache_info['tiles_added'] += 1
            cache_info['last_updated'] = datetime.now(timezone.utc).isoformat()
            
            return True
            
        except Exception as e:
            logger.error(f"Error adding tile to bitmap: {e}")
            return False
    
    async def _load_or_create_cache(self, task_id: str, sample_tile_bounds: Dict[str, float]) -> Optional[Dict[str, Any]]:
        """Load existing cache or create new one for task."""
        try:
            cache_key = self._get_cache_key(task_id)
            cache_file = self.cache_dir / f"{cache_key}.json"
            bitmap_file = self.cache_dir / f"{cache_key}.png"
            
            if cache_file.exists():
                # Load existing cache
                with open(cache_file, 'r') as f:
                    cache_info = json.load(f)
                
                if bitmap_file.exists():
                    # Load bitmap
                    bitmap_img = Image.open(bitmap_file)
                    
                    # Convert to RGB if needed
                    if bitmap_img.mode == 'RGBA':
                        # Extract alpha channel for data mask
                        alpha = np.array(bitmap_img)[:, :, 3]
                        cache_info['data_mask'] = alpha > 128
                        # Convert to RGB
                        bitmap_img = bitmap_img.convert('RGB')
                    else:
                        cache_info['data_mask'] = np.ones((cache_info['bitmap_height'], cache_info['bitmap_width']), dtype=bool)
                    
                    cache_info['bitmap'] = np.array(bitmap_img)  # This will be RGB
                else:
                    # Recreate bitmap
                    cache_info['bitmap'] = np.zeros((cache_info['bitmap_height'], cache_info['bitmap_width'], 3), dtype=np.uint8)
                    cache_info['data_mask'] = np.zeros((cache_info['bitmap_height'], cache_info['bitmap_width']), dtype=bool)
                
                logger.debug(f"📂 Loaded existing bitmap cache for task {task_id}")
            else:
                # Create new cache - expand area around first tile
                buffer = 0.01  # ~1km buffer around initial tile
                area_bounds = {
                    'north': sample_tile_bounds['north'] + buffer,
                    'south': sample_tile_bounds['south'] - buffer,
                    'east': sample_tile_bounds['east'] + buffer,
                    'west': sample_tile_bounds['west'] - buffer
                }
                
                bitmap_width, bitmap_height = self._calculate_bitmap_dimensions(area_bounds)
                
                cache_info = {
                    'task_id': task_id,
                    'cache_key': cache_key,
                    'area_bounds': area_bounds,
                    'bitmap_width': bitmap_width,
                    'bitmap_height': bitmap_height,
                    'pixels_per_meter': self.pixels_per_meter,
                    'created_at': datetime.now(timezone.utc).isoformat(),
                    'last_updated': datetime.now(timezone.utc).isoformat(),
                    'tiles_added': 0,
                    'global_elevation_min': None,
                    'global_elevation_max': None,
                    'bitmap': np.zeros((bitmap_height, bitmap_width, 3), dtype=np.uint8),  # Always RGB
                    'data_mask': np.zeros((bitmap_height, bitmap_width), dtype=bool)
                }
                
                logger.debug(f"🆕 Created new bitmap cache for task {task_id} ({bitmap_width}x{bitmap_height})")
            
            return cache_info
            
        except Exception as e:
            logger.error(f"Error loading/creating cache for task {task_id}: {e}")
            return None
    
    async def _save_cache(self, cache_info: Dict[str, Any]) -> bool:
        """Save cache to disk."""
        try:
            cache_key = cache_info['cache_key']
            cache_file = self.cache_dir / f"{cache_key}.json"
            bitmap_file = self.cache_dir / f"{cache_key}.png"
            
            # Save metadata (exclude numpy arrays and convert numpy types to Python types)
            metadata = {}
            for k, v in cache_info.items():
                if k not in ['bitmap', 'data_mask']:
                    # Convert numpy types to Python types for JSON serialization
                    if hasattr(v, 'item'):  # numpy scalar
                        metadata[k] = v.item()
                    elif isinstance(v, (np.integer, np.floating)):
                        metadata[k] = v.item()
                    else:
                        metadata[k] = v
            
            with open(cache_file, 'w') as f:
                json.dump(metadata, f, indent=2)
            
            # Save bitmap with transparency for areas without data
            bitmap = cache_info['bitmap']
            data_mask = cache_info['data_mask']
            
            # Create RGBA image with alpha channel for transparency
            rgba_bitmap = np.zeros((bitmap.shape[0], bitmap.shape[1], 4), dtype=np.uint8)
            rgba_bitmap[:, :, :3] = bitmap  # RGB channels
            rgba_bitmap[:, :, 3] = data_mask.astype(np.uint8) * 255  # Alpha channel
            
            bitmap_img = Image.fromarray(rgba_bitmap, 'RGBA')
            bitmap_img.save(bitmap_file, 'PNG', optimize=True)
            
            return True
            
        except Exception as e:
            logger.error(f"Error saving cache: {e}")
            return False
    
    async def get_cached_bitmap(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Get cached bitmap for a task.
        
        Args:
            task_id: Task identifier
            
        Returns:
            Dict with bitmap_url, bounds, metadata, or None if not found
        """
        try:
            cache_key = self._get_cache_key(task_id)
            cache_file = self.cache_dir / f"{cache_key}.json"
            bitmap_file = self.cache_dir / f"{cache_key}.png"
            
            if cache_file.exists() and bitmap_file.exists():
                with open(cache_file, 'r') as f:
                    cache_info = json.load(f)
                
                # Create URL for bitmap
                bitmap_url = f"/api/v1/bitmap-cache/{cache_key}.png"
                
                return {
                    'bitmap_url': bitmap_url,
                    'bounds': cache_info['area_bounds'],
                    'pixels_per_meter': cache_info['pixels_per_meter'],
                    'dimensions': {
                        'width': cache_info['bitmap_width'],
                        'height': cache_info['bitmap_height']
                    },
                    'tiles_added': cache_info['tiles_added'],
                    'last_updated': cache_info['last_updated'],
                    'elevation_range': {
                        'min': cache_info['global_elevation_min'],
                        'max': cache_info['global_elevation_max']
                    },
                    'cache_key': cache_key
                }
            
            return None
            
        except Exception as e:
            logger.error(f"Error getting cached bitmap for task {task_id}: {e}")
            return None
    
    def cleanup_old_caches(self, max_age_days: int = 7) -> int:
        """Remove old cache files."""
        try:
            import time
            current_time = time.time()
            removed_count = 0
            
            for cache_file in self.cache_dir.glob("*.json"):
                file_age_days = (current_time - cache_file.stat().st_mtime) / (24 * 3600)
                
                if file_age_days > max_age_days:
                    cache_key = cache_file.stem
                    bitmap_file = self.cache_dir / f"{cache_key}.png"
                    
                    cache_file.unlink(missing_ok=True)
                    bitmap_file.unlink(missing_ok=True)
                    removed_count += 1
            
            if removed_count > 0:
                logger.info(f"🧹 Cleaned up {removed_count} old bitmap caches")
            
            return removed_count
            
        except Exception as e:
            logger.error(f"Error cleaning up caches: {e}")
            return 0

# Global cache instance
_simple_bitmap_cache_instance: Optional[SimpleBitmapCache] = None

def get_simple_bitmap_cache() -> SimpleBitmapCache:
    """Get or create global simple bitmap cache instance."""
    global _simple_bitmap_cache_instance
    if _simple_bitmap_cache_instance is None:
        _simple_bitmap_cache_instance = SimpleBitmapCache()
    return _simple_bitmap_cache_instance

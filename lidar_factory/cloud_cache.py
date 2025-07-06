"""
Cloud tile cache module for LIDAR data patches.
Provides transparent caching layer using Google Cloud Storage.
"""

import os
import json
import hashlib
import numpy as np
import logging
from typing import Optional, Dict, Any, Tuple
from datetime import datetime
import io
from backend.utils.gcs_utils import (
    get_gcs_client, get_gcs_bucket, upload_blob, download_blob, blob_exists, list_blobs, delete_blob
)

logger = logging.getLogger(__name__)

class LidarTileCache:
    """Cloud-based tile cache for LIDAR data patches using Google Cloud Storage."""
    def __init__(self, 
                 bucket_name: str = "re_archaeology",
                 credentials_path: Optional[str] = None,
                 project_id: Optional[str] = None):
        """
        Initialize the cloud cache.
        
        Args:
            bucket_name: GCS bucket name for storing tiles
            credentials_path: Path to service account credentials JSON
            project_id: Google Cloud project ID
        """
        # Use same credentials as Earth Engine if not provided
        if not credentials_path:
            credentials_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS', 
                                       'sage-striker-294302-b89a8b7e205b.json')

        if not project_id:
            project_id = os.getenv('GOOGLE_EE_PROJECT_ID', 'sage-striker-294302')
            
        self.bucket_name = bucket_name
        self.client = None
        self.bucket = None
        self._initialized = False
        self.credentials_path = credentials_path
        self.project_id = project_id

        self._initialize_gcs()
    
    def _initialize_gcs(self) -> bool:
        """Initialize Google Cloud Storage client and bucket using utility."""
        try:
            self.client = get_gcs_client(self.credentials_path, self.project_id)
            self.bucket = get_gcs_bucket(self.bucket_name, self.client)
            self._initialized = True
            return True
        except Exception as e:
            logger.error(f"Failed to initialize GCS client: {e}")
            return False
    
    def _make_tile_id(self, 
                      lat: float, 
                      lon: float, 
                      size_m: int, 
                      resolution_m: float,
                      data_type: str,
                      source: str) -> str:
        """
        Generate a unique tile identifier.
        
        Args:
            lat: Center latitude
            lon: Center longitude  
            size_m: Patch size in meters
            resolution_m: Resolution in meters per pixel
            data_type: Data type (DSM, DTM, etc.)
            source: Source dataset name
            
        Returns:
            Unique tile identifier string
        """
        # Round coordinates to avoid floating point precision issues
        lat_rounded = round(lat, 6)
        lon_rounded = round(lon, 6)
        res_rounded = round(resolution_m, 3)
        
        # Create hash of parameters for consistent naming
        params = f"{lat_rounded}_{lon_rounded}_{size_m}_{res_rounded}_{data_type}_{source}"
        tile_hash = hashlib.md5(params.encode()).hexdigest()[:12]
        
        return f"{source}/{data_type}/{lat_rounded}_{lon_rounded}_{size_m}m_{res_rounded}m_{tile_hash}"
    
    def _blob_path(self, tile_id: str) -> str:
        """Convert tile ID to GCS blob path."""
        return f"tiles/{tile_id}.npz"
    
    def exists(self, tile_id: str) -> bool:
        """Check if tile exists in cache."""
        if not self._initialized:
            return False
        try:
            return blob_exists(self.bucket, self._blob_path(tile_id))
        except Exception as e:
            logger.debug(f"Error checking tile existence: {e}")
            return False
    
    def get(self, 
            lat: float, 
            lon: float, 
            size_m: int, 
            resolution_m: float,
            data_type: str,
            source: str) -> Optional[np.ndarray]:
        """
        Retrieve tile from cache.
        
        Returns:
            Cached tile data or None if not found
        """
        if not self._initialized:
            return None
            
        tile_id = self._make_tile_id(lat, lon, size_m, resolution_m, data_type, source)
        
        try:
            blob_data = download_blob(self.bucket, self._blob_path(tile_id))
            if blob_data is None:
                logger.debug(f"Cache miss: {tile_id}")
                return None
            with io.BytesIO(blob_data) as buffer:
                data = np.load(buffer, allow_pickle=True)
                tile_data = data['elevation']
                metadata = data['metadata'].item()
                
            logger.debug(f"✅ Cache hit: {tile_id} | Shape: {tile_data.shape} | Cached: {metadata.get('timestamp', 'unknown')}")
            return tile_data
            
        except Exception as e:
            logger.warning(f"Error loading tile from cache: {e}")
            return None
    
    def put(self, 
            lat: float, 
            lon: float, 
            size_m: int, 
            resolution_m: float,
            data_type: str,
            source: str,
            tile_data: np.ndarray) -> bool:
        """
        Store tile in cache.
        
        Args:
            tile_data: Elevation data array to cache
            
        Returns:
            True if successfully cached, False otherwise
        """
        if not self._initialized or tile_data is None:
            return False
            
        tile_id = self._make_tile_id(lat, lon, size_m, resolution_m, data_type, source)
        
        try:
            metadata = {
                "source": source,
                "data_type": data_type,
                "lat": lat,
                "lon": lon,
                "size_m": size_m,
                "resolution_m": resolution_m,
                "shape": tile_data.shape,
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "stats": {
                    "min": float(np.nanmin(tile_data)),
                    "max": float(np.nanmax(tile_data)),
                    "mean": float(np.nanmean(tile_data))
                }
            }
            with io.BytesIO() as buffer:
                np.savez_compressed(
                    buffer,
                    elevation=tile_data,
                    metadata=metadata
                )
                buffer.seek(0)
                blob_data = buffer.getvalue()
            upload_blob(
                self.bucket,
                self._blob_path(tile_id),
                blob_data,
                content_type='application/octet-stream',
                metadata={
                    'source': source,
                    'data_type': data_type,
                    'cached_at': metadata['timestamp']
                }
            )
            logger.info(f"✅ Cached tile: {tile_id} | Shape: {tile_data.shape} | Size: {len(blob_data)/1024:.1f}KB")
            return True
        except Exception as e:
            logger.error(f"Error caching tile: {e}")
            return False
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        if not self._initialized:
            reason = self._error if hasattr(self, '_error') and self._error else "not_initialized"
            return {"enabled": False, "error": reason}
            
        try:
            blobs = list_blobs(self.bucket, prefix="tiles/")
            total_size = sum(blob.size for blob in blobs if blob.size)
            
            return {
                "enabled": True,
                "bucket": self.bucket_name,
                "tile_count": len(blobs),
                "total_size_mb": round(total_size / (1024 * 1024), 2),
                "project_id": self.project_id
            }
        except Exception as e:
            return {"enabled": False, "error": str(e)}
    
    def clear_cache(self, source_filter: Optional[str] = None) -> int:
        """
        Clear cache tiles, optionally filtered by source.
        
        Args:
            source_filter: If provided, only clear tiles from this source
            
        Returns:
            Number of tiles cleared
        """
        if not self._initialized:
            return 0
            
        try:
            prefix = f"tiles/{source_filter}/" if source_filter else "tiles/"
            blobs = list_blobs(self.bucket, prefix=prefix)
            
            count = 0
            for blob in blobs:
                delete_blob(self.bucket, blob.name)
                count += 1
            
            logger.info(f"Cleared {count} tiles from cache" + (f" (source: {source_filter})" if source_filter else ""))
            return count
            
        except Exception as e:
            logger.error(f"Error clearing cache: {e}")
            return 0

# Global cache instance
_cache_instance: Optional[LidarTileCache] = None

def get_cache() -> LidarTileCache:
    """Get or create global cache instance."""
    global _cache_instance
    if _cache_instance is None:
        _cache_instance = LidarTileCache(bucket_name="re_archaeology")
    return _cache_instance

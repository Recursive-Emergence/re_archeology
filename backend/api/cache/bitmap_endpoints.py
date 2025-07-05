"""
HTTP endpoints for serving cached bitmap images.
"""

import os
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse, JSONResponse
from typing import Optional
import logging

from .simple_bitmap_cache import get_simple_bitmap_cache

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/bitmap-cache/{cache_key}.png")
async def serve_bitmap(cache_key: str):
    """Serve cached bitmap image."""
    try:
        cache = get_simple_bitmap_cache()
        bitmap_file = cache.cache_dir / f"{cache_key}.png"
        
        if not bitmap_file.exists():
            raise HTTPException(status_code=404, detail="Bitmap not found")
        
        return FileResponse(
            bitmap_file,
            media_type="image/png",
            headers={
                "Cache-Control": "public, max-age=300",  # 5 minutes cache
                "Access-Control-Allow-Origin": "*"
            }
        )
        
    except Exception as e:
        logger.error(f"Error serving bitmap {cache_key}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/bitmap-cache/task/{task_id}/info")
async def get_task_bitmap_info(task_id: str):
    """
    Get bitmap cache information for a task.
    
    Args:
        task_id: Task identifier
    """
    try:
        cache = get_simple_bitmap_cache()
        bitmap_info = await cache.get_cached_bitmap(task_id)
        
        if not bitmap_info:
            # Return a proper JSON response instead of 404 error
            return JSONResponse(
                content={
                    "cached": False, 
                    "message": f"No bitmap cache found for task {task_id}",
                    "task_id": task_id
                },
                status_code=200  # Changed from 404 to 200
            )
        
        return JSONResponse(content={
            "cached": True,
            "bitmap_info": bitmap_info,
            "task_id": task_id
        })
        
    except Exception as e:
        logger.error(f"Error getting bitmap info for task {task_id}: {e}")
        return JSONResponse(
            content={"cached": False, "error": str(e), "task_id": task_id},
            status_code=500
        )

@router.post("/bitmap-cache/cleanup")
async def cleanup_bitmap_cache(max_age_days: int = 7):
    """Cleanup old bitmap cache files."""
    try:
        cache = get_simple_bitmap_cache()
        removed_count = cache.cleanup_old_caches(max_age_days)
        
        return JSONResponse(content={
            "success": True,
            "removed_count": removed_count
        })
        
    except Exception as e:
        logger.error(f"Error cleaning up bitmap cache: {e}")
        return JSONResponse(
            content={"success": False, "error": str(e)},
            status_code=500
        )

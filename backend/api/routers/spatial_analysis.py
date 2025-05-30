"""
Spatial Analysis Router for RE-Archaeology Framework
Provides spatial analysis functionality for archaeological research
"""

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from typing import List, Optional, Dict, Any, Tuple
import json
import uuid
from datetime import datetime
from geojson import Feature, FeatureCollection, Point, Polygon

from ...models.ontology_models import (
    User, ThreadCategory, EntityType, BackgroundTask, TaskStatus
)
from ...models.neo4j_crud import Neo4jCRUD
from ...utils.config import get_settings
from .auth import get_current_user
from .background_tasks import task_registry, manager

router = APIRouter(prefix="/api/v1/spatial-analysis", tags=["spatial-analysis"])

# Mock Earth Engine analysis functions (replace with actual EE integration)
class EarthEngineService:
    """Service class for Earth Engine operations"""
    
    @staticmethod
    def get_satellite_imagery(bbox: Tuple[float, float, float, float], 
                            start_date: str, end_date: str) -> Dict[str, Any]:
        """Get satellite imagery for a bounding box"""
        # Mock implementation - replace with actual Earth Engine calls
        return {
            "imagery_id": str(uuid.uuid4()),
            "bbox": bbox,
            "date_range": {"start": start_date, "end": end_date},
            "cloud_cover": 15.2,
            "resolution": "10m",
            "bands": ["B4", "B3", "B2", "B8"],
            "tile_url_template": f"https://earthengine.googleapis.com/v1alpha/projects/earthengine-legacy/maps/{uuid.uuid4()}/tiles/{{z}}/{{x}}/{{y}}",
            "generated_at": datetime.utcnow().isoformat()
        }
    
    @staticmethod
    def analyze_archaeological_potential(bbox: Tuple[float, float, float, float],
                                       parameters: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze archaeological potential for an area"""
        # Mock implementation
        potential_sites = []
        
        # Generate mock potential sites within the bbox
        import random
        num_sites = random.randint(5, 20)
        
        for i in range(num_sites):
            lon = random.uniform(bbox[0], bbox[2])
            lat = random.uniform(bbox[1], bbox[3])
            
            potential_sites.append({
                "id": str(uuid.uuid4()),
                "coordinates": [lon, lat],
                "confidence": random.uniform(0.6, 0.95),
                "type": random.choice(["settlement", "burial", "ritual", "agriculture"]),
                "features": {
                    "vegetation_anomaly": random.choice([True, False]),
                    "soil_marks": random.choice([True, False]),
                    "elevation_change": random.choice([True, False])
                }
            })
        
        return {
            "analysis_id": str(uuid.uuid4()),
            "bbox": bbox,
            "potential_sites": potential_sites,
            "overall_confidence": sum(site["confidence"] for site in potential_sites) / len(potential_sites),
            "methodology": parameters.get("methodology", "spectral_analysis"),
            "processed_at": datetime.utcnow().isoformat()
        }
    
    @staticmethod
    def generate_change_detection(bbox: Tuple[float, float, float, float],
                                before_date: str, after_date: str) -> Dict[str, Any]:
        """Generate change detection analysis"""
        # Mock implementation
        changes = []
        
        import random
        num_changes = random.randint(3, 10)
        
        for i in range(num_changes):
            lon = random.uniform(bbox[0], bbox[2])
            lat = random.uniform(bbox[1], bbox[3])
            
            changes.append({
                "id": str(uuid.uuid4()),
                "coordinates": [lon, lat],
                "change_type": random.choice(["vegetation_loss", "construction", "erosion", "flooding"]),
                "magnitude": random.uniform(0.3, 1.0),
                "confidence": random.uniform(0.7, 0.95)
            })
        
        return {
            "analysis_id": str(uuid.uuid4()),
            "bbox": bbox,
            "date_range": {"before": before_date, "after": after_date},
            "changes": changes,
            "total_changed_area": random.uniform(0.5, 5.0),  # km²
            "processed_at": datetime.utcnow().isoformat()
        }

ee_service = EarthEngineService()

# Thread-specific map endpoints

@router.post("/thread/{thread_id}/map")
async def create_thread_map(
    thread_id: str,
    bbox: List[float],  # [min_lon, min_lat, max_lon, max_lat]
    analysis_type: str = "satellite_imagery",
    parameters: Optional[Dict[str, Any]] = None,
    current_user: User = Depends(get_current_user)
):
    """Create a map for a specific thread with Earth Engine data"""
    
    # Validate thread access
    try:
        with Neo4jCRUD() as db:
            # Check if thread exists and user has access
            query = """
            MATCH (t:Thread {thread_id: $thread_id})
            OPTIONAL MATCH (t)-[:BELONGS_TO]->(cat:ThreadCategory)
            RETURN t, cat
            """
            results = db.run_query(query, {"thread_id": thread_id})
            
            if not results:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Thread not found"
                )
            
            thread_data = results[0]["t"]
            category_data = results[0]["cat"]
            
            # Check if thread requires authentication
            if thread_data.get("requires_auth", False):
                # User must be authenticated (already checked by dependency)
                pass
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to validate thread access: {str(e)}"
        )
    
    # Validate bbox
    if len(bbox) != 4:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="bbox must contain exactly 4 values: [min_lon, min_lat, max_lon, max_lat]"
        )
    
    bbox_tuple = tuple(bbox)
    
    try:
        # Create map based on analysis type
        if analysis_type == "satellite_imagery":
            start_date = parameters.get("start_date", "2023-01-01") if parameters else "2023-01-01"
            end_date = parameters.get("end_date", "2023-12-31") if parameters else "2023-12-31"
            
            map_data = ee_service.get_satellite_imagery(bbox_tuple, start_date, end_date)
            
        elif analysis_type == "archaeological_potential":
            # Start background task for complex analysis
            from .background_tasks import start_background_task
            
            task_response = await start_background_task(
                task_type="earth_engine_analysis",
                entity_type=EntityType.THREAD,
                entity_id=thread_id,
                parameters={
                    "bbox": bbox,
                    "analysis_type": "archaeological_potential",
                    "parameters": parameters or {}
                },
                current_user=current_user
            )
            
            return {
                "status": "processing",
                "task_id": task_response["task_id"],
                "message": "Archaeological potential analysis started. Results will be available via WebSocket."
            }
            
        elif analysis_type == "change_detection":
            before_date = parameters.get("before_date", "2022-01-01") if parameters else "2022-01-01"
            after_date = parameters.get("after_date", "2023-01-01") if parameters else "2023-01-01"
            
            map_data = ee_service.generate_change_detection(bbox_tuple, before_date, after_date)
            
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown analysis type: {analysis_type}"
            )
        
        # Store map data in database
        map_id = str(uuid.uuid4())
        
        with Neo4jCRUD() as db:
            query = """
            MATCH (t:Thread {thread_id: $thread_id})
            CREATE (m:ThreadMap {
                map_id: $map_id,
                thread_id: $thread_id,
                user_id: $user_id,
                analysis_type: $analysis_type,
                bbox: $bbox,
                parameters: $parameters,
                map_data: $map_data,
                created_at: datetime()
            })
            CREATE (t)-[:HAS_MAP]->(m)
            RETURN m
            """
            
            db.run_query(query, {
                "map_id": map_id,
                "thread_id": thread_id,
                "user_id": current_user.user_id,
                "analysis_type": analysis_type,
                "bbox": json.dumps(bbox),
                "parameters": json.dumps(parameters or {}),
                "map_data": json.dumps(map_data)
            })
        
        return {
            "map_id": map_id,
            "analysis_type": analysis_type,
            "data": map_data,
            "created_at": datetime.utcnow().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create map: {str(e)}"
        )

@router.get("/thread/{thread_id}/maps")
async def get_thread_maps(
    thread_id: str,
    current_user: User = Depends(get_current_user)
):
    """Get all maps for a specific thread"""
    try:
        with Neo4jCRUD() as db:
            query = """
            MATCH (t:Thread {thread_id: $thread_id})-[:HAS_MAP]->(m:ThreadMap)
            RETURN m
            ORDER BY m.created_at DESC
            """
            results = db.run_query(query, {"thread_id": thread_id})
            
            maps = []
            for record in results:
                map_data = record["m"]
                maps.append({
                    "map_id": map_data["map_id"],
                    "analysis_type": map_data["analysis_type"],
                    "bbox": json.loads(map_data["bbox"]),
                    "parameters": json.loads(map_data.get("parameters", "{}")),
                    "data": json.loads(map_data["map_data"]),
                    "created_at": map_data["created_at"],
                    "user_id": map_data["user_id"]
                })
            
            return {"thread_id": thread_id, "maps": maps}
            
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get thread maps: {str(e)}"
        )

@router.get("/map/{map_id}")
async def get_map_details(
    map_id: str,
    current_user: User = Depends(get_current_user)
):
    """Get detailed information about a specific map"""
    try:
        with Neo4jCRUD() as db:
            query = """
            MATCH (m:ThreadMap {map_id: $map_id})
            RETURN m
            """
            results = db.run_query(query, {"map_id": map_id})
            
            if not results:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Map not found"
                )
            
            map_data = results[0]["m"]
            return {
                "map_id": map_data["map_id"],
                "thread_id": map_data["thread_id"],
                "analysis_type": map_data["analysis_type"],
                "bbox": json.loads(map_data["bbox"]),
                "parameters": json.loads(map_data.get("parameters", "{}")),
                "data": json.loads(map_data["map_data"]),
                "created_at": map_data["created_at"],
                "user_id": map_data["user_id"]
            }
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get map details: {str(e)}"
        )

# Category-based map templates

@router.get("/category/{category_name}/map-templates")
async def get_category_map_templates(category_name: str):
    """Get map templates for a specific thread category"""
    
    templates = {
        "Maps": [
            {
                "name": "Satellite Imagery Analysis",
                "analysis_type": "satellite_imagery",
                "description": "High-resolution satellite imagery for area analysis",
                "parameters": {
                    "start_date": "2023-01-01",
                    "end_date": "2023-12-31",
                    "cloud_threshold": 20
                }
            },
            {
                "name": "Change Detection",
                "analysis_type": "change_detection",
                "description": "Detect changes between two time periods",
                "parameters": {
                    "before_date": "2022-01-01",
                    "after_date": "2023-01-01"
                }
            }
        ],
        "Sites": [
            {
                "name": "Archaeological Potential",
                "analysis_type": "archaeological_potential",
                "description": "Identify areas with high archaeological potential",
                "parameters": {
                    "methodology": "spectral_analysis",
                    "confidence_threshold": 0.7
                }
            },
            {
                "name": "Site Documentation",
                "analysis_type": "satellite_imagery",
                "description": "Document existing archaeological sites",
                "parameters": {
                    "resolution": "high",
                    "multispectral": True
                }
            }
        ],
        "Researches": [
            {
                "name": "Research Area Analysis",
                "analysis_type": "archaeological_potential",
                "description": "Comprehensive analysis for research planning",
                "parameters": {
                    "include_terrain": True,
                    "include_vegetation": True,
                    "include_water": True
                }
            }
        ],
        "RE Theory": [
            {
                "name": "Theoretical Model Validation",
                "analysis_type": "change_detection",
                "description": "Validate theoretical models with real data",
                "parameters": {
                    "model_type": "predictive",
                    "validation_method": "temporal"
                }
            }
        ]
    }
    
    category_templates = templates.get(category_name, [])
    return {
        "category": category_name,
        "templates": category_templates
    }

# Export utilities

@router.post("/map/{map_id}/export")
async def export_map_data(
    map_id: str,
    export_format: str = "geojson",
    current_user: User = Depends(get_current_user)
):
    """Export map data in various formats"""
    try:
        # Get map data
        with Neo4jCRUD() as db:
            query = """
            MATCH (m:ThreadMap {map_id: $map_id})
            RETURN m
            """
            results = db.run_query(query, {"map_id": map_id})
            
            if not results:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Map not found"
                )
            
            map_data = results[0]["m"]
            data = json.loads(map_data["map_data"])
        
        if export_format == "geojson":
            # Convert to GeoJSON format
            features = []
            
            if "potential_sites" in data:
                for site in data["potential_sites"]:
                    feature = Feature(
                        geometry=Point(site["coordinates"]),
                        properties={
                            "id": site["id"],
                            "confidence": site["confidence"],
                            "type": site["type"],
                            "features": site["features"]
                        }
                    )
                    features.append(feature)
            
            if "changes" in data:
                for change in data["changes"]:
                    feature = Feature(
                        geometry=Point(change["coordinates"]),
                        properties={
                            "id": change["id"],
                            "change_type": change["change_type"],
                            "magnitude": change["magnitude"],
                            "confidence": change["confidence"]
                        }
                    )
                    features.append(feature)
            
            geojson_data = FeatureCollection(features)
            
            return {
                "format": "geojson",
                "data": geojson_data,
                "exported_at": datetime.utcnow().isoformat()
            }
        
        elif export_format == "csv":
            # Convert to CSV format (return as structured data)
            csv_data = []
            
            if "potential_sites" in data:
                for site in data["potential_sites"]:
                    csv_data.append({
                        "id": site["id"],
                        "longitude": site["coordinates"][0],
                        "latitude": site["coordinates"][1],
                        "confidence": site["confidence"],
                        "type": site["type"],
                        "vegetation_anomaly": site["features"].get("vegetation_anomaly"),
                        "soil_marks": site["features"].get("soil_marks"),
                        "elevation_change": site["features"].get("elevation_change")
                    })
            
            return {
                "format": "csv",
                "data": csv_data,
                "exported_at": datetime.utcnow().isoformat()
            }
        
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported export format: {export_format}"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export map data: {str(e)}"
        )

"""
Enhanced Earth Engine Integration Router for RE-Archaeology Framework
Provides thread-specific map generation and background task integration
Includes Netherlands AHN LiDAR data visualization
"""

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from typing import List, Dict, Any, Optional
import logging
import json
import time
import uuid
from geojson import Feature, FeatureCollection, Point, Polygon
from pydantic import BaseModel, Field

from backend.utils.error_handling import validate_request_data
from backend.models.neo4j_crud import BackgroundTaskCRUD, ThreadCRUD
from backend.api.routers.auth import get_current_user

# Try to import Earth Engine - fallback to mock if not available
try:
    import ee
    EE_AVAILABLE = True
    print("Earth Engine available for AHN LiDAR data")
except ImportError:
    EE_AVAILABLE = False
    print("Earth Engine not available - using mock data")

router = APIRouter(
    prefix="/earth-engine",
    tags=["Earth Engine"],
)

# Mock data for development without Earth Engine
SAMPLE_DATASETS = [
    {
        "id": "landsat_toa",
        "name": "Landsat 8 TOA",
        "description": "Landsat 8 Top of Atmosphere reflectance",
        "type": "image_collection"
    },
    {
        "id": "sentinel_2",
        "name": "Sentinel-2",
        "description": "Sentinel-2 MSI: MultiSpectral Instrument, Level-1C",
        "type": "image_collection"
    },
    {
        "id": "elevation",
        "name": "SRTM Digital Elevation",
        "description": "Shuttle Radar Topography Mission (SRTM) 30m resolution elevation data",
        "type": "image"
    }
]

# Models
class GeometryRequest(BaseModel):
    type: str
    coordinates: List

class MapAnalysisRequest(BaseModel):
    thread_id: str = Field(..., description="Thread ID to associate this analysis with")
    geometry: GeometryRequest = Field(..., description="GeoJSON geometry")
    analysis_type: str = Field(..., description="Type of analysis to perform")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Additional parameters for the analysis")

class AreaOfInterest(BaseModel):
    geometry: GeometryRequest
    properties: Dict[str, Any] = Field(default_factory=dict)

class DatasetResponse(BaseModel):
    id: str
    name: str
    description: str
    type: str

# Helper functions
def initialize_earth_engine():
    """Initialize Earth Engine with service account or user credentials"""
    try:
        # This would use ee.Initialize() in a real implementation
        # For now just mock successful initialization
        logging.info("Mock Earth Engine initialization successful")
        return True
    except Exception as e:
        logging.error(f"Error initializing Earth Engine: {e}")
        return False

def create_background_task(task_data, description, user_id=None):
    """Create a background task in Neo4j database"""
    task_id = str(uuid.uuid4())
    
    task = {
        "id": task_id,
        "type": "EARTH_ENGINE_ANALYSIS",
        "status": "PENDING",
        "data": task_data,
        "description": description,
        "created_at": int(time.time() * 1000),
        "progress": 0
    }
    
    if user_id:
        task["user_id"] = user_id
    
    # In a real implementation, this would create the task in Neo4j
    # For now, we'll just log it
    logging.info(f"Created background task: {task_id}")
    
    return task_id

# Routes
@router.get("/datasets", response_model=List[DatasetResponse])
async def get_datasets():
    """Get list of available Earth Engine datasets"""
    # In a real implementation, this would query Earth Engine for available datasets
    return SAMPLE_DATASETS

@router.post("/analyze", status_code=status.HTTP_202_ACCEPTED)
async def create_analysis(
    request: MapAnalysisRequest,
    background_tasks: BackgroundTasks,
    current_user = Depends(get_current_user)
):
    """Create a new Earth Engine analysis task"""
    # Validate thread exists
    thread_crud = ThreadCRUD()
    thread = thread_crud.get_by_id(request.thread_id)
    if not thread:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Thread with ID {request.thread_id} not found"
        )
    
    # Prepare task data
    task_data = {
        "thread_id": request.thread_id,
        "geometry": json.loads(request.geometry.json()),
        "analysis_type": request.analysis_type,
        "parameters": request.parameters,
        "user_id": current_user["id"] if current_user else None
    }
    
    # Create task description
    description = f"Earth Engine {request.analysis_type} analysis for thread {request.thread_id}"
    
    # Create background task
    task_crud = BackgroundTaskCRUD()
    task_id = task_crud.create(
        task_type="EARTH_ENGINE_ANALYSIS",
        status="PENDING",
        data=task_data,
        description=description,
        user_id=current_user["id"] if current_user else None
    )
    
    # Add task to background processing queue
    background_tasks.add_task(process_analysis_task, task_id)
    
    return {"task_id": task_id, "status": "pending"}

@router.get("/thread/{thread_id}/maps")
async def get_maps_for_thread(thread_id: str):
    """Get all maps generated for a specific thread"""
    # In a real implementation, this would query Neo4j for maps
    # For now, return mock data
    return [
        {
            "id": "map1",
            "thread_id": thread_id,
            "title": "Satellite Imagery",
            "type": "tile_layer",
            "tile_url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            "attribution": "Esri, DigitalGlobe, GeoEye, i-cubed, USDA, USGS, AEX, Getmapping, Aerogrid, IGN, IGP, swisstopo, and the GIS User Community"
        },
        {
            "id": "map2",
            "thread_id": thread_id,
            "title": "Archaeological Potential",
            "type": "geojson",
            "geojson_data": {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[-74.0, 40.7], [-74.0, 40.8], [-73.9, 40.8], [-73.9, 40.7], [-74.0, 40.7]]]
                        },
                        "properties": {
                            "potential": "high",
                            "value": 0.85
                        }
                    }
                ]
            },
            "style": {
                "fillColor": "#ff7800",
                "weight": 2,
                "opacity": 1,
                "color": "#000",
                "fillOpacity": 0.5
            }
        }
    ]

@router.get("/status/{task_id}")
async def get_task_status(task_id: str):
    """Get status of a running Earth Engine task"""
    task_crud = BackgroundTaskCRUD()
    task = task_crud.get_by_id(task_id)
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with ID {task_id} not found"
        )
    
    return {
        "task_id": task["id"],
        "status": task["status"],
        "progress": task.get("progress", 0),
        "created_at": task["created_at"],
        "updated_at": task.get("updated_at"),
        "result": task.get("result")
    }

# Background task processing
async def process_analysis_task(task_id: str):
    """Process Earth Engine analysis task in background"""
    logging.info(f"Processing Earth Engine analysis task: {task_id}")
    
    task_crud = BackgroundTaskCRUD()
    task = task_crud.get_by_id(task_id)
    
    if not task:
        logging.error(f"Task with ID {task_id} not found")
        return
    
    try:
        # Update task to processing
        task_crud.update(task_id, {"status": "PROCESSING"})
        
        # Simulate processing with delays
        for progress in range(10, 101, 10):
            # In a real implementation, this would be actual Earth Engine processing
            time.sleep(2)  # Simulate processing time
            task_crud.update(task_id, {"progress": progress})
        
        # Generate mock result
        result = {
            "map_id": str(uuid.uuid4()),
            "thread_id": task["data"]["thread_id"],
            "title": f"{task['data']['analysis_type'].capitalize()} Analysis",
            "type": "tile_layer",
            "tile_url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            "bounds": [-180, -90, 180, 90],
            "center": [0, 0],
            "zoom": 2
        }
        
        # Update task to completed with result
        task_crud.update(task_id, {
            "status": "COMPLETED", 
            "progress": 100,
            "result": result,
            "completed_at": int(time.time() * 1000)
        })
        
        logging.info(f"Completed Earth Engine analysis task: {task_id}")
    except Exception as e:
        logging.error(f"Error processing Earth Engine analysis task: {e}")
        task_crud.update(task_id, {
            "status": "FAILED",
            "error": str(e)
        })

@router.get("/netherlands-ahn-map")
async def get_netherlands_ahn_map():
    """
    Get Global Archaeological Map data for the landing page.
    Features Netherlands AHN LiDAR data as a showcase of worldwide capabilities.
    """
    try:
        if not EE_AVAILABLE:
            # Return mock map data for development
            return {
                "map_id": "global-archaeological-mock",
                "title": "Global Archaeological Map (Netherlands Showcase)",
                "type": "tile_layer",
                "tile_url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
                "bounds": [3.3, 50.7, 7.3, 53.6],  # Netherlands bounds
                "center": [52.1326, 5.2913],  # Utrecht area
                "zoom": 8,
                "overlays": [
                    {
                        "name": "Sample Sites",
                        "type": "geojson",
                        "data": {
                            "type": "FeatureCollection",
                            "features": [
                                {
                                    "type": "Feature",
                                    "properties": {
                                        "name": "Historic Windmill Site",
                                        "height": "25m",
                                        "type": "windmill"
                                    },
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [5.2913, 52.1326]
                                    }
                                },
                                {
                                    "type": "Feature", 
                                    "properties": {
                                        "name": "Archaeological Mound",
                                        "height": "8m",
                                        "type": "structure"
                                    },
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [5.3913, 52.2326]
                                    }
                                }
                            ]
                        },
                        "style": {
                            "color": "red",
                            "fillColor": "red",
                            "fillOpacity": 0.7,
                            "radius": 8
                        }
                    }
                ]
            }
        
        # Initialize Earth Engine with service account if available
        if not ee.data._credentials:
            from backend.utils.config import get_settings
            settings = get_settings()
            
            if settings.GOOGLE_EE_SERVICE_ACCOUNT_KEY and settings.GOOGLE_EE_PROJECT_ID:
                # Initialize with service account
                import json
                import os
                
                # Check if it's a file path or JSON string
                if os.path.isfile(settings.GOOGLE_EE_SERVICE_ACCOUNT_KEY):
                    credentials = ee.ServiceAccountCredentials(
                        email=None,  # Will be read from JSON file
                        key_file=settings.GOOGLE_EE_SERVICE_ACCOUNT_KEY
                    )
                else:
                    # Assume it's a JSON string
                    key_data = json.loads(settings.GOOGLE_EE_SERVICE_ACCOUNT_KEY)
                    credentials = ee.ServiceAccountCredentials(
                        email=key_data['client_email'],
                        key_data=key_data
                    )
                
                ee.Initialize(credentials, project=settings.GOOGLE_EE_PROJECT_ID)
            else:
                # Try to initialize without credentials (if user authenticated locally)
                ee.Initialize()
        
        # Define Netherlands region of interest (Utrecht area)
        netherlands_location = {"lat": 52.4751495, "lon": 4.8155928}  # Utrecht area
        buffer_meters_nl = 5000  # 5km buffer
        point_geom_nl = ee.Geometry.Point([netherlands_location['lon'], netherlands_location['lat']])
        buffered_region_nl = point_geom_nl.buffer(buffer_meters_nl)
        
        # Load and filter AHN4 LiDAR data
        ahn4_collection = ee.ImageCollection("AHN/AHN4")
        ahn4_filtered = ahn4_collection.filterBounds(buffered_region_nl)
        
        if ahn4_filtered.size().getInfo() > 0:
            ahn4_mosaic = ahn4_filtered.mosaic()
            ahn4_dsm = ahn4_mosaic.select('dsm').clip(buffered_region_nl)
            
            # Create visualization parameters for AHN4 DSM
            ahn4_vis_params = {
                'bands': ['dsm'],
                'min': 0,
                'max': 50,
                'palette': ['006633', 'E5FFCC', '662A00', 'D8D8D8', 'F5F5F5']
            }
            
            # Get map ID for the AHN4 layer
            map_id_dict = ahn4_dsm.getMapId(ahn4_vis_params)
            
            # Detect potential archaeological structures
            elevation_threshold = 5  # meters
            ahn4_elevated = ahn4_dsm.gt(elevation_threshold)
            
            # Apply connected components to group elevated pixels
            kernel = ee.Kernel.square(radius=1)
            connected_components = ahn4_elevated.connectedComponents(kernel, maxSize=128)
            labeled_components = connected_components.select('label')
            
            # Convert to vectors and filter by area
            potential_structures = labeled_components.reduceToVectors(
                geometry=buffered_region_nl,
                scale=0.5,
                maxPixels=1e9,
                bestEffort=True
            )
            
            min_area_sq_meters = 50
            filtered_structures = potential_structures.filter(ee.Filter.gte('area', min_area_sq_meters))
            
            # Get structure data for frontend
            structure_data = filtered_structures.limit(20).getInfo()  # Limit for performance
            
            return {
                "map_id": "global-archaeological-netherlands",
                "title": "Global Archaeological Map - Netherlands AHN4 LiDAR Showcase",
                "type": "ee_tile_layer",
                "tile_url": map_id_dict['tile_fetcher'].url_format,
                "bounds": [3.3, 50.7, 7.3, 53.6],  # Netherlands bounds
                "center": [netherlands_location['lat'], netherlands_location['lon']],
                "zoom": 12,
                "overlays": [
                    {
                        "name": "Potential Archaeological Structures",
                        "type": "geojson", 
                        "data": structure_data,
                        "style": {
                            "color": "red",
                            "fillColor": "red", 
                            "fillOpacity": 0.6,
                            "weight": 2
                        }
                    }
                ],
                "legend": {
                    "title": "AHN4 Elevation (meters)",
                    "colors": ["#006633", "#E5FFCC", "#662A00", "#D8D8D8", "#F5F5F5"],
                    "labels": ["0-10m", "10-20m", "20-30m", "30-40m", "40-50m"]
                }
            }
        else:
            raise HTTPException(
                status_code=404,
                detail="No AHN4 data found for the specified region"
            )
            
    except Exception as e:
        logging.error(f"Error generating Netherlands AHN map: {e}")
        # Return fallback map on error
        return {
            "map_id": "global-archaeological-fallback",
            "title": "Global Archaeological Map (Fallback)",
            "type": "tile_layer",
            "tile_url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
            "bounds": [3.3, 50.7, 7.3, 53.6],
            "center": [52.1326, 5.2913],
            "zoom": 8,
            "error": str(e)
        }

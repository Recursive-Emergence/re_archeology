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

@router.get("/amazon-basin-map")
async def get_amazon_basin_map():
    """
    Get Global Archaeological Map data for the landing page.
    Features Amazon Basin deforestation and site detection as a showcase of worldwide capabilities.
    """
    try:
        if not EE_AVAILABLE:
            # Return mock map data for development
            return {
                "map_id": "global-archaeological-amazon",
                "title": "Global Archaeological Map (Amazon Basin Showcase)",
                "type": "tile_layer",
                "tile_url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
                "bounds": [-73.2, -9.8, -44.2, 5.3],  # Amazon Basin bounds
                "center": [-60.0, -3.2],  # Amazon Basin center
                "zoom": 6,
                "show_labels": True,  # Always show labels for geographic features
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
                                        "name": "Geoglyph Site",
                                        "elevation": "180m",
                                        "type": "geoglyph"
                                    },
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [-67.8, -8.1]
                                    }
                                },
                                {
                                    "type": "Feature", 
                                    "properties": {
                                        "name": "Pre-Columbian Settlement",
                                        "elevation": "220m",
                                        "type": "settlement"
                                    },
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [-63.2, -5.8]
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
        
        # Define Amazon Basin region of interest (Central Amazon)
        amazon_location = {"lat": -3.2, "lon": -60.0}  # Central Amazon Basin
        buffer_meters_amazon = 50000  # 50km buffer
        point_geom_amazon = ee.Geometry.Point([amazon_location['lon'], amazon_location['lat']])
        buffered_region_amazon = point_geom_amazon.buffer(buffer_meters_amazon)
        
        # Load and analyze Amazon Basin Landsat data for deforestation and site detection
        landsat_collection = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
        landsat_filtered = landsat_collection.filterBounds(buffered_region_amazon).filterDate('2020-01-01', '2023-12-31')
        
        if landsat_filtered.size().getInfo() > 0:
            landsat_mosaic = landsat_filtered.median()
            # Create NDVI for vegetation analysis
            ndvi = landsat_mosaic.normalizedDifference(['SR_B5', 'SR_B4']).clip(buffered_region_amazon)
            
            # Create visualization parameters for NDVI
            ndvi_vis_params = {
                'min': -0.5,
                'max': 0.8,
                'palette': ['red', 'yellow', 'green']
            }
            
            # Get map ID for the NDVI layer
            map_id_dict = ndvi.getMapId(ndvi_vis_params)
            
            # Detect potential archaeological areas using NDVI and edge detection
            ndvi_threshold = 0.3  # Areas with lower vegetation might indicate sites
            potential_sites = ndvi.lt(ndvi_threshold)
            
            # Apply connected components to group potential site pixels
            kernel = ee.Kernel.circle(radius=2)
            connected_components = potential_sites.connectedComponents(kernel, maxSize=256)
            labeled_components = connected_components.select('label')
            
            # Convert to vectors and filter by area
            potential_structures = labeled_components.reduceToVectors(
                geometry=buffered_region_amazon,
                scale=30,
                maxPixels=1e9,
                bestEffort=True
            )
            
            min_area_sq_meters = 1000  # Larger minimum area for Amazon sites
            filtered_structures = potential_structures.filter(ee.Filter.gte('area', min_area_sq_meters))
            
            # Get structure data for frontend
            structure_data = filtered_structures.limit(20).getInfo()  # Limit for performance
            
            return {
                "map_id": "global-archaeological-amazon",
                "title": "Global Archaeological Map - Amazon Basin NDVI Analysis",
                "type": "ee_tile_layer",
                "tile_url": map_id_dict['tile_fetcher'].url_format,
                "bounds": [-73.2, -9.8, -44.2, 5.3],  # Amazon Basin bounds
                "center": [amazon_location['lat'], amazon_location['lon']],
                "zoom": 8,
                "show_labels": True,
                "overlays": [
                    {
                        "name": "Potential Archaeological Areas",
                        "type": "geojson", 
                        "data": structure_data,
                        "style": {
                            "color": "orange",
                            "fillColor": "orange", 
                            "fillOpacity": 0.6,
                            "weight": 2
                        }
                    }
                ],
                "legend": {
                    "title": "NDVI Vegetation Index",
                    "colors": ["red", "yellow", "green"],
                    "labels": ["Low Vegetation", "Medium Vegetation", "High Vegetation"]
                }
            }
        else:
            raise HTTPException(
                status_code=404,
                detail="No Landsat data found for the specified Amazon Basin region"
            )
            
    except Exception as e:
        logging.error(f"Error generating Amazon Basin map: {e}")
        # Return fallback map on error
        return {
            "map_id": "global-archaeological-fallback",
            "title": "Global Archaeological Map (Fallback)",
            "type": "tile_layer",
            "tile_url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            "bounds": [-73.2, -9.8, -44.2, 5.3],
            "center": [-3.2, -60.0],
            "zoom": 6,
            "show_labels": True,
            "error": str(e)
        }

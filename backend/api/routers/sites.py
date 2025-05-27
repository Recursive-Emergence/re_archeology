"""
API router for site management.
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List
from backend.models.ontology_models import Site, CreateSiteRequest
from backend.models.neo4j_crud import SiteCRUD
from backend.core.neo4j_database import get_neo4j_session

router = APIRouter(prefix="/sites", tags=["sites"])

@router.post("/", response_model=Site)
async def create_site(site_data: CreateSiteRequest, session=Depends(get_neo4j_session)):
    """Create a new site."""
    return SiteCRUD.create_site(site_data)

@router.get("/{site_id}", response_model=Site)
async def get_site(site_id: str, session=Depends(get_neo4j_session)):
    """Get a site by ID."""
    result = SiteCRUD.get_node_by_id("Site", site_id)
    if not result:
        raise HTTPException(status_code=404, detail="Site not found")
    return Site(**result)

@router.get("/", response_model=List[Site])
async def get_all_sites(limit: int = 100, session=Depends(get_neo4j_session)):
    """Get all sites."""
    results = SiteCRUD.get_all_nodes("Site", limit)
    return [Site(**result) for result in results]

@router.get("/near/", response_model=List[Site])
async def get_sites_near_location(
    latitude: float = Query(..., description="Latitude"),
    longitude: float = Query(..., description="Longitude"), 
    radius_km: float = Query(10, description="Search radius in kilometers"),
    session=Depends(get_neo4j_session)
):
    """Get sites near a given location."""
    return SiteCRUD.get_sites_near_location(latitude, longitude, radius_km)

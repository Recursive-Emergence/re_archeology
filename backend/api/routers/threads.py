"""
API router for thread management.
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import List
from backend.models.ontology_models import Thread, CreateThreadRequest
from backend.models.neo4j_crud import ThreadCRUD
from backend.core.neo4j_database import get_neo4j_session

router = APIRouter(prefix="/threads", tags=["threads"])

@router.post("/", response_model=Thread)
async def create_thread(thread_data: CreateThreadRequest, session=Depends(get_neo4j_session)):
    """Create a new thread."""
    return ThreadCRUD.create_thread(thread_data)

@router.get("/{thread_id}", response_model=Thread)
async def get_thread(thread_id: str, session=Depends(get_neo4j_session)):
    """Get a thread by ID."""
    result = ThreadCRUD.get_node_by_id("Thread", thread_id)
    if not result:
        raise HTTPException(status_code=404, detail="Thread not found")
    return Thread(**result)

@router.get("/", response_model=List[Thread])
async def get_all_threads(limit: int = 100, session=Depends(get_neo4j_session)):
    """Get all threads."""
    results = ThreadCRUD.get_all_nodes("Thread", limit)
    return [Thread(**result) for result in results]

@router.get("/user/{user_id}", response_model=List[Thread])
async def get_threads_by_user(user_id: str, session=Depends(get_neo4j_session)):
    """Get all threads created by a user."""
    return ThreadCRUD.get_threads_by_user(user_id)

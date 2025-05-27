"""
API router for user management.
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import List
from backend.models.ontology_models import User, CreateUserRequest
from backend.models.neo4j_crud import UserCRUD
from backend.core.neo4j_database import get_neo4j_session

router = APIRouter(prefix="/users", tags=["users"])

@router.post("/", response_model=User)
async def create_user(user_data: CreateUserRequest, session=Depends(get_neo4j_session)):
    """Create a new user."""
    # Check if user with email already exists
    existing_user = UserCRUD.get_user_by_email(user_data.email)
    if existing_user:
        raise HTTPException(status_code=400, detail="User with this email already exists")
    
    return UserCRUD.create_user(user_data)

@router.get("/{user_id}", response_model=User)
async def get_user(user_id: str, session=Depends(get_neo4j_session)):
    """Get a user by ID."""
    result = UserCRUD.get_node_by_id("User", user_id)
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    return User(**result)

@router.get("/", response_model=List[User])
async def get_all_users(limit: int = 100, session=Depends(get_neo4j_session)):
    """Get all users."""
    results = UserCRUD.get_all_nodes("User", limit)
    return [User(**result) for result in results]

@router.get("/email/{email}", response_model=User)
async def get_user_by_email(email: str, session=Depends(get_neo4j_session)):
    """Get a user by email."""
    user = UserCRUD.get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

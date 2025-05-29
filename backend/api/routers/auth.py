"""
                                                                                                                                                                        Authentication router for Google OAuth and JWT management.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from google.auth.transport import requests
from google.oauth2 import id_token
from google.auth.exceptions import GoogleAuthError
from pydantic import BaseModel, ValidationError

from backend.core.neo4j_database import neo4j_db
from backend.models.ontology_models import User, UserRole
from backend.utils.config import get_settings
from backend.utils.error_handling import handle_neo4j_error

# Configure logging
logger = logging.getLogger(__name__)

settings = get_settings()
router = APIRouter(prefix="/auth", tags=["authentication"])
security = HTTPBearer()

class GoogleTokenRequest(BaseModel):
    token: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    expires_in: int
    user: dict

class UserProfile(BaseModel):
    id: str
    name: str
    email: str
    profile_picture: Optional[str] = None
    role: str

def create_access_token(data: dict) -> str:
    """Create JWT access token."""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=settings.JWT_EXPIRATION_HOURS)
    to_encode.update({"exp": expire})
    
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

def verify_google_token(token: str) -> dict:
    """Verify Google ID token and return user info."""
    try:
        # Verify the token with Google
        idinfo = id_token.verify_oauth2_token(
            token, requests.Request(), settings.GOOGLE_CLIENT_ID
        )
        
        if idinfo['iss'] not in ['accounts.google.com', 'https://accounts.google.com']:
            raise ValueError('Wrong issuer.')
            
        return idinfo
    except ValueError as e:
        logger.warning(f"Google token verification failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Google token: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Error verifying Google token: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Get current user from JWT token."""
    try:
        payload = jwt.decode(
            credentials.credentials, 
            settings.JWT_SECRET_KEY, 
            algorithms=[settings.JWT_ALGORITHM]
        )
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials"
            )
        return {"user_id": user_id, "email": payload.get("email")}
    except jwt.PyJWTError:
        logger.warning("JWT token verification failed")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )
    except Exception as e:
        logger.error(f"Error getting current user: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

async def get_current_user_optional(token: Optional[str] = None) -> Optional[dict]:
    """Get current user from JWT token, but return None if invalid/missing."""
    if not token:
        return None
    
    try:
        payload = jwt.decode(
            token, 
            settings.JWT_SECRET_KEY, 
            algorithms=[settings.JWT_ALGORITHM]
        )
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
        return {"user_id": user_id, "email": payload.get("email"), "name": payload.get("name")}
    except (jwt.PyJWTError, Exception) as e:
        logger.debug(f"Optional token verification failed: {str(e)}")
        return None

@router.post("/google", response_model=TokenResponse)
async def google_auth(request: GoogleTokenRequest):
    """Authenticate with Google OAuth token."""
    # Verify Google token
    google_user_info = verify_google_token(request.token)
    
    google_id = google_user_info['sub']
    email = google_user_info['email']
    name = google_user_info['name']
    picture = google_user_info.get('picture')
    
    # Check if user exists
    query = """
    MATCH (u:User {google_id: $google_id})
    RETURN u
    """
    result = await neo4j_db.execute_query(query, google_id=google_id)
    
    if result.records:
        # User exists, update last login
        user_data = dict(result.records[0]['u'])
        update_query = """
        MATCH (u:User {google_id: $google_id})
        SET u.last_login = datetime()
        RETURN u
        """
        await neo4j_db.execute_query(update_query, google_id=google_id)
    else:
        # Create new user
        new_user = User(
            name=name,
            email=email,
            google_id=google_id,
            profile_picture=picture,
            role=UserRole.CONTRIBUTOR
        )
        
        create_query = """
        CREATE (u:User {
            id: $id,
            name: $name,
            email: $email,
            google_id: $google_id,
            profile_picture: $profile_picture,
            role: $role,
            created_at: datetime(),
            registered_at: datetime(),
            last_login: datetime()
        })
        RETURN u
        """
        
        try:
            result = await neo4j_db.execute_query(
                create_query,
                id=new_user.id,
                name=new_user.name,
                email=new_user.email,
                google_id=new_user.google_id,
                profile_picture=new_user.profile_picture,
                role=new_user.role.value
            )
            user_data = dict(result.records[0]['u'])
        except Exception as e:
            logger.error(f"Error creating new user in DB: {str(e)}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error"
            )
    
    # Create JWT token
    token_data = {
        "sub": user_data['id'],
        "email": user_data['email'],
        "name": user_data['name']
    }
    access_token = create_access_token(token_data)
    
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.JWT_EXPIRATION_HOURS * 3600,
        user={
            "id": user_data['id'],
            "name": user_data['name'],
            "email": user_data['email'],
            "profile_picture": user_data.get('profile_picture'),
            "role": user_data['role']
        }
    )

@router.get("/profile", response_model=UserProfile)
async def get_user_profile(current_user: dict = Depends(get_current_user)):
    """Get current user profile."""
    query = """
    MATCH (u:User {id: $user_id})
    RETURN u
    """
    result = await neo4j_db.execute_query(query, user_id=current_user['user_id'])
    
    if not result.records:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    user_data = dict(result.records[0]['u'])
    return UserProfile(
        id=user_data['id'],
        name=user_data['name'],
        email=user_data['email'],
        profile_picture=user_data.get('profile_picture'),
        role=user_data['role']
    )

@router.post("/logout")
async def logout():
    """Logout user (client should discard token)."""
    return {"message": "Successfully logged out"}

@router.post("/refresh")
async def refresh_token(current_user: dict = Depends(get_current_user)):
    """Refresh JWT token."""
    token_data = {
        "sub": current_user['user_id'],
        "email": current_user['email']
    }
    access_token = create_access_token(token_data)
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": settings.JWT_EXPIRATION_HOURS * 3600
    }

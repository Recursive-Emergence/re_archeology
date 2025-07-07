"""
Authentication router for Google OAuth and JWT management.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional
import uuid
from jose import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from google.auth.transport import requests
from google.oauth2 import id_token
from google.auth.exceptions import GoogleAuthError
from pydantic import BaseModel, ValidationError

from backend.core.neo4j_database import neo4j_db
from backend.utils.config import get_settings
from backend.api.routers.google_jwt_utils import decode_google_jwt

# Configure logging
logger = logging.getLogger(__name__)

settings = get_settings()
router = APIRouter(prefix="/auth", tags=["authentication"])
security = HTTPBearer()

# Request and response models
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

class TestLoginRequest(BaseModel):
    email: str
    name: Optional[str] = "Test User"

# Additional request models
class EmailLoginRequest(BaseModel):
    email: str

class UserRegistrationRequest(BaseModel):
    email: str
    name: str
    role: str = "user"

# Configuration response model
class AuthConfigResponse(BaseModel):
    google_client_id: str

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
    """Get current user from JWT token. Supports Google RS256 JWTs and legacy HS256 tokens."""
    try:
        logger.info(f"[DEBUG] Raw JWT token: {getattr(credentials, 'credentials', None)}")
        token = credentials.credentials
        # Try RS256 decode (Google)
        try:
            payload = decode_google_jwt(token, settings.GOOGLE_CLIENT_ID)
            logger.info("[DEBUG] Decoded Google RS256 JWT.")
        except Exception as rs256_exc:
            logger.info(f"[DEBUG] RS256 decode failed: {rs256_exc}, trying HS256 fallback.")
            # Fallback to legacy HS256 (internal tokens)
            payload = jwt.decode(
                token,
                settings.JWT_SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM]
            )
        user_id: str = payload.get("sub")
        if user_id is None:
            logger.warning("[DEBUG] JWT decode: 'sub' missing in payload")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials"
            )
        logger.info(f"[DEBUG] Decoded JWT payload: {payload}")
        return {
            "user_id": user_id, 
            "email": payload.get("email"),
            "name": payload.get("name"),
            "picture": payload.get("picture")  # Include picture from JWT
        }
    except jwt.JWTError as e:
        logger.warning(f"JWT token verification failed: {e}")
        logger.warning(f"[DEBUG] JWT decode error: {e}")
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
    """Get current user from JWT token (optional - returns None if no valid token)."""
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
            
        return {
            "user_id": user_id, 
            "email": payload.get("email"),
            "name": payload.get("name"),
            "picture": payload.get("picture")  # Include picture from JWT
        }
    except jwt.JWTError:
        logger.debug("JWT token verification failed (optional)")
        return None
    except Exception as e:
        logger.debug(f"Error getting current user (optional): {str(e)}")
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
    
    # For now, create a simple fallback user without database
    # This allows OAuth to work even when Neo4j is not available
    user_data = {
        "id": str(uuid.uuid4()),
        "name": name,
        "email": email,
        "google_id": google_id,
        "profile_picture": picture,
        "role": "user"
    }
    
    logger.info(f"Authenticated user with Google OAuth: {email}")
    
    # Create access token with picture included
    access_token = create_access_token({
        "sub": user_data["id"],
        "email": user_data["email"],
        "name": user_data["name"],
        "picture": picture  # Include picture in JWT
    })
    
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.JWT_EXPIRATION_HOURS * 3600,
        user={
            "id": user_data["id"],
            "name": user_data["name"],
            "email": user_data["email"],
            "picture": user_data.get("profile_picture"),  # Frontend expects 'picture' field
            "profile_picture": user_data.get("profile_picture"),  # Keep both for compatibility
            "role": user_data["role"]
        }
    )

@router.get("/validate")
async def validate_token(current_user: dict = Depends(get_current_user)):
    """Validate JWT token and return user info."""
    return {
        "valid": True,
        "user": current_user
    }

@router.get("/config", response_model=AuthConfigResponse)
async def get_auth_config():
    """Get authentication configuration for frontend"""
    return AuthConfigResponse(
        google_client_id=settings.GOOGLE_CLIENT_ID
    )

@router.get("/google")
async def google_oauth_redirect():
    """Handle Google OAuth redirect - redirect to frontend"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/", status_code=302)

@router.post("/logout")
async def logout():
    """Logout user (client should discard token)."""
    return {"message": "Successfully logged out"}

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import logging
import os
import pathlib
from typing import Dict, List, Any
from dotenv import load_dotenv

# Configure logging first
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables from .env file
load_dotenv()

# Initialize Earth Engine using shared module
from backend.utils.earth_engine import initialize_earth_engine, is_earth_engine_available

earth_engine_available = initialize_earth_engine()

if earth_engine_available:
    logger.info("Earth Engine available for AHN LiDAR data")
else:
    logger.warning("Earth Engine not available - some features may be limited")

from backend.core.neo4j_database import neo4j_db
from backend.utils.config import settings

# Create FastAPI app
app = FastAPI(
    title=settings.PROJECT_NAME,
    description="API for the RE-Archaeology Agent System",
    version="0.1.0"
)

# Set up CORS middleware - ensuring frontend can access all endpoints
frontend_origins = settings.FRONTEND_ORIGINS.split(',') if settings.FRONTEND_ORIGINS else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Type"]
)

# Health check endpoint
@app.get("/health")
def health_check():
    return {"status": "healthy", "version": "0.1.0"}

# Readiness check endpoint for Cloud Run
@app.get("/ready")
def readiness_check():
    return {"status": "ready", "service": "re-archaeology-api"}

# Import and include routers
from backend.api.routers import (
    users, hypotheses, sites, websocket,
    auth, discussion_threads, background_tasks, spatial_analysis, earth_engine_service, discovery,
    ai_chat,  # Re-enabled for chat functionality
    tasks,    # New tasks management endpoint
)

# Core routers
app.include_router(users.router, prefix=settings.API_V1_STR, tags=["users"])
app.include_router(hypotheses.router, prefix=settings.API_V1_STR, tags=["hypotheses"])
app.include_router(sites.router, prefix=settings.API_V1_STR, tags=["sites"])

# Enhanced feature routers
app.include_router(auth.router, prefix=settings.API_V1_STR, tags=["authentication"])
app.include_router(discussion_threads.router, prefix=settings.API_V1_STR, tags=["discussion-threads"])
app.include_router(ai_chat.router, prefix=settings.API_V1_STR, tags=["ai-chat"])  # Re-enabled for chat functionality
app.include_router(background_tasks.router, prefix=settings.API_V1_STR, tags=["background-tasks"])
app.include_router(spatial_analysis.router, prefix=settings.API_V1_STR, tags=["spatial-analysis"])
app.include_router(earth_engine_service.router, prefix=settings.API_V1_STR, tags=["earth-engine"])
app.include_router(discovery.router, prefix=settings.API_V1_STR, tags=["discovery"])
app.include_router(tasks.router, prefix=settings.API_V1_STR, tags=["tasks"])  # New tasks management
app.include_router(websocket.router, tags=["websockets"])

# Explicit homepage route for the discovery interface
from fastapi.responses import FileResponse

@app.get("/", response_class=FileResponse)
async def serve_homepage():
    """Serve the main discovery interface as homepage"""
    frontend_path = pathlib.Path(__file__).parent.parent.parent / "frontend"
    index_path = frontend_path / "index.html"
    logger.info(f"🏠 Serving homepage request:")
    logger.info(f"   Frontend path: {frontend_path}")
    logger.info(f"   Index path: {index_path}")
    logger.info(f"   Index exists: {index_path.exists()}")
    
    if index_path.exists():
        return FileResponse(str(index_path), media_type="text/html")
    else:
        # Try alternative paths for Docker environment
        alternative_paths = [
            pathlib.Path("/app/frontend/index.html"),
            pathlib.Path("./frontend/index.html"),
            pathlib.Path("frontend/index.html")
        ]
        for alt_path in alternative_paths:
            logger.info(f"   Checking alternative index: {alt_path} - exists: {alt_path.exists()}")
            if alt_path.exists():
                logger.info(f"✅ Using alternative index path: {alt_path}")
                return FileResponse(str(alt_path), media_type="text/html")
        
        logger.error("❌ No valid index.html found in any location")
        raise HTTPException(status_code=404, detail="Discovery interface not found")

# Mount static files for frontend assets (CSS, JS, images)
frontend_path = pathlib.Path(__file__).parent.parent.parent / "frontend"
logger.info(f"🔍 Frontend path resolution:")
logger.info(f"   Current file: {__file__}")
logger.info(f"   Calculated frontend path: {frontend_path}")
logger.info(f"   Frontend path exists: {frontend_path.exists()}")
logger.info(f"   Frontend path absolute: {frontend_path.absolute()}")

if frontend_path.exists():
    # Log subdirectories for debugging
    subdirs = ["css", "js", "images", "components", "services"]
    for subdir in subdirs:
        subpath = frontend_path / subdir
        logger.info(f"   {subdir} path exists: {subpath.exists()} - {subpath}")
    
    # Mount static files for CSS, JS, images, etc.
    app.mount("/css", StaticFiles(directory=str(frontend_path / "css")), name="css")
    app.mount("/js", StaticFiles(directory=str(frontend_path / "js")), name="js")
    app.mount("/images", StaticFiles(directory=str(frontend_path / "images")), name="images")
    app.mount("/components", StaticFiles(directory=str(frontend_path / "components")), name="components")
    app.mount("/services", StaticFiles(directory=str(frontend_path / "services")), name="services")
    # Mount all static files at /static/ for backward compatibility
    app.mount("/static", StaticFiles(directory=str(frontend_path)), name="static")
    logger.info("✅ Static file mounts configured successfully")
else:
    logger.error(f"❌ Frontend path does not exist: {frontend_path}")
    # Try alternative paths for Docker environment
    alternative_paths = [
        pathlib.Path("/app/frontend"),
        pathlib.Path("./frontend"),
        pathlib.Path("frontend")
    ]
    for alt_path in alternative_paths:
        logger.info(f"   Checking alternative: {alt_path} - exists: {alt_path.exists()}")
        if alt_path.exists():
            logger.info(f"✅ Using alternative frontend path: {alt_path}")
            frontend_path = alt_path
            app.mount("/css", StaticFiles(directory=str(frontend_path / "css")), name="css")
            app.mount("/js", StaticFiles(directory=str(frontend_path / "js")), name="js")
            app.mount("/images", StaticFiles(directory=str(frontend_path / "images")), name="images")
            app.mount("/components", StaticFiles(directory=str(frontend_path / "components")), name="components")
            app.mount("/services", StaticFiles(directory=str(frontend_path / "services")), name="services")
            app.mount("/static", StaticFiles(directory=str(frontend_path)), name="static")
            break

# Serve static files from the project root for demo html/js
app.mount("/", StaticFiles(directory=str(pathlib.Path(__file__).parent.parent.parent)), name="static-root")

# Startup event
@app.on_event("startup")
async def startup_event():
    logger.info(f"Starting up {settings.PROJECT_NAME} API")
    
    # Initialize Neo4j connection and schema - completely optional
    try:
        # Set a very short timeout to avoid blocking startup
        import asyncio
        await asyncio.wait_for(
            asyncio.to_thread(_initialize_neo4j),
            timeout=3.0  # 3 second timeout
        )
        logger.info("✅ Successfully connected to Neo4j database")
        
    except asyncio.TimeoutError:
        logger.warning("⚠️ Neo4j connection timed out - continuing startup without database")
    except Exception as e:
        logger.warning(f"⚠️ Neo4j connection/schema failed: {e} - continuing startup without database")
    
    # Check for running tasks and restart them
    
    logger.info("🚀 RE-Archaeology API startup complete")

def _initialize_neo4j():
    """Helper function to initialize Neo4j connection"""
    try:
        # Import here to ensure settings are loaded after .env
        from backend.utils.config import settings
        
        # Try to establish connection
        neo4j_db.connect()
        
        # Log the URI we're using (after connection)
        logger.info(f"Connected to Neo4j at URI: {neo4j_db.uri}")
        
        # Initialize schema
        from backend.models.neo4j_schema import create_schema
        create_schema()
    except Exception as e:
        logger.warning(f"Neo4j initialization failed: {e}")
        raise  # Re-raise to be caught by the timeout handler

# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    logger.info(f"Shutting down {settings.PROJECT_NAME} API")
    neo4j_db.close()

# Direct startup for development/testing
if __name__ == "__main__":
    import uvicorn
    import os
    
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8080"))
    
    print(f"Starting server directly from main.py on {host}:{port}")
    
    uvicorn.run(
        app,
        host=host,
        port=port,
        reload=False,
        log_level="info",
        access_log=True
    )

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import logging
import os
import pathlib
from typing import Dict, List, Any

from backend.core.neo4j_database import neo4j_db
from backend.utils.config import settings

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title=settings.PROJECT_NAME,
    description="API for the RE-Archaeology Agent System",
    version="0.1.0"
)

# Set up CORS middleware - ensuring frontend can access all endpoints
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development only - restrict in production
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Type"]
)

# Health check endpoint
@app.get("/health")
def health_check():
    return {"status": "healthy", "version": "0.1.0"}

# Import and include routers FIRST
from backend.api.routers import users, threads, hypotheses, sites

app.include_router(users.router, prefix=settings.API_V1_STR, tags=["users"])
app.include_router(threads.router, prefix=settings.API_V1_STR, tags=["threads"])
app.include_router(hypotheses.router, prefix=settings.API_V1_STR, tags=["hypotheses"])
app.include_router(sites.router, prefix=settings.API_V1_STR, tags=["sites"])

# Mount static files for frontend LAST (catches all remaining routes)
frontend_path = pathlib.Path(__file__).parent.parent.parent / "frontend"
if frontend_path.exists():
    # Mount frontend at root path - this will serve index.html for "/" and all static files
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")

# Startup event
@app.on_event("startup")
async def startup_event():
    logger.info(f"Starting up {settings.PROJECT_NAME} API")
    
    # Initialize Neo4j connection and schema
    try:
        neo4j_db.connect()
        logger.info("Successfully connected to Neo4j database")
        
        # Initialize schema
        from backend.models.neo4j_schema import create_schema
        create_schema()
        logger.info("Neo4j schema initialized")
        
    except Exception as e:
        logger.error(f"Neo4j connection/schema failed: {e}")

# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    logger.info(f"Shutting down {settings.PROJECT_NAME} API")
    neo4j_db.close()

#!/usr/bin/env python3
"""
Discovery Server Runner

Simple wrapper to start the FastAPI backend server for the
real-time windmill discovery visualization system.
"""

import sys
import os
import uvicorn

# Add backend directory to path
sys.path.append('/media/im3/plus/lab4/RE/re_archaeology/backend')

if __name__ == "__main__":
    print("🏛️ Starting Windmill Discovery API Server")
    print("=" * 50)
    print("🌐 WebSocket: ws://localhost:8080/api/v1/ws/discovery")
    print("🌐 API: http://localhost:8080/api/v1")
    print("🌐 Frontend: http://localhost:8080/")
    print("=" * 50)
    
    # Start the FastAPI server
    uvicorn.run(
        "backend.api.main:app",
        host="0.0.0.0",
        port=8080,
        reload=True,
        log_level="info"
    )
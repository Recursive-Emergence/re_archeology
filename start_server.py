#!/usr/bin/env python3
"""
Custom server startup script to force uvicorn to use the correct host and port
"""
import os
import uvicorn
import sys

if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8080"))
    
    print(f"Environment HOST: {os.getenv('HOST')}")
    print(f"Environment PORT: {os.getenv('PORT')}")
    print(f"Resolved host: {host}")
    print(f"Resolved port: {port}")
    print(f"Starting server on {host}:{port}")
    
    # Force explicit configuration
    config = uvicorn.Config(
        "backend.api.main:app",
        host=host,
        port=port,
        reload=False,  # Disable reload in container
        log_level="info",
        access_log=True,
        workers=1
    )
    
    server = uvicorn.Server(config)
    server.run()

#!/usr/bin/env python3
"""
Custom server startup script to force uvicorn to use the correct host and port
"""
import os
import sys

# Add the current directory to Python path
sys.path.insert(0, '/app')

try:
    import uvicorn
except ImportError as e:
    print(f"Failed to import uvicorn: {e}")
    print("Python path:", sys.path)
    print("Available packages:")
    import pkg_resources
    for package in pkg_resources.working_set:
        print(f"  {package.project_name} {package.version}")
    sys.exit(1)

if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8080"))
    
    print(f"Environment HOST: {os.getenv('HOST')}")
    print(f"Environment PORT: {os.getenv('PORT')}")
    print(f"Resolved host: {host}")
    print(f"Resolved port: {port}")
    
    # Debug Neo4j environment variables
    print(f"NEO4J_URI from env: {os.environ.get('NEO4J_URI', 'NOT SET')}")
    print(f"NEO4J_USER from env: {os.environ.get('NEO4J_USER', 'NOT SET')}")
    print(f"NEO4J_PASSWORD from env: {'SET' if os.environ.get('NEO4J_PASSWORD') else 'NOT SET'}")
    
    # Debug Google OAuth environment variables
    print(f"GOOGLE_CLIENT_ID from env: {'SET' if os.environ.get('GOOGLE_CLIENT_ID') else 'NOT SET'}")
    
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

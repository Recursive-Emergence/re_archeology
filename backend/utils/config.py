import os
from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# Load environment variables from .env file
# Check multiple possible locations for .env file
env_paths = [
    "/app/.env",  # Docker container path
    ".env",       # Local development path
    "../.env",    # If running from backend directory
    "../../.env"  # If running from nested directory
]

env_loaded = False
for env_path in env_paths:
    if os.path.exists(env_path):
        load_dotenv(env_path)
        env_loaded = True
        print(f"Loaded environment from: {env_path}")
        break

if not env_loaded:
    print("Warning: No .env file found, using default values")
    load_dotenv()  # Try default behavior

class Settings(BaseSettings):
    # Base configuration
    PROJECT_NAME: str = "RE-Archaeology Agent"
    API_V1_STR: str = "/api/v1"
    
    # Neo4j Database configuration
    NEO4J_URI: str = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    NEO4J_USER: str = os.getenv("NEO4J_USER", "neo4j")
    NEO4J_PASSWORD: str = os.getenv("NEO4J_PASSWORD", "re_archaeology_pass")
    
    # Google OAuth configuration
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    GOOGLE_REDIRECT_URI: str = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8080/api/v1/auth/google/callback")
    
    # JWT configuration
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_EXPIRATION_HOURS: int = int(os.getenv("JWT_EXPIRATION_HOURS", "24"))
    
    # OpenAI configuration
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4-turbo-preview")
    OPENAI_EMBEDDING_MODEL: str = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
    
    # WebSocket and Redis configuration
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    WEBSOCKET_REDIS_URL: str = os.getenv("WEBSOCKET_REDIS_URL", "redis://localhost:6379/1")

    class Config:
        case_sensitive = True

settings = Settings()

def get_settings() -> Settings:
    return settings

def print_neo4j_config():
    """Debug function to print current Neo4j configuration"""
    print("=" * 50)
    print("NEO4J CONFIGURATION DEBUG")
    print("=" * 50)
    print(f"NEO4J_URI: {settings.NEO4J_URI}")
    print(f"NEO4J_USER: {settings.NEO4J_USER}")
    print(f"NEO4J_PASSWORD: {'*' * len(settings.NEO4J_PASSWORD) if settings.NEO4J_PASSWORD else 'NOT SET'}")
    print("=" * 50)

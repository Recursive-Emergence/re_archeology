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
    print("No .env file found, using environment variables from system")
    # For Cloud Run and other environments where .env file is not available
    # Environment variables are set directly via the deployment configuration
    load_dotenv()  # Try default behavior

class Settings(BaseSettings):
    # Base configuration
    PROJECT_NAME: str = "RE-Archaeology Agent"
    API_V1_STR: str = "/api/v1"
    
    # Neo4j Database configuration - use model_config to load from env
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "re_archaeology_pass"
    
    # Google OAuth configuration
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8080/api/v1/auth/google/callback"
    
    # JWT configuration
    JWT_SECRET_KEY: str = "your-secret-key-change-in-production"
    JWT_ALGORITHM: str = "RS256"
    JWT_EXPIRATION_HOURS: int = 24
    
    # OpenAI configuration
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4-turbo-preview"
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"
    
    # Google Earth Engine configuration
    GOOGLE_EE_SERVICE_ACCOUNT_KEY: str = ""  # Path to JSON key file or JSON string
    GOOGLE_EE_PROJECT_ID: str = ""  # Google Cloud Project ID for Earth Engine
    
    # CORS and Frontend configuration
    FRONTEND_ORIGINS: str = "http://localhost:8080"
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Override with environment variables
        # Neo4j settings
        self.NEO4J_URI = os.environ.get("NEO4J_URI", self.NEO4J_URI)
        self.NEO4J_USER = os.environ.get("NEO4J_USER", self.NEO4J_USER)
        self.NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", self.NEO4J_PASSWORD)
        
        # Google OAuth settings
        self.GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", self.GOOGLE_CLIENT_ID)
        self.GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", self.GOOGLE_CLIENT_SECRET)
        self.GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", self.GOOGLE_REDIRECT_URI)
        
        # JWT settings
        self.JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", self.JWT_SECRET_KEY)
        self.JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", self.JWT_ALGORITHM)
        self.JWT_EXPIRATION_HOURS = int(os.environ.get("JWT_EXPIRATION_HOURS", self.JWT_EXPIRATION_HOURS))
        
        # OpenAI settings
        self.OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", self.OPENAI_API_KEY)
        self.OPENAI_MODEL = os.environ.get("OPENAI_MODEL", self.OPENAI_MODEL)
        self.OPENAI_EMBEDDING_MODEL = os.environ.get("OPENAI_EMBEDDING_MODEL", self.OPENAI_EMBEDDING_MODEL)
        
        # Google Earth Engine settings
        self.GOOGLE_EE_SERVICE_ACCOUNT_KEY = os.environ.get("GOOGLE_EE_SERVICE_ACCOUNT_KEY", self.GOOGLE_EE_SERVICE_ACCOUNT_KEY)
        self.GOOGLE_EE_PROJECT_ID = os.environ.get("GOOGLE_EE_PROJECT_ID", self.GOOGLE_EE_PROJECT_ID)
        
        # Frontend CORS settings
        self.FRONTEND_ORIGINS = os.environ.get("FRONTEND_ORIGINS", self.FRONTEND_ORIGINS)

    class Config:
        case_sensitive = True

settings = Settings()

def get_settings() -> Settings:
    return settings

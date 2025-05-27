import os
from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# Load environment variables
load_dotenv()

class Settings(BaseSettings):
    # Base configuration
    PROJECT_NAME: str = "RE-Archaeology Agent"
    API_V1_STR: str = "/api/v1"
    
    # Neo4j Database configuration
    NEO4J_URI: str = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    NEO4J_USER: str = os.getenv("NEO4J_USER", "neo4j")
    NEO4J_PASSWORD: str = os.getenv("NEO4J_PASSWORD", "re_archaeology_pass")

    class Config:
        case_sensitive = True

settings = Settings()

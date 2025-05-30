"""
Neo4j database connection and session management.
"""
import os
from typing import Generator
from neo4j import GraphDatabase, Driver
from contextlib import contextmanager
import logging

logger = logging.getLogger(__name__)

class Neo4jDatabase:
    def __init__(self):
        self.driver: Driver = None
        # Don't initialize connection settings here - they'll be set when connect() is called
        self.uri = None
        self.user = None
        self.password = None
    
    def connect(self):
        """Establish connection to Neo4j database."""
        try:
            # Import settings here to ensure .env is loaded
            from backend.utils.config import settings
            import os
            
            # Check raw environment values first
            env_uri = os.environ.get("NEO4J_URI")
            if env_uri:
                logger.info(f"Found NEO4J_URI in environment: {env_uri}")
            
            # Get settings from the settings module
            self.uri = settings.NEO4J_URI
            self.user = settings.NEO4J_USER
            self.password = settings.NEO4J_PASSWORD
            
            logger.info(f"Attempting to connect to Neo4j at {self.uri}")
            
            self.driver = GraphDatabase.driver(
                self.uri, 
                auth=(self.user, self.password)
            )
            
            # Test connection
            with self.driver.session() as session:
                result = session.run("RETURN 1 as test").single()
                logger.info(f"Connection test result: {result['test']}")
                
            logger.info(f"Successfully connected to Neo4j at {self.uri}")
        except Exception as e:
            logger.error(f"Failed to connect to Neo4j: {e}")
            logger.error(f"URI attempted: {self.uri}")
            raise
    
    def close(self):
        """Close database connection."""
        if self.driver:
            self.driver.close()
            logger.info("Neo4j connection closed")
    
    @contextmanager
    def get_session(self):
        """Get a Neo4j session with context management."""
        if not self.driver:
            self.connect()
        
        session = self.driver.session()
        try:
            yield session
        finally:
            session.close()
    
    async def execute_query(self, query: str, parameters: dict = None, **kwargs):
        """Execute a single query and return results."""
        # Merge kwargs into parameters dict for compatibility
        if kwargs:
            if parameters is None:
                parameters = {}
            parameters.update(kwargs)
            
        with self.get_session() as session:
            result = session.run(query, parameters or {})
            # Return a result object with records attribute for compatibility
            records = [record for record in result]
            
            # Create a simple result object that mimics neo4j Result
            class SimpleResult:
                def __init__(self, records):
                    self.records = records
            
            return SimpleResult(records)
    
    async def execute_write_query(self, query: str, parameters: dict = None, **kwargs):
        """Execute a write query in a transaction."""
        # Merge kwargs into parameters dict for compatibility
        if kwargs:
            if parameters is None:
                parameters = {}
            parameters.update(kwargs)
            
        with self.get_session() as session:
            return session.execute_write(
                lambda tx: tx.run(query, parameters or {}).single()
            )

# Global database instance
neo4j_db = Neo4jDatabase()

def get_neo4j_session() -> Generator:
    """Dependency for FastAPI to get Neo4j session."""
    with neo4j_db.get_session() as session:
        yield session

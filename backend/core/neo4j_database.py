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
        self.uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
        self.user = os.getenv("NEO4J_USER", "neo4j")
        self.password = os.getenv("NEO4J_PASSWORD", "re_archaeology_pass")
    
    def connect(self):
        """Establish connection to Neo4j database."""
        try:
            self.driver = GraphDatabase.driver(
                self.uri, 
                auth=(self.user, self.password)
            )
            # Test connection
            with self.driver.session() as session:
                session.run("RETURN 1")
            logger.info(f"Connected to Neo4j at {self.uri}")
        except Exception as e:
            logger.error(f"Failed to connect to Neo4j: {e}")
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
    
    def execute_query(self, query: str, parameters: dict = None):
        """Execute a single query and return results."""
        with self.get_session() as session:
            result = session.run(query, parameters or {})
            return [record for record in result]
    
    def execute_write_query(self, query: str, parameters: dict = None):
        """Execute a write query in a transaction."""
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

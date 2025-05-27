"""
Neo4j schema initialization and constraints.
Based on the ontology defined in architecture.md
"""
from typing import List
from backend.core.neo4j_database import neo4j_db
import logging

logger = logging.getLogger(__name__)

# Cypher queries to create constraints and indexes
SCHEMA_QUERIES = [
    # Node constraints (unique IDs)
    "CREATE CONSTRAINT agent_id_unique IF NOT EXISTS FOR (a:Agent) REQUIRE a.id IS UNIQUE",
    "CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE", 
    "CREATE CONSTRAINT thread_id_unique IF NOT EXISTS FOR (t:Thread) REQUIRE t.id IS UNIQUE",
    "CREATE CONSTRAINT hypothesis_id_unique IF NOT EXISTS FOR (h:Hypothesis) REQUIRE h.id IS UNIQUE",
    "CREATE CONSTRAINT site_id_unique IF NOT EXISTS FOR (s:Site) REQUIRE s.id IS UNIQUE",
    "CREATE CONSTRAINT geo_tile_id_unique IF NOT EXISTS FOR (g:GeoTile) REQUIRE g.id IS UNIQUE",
    "CREATE CONSTRAINT artifact_id_unique IF NOT EXISTS FOR (a:Artifact) REQUIRE a.id IS UNIQUE",
    "CREATE CONSTRAINT motif_id_unique IF NOT EXISTS FOR (m:Motif) REQUIRE m.id IS UNIQUE",
    "CREATE CONSTRAINT pattern_id_unique IF NOT EXISTS FOR (p:Pattern) REQUIRE p.id IS UNIQUE",
    "CREATE CONSTRAINT research_id_unique IF NOT EXISTS FOR (r:Research) REQUIRE r.id IS UNIQUE",
    "CREATE CONSTRAINT narrative_id_unique IF NOT EXISTS FOR (n:Narrative) REQUIRE n.id IS UNIQUE",
    
    # Indexes for common queries
    "CREATE INDEX user_email_index IF NOT EXISTS FOR (u:User) ON (u.email)",
    "CREATE INDEX thread_created_index IF NOT EXISTS FOR (t:Thread) ON (t.created_at)",
    "CREATE INDEX site_status_index IF NOT EXISTS FOR (s:Site) ON (s.status)",
    "CREATE INDEX hypothesis_status_index IF NOT EXISTS FOR (h:Hypothesis) ON (h.status)",
    "CREATE INDEX pattern_score_index IF NOT EXISTS FOR (p:Pattern) ON (p.score)",
    
    # Spatial index for sites (if using Point type)
    "CREATE POINT INDEX site_location_index IF NOT EXISTS FOR (s:Site) ON (s.location)",
]

def create_schema():
    """Create the Neo4j schema with constraints and indexes."""
    logger.info("Creating Neo4j schema...")
    
    for query in SCHEMA_QUERIES:
        try:
            neo4j_db.execute_query(query)
            logger.info(f"Executed: {query}")
        except Exception as e:
            logger.warning(f"Failed to execute {query}: {e}")
    
    logger.info("Schema creation completed")

def verify_schema():
    """Verify that the schema was created correctly."""
    logger.info("Verifying Neo4j schema...")
    
    # Check constraints
    constraints_query = "SHOW CONSTRAINTS"
    constraints = neo4j_db.execute_query(constraints_query)
    logger.info(f"Found {len(constraints)} constraints")
    
    # Check indexes
    indexes_query = "SHOW INDEXES"
    indexes = neo4j_db.execute_query(indexes_query)
    logger.info(f"Found {len(indexes)} indexes")
    
    return True

if __name__ == "__main__":
    neo4j_db.connect()
    create_schema()
    verify_schema()
    neo4j_db.close()

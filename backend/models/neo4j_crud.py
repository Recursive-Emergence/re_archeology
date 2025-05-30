"""
Neo4j CRUD operations for ontology entities.
"""
from typing import List, Optional, Dict, Any
from datetime import datetime
from backend.core.neo4j_database import neo4j_db
from backend.models.ontology_models import *
import json
import logging

logger = logging.getLogger(__name__)

class Neo4jCRUD:
    """Base CRUD operations for Neo4j entities."""
    
    @staticmethod
    def create_node(label: str, properties: dict) -> dict:
        """Create a new node with given label and properties."""
        # Convert datetime objects to ISO strings
        for key, value in properties.items():
            if isinstance(value, datetime):
                properties[key] = value.isoformat()
            elif isinstance(value, list) and value and isinstance(value[0], str):
                # Keep string lists as is
                pass
            elif isinstance(value, (list, dict)):
                # Convert complex objects to JSON strings
                properties[key] = json.dumps(value)
        
        query = f"""
        CREATE (n:{label} $props)
        RETURN n
        """
        
        result = neo4j_db.execute_write_query(query, {"props": properties})
        return dict(result["n"])
    
    @staticmethod
    def get_node_by_id(label: str, node_id: str) -> Optional[dict]:
        """Get a node by its ID."""
        query = f"""
        MATCH (n:{label} {{id: $id}})
        RETURN n
        """
        
        results = neo4j_db.execute_query(query, {"id": node_id})
        return dict(results[0]["n"]) if results else None
    
    @staticmethod
    def get_all_nodes(label: str, limit: int = 100) -> List[dict]:
        """Get all nodes of a given label."""
        query = f"""
        MATCH (n:{label})
        RETURN n
        ORDER BY n.created_at DESC
        LIMIT $limit
        """
        
        results = neo4j_db.execute_query(query, {"limit": limit})
        return [dict(record["n"]) for record in results]
    
    @staticmethod
    def update_node(label: str, node_id: str, properties: dict) -> Optional[dict]:
        """Update a node's properties."""
        # Convert datetime objects to ISO strings
        for key, value in properties.items():
            if isinstance(value, datetime):
                properties[key] = value.isoformat()
        
        query = f"""
        MATCH (n:{label} {{id: $id}})
        SET n += $props
        RETURN n
        """
        
        result = neo4j_db.execute_write_query(query, {"id": node_id, "props": properties})
        return dict(result["n"]) if result else None
    
    @staticmethod
    def delete_node(label: str, node_id: str) -> bool:
        """Delete a node by its ID."""
        query = f"""
        MATCH (n:{label} {{id: $id}})
        DETACH DELETE n
        RETURN count(n) as deleted
        """
        
        result = neo4j_db.execute_write_query(query, {"id": node_id})
        return result["deleted"] > 0 if result else False
    
    @staticmethod
    def create_relationship(from_label: str, from_id: str, rel_type: str, 
                          to_label: str, to_id: str, properties: dict = None) -> bool:
        """Create a relationship between two nodes."""
        props_clause = ""
        params = {"from_id": from_id, "to_id": to_id}
        
        if properties:
            props_clause = " $props"
            params["props"] = properties
        
        query = f"""
        MATCH (a:{from_label} {{id: $from_id}}), (b:{to_label} {{id: $to_id}})
        CREATE (a)-[r:{rel_type}{props_clause}]->(b)
        RETURN r
        """
        
        result = neo4j_db.execute_write_query(query, params)
        return result is not None

# Specific CRUD classes for each entity
class UserCRUD(Neo4jCRUD):
    @staticmethod
    def create_user(user_data: CreateUserRequest) -> User:
        """Create a new user."""
        user = User(**user_data.dict())
        result = Neo4jCRUD.create_node("User", user.dict())
        return User(**result)
    
    @staticmethod
    def get_user_by_email(email: str) -> Optional[User]:
        """Get user by email."""
        query = """
        MATCH (u:User {email: $email})
        RETURN u
        """
        
        results = neo4j_db.execute_query(query, {"email": email})
        return User(**dict(results[0]["u"])) if results else None

class ThreadCRUD(Neo4jCRUD):
    @staticmethod
    def create_thread(thread_data: CreateThreadRequest) -> Thread:
        """Create a new thread."""
        thread = Thread(**thread_data.dict())
        result = Neo4jCRUD.create_node("Thread", thread.dict())
        
        # Create WRITES relationship
        Neo4jCRUD.create_relationship(
            "User", thread_data.starter_user_id,
            "WRITES",
            "Thread", thread.id
        )
        
        return Thread(**result)
    
    @staticmethod
    def get_threads_by_user(user_id: str) -> List[Thread]:
        """Get all threads written by a user."""
        query = """
        MATCH (u:User {id: $user_id})-[:WRITES]->(t:Thread)
        RETURN t
        ORDER BY t.created_at DESC
        """
        
        results = neo4j_db.execute_query(query, {"user_id": user_id})
        return [Thread(**dict(record["t"])) for record in results]

class HypothesisCRUD(Neo4jCRUD):
    @staticmethod
    def create_hypothesis(hypothesis_data: CreateHypothesisRequest) -> Hypothesis:
        """Create a new hypothesis."""
        hypothesis = Hypothesis(**hypothesis_data.dict())
        result = Neo4jCRUD.create_node("Hypothesis", hypothesis.dict())
        
        # Create relationships
        Neo4jCRUD.create_relationship(
            "User", hypothesis_data.proposed_by_user,
            "PROPOSES",
            "Hypothesis", hypothesis.id
        )
        
        Neo4jCRUD.create_relationship(
            "Thread", hypothesis_data.emerged_from_thread,
            "YIELDS",
            "Hypothesis", hypothesis.id
        )
        
        return Hypothesis(**result)

class SiteCRUD(Neo4jCRUD):
    @staticmethod
    def create_site(site_data: CreateSiteRequest) -> Site:
        """Create a new site."""
        site = Site(**site_data.dict())
        result = Neo4jCRUD.create_node("Site", site.dict())
        
        # Create MAY_FORM relationship if created from hypothesis
        if site_data.created_from_hypothesis:
            Neo4jCRUD.create_relationship(
                "Hypothesis", site_data.created_from_hypothesis,
                "MAY_FORM",
                "Site", site.id
            )
        
        return Site(**result)
    
    @staticmethod
    def get_sites_near_location(lat: float, lon: float, radius_km: float = 10) -> List[Site]:
        """Get sites near a given location (simplified - would need proper spatial queries)."""
        # This is a simplified version - in production, use proper spatial queries
        query = """
        MATCH (s:Site)
        WHERE abs(s.latitude - $lat) < $delta AND abs(s.longitude - $lon) < $delta
        RETURN s
        """
        
        # Rough approximation: 1 degree ~ 111km
        delta = radius_km / 111.0
        
        results = neo4j_db.execute_query(query, {
            "lat": lat, "lon": lon, "delta": delta
        })
        return [Site(**dict(record["s"])) for record in results]

class BackgroundTaskCRUD(Neo4jCRUD):
    @staticmethod
    def create_task(task_data: CreateBackgroundTaskRequest) -> BackgroundTask:
        """Create a new background task."""
        task = BackgroundTask(**task_data.dict())
        result = Neo4jCRUD.create_node("BackgroundTask", task.dict())
        return BackgroundTask(**result)

    @staticmethod
    def get_task_by_id(task_id: str) -> Optional[BackgroundTask]:
        """Get a background task by its ID."""
        return Neo4jCRUD.get_node_by_id("BackgroundTask", task_id)

    @staticmethod
    def update_task_status(task_id: str, status: TaskStatus, result: Optional[Dict[str, Any]] = None) -> Optional[BackgroundTask]:
        """Update the status and result of a background task."""
        properties = {"status": status.value, "updated_at": datetime.utcnow()}
        if result:
            properties["result"] = json.dumps(result)
        return Neo4jCRUD.update_node("BackgroundTask", task_id, properties)

    @staticmethod
    def get_all_tasks(limit: int = 100) -> List[BackgroundTask]:
        """Get all background tasks."""
        return Neo4jCRUD.get_all_nodes("BackgroundTask", limit=limit)

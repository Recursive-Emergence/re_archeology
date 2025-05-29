"""
Initialize sample background tasks for development and testing.
Creates example tasks in different states to test the background task monitoring system.
"""

import os
import sys
import uuid
from datetime import datetime, timedelta
from typing import List, Dict
import random

# Add the backend to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))

from backend.core.neo4j_database import neo4j_db
from backend.utils.config import settings

# Sample background tasks for testing
SAMPLE_TASKS = [
    {
        "name": "LIDAR Data Processing - Amazonian Basin",
        "task_type": "data_processing",
        "status": "running",
        "progress": 67,
        "description": "Processing high-resolution LIDAR data for potential archaeological sites in the Amazonian Basin. Analyzing elevation patterns and vegetation anomalies.",
        "total_steps": 150,
        "current_step": 100,
        "estimated_duration": 3600,  # 1 hour
        "priority": "high"
    },
    {
        "name": "Satellite Image Analysis - Mayan Settlements",
        "task_type": "ai_analysis",
        "status": "completed",
        "progress": 100,
        "description": "Completed machine learning analysis of satellite imagery to identify potential Mayan settlement patterns in Guatemala.",
        "total_steps": 200,
        "current_step": 200,
        "estimated_duration": 7200,  # 2 hours
        "priority": "medium"
    },
    {
        "name": "Site Documentation - Petra Survey",
        "task_type": "documentation",
        "status": "pending",
        "progress": 0,
        "description": "Automated documentation generation for recent Petra archaeological survey data. Will compile reports and visualizations.",
        "total_steps": 50,
        "current_step": 0,
        "estimated_duration": 1800,  # 30 minutes
        "priority": "low"
    },
    {
        "name": "3D Model Reconstruction - Roman Villa",
        "task_type": "reconstruction",
        "status": "running",
        "progress": 23,
        "description": "Creating 3D reconstruction model of Roman villa remains using photogrammetry data and archaeological measurements.",
        "total_steps": 300,
        "current_step": 69,
        "estimated_duration": 10800,  # 3 hours
        "priority": "medium"
    },
    {
        "name": "Database Sync - European Heritage Sites",
        "task_type": "data_sync",
        "status": "failed",
        "progress": 45,
        "description": "Synchronizing European heritage site database. Failed due to API rate limiting. Will retry with adjusted parameters.",
        "total_steps": 100,
        "current_step": 45,
        "estimated_duration": 600,  # 10 minutes
        "priority": "high",
        "error_message": "API rate limit exceeded. Retry scheduled for next available window."
    },
    {
        "name": "Semantic Search Index Update",
        "task_type": "indexing",
        "status": "running",
        "progress": 89,
        "description": "Updating semantic search embeddings for all archaeological threads and research papers. Almost complete.",
        "total_steps": 1000,
        "current_step": 890,
        "estimated_duration": 1200,  # 20 minutes
        "priority": "medium"
    }
]

def create_background_task(task_data: Dict) -> str:
    """Create a single background task in Neo4j."""
    task_id = str(uuid.uuid4())
    
    # Calculate timestamps based on status
    created_at = datetime.utcnow()
    
    if task_data["status"] == "completed":
        started_at = created_at - timedelta(seconds=task_data["estimated_duration"])
        completed_at = created_at
        updated_at = completed_at
    elif task_data["status"] == "running":
        started_at = created_at - timedelta(seconds=task_data["estimated_duration"] * task_data["progress"] / 100)
        completed_at = None
        updated_at = created_at
    elif task_data["status"] == "failed":
        started_at = created_at - timedelta(seconds=task_data["estimated_duration"] * task_data["progress"] / 100)
        completed_at = None
        updated_at = created_at
    else:  # pending
        started_at = None
        completed_at = None
        updated_at = created_at
    
    query = """
    CREATE (bt:BackgroundTask {
        id: $id,
        name: $name,
        task_type: $task_type,
        status: $status,
        progress: $progress,
        description: $description,
        total_steps: $total_steps,
        current_step: $current_step,
        estimated_duration: $estimated_duration,
        priority: $priority,
        error_message: $error_message,
        created_at: datetime($created_at),
        started_at: CASE WHEN $started_at IS NOT NULL THEN datetime($started_at) ELSE NULL END,
        completed_at: CASE WHEN $completed_at IS NOT NULL THEN datetime($completed_at) ELSE NULL END,
        updated_at: datetime($updated_at)
    })
    RETURN bt.id as id
    """
    
    with neo4j_db.get_session() as session:
        result = session.run(query, {
            "id": task_id,
            "name": task_data["name"],
            "task_type": task_data["task_type"],
            "status": task_data["status"],
            "progress": task_data["progress"],
            "description": task_data["description"],
            "total_steps": task_data["total_steps"],
            "current_step": task_data["current_step"],
            "estimated_duration": task_data["estimated_duration"],
            "priority": task_data["priority"],
            "error_message": task_data.get("error_message"),
            "created_at": created_at.isoformat(),
            "started_at": started_at.isoformat() if started_at else None,
            "completed_at": completed_at.isoformat() if completed_at else None,
            "updated_at": updated_at.isoformat()
        })
        
        record = result.single()
        if record:
            return record["id"]
        else:
            raise Exception(f"Failed to create task: {task_data['name']}")

def check_existing_tasks() -> int:
    """Check how many background tasks already exist."""
    query = "MATCH (bt:BackgroundTask) RETURN count(bt) as count"
    
    with neo4j_db.get_session() as session:
        result = session.run(query)
        record = result.single()
        return record["count"] if record else 0

def initialize_sample_tasks(force_recreate: bool = False) -> None:
    """Initialize sample background tasks."""
    print("🔄 Initializing sample background tasks...")
    
    try:
        # Check existing tasks
        existing_count = check_existing_tasks()
        
        if existing_count > 0 and not force_recreate:
            print(f"⚠️  Found {existing_count} existing background tasks")
            print("Use --force to recreate tasks")
            return
        
        if force_recreate and existing_count > 0:
            # Delete existing tasks
            print("🗑️  Deleting existing background tasks...")
            with neo4j_db.get_session() as session:
                session.run("MATCH (bt:BackgroundTask) DETACH DELETE bt")
            print("✅ Existing tasks deleted")
        
        # Create new tasks
        created_count = 0
        for task_data in SAMPLE_TASKS:
            try:
                task_id = create_background_task(task_data)
                status_emoji = {
                    "pending": "⏳",
                    "running": "🏃",
                    "completed": "✅",
                    "failed": "❌"
                }
                emoji = status_emoji.get(task_data["status"], "❓")
                print(f"{emoji} Created task '{task_data['name'][:50]}...' ({task_data['status']}, {task_data['progress']}%)")
                created_count += 1
            except Exception as e:
                print(f"❌ Failed to create task '{task_data['name']}': {e}")
        
        print(f"\n🎉 Successfully created {created_count} sample background tasks!")
        
        # Show summary
        final_count = check_existing_tasks()
        print(f"📊 Total background tasks in database: {final_count}")
            
    except Exception as e:
        print(f"❌ Error initializing sample tasks: {e}")
        raise

def main():
    """Main execution function."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Initialize sample background tasks")
    parser.add_argument("--force", action="store_true", 
                       help="Force recreate tasks (deletes existing)")
    
    args = parser.parse_args()
    
    # Initialize database connection
    try:
        neo4j_db.connect()
        print("✅ Connected to Neo4j database")
    except Exception as e:
        print(f"❌ Failed to connect to Neo4j: {e}")
        return 1
    
    try:
        initialize_sample_tasks(force_recreate=args.force)
        return 0
    except Exception as e:
        print(f"❌ Script failed: {e}")
        return 1
    finally:
        neo4j_db.close()
        print("🔌 Database connection closed")

if __name__ == "__main__":
    exit(main())

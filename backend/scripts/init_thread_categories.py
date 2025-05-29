"""
Initialize default thread categories in Neo4j database.
This script should be run after database setup to create the standard category structure.
"""

import os
import sys
import uuid
from datetime import datetime
from typing import List, Dict

# Add the backend to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))

from backend.core.neo4j_database import neo4j_db
from backend.utils.config import settings

# Default thread categories configuration
DEFAULT_CATEGORIES = [
    {
        "name": "Maps",
        "description": "Discuss geographical visualizations, satellite imagery, LIDAR data, and interactive mapping projects. Share insights about spatial patterns and archaeological landscapes.",
        "icon": "map",
        "order_index": 1
    },
    {
        "name": "Researches",
        "description": "Academic discussions, research papers, methodology debates, and peer-reviewed archaeological studies. Share findings and collaborate on research projects.",
        "icon": "book",
        "order_index": 2
    },
    {
        "name": "Sites",
        "description": "Archaeological site discoveries, excavation reports, site documentation, and heritage preservation discussions. Share site-specific knowledge and findings.",
        "icon": "location",
        "order_index": 3
    },
    {
        "name": "RE Theory",
        "description": "Reverse Engineering archaeological theory, computational archaeology methods, AI-assisted analysis, and innovative approaches to understanding the past.",
        "icon": "cpu",
        "order_index": 4
    },
    {
        "name": "General Discussion",
        "description": "Open forum for general archaeological discussions, news, announcements, and community interactions that don't fit other categories.",
        "icon": "chat",
        "order_index": 5
    },
    {
        "name": "Data & Tools",
        "description": "Share datasets, software tools, APIs, and technical resources for archaeological research. Discuss data standards and analytical tools.",
        "icon": "database",
        "order_index": 6
    }
]

def create_thread_category(category_data: Dict) -> str:
    """Create a single thread category in Neo4j."""
    category_id = str(uuid.uuid4())
    timestamp = datetime.utcnow().isoformat()
    
    query = """
    CREATE (tc:ThreadCategory {
        id: $id,
        name: $name,
        description: $description,
        icon: $icon,
        order_index: $order_index,
        created_at: datetime($created_at)
    })
    RETURN tc.id as id
    """
    
    with neo4j_db.get_session() as session:
        result = session.run(query, {
            "id": category_id,
            "name": category_data["name"],
            "description": category_data["description"],
            "icon": category_data["icon"],
            "order_index": category_data["order_index"],
            "created_at": timestamp
        })
        
        record = result.single()
        if record:
            return record["id"]
        else:
            raise Exception(f"Failed to create category: {category_data['name']}")

def check_existing_categories() -> List[str]:
    """Check if categories already exist."""
    query = "MATCH (tc:ThreadCategory) RETURN tc.name as name"
    
    with neo4j_db.get_session() as session:
        result = session.run(query)
        return [record["name"] for record in result]

def initialize_thread_categories(force_recreate: bool = False) -> None:
    """Initialize default thread categories."""
    print("🔄 Initializing thread categories...")
    
    try:
        # Check existing categories
        existing_categories = check_existing_categories()
        
        if existing_categories and not force_recreate:
            print(f"⚠️  Found existing categories: {existing_categories}")
            print("Use --force to recreate categories")
            return
        
        if force_recreate and existing_categories:
            # Delete existing categories
            print("🗑️  Deleting existing categories...")
            with neo4j_db.get_session() as session:
                session.run("MATCH (tc:ThreadCategory) DETACH DELETE tc")
            print("✅ Existing categories deleted")
        
        # Create new categories
        created_count = 0
        for category_data in DEFAULT_CATEGORIES:
            try:
                category_id = create_thread_category(category_data)
                print(f"✅ Created category '{category_data['name']}' (ID: {category_id[:8]}...)")
                created_count += 1
            except Exception as e:
                print(f"❌ Failed to create category '{category_data['name']}': {e}")
        
        print(f"\n🎉 Successfully created {created_count} thread categories!")
        
        # Verify creation
        final_categories = check_existing_categories()
        print(f"📊 Total categories in database: {len(final_categories)}")
        for cat in final_categories:
            print(f"  - {cat}")
            
    except Exception as e:
        print(f"❌ Error initializing thread categories: {e}")
        raise

def main():
    """Main execution function."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Initialize default thread categories")
    parser.add_argument("--force", action="store_true", 
                       help="Force recreate categories (deletes existing)")
    
    args = parser.parse_args()
    
    # Initialize database connection
    try:
        neo4j_db.connect()
        print("✅ Connected to Neo4j database")
    except Exception as e:
        print(f"❌ Failed to connect to Neo4j: {e}")
        return 1
    
    try:
        initialize_thread_categories(force_recreate=args.force)
        return 0
    except Exception as e:
        print(f"❌ Script failed: {e}")
        return 1
    finally:
        neo4j_db.close()
        print("🔌 Database connection closed")

if __name__ == "__main__":
    exit(main())

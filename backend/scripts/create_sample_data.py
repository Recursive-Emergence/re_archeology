#!/usr/bin/env python3
"""
Initialize sample thread data for demonstration
"""

import asyncio
import sys
import os

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.core.neo4j_database import neo4j_db
from backend.models.ontology_models import Thread, ThreadComment
import uuid
from datetime import datetime

async def create_sample_threads():
    """Create sample threads and comments for demonstration"""
    
    # Get existing categories
    categories_query = "MATCH (tc:ThreadCategory) RETURN tc ORDER BY tc.order_index"
    result = await neo4j_db.execute_query(categories_query)
    categories = [dict(record['tc']) for record in result.records]
    
    if not categories:
        print("No categories found. Run the server first to initialize categories.")
        return
    
    print(f"Found {len(categories)} categories")
    
    # Create sample user if not exists
    user_query = """
    MERGE (u:User {id: $user_id})
    ON CREATE SET 
        u.name = $name,
        u.email = $email,
        u.created_at = datetime(),
        u.google_id = $google_id
    RETURN u
    """
    await neo4j_db.execute_query(user_query, 
        user_id="demo-user-1",
        name="Dr. Sarah Chen",
        email="sarah.chen@demo.org",
        google_id="demo-google-123"
    )
    
    await neo4j_db.execute_query(user_query, 
        user_id="demo-user-2", 
        name="Mike Rodriguez",
        email="mike.rodriguez@demo.org",
        google_id="demo-google-456"
    )
    
    # Sample threads data
    sample_threads = [
        {
            "category": "Maps",
            "title": "Amazon Basin LIDAR Analysis",
            "content": "Latest LIDAR data reveals new potential archaeological sites in the Amazon. Let's discuss the patterns and methodologies for analysis.",
            "starter": "demo-user-1"
        },
        {
            "category": "Sites", 
            "title": "Machu Picchu Water Management Systems",
            "content": "Exploring the sophisticated water management systems at Machu Picchu using reverse engineering approaches.",
            "starter": "demo-user-2"
        },
        {
            "category": "RE Theory",
            "title": "AI-Assisted Pattern Recognition in Archaeological Data",
            "content": "How can we leverage machine learning to identify patterns in archaeological datasets that humans might miss?",
            "starter": "demo-user-1"
        },
        {
            "category": "Researches",
            "title": "New Findings on Cahokia Settlement Patterns",
            "content": "Recent excavations and remote sensing reveal new insights into Cahokia's urban planning and social organization.",
            "starter": "demo-user-2"
        }
    ]
    
    # Find category by name
    def find_category_id(name):
        for cat in categories:
            if cat['name'] == name:
                return cat['id']
        return categories[0]['id']  # fallback to first category
    
    created_threads = []
    
    for thread_data in sample_threads:
        category_id = find_category_id(thread_data["category"])
        thread_id = str(uuid.uuid4())
        
        # Create thread
        thread_query = """
        MATCH (u:User {id: $user_id})
        MATCH (tc:ThreadCategory {id: $category_id})
        CREATE (t:Thread {
            id: $thread_id,
            title: $title,
            content: $content,
            starter_user_id: $user_id,
            category_id: $category_id,
            tags: $tags,
            created_at: datetime(),
            updated_at: datetime()
        })
        CREATE (u)-[:STARTED]->(t)
        CREATE (t)-[:BELONGS_TO]->(tc)
        RETURN t
        """
        
        await neo4j_db.execute_query(thread_query,
            thread_id=thread_id,
            title=thread_data["title"],
            content=thread_data["content"],
            user_id=thread_data["starter"],
            category_id=category_id,
            tags=[]
        )
        
        created_threads.append({
            "id": thread_id,
            "title": thread_data["title"],
            "category": thread_data["category"]
        })
        
        print(f"Created thread: {thread_data['title']}")
        
        # Add some sample comments
        comments = [
            {
                "author": "demo-user-2" if thread_data["starter"] == "demo-user-1" else "demo-user-1",
                "content": "This is a fascinating topic! I'd love to learn more about the methodology used."
            },
            {
                "author": thread_data["starter"],
                "content": "Thanks for the interest! Let me share some additional details about our approach..."
            }
        ]
        
        for comment_data in comments:
            comment_id = str(uuid.uuid4())
            comment_query = """
            MATCH (u:User {id: $user_id})
            MATCH (t:Thread {id: $thread_id})
            CREATE (c:ThreadComment {
                id: $comment_id,
                content: $content,
                author_id: $user_id,
                thread_id: $thread_id,
                created_at: datetime()
            })
            CREATE (u)-[:AUTHORED]->(c)
            CREATE (c)-[:COMMENTS_ON]->(t)
            RETURN c
            """
            
            await neo4j_db.execute_query(comment_query,
                comment_id=comment_id,
                content=comment_data["content"],
                user_id=comment_data["author"],
                thread_id=thread_id
            )
    
    print(f"\nCreated {len(created_threads)} sample threads with comments!")
    print("You can now test the application with real data.")
    
    return created_threads

async def main():
    """Main function to run the initialization"""
    try:
        print("Connecting to Neo4j...")
        neo4j_db.connect()
        print("Connected successfully!")
        
        await create_sample_threads()
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        neo4j_db.close()

if __name__ == "__main__":
    asyncio.run(main())

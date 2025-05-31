"""
Thread management API with categories and authentication.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from datetime import datetime
import neo4j.time

from backend.core.neo4j_database import neo4j_db
from backend.models.ontology_models import Thread, ThreadCategory, ThreadComment
from backend.api.routers.auth import get_current_user

router = APIRouter(prefix="/threads", tags=["threads"])

def convert_neo4j_datetime(dt):
    """Convert Neo4j DateTime to Python datetime."""
    if isinstance(dt, neo4j.time.DateTime):
        return dt.to_native()
    return dt

class CreateThreadRequest(BaseModel):
    title: str
    content: Optional[str] = None
    category_id: str
    tags: List[str] = []

class CreateCommentRequest(BaseModel):
    content: str
    parent_comment_id: Optional[str] = None

class ThreadResponse(BaseModel):
    id: str
    title: str
    content: Optional[str]
    category_id: str
    starter_user_id: str
    starter_user_name: str
    tags: List[str]
    created_at: datetime
    comment_count: int

class CommentResponse(BaseModel):
    id: str
    content: str
    author_id: str
    author_name: str
    thread_id: str
    parent_comment_id: Optional[str]
    created_at: datetime
    replies: List['CommentResponse'] = []

class CategoryResponse(BaseModel):
    id: str
    name: str
    description: str
    icon: Optional[str]
    order_index: int
    thread_count: int

# Initialize default categories
async def initialize_default_categories():
    """Initialize default thread categories if they don't exist."""
    default_categories = [
        {"name": "Maps", "description": "Geographic analysis and Earth Engine visualizations", "icon": "🗺️", "order": 1},
        {"name": "Researches", "description": "Academic papers, studies, and research discussions", "icon": "📚", "order": 2},
        {"name": "Sites", "description": "Archaeological sites and location discussions", "icon": "🏛️", "order": 3},
        {"name": "RE Theory", "description": "Theoretical discussions and methodology", "icon": "🧠", "order": 4},
        {"name": "General", "description": "General discussions and announcements", "icon": "💬", "order": 5}
    ]
    
    for cat in default_categories:
        check_query = "MATCH (tc:ThreadCategory {name: $name}) RETURN tc"
        result = await neo4j_db.execute_query(check_query, name=cat["name"])
        
        if not result.records:
            category = ThreadCategory(
                name=cat["name"],
                description=cat["description"],
                icon=cat["icon"],
                order_index=cat["order"]
            )
            
            create_query = """
            CREATE (tc:ThreadCategory {
                id: $id,
                name: $name,
                description: $description,
                icon: $icon,
                order_index: $order_index,
                created_at: datetime()
            })
            """
            await neo4j_db.execute_query(
                create_query,
                id=category.id,
                name=category.name,
                description=category.description,
                icon=category.icon,
                order_index=category.order_index
            )

@router.get("/categories", response_model=List[CategoryResponse])
async def get_thread_categories():
    """Get all thread categories with thread counts."""
    await initialize_default_categories()
    
    query = """
    MATCH (tc:ThreadCategory)
    OPTIONAL MATCH (t:Thread)-[:BELONGS_TO]->(tc)
    RETURN tc, count(t) as thread_count
    ORDER BY tc.order_index
    """
    result = await neo4j_db.execute_query(query)
    
    categories = []
    for record in result.records:
        tc_data = dict(record['tc'])
        categories.append(CategoryResponse(
            id=tc_data['id'],
            name=tc_data['name'],
            description=tc_data['description'],
            icon=tc_data.get('icon'),
            order_index=tc_data['order_index'],
            thread_count=record['thread_count']
        ))
    
    return categories

@router.post("/", response_model=ThreadResponse)
async def create_thread(
    request: CreateThreadRequest,
    current_user: dict = Depends(get_current_user)
):
    """Create a new thread (requires authentication)."""
    # Verify category exists
    cat_query = "MATCH (tc:ThreadCategory {id: $category_id}) RETURN tc"
    cat_result = await neo4j_db.execute_query(cat_query, category_id=request.category_id)
    
    if not cat_result.records:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Thread category not found"
        )
    
    # Create thread
    thread = Thread(
        title=request.title,
        content=request.content,
        starter_user_id=current_user['user_id'],
        category_id=request.category_id,
        tags=request.tags
    )
    
    create_query = """
    MATCH (u:User {id: $user_id})
    MATCH (tc:ThreadCategory {id: $category_id})
    CREATE (t:Thread {
        id: $id,
        title: $title,
        content: $content,
        starter_user_id: $starter_user_id,
        category_id: $category_id,
        tags: $tags,
        created_at: datetime()
    })
    CREATE (t)-[:BELONGS_TO]->(tc)
    CREATE (u)-[:STARTED]->(t)
    RETURN t, u.name as starter_name
    """
    
    result = await neo4j_db.execute_query(
        create_query,
        user_id=current_user['user_id'],
        category_id=request.category_id,
        id=thread.id,
        title=thread.title,
        content=thread.content,
        starter_user_id=thread.starter_user_id,
        tags=thread.tags
    )
    
    thread_data = dict(result.records[0]['t'])
    starter_name = result.records[0]['starter_name']
    
    return ThreadResponse(
        id=thread_data['id'],
        title=thread_data['title'],
        content=thread_data.get('content'),
        category_id=thread_data['category_id'],
        starter_user_id=thread_data['starter_user_id'],
        starter_user_name=starter_name,
        tags=thread_data['tags'],
        created_at=convert_neo4j_datetime(thread_data['created_at']),
        comment_count=0
    )

@router.get("/category/{category_id}", response_model=List[ThreadResponse])
async def get_threads_by_category(category_id: str, skip: int = 0, limit: int = 20):
    """Get threads by category with pagination."""
    query = """
    MATCH (t:Thread)-[:BELONGS_TO]->(tc:ThreadCategory {id: $category_id})
    MATCH (u:User)-[:STARTED]->(t)
    OPTIONAL MATCH (c:ThreadComment)-[:COMMENTS_ON]->(t)
    RETURN t, u.name as starter_name, count(c) as comment_count
    ORDER BY t.created_at DESC
    SKIP $skip LIMIT $limit
    """
    
    result = await neo4j_db.execute_query(
        query, 
        category_id=category_id, 
        skip=skip, 
        limit=limit
    )
    
    threads = []
    for record in result.records:
        t_data = dict(record['t'])
        
        threads.append(ThreadResponse(
            id=t_data['id'],
            title=t_data['title'],
            content=t_data.get('content'),
            category_id=t_data['category_id'],
            starter_user_id=t_data['starter_user_id'],
            starter_user_name=record['starter_name'],
            tags=t_data['tags'],
            created_at=convert_neo4j_datetime(t_data['created_at']),
            comment_count=record['comment_count']
        ))
    
    return threads

@router.post("/{thread_id}/comments", response_model=CommentResponse)
async def add_comment(
    thread_id: str,
    request: CreateCommentRequest,
    current_user: dict = Depends(get_current_user)
):
    """Add a comment to a thread (requires authentication)."""
    # Verify thread exists
    thread_query = "MATCH (t:Thread {id: $thread_id}) RETURN t"
    thread_result = await neo4j_db.execute_query(thread_query, thread_id=thread_id)
    
    if not thread_result.records:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Thread not found"
        )
    
    # Create comment
    comment = ThreadComment(
        content=request.content,
        author_id=current_user['user_id'],
        thread_id=thread_id,
        parent_comment_id=request.parent_comment_id
    )
    
    create_query = """
    MATCH (u:User {id: $author_id})
    MATCH (t:Thread {id: $thread_id})
    CREATE (c:ThreadComment {
        id: $id,
        content: $content,
        author_id: $author_id,
        thread_id: $thread_id,
        parent_comment_id: $parent_comment_id,
        created_at: datetime()
    })
    CREATE (c)-[:COMMENTS_ON]->(t)
    CREATE (u)-[:AUTHORED]->(c)
    RETURN c, u.name as author_name
    """
    
    result = await neo4j_db.execute_query(
        create_query,
        author_id=current_user['user_id'],
        thread_id=thread_id,
        id=comment.id,
        content=comment.content,
        parent_comment_id=comment.parent_comment_id
    )
    
    comment_data = dict(result.records[0]['c'])
    author_name = result.records[0]['author_name']
    
    return CommentResponse(
        id=comment_data['id'],
        content=comment_data['content'],
        author_id=comment_data['author_id'],
        author_name=author_name,
        thread_id=comment_data['thread_id'],
        parent_comment_id=comment_data.get('parent_comment_id'),
        created_at=convert_neo4j_datetime(comment_data['created_at'])
    )

@router.get("/{thread_id}/comments", response_model=List[CommentResponse])
async def get_thread_comments(thread_id: str):
    """Get all comments for a thread."""
    query = """
    MATCH (c:ThreadComment)-[:COMMENTS_ON]->(t:Thread {id: $thread_id})
    MATCH (u:User)-[:AUTHORED]->(c)
    RETURN c, u.name as author_name
    ORDER BY c.created_at ASC
    """
    
    result = await neo4j_db.execute_query(query, thread_id=thread_id)
    
    comments = []
    for record in result.records:
        c_data = dict(record['c'])
            
        comments.append(CommentResponse(
            id=c_data['id'],
            content=c_data['content'],
            author_id=c_data['author_id'],
            author_name=record['author_name'],
            thread_id=c_data['thread_id'],
            parent_comment_id=c_data.get('parent_comment_id'),
            created_at=convert_neo4j_datetime(c_data['created_at'])
        ))
    
    return comments

# Update CommentResponse to handle self-references
CommentResponse.model_rebuild()

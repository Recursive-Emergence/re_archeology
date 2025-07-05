"""
OpenAI Chat and Semantic Search API with authentication.
Enhanced with task management capabilities for administrators.
"""
import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
import openai
import numpy as np
import json
import os
import uuid
import asyncio
from datetime import datetime, timezone
from pathlib import Path
import glob
import threading
import time
# SentenceTransformer is imported conditionally later in the code

from backend.core.neo4j_database import neo4j_db
from backend.models.ontology_models import SearchEmbedding, EntityType
from backend.api.routers.auth import get_current_user
from backend.utils.config import get_settings
# Import task management functions from tasks router
from backend.api.routers.tasks import load_existing_tasks, calculate_task_decay
# Import discovery manager for websocket notifications
from backend.api.routers.discovery_connections import discovery_manager

# Configure logging
logger = logging.getLogger(__name__)

settings = get_settings()
router = APIRouter(prefix="/ai", tags=["ai"])

# Task management paths and globals
TASKS_DATA_PATH = Path(__file__).parent.parent.parent.parent / "data" / "tasks"
USERS_PATH = Path(__file__).parent.parent.parent.parent / "users"
ADMINS_FILE = USERS_PATH / "admins.json"

# Global task monitoring state
task_monitor_active = False
task_monitor_thread = None
active_tasks_cache = {}
broadcast_queue = []

def add_broadcast(message: str):
    """Add a message to the broadcast queue"""
    global broadcast_queue
    broadcast_item = {
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    broadcast_queue.append(broadcast_item)
    # Keep only last 20 broadcasts
    if len(broadcast_queue) > 20:
        broadcast_queue.pop(0)

# Initialize sentence transformer for local embeddings (optional fallback)
# Use lazy loading to avoid downloading models unless actually needed
embedding_model = None
SEMANTIC_SEARCH_ENABLED = False

def get_embedding_model():
    """Lazy load the embedding model only when needed"""
    global embedding_model, SEMANTIC_SEARCH_ENABLED
    if embedding_model is None and not SEMANTIC_SEARCH_ENABLED:
        try:
            # Import is done inside function to handle case when package is not installed
            from sentence_transformers import SentenceTransformer
            # Only actually load the model when this function is called, not on import
            embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
            SEMANTIC_SEARCH_ENABLED = True
            logger.info("✅ Semantic search model loaded successfully")
        except Exception as e:
            embedding_model = None
            SEMANTIC_SEARCH_ENABLED = False
            logger.warning(f"WARNING: Semantic search dependencies not available: {e}")
    return embedding_model

class ChatMessage(BaseModel):
    role: str  # "user", "assistant", "system"
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    include_search: bool = True
    search_query: Optional[str] = None

class ChatResponse(BaseModel):
    message: ChatMessage
    search_results: Optional[List[Dict[str, Any]]] = None
    tokens_used: Optional[int] = None

class SearchRequest(BaseModel):
    query: str
    entity_types: Optional[List[str]] = None
    limit: int = 10

class SearchResult(BaseModel):
    entity_id: str
    entity_type: str
    content: str
    similarity_score: float
    metadata: Dict[str, Any]

class EmbeddingRequest(BaseModel):
    content: str
    entity_type: str
    entity_id: str

class SimpleChatRequest(BaseModel):
    message: str
    context: Optional[Dict[str, Any]] = None

class SimpleChatResponse(BaseModel):
    response: str
    tokens_used: Optional[int] = None

# Task management data models
class TaskCommand(BaseModel):
    action: str  # "start", "pause", "resume", "abort", "restart", "status"
    task_id: Optional[str] = None
    coordinates: Optional[List[float]] = None
    range_km: Optional[Dict[str, float]] = None
    profiles: Optional[List[str]] = None

class TaskResponse(BaseModel):
    success: bool
    message: str
    task_id: Optional[str] = None
    data: Optional[Dict[str, Any]] = None

async def get_openai_embedding(text: str) -> List[float]:
    """Generate embedding using OpenAI API."""
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        
        response = await client.embeddings.create(
            model=settings.OPENAI_EMBEDDING_MODEL,
            input=text
        )
        return response.data[0].embedding
    except Exception as e:
        # Fallback to local model if available
        local_model = get_embedding_model()
        if local_model:
            return local_model.encode(text).tolist()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate embedding: {str(e)}"
        )

async def search_similar_content(query: str, entity_types: Optional[List[str]] = None, limit: int = 10) -> List[SearchResult]:
    """Search for similar content using embeddings."""
    # Generate embedding for query
    query_embedding = await get_openai_embedding(query)
    
    # Build Cypher query for similarity search
    where_clause = ""
    if entity_types:
        entity_types_str = "', '".join(entity_types)
        where_clause = f"WHERE se.entity_type IN ['{entity_types_str}']"
    
    # Note: This is a simplified version. In production, you'd use a vector database
    # For now, we'll fetch all embeddings and compute similarity in Python
    fetch_query = f"""
    MATCH (se:SearchEmbedding)
    {where_clause}
    RETURN se
    LIMIT 1000
    """
    
    result = await neo4j_db.execute_query(fetch_query)
    
    similarities = []
    for record in result.records:
        se_data = dict(record['se'])
        stored_embedding = se_data['embedding_vector']
        
        # Calculate cosine similarity
        similarity = np.dot(query_embedding, stored_embedding) / (
            np.linalg.norm(query_embedding) * np.linalg.norm(stored_embedding)
        )
        
        similarities.append({
            'similarity': similarity,
            'entity_id': se_data['entity_id'],
            'entity_type': se_data['entity_type'],
            'content': se_data['content']
        })
    
    # Sort by similarity and return top results
    similarities.sort(key=lambda x: x['similarity'], reverse=True)
    
    search_results = []
    for item in similarities[:limit]:
        # Fetch additional metadata based on entity type
        metadata = await get_entity_metadata(item['entity_type'], item['entity_id'])
        
        search_results.append(SearchResult(
            entity_id=item['entity_id'],
            entity_type=item['entity_type'],
            content=item['content'],
            similarity_score=item['similarity'],
            metadata=metadata
        ))
    
    return search_results

async def get_entity_metadata(entity_type: str, entity_id: str) -> Dict[str, Any]:
    """Get metadata for an entity based on its type."""
    if entity_type == "thread":
        query = """
        MATCH (t:Thread {id: $entity_id})
        MATCH (u:User)-[:STARTED]->(t)
        MATCH (tc:ThreadCategory)<-[:BELONGS_TO]-(t)
        RETURN t.title as title, u.name as author, tc.name as category, t.created_at as created_at
        """
    elif entity_type == "site":
        query = """
        MATCH (s:Site {id: $entity_id})
        RETURN s.name as title, s.latitude as latitude, s.longitude as longitude, s.status as status
        """
    elif entity_type == "research":
        query = """
        MATCH (r:Research {id: $entity_id})
        RETURN r.title as title, r.source_url as source, r.type as type
        """
    elif entity_type == "narrative":
        query = """
        MATCH (n:Narrative {id: $entity_id})
        RETURN n.title as title, n.language as language, n.source_reference as source
        """
    else:
        return {}
    
    result = await neo4j_db.execute_query(query, entity_id=entity_id)
    
    if result.records:
        return dict(result.records[0])
    return {}

@router.post("/chat", response_model=ChatResponse)
async def chat_with_ai(
    request: ChatRequest,
    current_user: dict = Depends(get_current_user)
):
    """Chat with AI assistant with optional search enhancement."""
    search_results = None
    
    # Perform search if requested
    if request.include_search:
        search_query = request.search_query or request.messages[-1].content
        search_results = await search_similar_content(search_query)
        
        # Add search context to system message
        if search_results:
            search_context = "\n\n".join([
                f"Relevant content from {result.entity_type}: {result.content}"
                for result in search_results[:3]  # Include top 3 results
            ])
            
            system_message = f"""You are an AI assistant for the RE-Archaeology framework. 
            Use the following relevant context from the database to inform your response:
            
            {search_context}
            
            Provide helpful, accurate responses based on this context and your knowledge."""
            
            # Insert or update system message
            messages = [ChatMessage(role="system", content=system_message)] + request.messages
        else:
            messages = request.messages
    else:
        messages = request.messages
    
    try:
        # Convert to OpenAI format
        openai_messages = [{"role": msg.role, "content": msg.content} for msg in messages]
        
        # Call OpenAI API using new client format
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=openai_messages,
            max_tokens=300,  # Reduced from 1000
            temperature=0.7
        )
        
        assistant_message = ChatMessage(
            role="assistant",
            content=response.choices[0].message.content
        )
        
        return ChatResponse(
            message=assistant_message,
            search_results=[result.dict() for result in search_results] if search_results else None,
            tokens_used=response.usage.total_tokens
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI chat failed: {str(e)}"
        )

@router.post("/search", response_model=List[SearchResult])
async def semantic_search(request: SearchRequest):
    """Perform semantic search across entities."""
    if not SEMANTIC_SEARCH_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Semantic search is not enabled. Install the required dependencies first."
        )
        
    return await search_similar_content(
        request.query, 
        request.entity_types, 
        request.limit
    )

@router.post("/embeddings/generate")
async def generate_embedding(
    request: EmbeddingRequest,
    current_user: dict = Depends(get_current_user)
):
    """Generate and store embedding for content."""
    if not SEMANTIC_SEARCH_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Semantic search is not enabled. Install the required dependencies first."
        )
        
    # Generate embedding
    embedding_vector = await get_openai_embedding(request.content)
    
    # Create SearchEmbedding object
    search_embedding = SearchEmbedding(
        content=request.content,
        embedding_vector=embedding_vector,
        entity_type=EntityType(request.entity_type),
        entity_id=request.entity_id
    )
    
    # Store in Neo4j
    create_query = """
    CREATE (se:SearchEmbedding {
        id: $id,
        content: $content,
        embedding_vector: $embedding_vector,
        entity_type: $entity_type,
        entity_id: $entity_id,
        created_at: datetime()
    })
    """
    
    await neo4j_db.execute_query(
        create_query,
        id=search_embedding.id,
        content=search_embedding.content,
        embedding_vector=search_embedding.embedding_vector,
        entity_type=search_embedding.entity_type.value,
        entity_id=search_embedding.entity_id
    )
    
    return {"message": "Embedding generated and stored successfully", "embedding_id": search_embedding.id}

@router.post("/embeddings/batch-generate")
async def batch_generate_embeddings(
    current_user: dict = Depends(get_current_user)
):
    """Generate embeddings for existing content that doesn't have them."""
    # Find threads without embeddings
    thread_query = """
    MATCH (t:Thread)
    WHERE NOT EXISTS {
        MATCH (se:SearchEmbedding {entity_type: 'thread', entity_id: t.id})
    }
    RETURN t.id as id, t.title + ' ' + COALESCE(t.content, '') as content
    LIMIT 50
    """
    
    result = await neo4j_db.execute_query(thread_query)
    
    count = 0
    for record in result.records:
        try:
            embedding_vector = await get_openai_embedding(record['content'])
            
            search_embedding = SearchEmbedding(
                content=record['content'],
                embedding_vector=embedding_vector,
                entity_type=EntityType.THREAD,
                entity_id=record['id']
            )
            
            create_query = """
            CREATE (se:SearchEmbedding {
                id: $id,
                content: $content,
                embedding_vector: $embedding_vector,
                entity_type: $entity_type,
                entity_id: $entity_id,
                created_at: datetime()
            })
            """
            
            await neo4j_db.execute_query(
                create_query,
                id=search_embedding.id,
                content=search_embedding.content,
                embedding_vector=search_embedding.embedding_vector,
                entity_type=search_embedding.entity_type.value,
                entity_id=search_embedding.entity_id
            )
            
            count += 1
            
        except Exception as e:
            print(f"Failed to generate embedding for thread {record['id']}: {e}")
            continue
    
    return {"message": f"Generated embeddings for {count} items"}

@router.post("/message", response_model=SimpleChatResponse)
async def simple_chat(
    request: SimpleChatRequest
):
    """Enhanced chat endpoint for Bella AI assistant with admin task management."""
    try:
        message = request.message.strip()
        user_email = "isaac.mao@gmail.com"  # Default to admin for testing
        is_user_admin = is_admin(user_email)
        
        # Check for task management commands (admin only)
        task_command = None
        task_response = None
        
        if is_user_admin:
            task_command = await llm_parse_task_command(message, user_email)
            if task_command:
                task_response = execute_task_command(task_command, user_email)
        
        # Generate response text
        response_text = ""
        command_json = None
        
        if task_response:
            # Task command was executed - generate intelligent response
            response_text = await generate_command_response(task_command, task_response, message)
            
            # Prepare JSON command output for frontend
            command_json = {
                "command_type": "task_management",
                "action": task_command.action,
                "success": task_response.success,
                "task_id": task_response.task_id,
                "data": task_response.data
            }
            
            # Add JSON to response only for admin users
            if task_response.success and is_user_admin:
                response_text += f"\n\n```json\n{json.dumps(command_json, indent=2)}\n```"
            
        else:
            # Regular chat response - use LLM for intelligent responses
            response_text = await generate_intelligent_chat_response(message, request.context, is_user_admin)
        
        return SimpleChatResponse(
            response=response_text,
            tokens_used=None
        )
        
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        return SimpleChatResponse(
            response="I'm having some technical difficulties, but I'm excited to help you explore archaeological mysteries! Please try asking me about scanning, discoveries, or any archaeological topics you're curious about.",
            tokens_used=None
        )

@router.get("/broadcasts")
async def get_task_broadcasts(
    current_user: dict = Depends(get_current_user)
):
    """Get recent task broadcasts for live users"""
    try:
        return {
            "broadcasts": broadcast_queue,
            "active_tasks": len(active_tasks_cache),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Error getting broadcasts: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get broadcasts"
        )

@router.post("/admin/task-command")
async def admin_task_command(
    command: TaskCommand,
    current_user: dict = Depends(get_current_user)
):
    """Direct admin endpoint for task commands (alternative to chat interface)"""
    user_email = current_user.get('email', '')
    
    if not is_admin(user_email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required"
        )
    
    try:
        response = execute_task_command(command, user_email)
        return response
    except Exception as e:
        logger.error(f"Error executing admin command: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to execute command: {str(e)}"
        )

def get_geographic_region(lat: float, lon: float) -> str:
    """Determine geographic region based on coordinates."""
    if lat is None or lon is None:
        return "an unknown location"
    
    # Amazon Basin (rough boundaries)
    if -10 <= lat <= 5 and -80 <= lon <= -50:
        return "the Amazon rainforest region"
    
    # Mediterranean
    elif 30 <= lat <= 45 and -10 <= lon <= 40:
        return "the Mediterranean region"
    
    # Egypt/Middle East
    elif 20 <= lat <= 35 and 25 <= lon <= 50:
        return "the Middle East/Egypt region"
    
    # Central America/Maya region
    elif 10 <= lat <= 25 and -95 <= lon <= -75:
        return "Central America (Maya region)"
    
    # Peru/Andes
    elif -20 <= lat <= 0 and -85 <= lon <= -65:
        return "the Andean region of Peru/Bolivia"
    
    # Europe
    elif 35 <= lat <= 70 and -15 <= lon <= 40:
        return "Europe"
    
    # North America
    elif 25 <= lat <= 70 and -170 <= lon <= -50:
        return "North America"
    
    # Asia
    elif 10 <= lat <= 70 and 60 <= lon <= 180:
        return "Asia"
    
    # Africa
    elif -35 <= lat <= 35 and -20 <= lon <= 50:
        return "Africa"
    
    # Australia/Oceania
    elif -50 <= lat <= -10 and 110 <= lon <= 180:
        return "Australia/Oceania"
    
    else:
        return f"coordinates {lat:.2f}, {lon:.2f}"

# Admin validation functions
def load_admins() -> List[str]:
    """Load admin email list from admins.json"""
    try:
        with open(ADMINS_FILE, 'r') as f:
            data = json.load(f)
            return data.get('admins', [])
    except Exception as e:
        logger.error(f"Error loading admins: {e}")
        return []

def is_admin(user_email: str) -> bool:
    """Check if user is an admin"""
    admin_emails = load_admins()
    return user_email in admin_emails

# Use the proper task loading function from tasks router
def get_all_tasks() -> List[Dict[str, Any]]:
    """Get all tasks - wrapper around load_existing_tasks"""
    return load_existing_tasks()

def load_task_data(task_id: str) -> Optional[Dict[str, Any]]:
    """Load task data directly from file for a specific task ID"""
    try:
        # Find the task file directly
        task_files = glob.glob(str(TASKS_DATA_PATH / f"{task_id}-*.json"))
        if not task_files:
            return None
        
        # Sort by filename (date) to get the most recent
        task_files.sort(reverse=True)
        
        with open(task_files[0], 'r') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading task {task_id}: {e}")
        return None

def save_task_data(task_data: Dict[str, Any]) -> bool:
    """Save task data to JSON file (update existing file)"""
    try:
        task_id = task_data['id']
        
        # Find the existing task file
        task_files = glob.glob(str(TASKS_DATA_PATH / f"{task_id}-*.json"))
        
        if task_files:
            # Update the most recent existing file
            task_files.sort(reverse=True)
            filepath = Path(task_files[0])
        else:
            # Create new file with today's date
            date_str = datetime.now().strftime("%Y-%m-%d")
            filename = f"{task_id}-{date_str}.json"
            filepath = TASKS_DATA_PATH / filename
        
        # Ensure directory exists
        TASKS_DATA_PATH.mkdir(parents=True, exist_ok=True)
        
        # Update the updated_at timestamp
        task_data['updated_at'] = datetime.now(timezone.utc).isoformat()
        
        with open(filepath, 'w') as f:
            json.dump(task_data, f, indent=2)
        
        logger.info(f"✅ Updated task file: {filepath}")
        return True
    except Exception as e:
        logger.error(f"Error saving task data: {e}")
        return False

def update_task_status(task_id: str, new_status: str, error_message: str = None) -> bool:
    """Update task status and save to file"""
    try:
        # Load existing task data
        task_data = load_task_data(task_id)
        if not task_data:
            logger.error(f"Task {task_id} not found for status update")
            return False
        
        # Update status and timestamp
        old_status = task_data.get('status', 'unknown')
        task_data['status'] = new_status
        task_data['updated_at'] = datetime.now(timezone.utc).isoformat()
        
        logger.info(f"🔄 Updating task {task_id}: {old_status} → {new_status}")
        
        if error_message:
            task_data['error_message'] = error_message
        elif new_status == 'running':
            # Clear error message when restarting
            task_data['error_message'] = ""
        
        if new_status in ['completed', 'aborted']:
            task_data['completed_at'] = datetime.now(timezone.utc).isoformat()
        
        # Save updated task data
        success = save_task_data(task_data)
        if success:
            logger.info(f"✅ Successfully updated task {task_id} status: {old_status} → {new_status}")
            # Verify the update by reloading
            verify_task = load_task_data(task_id)
            if verify_task and verify_task.get('status') == new_status:
                logger.info(f"✅ Verified task {task_id} status update: {verify_task.get('status')}")
            else:
                logger.error(f"❌ Status verification failed for task {task_id}: expected {new_status}, got {verify_task.get('status') if verify_task else 'None'}")
        else:
            logger.error(f"❌ Failed to save task {task_id} status update")
        
        return success
        
    except Exception as e:
        logger.error(f"Error updating task status: {e}")
        return False

def execute_task_command(command: TaskCommand, user_email: str) -> TaskResponse:
    """Execute a task management command"""
    try:
        if command.action == "start":
            if not command.coordinates or not command.range_km:
                return TaskResponse(
                    success=False,
                    message="Missing coordinates or range for new task"
                )
            
            task_data = create_new_task(
                command.coordinates,
                command.range_km,
                command.profiles or ["default_windmill"],
                user_email
            )
            
            if save_task_data(task_data):
                # Add to active tasks cache
                active_tasks_cache[task_data['id']] = task_data
                
                return TaskResponse(
                    success=True,
                    message=f"New scanning task started at coordinates {command.coordinates}",
                    task_id=task_data['id'],
                    data=task_data
                )
            else:
                return TaskResponse(
                    success=False,
                    message="Failed to create task"
                )
        
        elif command.action == "pause":
            if not command.task_id:
                return TaskResponse(success=False, message="Task ID required for pause")
            
            if update_task_status(command.task_id, "paused"):
                # Actually pause the underlying sessions
                try:
                    asyncio.create_task(pause_task_sessions(command.task_id))
                    logger.info(f"Paused sessions for task {command.task_id}")
                except Exception as e:
                    logger.error(f"Failed to pause sessions: {e}")
                
                # Send websocket notification
                try:
                    asyncio.create_task(discovery_manager.send_message({
                        "type": "task_paused",
                        "task_id": command.task_id,
                        "message": f"Task {command.task_id[:8]} paused by administrator"
                    }))
                except Exception as e:
                    logger.error(f"Failed to send websocket notification: {e}")
                
                add_broadcast(f"⏸️ Task {command.task_id[:8]} paused by administrator")
                return TaskResponse(
                    success=True,
                    message=f"Task {command.task_id} paused successfully",
                    task_id=command.task_id
                )
            else:
                return TaskResponse(
                    success=False,
                    message=f"Failed to pause task {command.task_id}"
                )
        
        elif command.action == "resume":
            if not command.task_id:
                return TaskResponse(success=False, message="Task ID required for resume")
            
            if update_task_status(command.task_id, "running"):
                # Actually resume the underlying sessions
                try:
                    asyncio.create_task(resume_task_sessions(command.task_id))
                    logger.info(f"Resumed sessions for task {command.task_id}")
                except Exception as e:
                    logger.error(f"Failed to resume sessions: {e}")
                
                add_broadcast(f"▶️ Task {command.task_id[:8]} resumed by administrator")
                return TaskResponse(
                    success=True,
                    message=f"Task {command.task_id} resumed successfully",
                    task_id=command.task_id
                )
            else:
                return TaskResponse(
                    success=False,
                    message=f"Failed to resume task {command.task_id}"
                )
        
        elif command.action == "resume":
            if not command.task_id:
                return TaskResponse(success=False, message="Task ID required for resume")
            
            if update_task_status(command.task_id, "running"):
                # Actually resume the underlying sessions
                try:
                    asyncio.create_task(resume_task_sessions(command.task_id))
                    logger.info(f"Resumed sessions for task {command.task_id}")
                except Exception as e:
                    logger.error(f"Failed to resume sessions: {e}")
                
                # Send websocket notification
                try:
                    asyncio.create_task(discovery_manager.send_message({
                        "type": "task_resumed",
                        "task_id": command.task_id,
                        "message": f"Task {command.task_id[:8]} resumed by administrator"
                    }))
                except Exception as e:
                    logger.error(f"Failed to send websocket notification: {e}")
                
                add_broadcast(f"▶️ Task {command.task_id[:8]} resumed by administrator")
                return TaskResponse(
                    success=True,
                    message=f"Task {command.task_id} resumed successfully",
                    task_id=command.task_id
                )
            else:
                return TaskResponse(
                    success=False,
                    message=f"Failed to resume task {command.task_id}"
                )
        
        elif command.action == "abort":
            if not command.task_id:
                return TaskResponse(success=False, message="Task ID required for abort")
            
            if update_task_status(command.task_id, "aborted", "Aborted by administrator"):
                # Actually stop the underlying sessions
                try:
                    asyncio.create_task(stop_task_sessions(command.task_id))
                    logger.info(f"Stopped sessions for task {command.task_id}")
                except Exception as e:
                    logger.error(f"Failed to stop sessions: {e}")
                
                # Send websocket notification
                try:
                    asyncio.create_task(discovery_manager.send_message({
                        "type": "task_aborted",
                        "task_id": command.task_id,
                        "message": f"Task {command.task_id[:8]} aborted by administrator"
                    }))
                except Exception as e:
                    logger.error(f"Failed to send websocket notification: {e}")
                
                # Remove from active tasks cache
                active_tasks_cache.pop(command.task_id, None)
                
                add_broadcast(f"🛑 Task {command.task_id[:8]} aborted by administrator")
                return TaskResponse(
                    success=True,
                    message=f"Task {command.task_id} aborted successfully",
                    task_id=command.task_id
                )
            else:
                return TaskResponse(
                    success=False,
                    message=f"Failed to abort task {command.task_id}"
                )
        
        elif command.action == "status":
            if command.task_id:
                task_data = load_task_data(command.task_id)
                if task_data:
                    return TaskResponse(
                        success=True,
                        message=f"Task {command.task_id} status: {task_data['status']}",
                        data=task_data
                    )
                else:
                    return TaskResponse(
                        success=False,
                        message=f"Task {command.task_id} not found"
                    )
            else:
                # Return all tasks summary
                all_tasks = get_all_tasks()
                running_tasks = [t for t in all_tasks if t['status'] == 'running']
                paused_tasks = [t for t in all_tasks if t['status'] == 'paused']
                
                return TaskResponse(
                    success=True,
                    message=f"System status: {len(running_tasks)} running, {len(paused_tasks)} paused tasks",
                    data={
                        "running_tasks": len(running_tasks),
                        "paused_tasks": len(paused_tasks),
                        "total_tasks": len(all_tasks),
                        "tasks": all_tasks
                    }
                )
        
        elif command.action == "restart":
            if not command.task_id:
                return TaskResponse(success=False, message="Task ID required for restart")
            
            # Load task data to get original parameters
            task_data = load_task_data(command.task_id)
            if not task_data:
                return TaskResponse(
                    success=False,
                    message=f"Task {command.task_id} not found"
                )
            
            # Update task status and other fields together
            task_data['status'] = "running"
            task_data['updated_at'] = datetime.now(timezone.utc).isoformat()
            task_data['error_message'] = "Restarted by administrator"
            task_data['completed_at'] = None  # Clear completion time
            task_data['findings'] = 0
            task_data['progress'] = 0
            task_data['restart_count'] = task_data.get('restart_count', 0) + 1
            
            # Save the updated task data
            if save_task_data(task_data):
                # Actually restart the underlying sessions
                try:
                    asyncio.create_task(restart_task_sessions(command.task_id))
                    logger.info(f"Restarted sessions for task {command.task_id}")
                except Exception as e:
                    logger.error(f"Failed to restart sessions: {e}")
                
                add_broadcast(f"📄 Task {command.task_id[:8]} restarted by administrator")
                return TaskResponse(
                    success=True,
                    task_id=command.task_id,
                    message=f"Task {command.task_id} restarted successfully"
                )
            else:
                return TaskResponse(
                    success=False,
                    message=f"Failed to restart task {command.task_id}"
                )
        
        else:
            return TaskResponse(
                success=False,
                message=f"Unknown command: {command.action}"
            )
            
    except Exception as e:
        logger.error(f"Error executing task command: {e}")
        return TaskResponse(
            success=False,
            message=f"Error executing command: {str(e)}"
        )

async def pause_task_sessions(task_id: str):
    """
    Pause all active sessions related to a task
    
    Args:
        task_id: Task ID to pause sessions for
    """
    try:
        from .discovery_sessions import active_sessions
        
        # Find sessions that belong to this task
        sessions_to_pause = []
        for session_id, session_info in active_sessions.items():
            if session_info.get("task_id") == task_id:
                sessions_to_pause.append(session_id)
        
        if not sessions_to_pause:
            logger.info(f"No active sessions found for task {task_id}")
            return
        
        # Pause each session
        for session_id in sessions_to_pause:
            session_info = active_sessions[session_id]
            session_info["status"] = "paused"
            session_info["is_paused"] = True
            logger.info(f"Paused session {session_id} for task {task_id}")
            
            # Send websocket notification about session pause
            try:
                from .discovery_connections import discovery_manager
                await discovery_manager.send_message({
                    "type": "session_paused",
                    "session_id": session_id,
                    "task_id": task_id,
                    "message": f"Scanning session paused for task {task_id[:8]}",
                    "timestamp": datetime.now().isoformat()
                })
            except Exception as e:
                logger.error(f"Failed to send session pause notification: {e}")
        
        logger.info(f"Successfully paused {len(sessions_to_pause)} sessions for task {task_id}")
        
    except Exception as e:
        logger.error(f"Error pausing sessions for task {task_id}: {e}")

async def resume_task_sessions(task_id: str):
    """
    Resume all paused sessions related to a task
    
    Args:
        task_id: Task ID to resume sessions for
    """
    try:
        from .discovery_sessions import active_sessions
        
        # Find sessions that belong to this task
        sessions_to_resume = []
        for session_id, session_info in active_sessions.items():
            if session_info.get("task_id") == task_id and session_info.get("is_paused", False):
                sessions_to_resume.append(session_id)
        
        if not sessions_to_resume:
            logger.info(f"No paused sessions found for task {task_id}")
            return
        
        # Resume each session
        for session_id in sessions_to_resume:
            session_info = active_sessions[session_id]
            session_info["status"] = "running"
            session_info["is_paused"] = False
            logger.info(f"Resumed session {session_id} for task {task_id}")
            
            # Send websocket notification about session resume
            try:
                from .discovery_connections import discovery_manager
                await discovery_manager.send_message({
                    "type": "session_resumed",
                    "session_id": session_id,
                    "task_id": task_id,
                    "message": f"Scanning session resumed for task {task_id[:8]}",
                    "timestamp": datetime.now().isoformat()
                })
            except Exception as e:
                logger.error(f"Failed to send session resume notification: {e}")
        
        logger.info(f"Successfully resumed {len(sessions_to_resume)} sessions for task {task_id}")
        
    except Exception as e:
        logger.error(f"Error resuming sessions for task {task_id}: {e}")

async def restart_task_sessions(task_id: str):
    """
    Restart all sessions related to a task by creating new scanning sessions
    
    Args:
        task_id: Task ID to restart sessions for
    """
    try:
        from .discovery_sessions import active_sessions
        from ..startup_tasks import restart_task_session
        
        # First, stop any existing sessions for this task
        sessions_to_remove = []
        for session_id, session_info in active_sessions.items():
            if session_info.get("task_id") == task_id:
                sessions_to_remove.append(session_id)
        
        # Remove existing sessions
        for session_id in sessions_to_remove:
            active_sessions.pop(session_id, None)
            logger.info(f"Removed existing session {session_id} for task {task_id}")
        
        # Load task data to restart with original parameters
        task_data = load_task_data(task_id)
        if not task_data:
            logger.error(f"Task {task_id} not found for restart")
            return
        
        # Use the startup_tasks module to restart the task
        await restart_task_session(task_data)
        
        logger.info(f"Successfully restarted sessions for task {task_id}")
        
    except Exception as e:
        logger.error(f"Error restarting sessions for task {task_id}: {e}")

async def stop_task_sessions(task_id: str):
    """
    Stop all active sessions related to a task (cascade stop for abort/cancel).
    Args:
        task_id: Task ID to stop sessions for
    """
    try:
        from .discovery import stop_discovery_session
        task_data = load_task_data(task_id)
        if not task_data:
            logger.warning(f"No task data found for {task_id} when stopping sessions.")
            return
        sessions = task_data.get("sessions", {})
        for session_type, session_id in sessions.items():
            try:
                logger.info(f"Stopping session {session_id} (type: {session_type}) for task {task_id}")
                await stop_discovery_session(session_id)
            except Exception as e:
                logger.error(f"Failed to stop session {session_id} for task {task_id}: {e}")
        logger.info(f"Cascade stop: all sessions for task {task_id} requested to stop.")
    except Exception as e:
        logger.error(f"Cascade stop failed for task {task_id}: {e}")

def get_running_task_id() -> Optional[str]:
    """Get the ID of the first running task"""
    all_tasks = get_all_tasks()
    for task in all_tasks:
        if task.get('status') == 'running':
            return task['id']
    return None

def get_paused_task_id() -> Optional[str]:
    """Get the ID of the first paused task"""
    all_tasks = get_all_tasks()
    for task in all_tasks:
        if task.get('status') == 'paused':
            return task['id']
    return None

def get_any_task_id() -> Optional[str]:
    """Get the ID of any task (prioritize running, then paused, then others)"""
    all_tasks = get_all_tasks()
    
    # First try running tasks
    for task in all_tasks:
        if task.get('status') == 'running':
            return task['id']
    
    # Then try paused tasks
    for task in all_tasks:
        if task.get('status') == 'paused':
            return task['id']
    
    # Finally any task
    if all_tasks:
        return all_tasks[0]['id']
    
    return None

# LLM-based command parsing and response generation
async def llm_parse_task_command(message: str, user_email: str) -> Optional[TaskCommand]:
    """Use LLM to parse natural language into task commands"""
    try:
        # Get current system status for context
        all_tasks = get_all_tasks()
        running_tasks = [t for t in all_tasks if t['status'] == 'running']
        paused_tasks = [t for t in all_tasks if t['status'] == 'paused']
        
        system_prompt = f"""You are Bella, an AI assistant for archaeological task management. 
        
Current system status:
- Running tasks: {len(running_tasks)}
- Paused tasks: {len(paused_tasks)}
- Total tasks: {len(all_tasks)}

Your job is to analyze user messages and determine if they contain task management commands.
If a command is detected, respond with a JSON object. If not, respond with "NO_COMMAND".

Available commands:
- start: Create new scanning task (requires coordinates and range)
- pause: Pause a running task  
- resume: Resume a paused task
- abort: Stop/cancel a task permanently
- restart: Reset and restart a task
- status: Get status information

For start commands, extract coordinates and rectangular dimensions carefully:
- Look for patterns like: start_coordinates": [ -7.5, -65.0 ]
- Look for patterns like: "width_km": 1000, "height_km": 500
- Preserve exact width and height values as separate dimensions

Examples:
User: "pause the running task" → {{"action": "pause", "task_id": "auto"}}
User: "start scanning at coordinates 36.9, 67.5 with 5km range" → {{"action": "start", "coordinates": [36.9, 67.5], "range_km": {{"width": 5, "height": 5}}}}
User: "start_coordinates: [ -7.5, -65.0 ], range: {{ width_km: 1000, height_km: 500 }}" → {{"action": "start", "coordinates": [-7.5, -65.0], "range_km": {{"width": 1000, "height": 500}}}}
User: "create new task at coordinates -7.5, -65.0 with width 1000km height 500km" → {{"action": "start", "coordinates": [-7.5, -65.0], "range_km": {{"width": 1000, "height": 500}}}}
User: "what's the status?" → {{"action": "status"}}
User: "hello" → NO_COMMAND

Important: Always preserve exact width and height values as separate dimensions, never convert to square areas.

Analyze this message: "{message}"
"""

        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": message}
            ],
            max_tokens=200,
            temperature=0.1
        )
        
        result = response.choices[0].message.content.strip()
        
        if result == "NO_COMMAND":
            return None
            
        # Parse JSON response
        command_data = json.loads(result)
        
        # Handle auto task ID resolution
        if command_data.get("task_id") == "auto":
            if command_data["action"] == "pause":
                command_data["task_id"] = get_running_task_id()
            elif command_data["action"] == "resume":
                command_data["task_id"] = get_paused_task_id()
            elif command_data["action"] in ["abort", "restart"]:
                command_data["task_id"] = get_running_task_id() or get_paused_task_id()
        
        return TaskCommand(**command_data)
        
    except Exception as e:
        logger.error(f"Error in LLM command parsing: {e}")
        return None

async def generate_command_response(command: TaskCommand, response: TaskResponse, original_message: str) -> str:
    """Generate intelligent response for executed commands"""
    try:
        system_prompt = f"""You are Bella, a friendly archaeological AI assistant. 
        
A user said: "{original_message}"
You executed this command: {command.action}
The result was: {"successful" if response.success else "failed"}
Command details: {response.message}

Generate a natural, conversational response that:
1. Acknowledges what the user requested
2. Confirms what action was taken
3. Provides relevant details about the outcome
4. Maintains your helpful, archaeological expert personality

Keep it concise but informative, like you're talking to a colleague.
"""

        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        
        llm_response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "system", "content": system_prompt}],
            max_tokens=150,
            temperature=0.7
        )
        
        return llm_response.choices[0].message.content.strip()
        
    except Exception as e:
        logger.error(f"Error generating command response: {e}")
        return response.message  # Fallback to basic response

async def generate_intelligent_chat_response(message: str, context: Optional[Dict], is_admin: bool) -> str:
    """Generate intelligent chat responses using LLM"""
    try:
        # Build context information
        context_info = ""
        if context:
            if context.get('current_coordinates'):
                coords = context['current_coordinates']
                lat, lon = coords.get('latitude'), coords.get('longitude')
                region = get_geographic_region(lat, lon)
                context_info += f"User is viewing {region} at coordinates {lat:.3f}, {lon:.3f}. "
            
            if context.get('current_scan'):
                context_info += "User has an active scan running. "
                
            if context.get('positive_detections', 0) > 0:
                context_info += f"User has found {context['positive_detections']} potential structures. "
        
        # Get current task status
        all_tasks = get_all_tasks()
        running_tasks = [t for t in all_tasks if t['status'] == 'running']
        system_status = f"System has {len(running_tasks)} running tasks, {len(all_tasks)} total tasks."
        
        admin_info = "User is an administrator who can manage scanning tasks through natural language." if is_admin else "User is a regular user."
        
        system_prompt = f"""You are Bella, a knowledgeable and friendly AI assistant specializing in archaeological discovery and LiDAR analysis.

Context: {context_info}
System: {system_status}
User: {admin_info}

Your personality:
- Enthusiastic about archaeology and discovery
- Knowledgeable about LiDAR, scanning techniques, and archaeological methods
- Helpful and encouraging
- Professional but approachable
- You understand φ⁰-ψ⁰ resonance analysis and windmill detection

Guidelines:
- Be conversational and natural
- Share relevant archaeological insights
- If user is admin, mention they can manage tasks through conversation
- Reference their current location/context when relevant
- Keep responses concise but informative
- Show excitement about discoveries and exploration

User message: "{message}"
"""

        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "system", "content": system_prompt}],
            max_tokens=200,
            temperature=0.8
        )
        
        return response.choices[0].message.content.strip()
        
    except Exception as e:
        logger.error(f"Error generating intelligent response: {e}")
        # Fallback to simple response
        return "I'm Bella, your archaeological assistant! I'm here to help you explore and understand archaeological discoveries. What would you like to know about?"

def cleanup_duplicate_task_files():
    """Clean up duplicate task files, keeping only the most recent version of each task"""
    try:
        task_files = glob.glob(str(TASKS_DATA_PATH / "*.json"))
        task_groups = {}
        
        # Group files by task ID
        for task_file in task_files:
            try:
                with open(task_file, 'r') as f:
                    task_data = json.load(f)
                    task_id = task_data['id']
                    
                    if task_id not in task_groups:
                        task_groups[task_id] = []
                    
                    task_groups[task_id].append({
                        'file': task_file,
                        'updated_at': task_data['updated_at']
                    })
                    
            except Exception as e:
                logger.error(f"Error reading task file {task_file}: {e}")
        
        # For each task, keep only the most recent file
        files_removed = 0
        for task_id, files in task_groups.items():
            if len(files) > 1:
                # Sort by updated_at and keep only the most recent
                files.sort(key=lambda x: x['updated_at'], reverse=True)
                
                # Remove older files
                for file_info in files[1:]:
                    try:
                        os.remove(file_info['file'])
                        files_removed += 1
                        logger.info(f"Removed duplicate task file: {file_info['file']}")
                    except Exception as e:
                        logger.error(f"Error removing file {file_info['file']}: {e}")
        
        logger.info(f"Cleanup completed. Removed {files_removed} duplicate task files.")
        return files_removed
        
    except Exception as e:
        logger.error(f"Error during task file cleanup: {e}")
        return 0

def create_new_task(coordinates: List[float], range_km: Dict[str, float], profiles: List[str], user_email: str) -> Dict[str, Any]:
    """Create a new scanning task with rectangular dimensions"""
    try:
        task_id = str(uuid.uuid4())
        
        # Extract rectangular dimensions from range_km
        width_km = range_km.get('width', range_km.get('width_km', 5))
        height_km = range_km.get('height', range_km.get('height_km', 5))
        
        # Create task data
        task_data = {
            "id": task_id,
            "type": "scan",
            "status": "running",  # Start as running, not pending
            "start_coordinates": coordinates,
            "range": {
                "width_km": width_km,
                "height_km": height_km
            },
            "user_id": user_email,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "completed_at": None,
            "progress": 0,
            "findings": 0,
            "error_message": "",
            "estimated_completion": None,
            "session_id": str(uuid.uuid4()),
            "restart_count": 0,
            "decay_value": 1.0,
            "profiles": profiles,
            "sessions": {
                "scan": str(uuid.uuid4()),
                "detection": f"detection_{task_id[:8]}"
            }
        }
        
        logger.info(f"✅ Created new task {task_id} with rectangular dimensions: {width_km}×{height_km}km at {coordinates}")
        
        # Start the actual scanning session asynchronously
        asyncio.create_task(start_task_scanning_session(task_data))
        
        return task_data
        
    except Exception as e:
        logger.error(f"Error creating new task: {e}")
        raise e

async def start_task_scanning_session(task_data: Dict[str, Any]):
    """Start the actual LiDAR scanning session for a task"""
    try:
        # Import within the function to avoid circular imports
        from backend.api.routers.discovery_lidar import start_lidar_scan
        from backend.api.routers.discovery_sessions import active_sessions
        
        task_id = task_data['id']
        coordinates = task_data['start_coordinates']
        range_data = task_data['range']
        
        # Build scan configuration with rectangular dimensions
        config = {
            'center_lat': coordinates[0],
            'center_lon': coordinates[1],
            'width_km': range_data['width_km'],
            'height_km': range_data['height_km'],
            'tile_size_m': 40,
            'heatmap_mode': True,
            'streaming_mode': True,
            'prefer_high_resolution': False,
            'enable_detection': True,
            'structure_type': 'dutch_windmill',
            'task_id': task_id  # Critical: link the scan to the task
        }
        
        logger.info(f"🚀 Starting scanning session for task {task_id} with config: {config}")
        
        # Call the LiDAR scan endpoint directly
        response = await start_lidar_scan(config)
        
        if response.get('status') == 'started':
            session_id = response.get('session_id')
            logger.info(f"✅ Started scanning session {session_id} for task {task_id}")
            
            # Update the task with the actual session ID
            task_data['session_id'] = session_id
            task_data['sessions']['scan'] = session_id
            
            # Ensure the session is linked to the task in active_sessions
            if session_id in active_sessions:
                session_data = active_sessions[session_id]
                if isinstance(session_data, dict):
                    session_data['task_id'] = task_id
                    if 'config' in session_data:
                        session_data['config']['task_id'] = task_id
                    logger.info(f"🔗 Linked session {session_id} to task {task_id}")
            
            # Save the updated task data
            save_task_data(task_data)
        else:
            logger.error(f"❌ Failed to start scanning session for task {task_id}: {response}")
            # Update task status to error
            task_data['status'] = 'failed'
            task_data['error_message'] = f"Failed to start scanning session: {response.get('message', 'Unknown error')}"
            save_task_data(task_data)
            
    except Exception as e:
        logger.error(f"❌ Error starting scanning session for task {task_id}: {e}")
        # Update task status to error
        task_data['status'] = 'failed'
        task_data['error_message'] = f"Error starting scanning session: {str(e)}"
        save_task_data(task_data)

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

def parse_task_command(message: str) -> Optional[TaskCommand]:
    """Parse natural language message for task commands"""
    message_lower = message.lower()
    
    # Start task patterns
    if any(phrase in message_lower for phrase in ['start task', 'new task', 'begin scan', 'start scan']):
        # Try to extract coordinates and range
        coordinates = None
        range_km = {"width": 5, "height": 5}  # Default
        
        # Look for coordinate patterns
        import re
        coord_pattern = r'(?:coordinates?|coords?|at)\s*(?:lat|latitude)?[:\s]*(-?\d+\.?\d*)[,\s]+(?:lon|longitude)?[:\s]*(-?\d+\.?\d*)'
        coord_match = re.search(coord_pattern, message_lower)
        
        if coord_match:
            coordinates = [float(coord_match.group(1)), float(coord_match.group(2))]
        
        # Look for range patterns
        range_pattern = r'(?:range|area|size)\s*(?:of\s*)?(\d+)(?:\s*x\s*(\d+))?\s*km'
        range_match = re.search(range_pattern, message_lower)
        
        if range_match:
            width = int(range_match.group(1))
            height = int(range_match.group(2)) if range_match.group(2) else width
            range_km = {"width": width, "height": height}
        
        return TaskCommand(
            action="start",
            coordinates=coordinates,
            range_km=range_km,
            profiles=["default_windmill"]
        )
    
    # Pause task patterns
    elif any(phrase in message_lower for phrase in ['pause task', 'pause current', 'pause running', 'pause the', 'halt task', 'suspend task']):
        task_id = extract_task_id(message) or get_running_task_id()
        return TaskCommand(action="pause", task_id=task_id)
    
    # Resume task patterns
    elif any(phrase in message_lower for phrase in ['resume task', 'continue task', 'resume current', 'continue current']):
        task_id = extract_task_id(message) or get_paused_task_id()
        return TaskCommand(action="resume", task_id=task_id)
    
    # Abort task patterns (including "stop")
    elif any(phrase in message_lower for phrase in ['abort task', 'cancel task', 'kill task', 'stop task', 'stop current', 'abort current', 'cancel current']):
        task_id = extract_task_id(message) or get_running_task_id()
        return TaskCommand(action="abort", task_id=task_id)
    
    # Restart task patterns
    elif any(phrase in message_lower for phrase in ['restart task', 'reset task', 'restart current', 'reset current']):
        task_id = extract_task_id(message) or get_any_task_id()
        return TaskCommand(action="restart", task_id=task_id)
    
    # Status patterns
    elif any(phrase in message_lower for phrase in ['task status', 'check task', 'show tasks', 'list tasks']):
        task_id = extract_task_id(message)
        return TaskCommand(action="status", task_id=task_id)
    
    return None

def extract_task_id(message: str) -> Optional[str]:
    """Extract task ID from message"""
    import re
    # Look for UUID patterns
    uuid_pattern = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    match = re.search(uuid_pattern, message.lower())
    if match:
        return match.group(0)
    
    # Look for "task" followed by partial ID
    task_pattern = r'task\s+([a-f0-9]{8})'
    match = re.search(task_pattern, message.lower())
    if match:
        # Find full task ID starting with this prefix
        prefix = match.group(1)
        all_tasks = get_all_tasks()
        for task in all_tasks:
            if task['id'].startswith(prefix):
                return task['id']
    
    return None

# Session Management Functions for Task Control
async def pause_task_sessions(task_id: str):
    """Pause all scanning and detection sessions for a task"""
    try:
        from .discovery_sessions import active_sessions, _active_detection_tasks
        
        # Find sessions associated with this task
        sessions_to_pause = []
        for session_id, session_data in active_sessions.items():
            if isinstance(session_data, dict) and session_data.get("task_id") == task_id:
                sessions_to_pause.append(session_id)
        
        # Pause each session
        for session_id in sessions_to_pause:
            if session_id in active_sessions:
                session_data = active_sessions[session_id]
                if isinstance(session_data, dict):
                    session_data["is_paused"] = True
                    session_data["status"] = "paused"
                    logger.info(f"🔄 Paused scanning session {session_id} for task {task_id}")
        
        # Cancel any active detection tasks
        detection_tasks_to_cancel = [
            task_key for task_key in _active_detection_tasks.keys() 
            if task_key in sessions_to_pause
        ]
        
        for task_key in detection_tasks_to_cancel:
            if task_key in _active_detection_tasks:
                _active_detection_tasks[task_key].cancel()
                del _active_detection_tasks[task_key]
                logger.info(f"🛑 Cancelled detection task {task_key} for task {task_id}")
        
        logger.info(f"✅ Paused {len(sessions_to_pause)} sessions for task {task_id}")
        
    except Exception as e:
        logger.error(f"❌ Failed to pause sessions for task {task_id}: {e}")

async def resume_task_sessions(task_id: str):
    """Resume all scanning and detection sessions for a task"""
    try:
        from .discovery_sessions import active_sessions
        
        # Find paused sessions for this task
        sessions_to_resume = []
        for session_id, session_data in active_sessions.items():
            if (isinstance(session_data, dict) and 
                session_data.get("task_id") == task_id and 
                session_data.get("is_paused") == True):
                sessions_to_resume.append(session_id)
        
        # Resume each session
        for session_id in sessions_to_resume:
            if session_id in active_sessions:
                session_data = active_sessions[session_id]
                if isinstance(session_data, dict):
                    session_data["is_paused"] = False
                    session_data["status"] = "running"
                    logger.info(f"▶️ Resumed scanning session {session_id} for task {task_id}")
        
        logger.info(f"✅ Resumed {len(sessions_to_resume)} sessions for task {task_id}")
        
    except Exception as e:
        logger.error(f"❌ Failed to resume sessions for task {task_id}: {e}")

async def stop_task_sessions(task_id: str):
    """Stop and cleanup all scanning and detection sessions for a task"""
    try:
        from .discovery_sessions import active_sessions, _active_detection_tasks, _session_tile_data
        
        # Find sessions associated with this task (by task_id OR session_id matching task_id)
        sessions_to_stop = []
        for session_id, session_data in active_sessions.items():
            if isinstance(session_data, dict):
                # Check both task_id field and session_id matching task_id
                if (session_data.get("task_id") == task_id or 
                    session_id == task_id or 
                    session_id.startswith(task_id)):
                    sessions_to_stop.append(session_id)
        
        # Also check for any session that might be linked to this task_id pattern
        # (in case there are orphaned sessions)
        task_id_short = task_id[:8] if len(task_id) > 8 else task_id
        for session_id, session_data in list(active_sessions.items()):
            if isinstance(session_data, dict):
                config = session_data.get("config", {})
                if config.get("task_id") == task_id:
                    if session_id not in sessions_to_stop:
                        sessions_to_stop.append(session_id)
        
        logger.info(f"🔍 Found {len(sessions_to_stop)} sessions to stop for task {task_id}: {sessions_to_stop}")
        
        # Stop each session
        for session_id in sessions_to_stop:
            if session_id in active_sessions:
                session_data = active_sessions[session_id]
                if isinstance(session_data, dict):
                    session_data["status"] = "stopped"
                    logger.info(f"🛑 Stopped scanning session {session_id} for task {task_id}")
                
                # Remove from active sessions
                del active_sessions[session_id]
        
        # Cancel and cleanup detection tasks
        detection_tasks_to_cancel = [
            task_key for task_key in _active_detection_tasks.keys() 
            if task_key in sessions_to_stop
        ]
        
        for task_key in detection_tasks_to_cancel:
            if task_key in _active_detection_tasks:
                _active_detection_tasks[task_key].cancel()
                del _active_detection_tasks[task_key]
                logger.info(f"🛑 Cancelled and cleaned detection task {task_key} for task {task_id}")
        
        # Cleanup tile data
        for session_id in sessions_to_stop:
            if session_id in _session_tile_data:
                del _session_tile_data[session_id]
                logger.info(f"🧹 Cleaned tile data for session {session_id}")
        
        logger.info(f"✅ Stopped and cleaned {len(sessions_to_stop)} sessions for task {task_id}")
        
    except Exception as e:
        logger.error(f"❌ Failed to stop sessions for task {task_id}: {e}")

async def restart_task_sessions(task_id: str):
    """Restart scanning and detection sessions for a task"""
    try:
        logger.info(f"🔄 Starting session restart for task {task_id}")
        
        # First stop any existing sessions
        await stop_task_sessions(task_id)
        
        # Load task data
        task_data = load_task_data(task_id)
        if not task_data:
            logger.error(f"❌ Cannot restart sessions - task {task_id} not found")
            return
        
        logger.info(f"📋 Task data loaded for restart: status={task_data.get('status')}, coordinates={task_data.get('start_coordinates')}")
        
        # Use the restart logic from startup_tasks
        from backend.api.startup_tasks import restart_task_session
        logger.info(f"📡 Calling restart_task_session for task {task_id}")
        await restart_task_session(task_data)
        
        logger.info(f"✅ Completed session restart for task {task_id}")
        
    except Exception as e:
        logger.error(f"❌ Failed to restart sessions for task {task_id}: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")

# Task monitoring background thread
def task_monitor_loop():
    """Background loop to monitor tasks and generate broadcasts"""
    global task_monitor_active, active_tasks_cache, broadcast_queue
    
    while task_monitor_active:
        try:
            # Update active tasks cache
            all_tasks = get_all_tasks()
            running_tasks = [t for t in all_tasks if t['status'] == 'running']
            
            # Update cache
            active_tasks_cache.clear()
            for task in running_tasks:
                active_tasks_cache[task['id']] = task
            
            # Generate summary for broadcast
            if running_tasks:
                summary = f"System Update: {len(running_tasks)} active scanning tasks in progress"
                for task in running_tasks[:3]:  # Show top 3
                    progress_raw = task.get('progress', 0)
                    # Ensure progress is a number
                    if isinstance(progress_raw, (int, float)):
                        progress = progress_raw
                    else:
                        progress = 0
                    
                    findings_data = task.get('findings', [])
                    # Ensure findings is a list before getting length
                    if isinstance(findings_data, list):
                        findings_count = len(findings_data)
                    else:
                        findings_count = 1 if findings_data else 0
                    summary += f"\n• Task {task['id'][:8]}: {progress:.1f}% complete, {findings_count} findings"
                
                # Add to broadcast queue
                add_broadcast(summary)
            
            # Clean old broadcasts (keep last 10)
            if len(broadcast_queue) > 10:
                broadcast_queue = broadcast_queue[-10:]
            
            # Wait before next check
            time.sleep(30)  # Check every 30 seconds
            
        except Exception as e:
            logger.error(f"Error in task monitor loop: {e}")
            time.sleep(60)  # Wait longer on error

def start_task_monitor():
    """Start the task monitoring background thread"""
    global task_monitor_active, task_monitor_thread
    
    if not task_monitor_active:
        task_monitor_active = True
        task_monitor_thread = threading.Thread(target=task_monitor_loop, daemon=True)
        task_monitor_thread.start()
        logger.info("Task monitor started")

def stop_task_monitor():
    """Stop the task monitoring background thread"""
    global task_monitor_active, task_monitor_thread
    
    if task_monitor_active:
        task_monitor_active = False
        if task_monitor_thread:
            task_monitor_thread.join(timeout=5)
        logger.info("Task monitor stopped")

# Start task monitor when module loads
start_task_monitor()

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

Examples:
User: "pause the running task" → {{"action": "pause", "task_id": "auto"}}
User: "start scanning at coordinates 36.9, 67.5 with 5km range" → {{"action": "start", "coordinates": [36.9, 67.5], "range_km": {{"width": 5, "height": 5}}}}
User: "what's the status?" → {{"action": "status"}}
User: "hello" → NO_COMMAND

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

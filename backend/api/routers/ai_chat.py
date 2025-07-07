"""
OpenAI Chat and Semantic Search API with authentication.
"""
import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from openai import AsyncOpenAI
import numpy as np
import json
import os
import uuid
import asyncio
from datetime import datetime, timezone
from pathlib import Path
import threading
import time
# SentenceTransformer is imported conditionally later in the code

from backend.core.neo4j_database import neo4j_db
from backend.models.ontology_models import SearchEmbedding, EntityType
from backend.api.routers.auth import get_current_user
from backend.utils.config import get_settings
# Import discovery manager for websocket notifications
from backend.api.routers.messenger_websocket import frontend_backend_messenger
from backend.utils import gcs_utils
# Only import the TaskManager interface for task actions
from backend.api.routers.tasks import system_task_manager
from .ai_chat_task_helpers import generate_task_system_prompt, handle_llm_task_message

# Configure logging
logger = logging.getLogger(__name__)

settings = get_settings()
router = APIRouter(prefix="/ai", tags=["ai"])

# Global state for broadcasts (not task management)
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

from fastapi.security import HTTPAuthorizationCredentials

@router.post("/message", response_model=SimpleChatResponse)
async def simple_chat(request: SimpleChatRequest, current_user: dict = Depends(get_current_user)):
    """Unified chat endpoint: always uses LLM for both chat and task command detection."""
    try:
        context = request.context or {}
        # Add user info to context for downstream logic
        context["user"] = {
            "user_id": current_user.get("user_id"),
            "email": current_user.get("email"),
            "name": current_user.get("name"),
            "picture": current_user.get("picture")
        }
        from backend.api.routers.auth_utils import is_admin_user
        context["is_admin"] = is_admin_user(current_user.get("email"))
        logger.info(f"[DEBUG] JWT user: {current_user}")
        # Use the centralized LLM entry point, pass context only
        result = await handle_llm_task_message(request.message, context)
        # Prefer final_response if available, else initial_response
        response_text = result.get("final_response") or result.get("initial_response") or "I'm here to help!"
        return SimpleChatResponse(response=response_text)
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        return SimpleChatResponse(
            response="I'm having some technical difficulties, but I'm excited to help you explore archaeological mysteries! Please try asking me about scanning, discoveries, or any archaeological topics you're curious about.",
            tokens_used=None
        )

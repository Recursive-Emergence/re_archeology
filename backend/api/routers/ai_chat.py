"""
OpenAI Chat and Semantic Search API with authentication.
"""
import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
import openai
import numpy as np
# SentenceTransformer is imported conditionally later in the code

from backend.core.neo4j_database import neo4j_db
from backend.models.ontology_models import SearchEmbedding, EntityType
from backend.api.routers.auth import get_current_user
from backend.utils.config import get_settings

# Configure logging
logger = logging.getLogger(__name__)

settings = get_settings()
router = APIRouter(prefix="/ai", tags=["ai"])

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

@router.post("/message", response_model=SimpleChatResponse)
async def simple_chat(
    request: SimpleChatRequest
    # Temporarily remove auth requirement: current_user: dict = Depends(get_current_user)
):
    """Simple chat endpoint for Bella AI assistant."""
    try:
        # For now, provide intelligent responses without OpenAI
        message = request.message.lower().strip()
        
        # Context-aware responses
        context_info = ""
        location_info = ""
        
        if request.context:
            if request.context.get('current_scan'):
                context_info = "I can see you have an active scan running. "
            if request.context.get('positive_detections', 0) > 0:
                context_info += f"Great work! You've found {request.context['positive_detections']} potential archaeological structures. "
            
            # Add location context
            if request.context.get('current_coordinates'):
                coords = request.context['current_coordinates']
                lat, lon = coords.get('latitude'), coords.get('longitude')
                zoom = coords.get('zoom', 0)
                
                # Determine geographic region
                region = get_geographic_region(lat, lon)
                location_info = f"I can see you're currently viewing {region} (coordinates: {lat:.3f}, {lon:.3f}). "
                
                if zoom > 15:
                    location_info += "You're zoomed in quite close - perfect for detailed archaeological analysis! "
                elif zoom < 6:
                    location_info += "You're viewing a broad area - great for regional exploration! "
        
        # Smart responses based on message content
        if any(word in message for word in ['hello', 'hi', 'hey', 'greetings']):
            response = f"Hello! I'm Bella, your archaeological discovery assistant. {location_info}{context_info}How can I help you explore archaeological mysteries today?"
        
        elif any(word in message for word in ['where', 'location', 'position']):
            if request.context and request.context.get('selected_task'):
                task_info = request.context['selected_task']
                response = f"{location_info}You're currently focused on task {task_info.get('id', 'Unknown')} with {task_info.get('findings', 0)} findings so far. The scan status is '{task_info.get('status', 'unknown')}'. Would you like me to explain what we're looking for in this area?"
            else:
                response = f"{location_info}{context_info}We're exploring archaeological sites using advanced LiDAR scanning and φ⁰-ψ⁰ resonance analysis. Each location has its own unique signature that can reveal hidden structures!"
        
        elif any(word in message for word in ['help', 'assist', 'guide']):
            response = f"{location_info}{context_info}I'm here to help you understand archaeological discoveries! I can explain scanning techniques, interpret findings, discuss historical contexts, or help you navigate the RE-Archaeology platform. What would you like to explore?"
        
        elif any(word in message for word in ['windmill', 'tower', 'structure']):
            response = f"{location_info}{context_info}Windmills and tower structures are fascinating archaeological features! Our φ⁰-ψ⁰ resonance analysis can detect their unique geometric patterns even when buried or overgrown. The elevation signatures often reveal circular foundations and linear features that indicate historical construction."
        
        elif any(word in message for word in ['scan', 'scanning', 'lidar']):
            response = f"{location_info}{context_info}Our LiDAR scanning system uses advanced elevation analysis to detect archaeological structures. The process involves analyzing terrain patterns, elevation variations, and geometric signatures that indicate human-made structures. It's like having X-ray vision for the landscape!"
        
        elif any(word in message for word in ['findings', 'discoveries', 'results']):
            if request.context and request.context.get('positive_detections', 0) > 0:
                response = f"{location_info}Excellent! Your current scan has detected {request.context['positive_detections']} potential archaeological structures. Each detection represents a unique signature in the landscape that suggests human activity. Would you like me to explain what these patterns might indicate?"
            else:
                response = f"{location_info}{context_info}Archaeological discoveries are like pieces of a puzzle - each one tells us something about past civilizations. Our scanning technology can reveal foundations, walls, roads, and other structures that have been hidden for centuries!"
        
        elif any(word in message for word in ['amazon', 'rainforest', 'jungle']):
            response = f"{location_info}{context_info}The Amazon rainforest is an incredible archaeological frontier! Dense vegetation has hidden countless ancient civilizations for centuries. Our LiDAR technology can penetrate the forest canopy to reveal lost cities, ceremonial sites, and complex agricultural systems that tell the story of sophisticated pre-Columbian societies."
        
        else:
            # General response for other questions
            response = f"{location_info}{context_info}That's an interesting question! As your archaeological assistant, I'm here to help you understand the fascinating world of discovery and exploration. Whether it's about scanning techniques, historical contexts, or interpreting findings, I'm ready to dive into the details with you!"
        
        return SimpleChatResponse(
            response=response,
            tokens_used=None
        )
        
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        return SimpleChatResponse(
            response="I'm having some technical difficulties, but I'm excited to help you explore archaeological mysteries! Please try asking me about scanning, discoveries, or any archaeological topics you're curious about.",
            tokens_used=None
        )

@router.post("/test-message", response_model=SimpleChatResponse)
async def test_chat_no_auth(request: SimpleChatRequest):
    """Test chat endpoint without authentication for debugging."""
    try:
        # Simple fallback response for testing
        return SimpleChatResponse(
            response=f"Hello! I'm Bella, your archaeological assistant. You said: '{request.message}'. I'm here to help with your discoveries!",
            tokens_used=None
        )
    except Exception as e:
        logger.error(f"Test chat error: {str(e)}")
        return SimpleChatResponse(
            response="I'm having trouble connecting right now, but I'm here to help!",
            tokens_used=None
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

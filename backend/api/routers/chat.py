"""
Chat API router for RE-Archaeology Agent
Provides conversational interface for archaeological research assistance
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import json
import logging
from datetime import datetime

from backend.core.neo4j_database import neo4j_db
from backend.models.neo4j_crud import Neo4jCRUD

router = APIRouter()
logger = logging.getLogger(__name__)

class ChatMessage(BaseModel):
    message: str
    context: Optional[Dict[str, Any]] = None
    session_id: str
    user_id: Optional[str] = None

class ChatResponse(BaseModel):
    content: str
    type: str = "text"
    suggestions: Optional[List[str]] = None
    context_updated: Optional[bool] = False

class REAgentProcessor:
    """Processes user queries and generates contextual responses"""
    
    def __init__(self):
        self.crud = Neo4jCRUD()
        
    async def process_query(self, message: str, context: Optional[Dict] = None, 
                          user_id: Optional[str] = None) -> ChatResponse:
        """Process user message and generate appropriate response"""
        
        # Normalize message for analysis
        message_lower = message.lower().strip()
        
        # Determine query type and intent
        query_type = self._classify_query(message_lower)
        
        try:
            if query_type == "site_analysis":
                return await self._handle_site_query(message, context)
            elif query_type == "hypothesis_inquiry":
                return await self._handle_hypothesis_query(message, context)
            elif query_type == "discovery_search":
                return await self._handle_discovery_query(message, context)
            elif query_type == "data_visualization":
                return await self._handle_visualization_query(message, context)
            elif query_type == "pattern_analysis":
                return await self._handle_pattern_query(message, context)
            elif query_type == "general_help":
                return await self._handle_help_query(message, context)
            else:
                return await self._handle_general_query(message, context)
                
        except Exception as e:
            logger.error(f"Error processing query: {e}")
            return ChatResponse(
                content="I encountered an error while processing your request. Could you please rephrase your question?",
                type="error"
            )
    
    def _classify_query(self, message: str) -> str:
        """Classify the type of query based on keywords and patterns"""
        
        site_keywords = ["site", "location", "place", "where", "coordinates", "map"]
        hypothesis_keywords = ["hypothesis", "theory", "propose", "test", "evidence", "support"]
        discovery_keywords = ["discovery", "artifact", "finding", "excavation", "dig"]
        viz_keywords = ["visualize", "chart", "graph", "map", "show", "display", "plot"]
        pattern_keywords = ["pattern", "correlation", "relationship", "compare", "analyze"]
        help_keywords = ["help", "how", "what can", "guide", "tutorial"]
        
        if any(keyword in message for keyword in site_keywords):
            return "site_analysis"
        elif any(keyword in message for keyword in hypothesis_keywords):
            return "hypothesis_inquiry"
        elif any(keyword in message for keyword in discovery_keywords):
            return "discovery_search"
        elif any(keyword in message for keyword in viz_keywords):
            return "data_visualization"
        elif any(keyword in message for keyword in pattern_keywords):
            return "pattern_analysis"
        elif any(keyword in message for keyword in help_keywords):
            return "general_help"
        else:
            return "general"
    
    async def _handle_site_query(self, message: str, context: Optional[Dict]) -> ChatResponse:
        """Handle site-related queries"""
        try:
            # Get recent sites or sites matching criteria
            query = """
            MATCH (s:Site)
            OPTIONAL MATCH (s)-[:HAS_DISCOVERY]->(d:Discovery)
            WITH s, COUNT(d) as discovery_count
            ORDER BY s.created_at DESC
            LIMIT 5
            RETURN s.name as site_name, s.location as location, 
                   s.time_period as period, discovery_count
            """
            
            results = await self.crud.execute_query(query)
            
            if results:
                content = "Here are some recent archaeological sites:\n\n"
                for record in results:
                    content += f"**{record['site_name']}**\n"
                    content += f"• Location: {record['location']}\n"
                    content += f"• Period: {record['period']}\n"
                    content += f"• Discoveries: {record['discovery_count']}\n\n"
                
                suggestions = [
                    "Tell me more about " + results[0]['site_name'],
                    "Show discoveries at this site",
                    "Compare with similar sites",
                    "View on map"
                ]
            else:
                content = "I don't have any site data available at the moment. Would you like to add a new site or explore other aspects of the archaeological database?"
                suggestions = ["Add new site", "View hypotheses", "Browse discoveries"]
            
            return ChatResponse(content=content, type="data", suggestions=suggestions)
            
        except Exception as e:
            logger.error(f"Site query error: {e}")
            return ChatResponse(
                content="I'm having trouble accessing site data. Please try again.",
                type="error"
            )
    
    async def _handle_hypothesis_query(self, message: str, context: Optional[Dict]) -> ChatResponse:
        """Handle hypothesis-related queries"""
        try:
            query = """
            MATCH (h:Hypothesis)
            OPTIONAL MATCH (h)-[:RELATES_TO]->(s:Site)
            WITH h, COLLECT(s.name) as related_sites
            ORDER BY h.confidence_score DESC
            LIMIT 5
            RETURN h.statement as hypothesis, h.confidence_score as confidence,
                   h.evidence_type as evidence, related_sites
            """
            
            results = await self.crud.execute_query(query)
            
            if results:
                content = "Current archaeological hypotheses:\n\n"
                for record in results:
                    content += f"**Hypothesis:** {record['hypothesis']}\n"
                    content += f"• Confidence: {record['confidence']:.2f}\n"
                    content += f"• Evidence Type: {record['evidence_type']}\n"
                    if record['related_sites']:
                        content += f"• Related Sites: {', '.join(record['related_sites'])}\n"
                    content += "\n"
                
                suggestions = [
                    "Evaluate hypothesis evidence",
                    "Propose new hypothesis",
                    "Compare hypotheses",
                    "Find supporting data"
                ]
            else:
                content = "No hypotheses found. Would you like to propose a new hypothesis for testing?"
                suggestions = ["Propose new hypothesis", "View sites", "Browse discoveries"]
            
            return ChatResponse(content=content, type="data", suggestions=suggestions)
            
        except Exception as e:
            logger.error(f"Hypothesis query error: {e}")
            return ChatResponse(
                content="I'm having trouble accessing hypothesis data. Please try again.",
                type="error"
            )
    
    async def _handle_discovery_query(self, message: str, context: Optional[Dict]) -> ChatResponse:
        """Handle discovery-related queries"""
        try:
            query = """
            MATCH (d:Discovery)-[:FOUND_AT]->(s:Site)
            WITH d, s
            ORDER BY d.discovery_date DESC
            LIMIT 5
            RETURN d.name as discovery_name, d.artifact_type as type,
                   d.discovery_date as date, s.name as site_name,
                   d.cultural_significance as significance
            """
            
            results = await self.crud.execute_query(query)
            
            if results:
                content = "Recent archaeological discoveries:\n\n"
                for record in results:
                    content += f"**{record['discovery_name']}**\n"
                    content += f"• Type: {record['type']}\n"
                    content += f"• Site: {record['site_name']}\n"
                    content += f"• Date: {record['date']}\n"
                    if record['significance']:
                        content += f"• Significance: {record['significance']}\n"
                    content += "\n"
                
                suggestions = [
                    "Analyze artifact patterns",
                    "Find similar discoveries",
                    "View discovery timeline",
                    "Explore site context"
                ]
            else:
                content = "No discoveries found. Would you like to record a new discovery?"
                suggestions = ["Add new discovery", "View sites", "Browse hypotheses"]
            
            return ChatResponse(content=content, type="data", suggestions=suggestions)
            
        except Exception as e:
            logger.error(f"Discovery query error: {e}")
            return ChatResponse(
                content="I'm having trouble accessing discovery data. Please try again.",
                type="error"
            )
    
    async def _handle_visualization_query(self, message: str, context: Optional[Dict]) -> ChatResponse:
        """Handle data visualization requests"""
        content = """I can help you visualize archaeological data in several ways:

**Available Visualizations:**
• **Site Maps** - Geographic distribution of archaeological sites
• **Timeline Charts** - Chronological view of discoveries and periods
• **Relationship Graphs** - Connections between sites, discoveries, and hypotheses
• **Pattern Analysis** - Statistical patterns in artifact types and distributions

Which type of visualization would you like to explore?"""
        
        suggestions = [
            "Show site map",
            "Create timeline view",
            "Display relationships",
            "Analyze patterns"
        ]
        
        return ChatResponse(content=content, type="visualization", suggestions=suggestions)
    
    async def _handle_pattern_query(self, message: str, context: Optional[Dict]) -> ChatResponse:
        """Handle pattern analysis queries"""
        try:
            # Get some basic statistics for pattern analysis
            query = """
            MATCH (s:Site)
            OPTIONAL MATCH (s)-[:HAS_DISCOVERY]->(d:Discovery)
            WITH s.time_period as period, COUNT(d) as discoveries
            RETURN period, SUM(discoveries) as total_discoveries
            ORDER BY total_discoveries DESC
            """
            
            results = await self.crud.execute_query(query)
            
            content = "**Archaeological Pattern Analysis**\n\n"
            
            if results:
                content += "Discovery patterns by time period:\n\n"
                for record in results:
                    if record['period'] and record['total_discoveries'] > 0:
                        content += f"• **{record['period']}**: {record['total_discoveries']} discoveries\n"
                content += "\n"
            
            content += "I can help you identify patterns in:\n"
            content += "• Temporal distributions\n"
            content += "• Spatial clustering\n"
            content += "• Artifact type correlations\n"
            content += "• Site characteristic relationships\n"
            
            suggestions = [
                "Analyze temporal patterns",
                "Find spatial clusters",
                "Compare artifact types",
                "Identify site relationships"
            ]
            
            return ChatResponse(content=content, type="data", suggestions=suggestions)
            
        except Exception as e:
            logger.error(f"Pattern query error: {e}")
            return ChatResponse(
                content="I'm having trouble accessing pattern data. Please try again.",
                type="error"
            )
    
    async def _handle_help_query(self, message: str, context: Optional[Dict]) -> ChatResponse:
        """Handle general help queries"""
        content = """**Welcome to the RE-Archaeology Agent!**

I'm here to assist you with archaeological research and data analysis. Here's what I can help you with:

**🏛️ Site Analysis**
• Explore archaeological sites and their characteristics
• View site locations and time periods
• Analyze site relationships and patterns

**🔍 Discovery Management**
• Browse recent archaeological discoveries
• Search for specific artifact types
• Track discovery timelines and contexts

**🔬 Hypothesis Testing**
• Review current research hypotheses
• Evaluate evidence and confidence scores
• Propose and test new theories

**📊 Data Visualization**
• Create maps and timeline views
• Generate relationship graphs
• Perform statistical analysis

**💬 Contextual Assistance**
• Get help based on your current view
• Receive relevant suggestions
• Access domain-specific insights

Just ask me anything about your archaeological research!"""
        
        suggestions = [
            "Show me recent discoveries",
            "List active hypotheses",
            "Display site map",
            "Help with data analysis"
        ]
        
        return ChatResponse(content=content, type="help", suggestions=suggestions)
    
    async def _handle_general_query(self, message: str, context: Optional[Dict]) -> ChatResponse:
        """Handle general queries that don't fit specific categories"""
        content = """I understand you're asking about archaeological research. Let me help you explore the available data and tools.

Based on your question, you might be interested in:
• Viewing archaeological sites and their discoveries
• Exploring research hypotheses and evidence
• Analyzing patterns in the archaeological record
• Visualizing data relationships

What specific aspect would you like to investigate?"""
        
        suggestions = [
            "Show all sites",
            "Browse discoveries",
            "View hypotheses",
            "Help with analysis"
        ]
        
        return ChatResponse(content=content, type="general", suggestions=suggestions)

# Initialize the processor
re_agent = REAgentProcessor()

@router.post("/chat", response_model=ChatResponse)
async def chat_with_agent(chat_msg: ChatMessage):
    """Main chat endpoint for interacting with the RE Agent"""
    try:
        logger.info(f"Processing chat message: {chat_msg.message[:50]}...")
        
        response = await re_agent.process_query(
            message=chat_msg.message,
            context=chat_msg.context,
            user_id=chat_msg.user_id
        )
        
        # Log successful interactions
        logger.info(f"Chat response generated successfully for session: {chat_msg.session_id}")
        
        return response
        
    except Exception as e:
        logger.error(f"Chat endpoint error: {e}")
        raise HTTPException(
            status_code=500,
            detail="Sorry, I encountered an error while processing your request. Please try again."
        )

@router.get("/chat/health")
async def chat_health_check():
    """Health check for chat functionality"""
    try:
        # Test database connection
        await neo4j_db.verify_connectivity()
        return {"status": "healthy", "message": "Chat service is operational"}
    except Exception as e:
        logger.error(f"Chat health check failed: {e}")
        raise HTTPException(status_code=503, detail="Chat service unavailable")

# MVP2: RE-Archaeology Framework - Three-Pane UI with Bella AI Assistant

## Refined Goals

**Primary Focus**: Create a clean, intuitive three-pane user interface that provides seamless access to content categories, dynamic content viewing, and persistent AI assistance.

### Core UI Architecture:
1. **Left Pane - Category Navigation**:
   - Hierarchical content categories: "Maps", "Researches", "Sites", "RE Theory"
   - Clean, expandable tree navigation
   - Visual indicators for content availability and user access levels

2. **Middle Pane - Dynamic Content Display**:
   - Context-sensitive content rendering based on left pane selection
   - Thread discussions, map visualizations, research documents
   - Responsive design that adapts to content type

3. **Right Pane - Bella AI Assistant**:
   - Persistent chat interface with Bella, the RE-Archaeology AI assistant
   - Context-aware responses based on current content selection
   - Background task status updates and progress indicators
   - Real-time assistance and data processing notifications

### Authentication & Access Control:
- **Google OAuth 2.0**: Full access for authenticated users
- **Read-Only Mode**: Anonymous users can browse public content
- **Progressive Enhancement**: Authentication unlocks advanced features like content creation, AI chat, and personalized recommendations

## Technical Implementation

### Frontend Architecture:
- **Semantic Component Naming**: Replaced version-specific naming (mvp2.html) with functional naming (chat.html)
- **Modular CSS**: Organized styles with `main_chat.css` and `enhanced-ui.css`
- **Responsive Design**: Three-pane layout that adapts to screen sizes and content requirements

### Backend Services:
- **FastAPI Framework**: RESTful API with `/api/v1/` routing
- **Neo4j Database**: Graph-based content organization and relationship mapping
- **Earth Engine Integration**: Spatial analysis and map visualization through `earth_engine_service.py`
- **OpenAI Integration**: Bella AI assistant with context-aware responses

### Key Features:
1. **Bella AI Assistant Status Updates**:
   - Real-time background task monitoring
   - Progress indicators for data processing
   - Context-aware assistance based on current content

2. **Content Category System**:
   - Maps: Earth Engine visualizations and spatial data
   - Researches: Academic papers and analysis threads
   - Sites: Archaeological site documentation
   - RE Theory: Reverse engineering methodology discussions

3. **Progressive Authentication**:
   - Anonymous users: Read-only access to public content
   - Authenticated users: Full access including content creation and AI chat

## Deployment Strategy

### Local Development:
- Python virtual environment with requirements.txt
- Environment variables for API keys and database connections
- Hot reload for frontend development

### Cloud Run Production:
- Containerized deployment with Docker
- Secure credential management through Google Secret Manager
- Auto-scaling based on demand

## Success Metrics

- **User Experience**: Intuitive navigation between content categories
- **AI Integration**: Responsive Bella assistant with helpful background task updates
- **Performance**: Fast content loading and smooth pane transitions
- **Security**: Proper authentication flow and data protection

## Current Implementation Status

### Completed:
1. **Semantic File Naming**: All core components renamed for clarity
2. **Three-Pane UI Foundation**: Basic layout structure in place
3. **Backend Router Organization**: Earth Engine and spatial analysis services properly organized
4. **CSS Modernization**: Clean, semantic styling system

### Next Steps:
1. **Local Testing Setup**: Create virtual environment and test current implementation
2. **Google Auth Integration**: Implement OAuth flow for authenticated vs anonymous access
3. **Bella AI Integration**: Add OpenAI service for persistent chat assistant
4. **Enhanced UI Polish**: Finalize three-pane responsive design

### Neo4j Schema Extensions

#### New Node Types:
1. **ThreadCategory**:
   - `id`: UUID
   - `name`: string ("Maps", "Researches", "Sites", "RE Theory")
   - `description`: text
   - `icon`: string
   - `order_index`: integer
   - `created_at`: timestamp

2. **ThreadComment**:
   - `id`: UUID
   - `content`: text
   - `author_id`: UUID (User)
   - `thread_id`: UUID
   - `parent_comment_id`: UUID (optional, for replies)
   - `created_at`: timestamp
   - `updated_at`: timestamp

3. **BackgroundTask**:
   - `id`: UUID
   - `name`: string
   - `description`: text
   - `progress`: float (0-100)
   - `status`: enum ("running", "completed", "failed", "paused")
   - `started_at`: timestamp
   - `estimated_completion`: timestamp
   - `agent_id`: UUID

4. **SearchEmbedding**:
   - `id`: UUID
   - `content`: text
   - `embedding_vector`: list[float]
   - `entity_type`: enum ("thread", "site", "research", "narrative")
   - `entity_id`: UUID
   - `created_at`: timestamp

#### Enhanced Relationships:
- `BELONGS_TO`: (Thread) → (ThreadCategory)
- `COMMENTS_ON`: (User) → (Thread) via (ThreadComment)
- `REPLIES_TO`: (ThreadComment) → (ThreadComment)
- `PROCESSES`: (Agent) → (BackgroundTask)
- `EMBEDS`: (SearchEmbedding) → (Thread|Site|Research|Narrative)

### API Enhancements

#### New Endpoints:

1. **Authentication**:
   - `POST /api/v1/auth/google` - Google OAuth login/registration
   - `POST /api/v1/auth/refresh` - Refresh JWT token
   - `GET /api/v1/auth/profile` - Get user profile
   - `POST /api/v1/auth/logout` - Logout user

2. **Thread Management** (Authenticated Users Only):
   - `GET /api/v1/thread-categories/` - List all categories
   - `POST /api/v1/threads/` - Create new thread (requires auth)
   - `GET /api/v1/threads/{category_id}` - Get threads by category
   - `POST /api/v1/threads/{thread_id}/comments` - Add comment (requires auth)
   - `GET /api/v1/threads/{thread_id}/comments` - Get thread comments

3. **AI & Search** (Authenticated Users Only):
   - `POST /api/v1/chat/` - Chat with OpenAI integration (requires auth)
   - `POST /api/v1/search/semantic` - Semantic search across entities
   - `POST /api/v1/embeddings/generate` - Generate embeddings for content

4. **Background Tasks**:
   - `GET /api/v1/background-tasks/` - List active tasks
   - `GET /api/v1/background-tasks/{task_id}/status` - Get task status
   - `POST /api/v1/background-tasks/{task_id}/pause` - Pause/resume task

5. **Earth Engine Maps**:
   - `POST /api/v1/maps/earth-engine/region` - Generate region-specific maps
   - `GET /api/v1/maps/earth-engine/layers` - Available map layers
   - `POST /api/v1/maps/earth-engine/overlay` - Add overlay to map

## Tasks

### Backend

1. **Google Authentication System**:
   - Implement Google OAuth 2.0 integration.
   - Create JWT-based session management.
   - Add authentication middleware for protected endpoints.
   - Update user model with Google profile information.

2. **Neo4j Thread System**:
   - Extend Neo4j schema with new node types and relationships.
   - Implement CRUD operations for thread categories, threads, and comments.
   - Add hierarchical thread navigation and filtering.
   - Enforce authentication requirements for write operations.

3. **OpenAI Integration**:
   - Add OpenAI Python library to requirements.
   - Implement chat API with context awareness.
   - Create embedding generation service for semantic search.
   - Build vector similarity search functionality.
   - Restrict chat functionality to authenticated users.

4. **Background Task System**:
   - Implement task queue and progress tracking.
   - Create task management API endpoints.
   - Add real-time WebSocket updates for task status.

5. **Enhanced Earth Engine**:
   - Extend Earth Engine integration for thread-specific maps.
   - Implement region-based LIDAR data retrieval.
   - Add support for custom overlays and analysis tools.

### Frontend

1. **Google Authentication UI**:
   - Implement Google Sign-In button and flow.
   - Add user profile display and logout functionality.
   - Show authentication status and require login for protected features.
   - Display appropriate messages for unauthenticated users.

2. **Enhanced Thread Interface**:
   - Implement three-pane layout with category navigation.
   - Add thread creation and comment functionality.
   - Integrate real-time updates for new comments and threads.
   - Disable write operations for unauthenticated users.

3. **AI Chat Integration**:
   - Build chat interface with OpenAI integration.
   - Implement search-enhanced conversations.
   - Add semantic search UI components.
   - Require authentication for chat access.

4. **Background Tasks Panel**:
   - Design and implement right pane for task monitoring.
   - Add progress bars and status indicators.
   - Implement real-time task updates via WebSocket.

5. **Enhanced Map Visualization**:
   - Extend map interface for Earth Engine integration.
   - Add region selection and overlay controls.
   - Implement LIDAR visualization components.

### Infrastructure

1. **Environment Configuration**:
   - Add Google OAuth 2.0 credentials to environment variables.
   - Add OpenAI API key to environment variables.
   - Configure vector database for embeddings (optional: Pinecone/Weaviate).
   - Set up WebSocket support for real-time updates.

2. **Performance Optimization**:
   - Implement caching for frequently accessed threads.
   - Optimize Neo4j queries for hierarchical data.
   - Add pagination for large thread lists.

## Technical Implementation

### Required Dependencies:
```python
# Add to requirements.txt
openai==1.12.0
google-auth==2.23.0
google-auth-oauthlib==1.0.0
google-auth-httplib2==0.1.1
PyJWT==2.8.0
websockets==12.0
redis==5.0.1
sentence-transformers==2.2.2  # For local embeddings if needed
numpy==1.26.0  # For vector operations
```

### Environment Variables:
```bash
# Add to .env
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:8000/api/v1/auth/google/callback

# JWT Configuration
JWT_SECRET_KEY=your_jwt_secret_key_here
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4-turbo-preview
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# WebSocket Configuration
WEBSOCKET_REDIS_URL=redis://redis:6379/1
```

### Key Features Implementation:

1. **Thread Categories Structure**:
   ```
   Maps/
   ├── Regional Analysis
   ├── Netherlands Windmills
   └── LIDAR Overlays
   
   Researches/
   ├── Archaeological Papers
   ├── Historical Documents
   └── Comparative Studies
   
   Sites/
   ├── Confirmed Locations
   ├── Candidate Sites
   └── Site Analysis
   
   RE Theory/
   ├── Methodology Discussion
   ├── Pattern Recognition
   └── Theoretical Framework
   ```

2. **AI-Enhanced Search**:
   - Semantic similarity search across all content types.
   - Context-aware chat responses using search results.
   - Automated content summarization and insights.
   - **Authentication required for chat and advanced search features**.

3. **Background Processing Examples**:
   - "Processing Amazonian Basin LIDAR data (52%)"
   - "Analyzing site pattern correlations (78%)"
   - "Generating landscape connectivity maps (23%)"
   - "Cross-referencing historical documents (91%)"

## Deliverables

1. **Google Authentication System**:
   - Complete OAuth 2.0 integration with Google.
   - JWT-based session management.
   - Protected API endpoints requiring authentication.

2. **Enhanced Neo4j Database**:
   - Hierarchical thread discussion model.
   - Embedding storage and vector search capabilities.
   - Background task tracking system.

2. **AI-Powered Backend**:
   - OpenAI chat integration with context awareness.
   - Semantic search API with embedding support.
   - Real-time task monitoring and WebSocket updates.

3. **Advanced Frontend**:
   - Three-pane thread discussion interface.
   - Integrated AI chat with search enhancement.
   - Background task monitoring panel.
   - Enhanced Earth Engine map visualization.

4. **Deployment Ready**:
   - Updated Docker configuration with new dependencies.
   - Environment variable management for AI services.
   - Scalable WebSocket and task queue infrastructure.

## Timeline

   - Extend Neo4j schema for thread discussion model.
   - Implement basic thread and comment CRUD operations.
   - Set up OpenAI API integration foundation.
   - Complete thread discussion UI implementation.
   - Integrate OpenAI chat with context awareness.
   - Implement semantic search functionality.

   - Build background task system and monitoring.
   - Enhance Earth Engine integration for thread-specific maps.
   - Implement real-time updates via WebSocket.

   - Complete UI integration and testing.
   - Deploy enhanced system to Google Cloud Run.
   - Performance optimization and documentation.

## Notes

- Keep the lineaage of Docker deployment for easy rollback.
- Ensure OpenAI API rate limiting and cost management.
- Implement proper authentication for thread participation.
- Consider embedding model alternatives for cost optimization.
- Maintain compatibility with existing MVP1 functionality.
- Plan for scalable vector search as content grows.

## Success Metrics

- Users can create and participate in categorized discussions.
- AI chat provides contextually relevant responses using search.
- Background tasks provide transparent progress updates.
- Earth Engine maps integrate seamlessly with thread discussions.
- System maintains sub-2-second response times for chat and search.
- Cleaning up and optimizing the codebase for maintainability and performance. Remove redundant code and ensure proper error handling.

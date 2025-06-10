# MVP2: RE-Archaeology Framework - Three-Pane UI with Bella AI Assistant

## Goals & Architecture

**Primary Focus**: Deliver a clean, intuitive three-pane UI for categorized content, dynamic viewing, and persistent AI assistance.

### UI Structure
- **Left Pane**: Hierarchical navigation ("Maps", "Researches", "Sites", "RE Theory") with expandable tree and access indicators.
- **Middle Pane**: Context-sensitive content (threads, maps, research docs), responsive to selection.
- **Right Pane**: Persistent Bella AI chat, context-aware, with background task status and real-time notifications.

### Access Control
- **Google OAuth 2.0**: Full access for authenticated users; anonymous users have read-only access.
- **Progressive Enhancement**: Auth unlocks content creation, AI chat, and recommendations.

## Implementation Overview

### Frontend
- **Semantic Naming**: Functional file/component names (e.g., `chat.html`).
- **Modular CSS**: `main_chat.css`, `enhanced-ui.css`.
- **Responsive Three-Pane Layout**.

### Backend
- **FastAPI**: RESTful API at `/api/v1/`.
- **Neo4j**: Graph-based content and relationships.
- **Earth Engine**: Spatial analysis and map visualization.
- **OpenAI**: Bella AI assistant, context-aware chat.

### Key Features
- Real-time background task monitoring and progress.
- Context-aware AI chat and semantic search (auth required).
- Threaded discussions, map visualizations, and research docs.

## Current Status & Roadmap

### Completed
- Semantic file/component naming.
- Three-pane UI foundation.
- Backend router organization (Earth Engine, spatial analysis).
- CSS modernization.

### Next Steps
- Local testing setup (virtualenv, requirements).
- Google OAuth integration (backend & UI).
- Bella AI (OpenAI) chat integration.
- Enhanced UI polish and responsive design.
- Neo4j schema extension for threads, comments, background tasks, embeddings.
- CRUD for threads/comments, hierarchical navigation, and filtering.
- WebSocket-based real-time updates for background tasks.
- Earth Engine: thread-specific maps, overlays, LIDAR.
- Performance: caching, optimized queries, pagination.

## API & Data Model Summary

- **Auth**: Google OAuth, JWT sessions, profile, logout.
- **Threads**: Categories, threads, comments (CRUD, hierarchical, auth for write).
- **AI & Search**: OpenAI chat, semantic search, embeddings (auth required).
- **Background Tasks**: Task queue, progress, WebSocket updates.
- **Earth Engine**: Region maps, overlays, LIDAR.

**Neo4j Node Types**: ThreadCategory, ThreadComment, BackgroundTask, SearchEmbedding.
**Relationships**: BELONGS_TO, COMMENTS_ON, REPLIES_TO, PROCESSES, EMBEDS.

## Deployment & Infrastructure

- **Local**: Python venv, requirements.txt, .env for secrets, hot reload.
- **Production**: Docker, Google Secret Manager, auto-scaling.
- **WebSocket**: Redis backend for real-time updates.

## Dependencies
```
openai==1.12.0
google-auth==2.23.0
google-auth-oauthlib==1.0.0
google-auth-httplib2==0.1.1
PyJWT==2.8.0
websockets==12.0
redis==5.0.1
sentence-transformers==2.2.2
numpy==1.26.0
```

## Environment Variables
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=...
JWT_SECRET_KEY=...
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4-turbo-preview
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
WEBSOCKET_REDIS_URL=redis://redis:6379/1
```

## Deliverables
- Google OAuth 2.0 auth system (JWT, protected endpoints).
- Enhanced Neo4j schema (threads, embeddings, background tasks).
- OpenAI-powered backend (chat, semantic search, embeddings).
- Advanced frontend (three-pane UI, AI chat, background task panel, map visualization).
- Deployment-ready Docker config and scalable infrastructure.

## Success Metrics
- Categorized discussions, context-aware AI chat, transparent background task progress, seamless Earth Engine integration, sub-2s response times, maintainable and optimized codebase.

---

*This document has been streamlined for clarity and to remove redundancies. For details on implementation, see codebase and related docs.*

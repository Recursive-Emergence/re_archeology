# MVP3: RE-Archaeologist Framework - Advanced Three-Pane UI with Bella AI Assistant

## Goals & Architecture

**Primary Focus**: Deliver an advanced, interactive three-pane UI for discovery, dynamic map visualization, and AI-assisted exploration.

### UI Structure
- **Left Pane (Control Panel / Lab Panel)**: Styled like the discovery UI, featuring kernel management, threshold configuration, and discovery controls.
- **Middle Pane (Map Visualization)**: Large interactive map with street/satellite view toggle, overlays for scanned regions, and clickable patches for detailed results.
- **Right Pane (Chat Pane with Bella)**: Resizable chat interface with Bella AI assistant for real-time updates and context-aware chat.

### Access Control
- **Google OAuth 2.0**: Full access for authenticated users; anonymous users have read-only access.
- **Progressive Enhancement**: Auth unlocks advanced features like AI chat and discovery insights.

## Implementation Overview

### Frontend
- **Semantic Naming**: Functional file/component names (e.g., `discovery_ui.html`).
- **Modular CSS**: `discovery_ui.css`, `enhanced-ui.css`.
- **Responsive Three-Pane Layout**.

### Backend
- **FastAPI**: RESTful API at `/api/v1/`.
- **Neo4j**: Graph-based content and relationships.
- **Earth Engine**: Spatial analysis and map visualization.
- **OpenAI**: Bella AI assistant, context-aware chat.

### Key Features
- Real-time background task monitoring and progress.
- Interactive map with overlays and patch interactions.
- Bella AI assistant for discovery updates and insights.

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
- Neo4j schema extension for patches, findings, and background tasks.
- WebSocket-based real-time updates for discovery progress.
- Earth Engine: region-specific overlays, LIDAR.
- Performance: caching, optimized queries, pagination.

## API & Data Model Summary

- **Auth**: Google OAuth, JWT sessions, profile, logout.
- **Patches**: Scanned regions, findings (CRUD, hierarchical, auth for write).
- **AI & Search**: OpenAI chat, semantic search, embeddings (auth required).
- **Background Tasks**: Task queue, progress, WebSocket updates.
- **Earth Engine**: Region maps, overlays, LIDAR.

**Neo4j Node Types**: Patch, Finding, BackgroundTask, SearchEmbedding.
**Relationships**: BELONGS_TO, DISCOVERED_IN, PROCESSES, EMBEDS.

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
- Enhanced Neo4j schema (patches, findings, background tasks).
- OpenAI-powered backend (chat, semantic search, embeddings).
- Advanced frontend (three-pane UI, AI chat, background task panel, map visualization).
- Deployment-ready Docker config and scalable infrastructure.

## Success Metrics
- Interactive discovery, context-aware AI chat, transparent background task progress, seamless Earth Engine integration, sub-2s response times, maintainable and optimized codebase.

---

## Refactor Plan for MVP3

### Goals
1. **Backend Improvements**:
   - Implement kernel persistence to save trained kernels for future use.
   - Refactor scanning pipeline to be progressive and stateless, ensuring real-time updates.

2. **Frontend Enhancements**:
   - Handle real-time updates effectively, including dynamic map updates and progress visualization.
   - Improve interactivity and responsiveness for user interactions.

---

### Backend Refactoring

#### Kernel Persistence
- **Objective**: Save trained kernels after the first training and load them for future use.
- **Implementation Steps**:
  1. Add functionality to save kernels to disk using serialization (e.g., `pickle`).
  2. Implement a mechanism to load saved kernels.
  3. Create API endpoints for training and loading kernels.

#### Progressive Scanning
- **Objective**: Refactor the scanning pipeline to report progress incrementally and operate in a stateless manner.
- **Implementation Steps**:
  1. Modify the scanning logic to send updates for each patch scanned.
  2. Use WebSocket broadcasts for real-time progress updates.
  3. Ensure each scan operation is independent and can resume from the last state.

---

### Frontend Enhancements

#### Real-Time Updates
- **Objective**: Enhance the frontend to display real-time updates from the backend.
- **Implementation Steps**:
  1. Add functionality to handle incremental updates for scanned patches.
  2. Display updates dynamically on the map.
  3. Implement progress bars or indicators for ongoing scans.

#### Optimized UI
- **Objective**: Improve responsiveness and interactivity for map overlays and patch interactions.
- **Implementation Steps**:
  1. Optimize rendering for large datasets.
  2. Ensure smooth user interactions with map elements.

---

### Deliverables
1. **Backend**:
   - Kernel persistence functionality.
   - Progressive scanning pipeline.
   - API endpoints for kernel management and scanning.

2. **Frontend**:
   - Real-time updates for scanned patches.
   - Progress visualization.
   - Enhanced interactivity for map overlays.

---

### Success Metrics
- Reduced redundant kernel training.
- Real-time updates for scanning progress.
- Improved user experience with responsive and interactive UI.
- Maintainable and optimized codebase.

---

*This document outlines the MVP3 framework for RE-Archaeologist. For details on implementation, see codebase and related docs.*

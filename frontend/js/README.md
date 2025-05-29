# RE-Archaeology Frontend JavaScript

## Code Structure

The frontend JavaScript code has been restructured and consolidated to improve maintainability and reduce duplication.

### Key Files

- `main_app.js` - The main application class that handles all core functionality including:
  - Thread management
  - Hypothesis management
  - Site visualization
  - User authentication
  
- `thread_interface.js` - Now serves as a compatibility layer that forwards calls to the MainApp instance. This maintains backward compatibility with existing HTML templates while removing code duplication.

- `neo4j_api.js` - API interface for communication with the Neo4j backend

### Integration Services

- `auth_service.js` - Authentication service
- `ai_chat_service.js` - AI chat functionality
- `background_tasks_service.js` - Background task management
- `earth_engine_service.js` - Integration with Earth Engine
- `thread_websocket_service.js` - Real-time updates via WebSockets

## Recent Changes

- Removed redundant `legacy_app.js` file
- Consolidated duplicate thread management functionality from `thread_interface.js` into the `MainApp` class in `main_app.js`
- Converted `thread_interface.js` into a compatibility layer that delegates to the MainApp instance

## Usage

To initialize the application:

```javascript
document.addEventListener('DOMContentLoaded', () => {
    app = new MainApp();
    app.init();
});
```

The `app` global variable provides access to all application functionality.

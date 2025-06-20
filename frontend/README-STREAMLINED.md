# Frontend Structure - Streamlined

## Essential Files (Currently Active)

### HTML
- `index.html` - Main application entry point

### CSS
- `css/main-styles.css` - Primary application styles
- `css/status-enhancements.css` - Status display enhancements
- `css/visualization-enhancements.css` - Map and visualization styles

### JavaScript
- `js/new-app.js` - Main application class (REArchaeologyApp)
- `js/map-visualization.js` - Map visualization components and LiDAR support

### External Dependencies
- **Leaflet** - Map functionality (essential)
- **Google OAuth** - User authentication (essential)

## Removed Dependencies
- ❌ Bootstrap CSS/JS - Replaced with custom styles
- ❌ Chart.js - No charts currently used in the UI
- ❌ Material Design Icons - No material icons used

## Archive Directory
Contains legacy and unused files that were moved out of the main application:
- Old application versions
- Unused managers and utilities
- Experimental components

## File Count Reduction
- Before: ~20 JS files in main directory
- After: 2 essential JS files + archive for backups
- CSS files reduced to 3 focused stylesheets
- External dependencies reduced from 5 to 2

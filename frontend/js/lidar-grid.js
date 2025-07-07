// LiDAR subtile grid renderer for direct GCS mode (inspired by demo_ws.html)
(function() {
    // Cache for grid and tile containers
    let lastGridRows = null, lastGridCols = null;
    let grid = null;
    let gridInfo = null;
    window.setLidarGridInfo = function(info) {
        if (window.DEBUG_LIDAR_GRID) {
            console.log('[LIDAR-GRID] setLidarGridInfo called with:', info);
        }
        gridInfo = info;
        lastGridRows = null;
        lastGridCols = null;
        if (grid) grid.innerHTML = '';
    };
    window.renderLidarSubtile = function({ gridRows, gridCols, coarseRow, coarseCol, subtiles, subtileRow, subtileCol, level, color, elev }) {
        // Always use backend grid info if available
        if (gridInfo) {
            gridCols = gridInfo.grid_x || gridCols;
            gridRows = gridInfo.grid_y || gridRows;
            if (window.DEBUG_LIDAR_GRID) {
                console.log('[LIDAR-GRID] backend grid_x (cols):', gridInfo.grid_x, 'grid_y (rows):', gridInfo.grid_y, '-> using gridCols:', gridCols, 'gridRows:', gridRows);
            }
        } else if (window.DEBUG_LIDAR_GRID) {
            console.warn('[LIDAR-GRID] WARNING: gridInfo not set before renderLidarSubtile! Using fallback gridRows/gridCols:', gridRows, gridCols);
        }
        if (!gridRows || !gridCols) {
            if (window.DEBUG_LIDAR_GRID) {
                console.warn('[LIDAR-GRID] WARNING: gridRows/gridCols not set, skipping render. gridRows:', gridRows, 'gridCols:', gridCols);
            }
            return; // Don't render until grid size is known
        }
        const app = window.app || window.App || window.reArchaeologyApp;
        const map = app && app.map;
        const selectedArea = app && app.selectedArea;
        const mapContainer = document.getElementById('mapContainer');
        if (!map || !selectedArea || !selectedArea.bounds || !mapContainer) return;
        // Convert scan region bounds to pixel coordinates (ensure SW/NE order)
        const bounds = selectedArea.bounds;
        // Ensure bounds[0] is SW and bounds[1] is NE
        const latMin = Math.min(bounds[0][0], bounds[1][0]);
        const latMax = Math.max(bounds[0][0], bounds[1][0]);
        const lonMin = Math.min(bounds[0][1], bounds[1][1]);
        const lonMax = Math.max(bounds[0][1], bounds[1][1]);
        const sw = map.latLngToContainerPoint([latMin, lonMin]);
        const ne = map.latLngToContainerPoint([latMax, lonMax]);
        const left = Math.min(sw.x, ne.x);
        const top = Math.min(sw.y, ne.y);
        const width = Math.abs(ne.x - sw.x);
        const height = Math.abs(ne.y - sw.y);
        // Create or update grid overlay only if needed
        if (!grid) {
            grid = document.createElement('div');
            grid.id = 'lidar-tile-grid';
            grid.style.display = 'grid';
            grid.style.pointerEvents = 'none';
            grid.style.position = 'absolute';
            grid.style.zIndex = '2000';
            mapContainer.appendChild(grid);
        }
        // Always update grid columns/rows and size to match backend
        grid.style.left = left + 'px';
        grid.style.top = top + 'px';
        grid.style.width = width + 'px';
        grid.style.height = height + 'px';
        grid.style.gridTemplateColumns = `repeat(${gridCols}, 1fr)`;
        grid.style.gridTemplateRows = `repeat(${gridRows}, 1fr)`;
        // Only recreate grid if size changed
        if (lastGridRows !== gridRows || lastGridCols !== gridCols) {
            grid.innerHTML = '';
            lastGridRows = gridRows;
            lastGridCols = gridCols;
        }
        // Find or create the tile cell
        const tileIdx = coarseRow * gridCols + coarseCol;
        let tileDiv = document.getElementById('lidar-tile-' + tileIdx);
        if (!tileDiv) {
            tileDiv = document.createElement('div');
            tileDiv.id = 'lidar-tile-' + tileIdx;
            tileDiv.className = 'lidar-tile';
            tileDiv.style.width = '100%';
            tileDiv.style.height = '100%';
            tileDiv.style.position = 'relative';
            tileDiv.style.overflow = 'hidden';
            tileDiv.style.display = 'flex';
            tileDiv.style.alignItems = 'stretch';
            tileDiv.style.justifyContent = 'stretch';
            grid.appendChild(tileDiv);
        }
        // Find or create the subtile grid
        let subtileGrid = tileDiv.querySelector('.lidar-subtile-grid');
        if (!subtileGrid) {
            subtileGrid = document.createElement('div');
            subtileGrid.className = 'lidar-subtile-grid';
            subtileGrid.style.display = 'grid';
            subtileGrid.style.width = '100%';
            subtileGrid.style.height = '100%';
            tileDiv.appendChild(subtileGrid);
        }
        // Always create all subtile cells for this tile
        subtileGrid.style.gridTemplateColumns = `repeat(${subtiles}, 1fr)`;
        subtileGrid.style.gridTemplateRows = `repeat(${subtiles}, 1fr)`;
        while (subtileGrid.children.length < subtiles * subtiles) {
            const subtile = document.createElement('div');
            subtile.className = 'lidar-subtile';
            subtile.style.border = 'none';
            subtile.style.background = 'none';
            subtile.style.opacity = '0';
            subtileGrid.appendChild(subtile);
        }
        // Set color and tooltip for the current subtile
        const subtileIdx = subtileRow * subtiles + subtileCol;
        let subtileDiv = subtileGrid.children[subtileIdx];
        subtileDiv.style.background = color || '#eee';
        subtileDiv.title = elev.toFixed(1);
        subtileDiv.style.opacity = (0.3 + 0.2 * (level || 0)).toString();

        // --- Satellite animation and beam effect (fixed positioning) ---
        // Remove previous beam highlight
        const prevBeam = grid.querySelector('.lidar-beam');
        if (prevBeam) prevBeam.classList.remove('lidar-beam');
        // Add beam highlight to current subtile
        subtileDiv.classList.add('lidar-beam');
        // Add CSS for beam effect if not present
        if (!document.getElementById('lidar-beam-style')) {
            const style = document.createElement('style');
            style.id = 'lidar-beam-style';
            style.innerHTML = `.lidar-beam { box-shadow: 0 0 16px 6px #00eaff, 0 0 0 2px #00eaff; border-radius: 6px; z-index: 3001 !important; position: relative; }\n#lidar-sat-anim { position: absolute; z-index: 3002; pointer-events: none; transition: left 0.2s, top 0.2s; width: 32px; height: 32px; }`;
            document.head.appendChild(style);
        }
        // Move or create satellite icon above the current subtile
        let sat = document.getElementById('lidar-sat-anim');
        if (!sat) {
            sat = document.createElement('img');
            sat.id = 'lidar-sat-anim';
            sat.src = '/static/satellite-icon.png';
            sat.alt = 'Satellite';
            sat.onerror = function() { this.style.display = 'none'; };
            sat.style.position = 'absolute';
            sat.style.zIndex = '3002';
            sat.style.width = '32px';
            sat.style.height = '32px';
            sat.style.pointerEvents = 'none';
            grid.appendChild(sat);
        }
        // Position satellite icon at the center of the current subtile (relative to grid overlay)
        // Need to add tileDiv offset + subtileDiv offset
        const tileOffsetLeft = tileDiv.offsetLeft;
        const tileOffsetTop = tileDiv.offsetTop;
        const subtileOffsetLeft = subtileDiv.offsetLeft;
        const subtileOffsetTop = subtileDiv.offsetTop;
        const satLeft = tileOffsetLeft + subtileOffsetLeft + subtileDiv.offsetWidth / 2 - 16;
        const satTop = tileOffsetTop + subtileOffsetTop + subtileDiv.offsetHeight / 2 - 16;
        sat.style.left = satLeft + 'px';
        sat.style.top = satTop + 'px';
        if (window.DEBUG_LIDAR_GRID) {
            console.log('[LIDAR-GRID] gridRows:', gridRows, 'gridCols:', gridCols, 'coarseRow:', coarseRow, 'coarseCol:', coarseCol, 'subtiles:', subtiles, 'subtileRow:', subtileRow, 'subtileCol:', subtileCol);
            console.log('[LIDAR-GRID] grid overlay px:', {left, top, width, height});
            console.log('[LIDAR-GRID] tile offset:', {tileOffsetLeft, tileOffsetTop, tileWidth: tileDiv.offsetWidth, tileHeight: tileDiv.offsetHeight});
            console.log('[LIDAR-GRID] subtile offset:', {subtileOffsetLeft, subtileOffsetTop, width: subtileDiv.offsetWidth, height: subtileDiv.offsetHeight});
            console.log('[LIDAR-GRID] Satellite icon position:', {satLeft, satTop});
        }
    };
    window.DEBUG_LIDAR_GRID = false;
})();

// WebSocket connection and message handling
export function connectWebSocket(app) {
    try {
        if (app.websocket) {
            console.log('🔌 Closing existing WebSocket connection');
            app.websocket.close();
            app.websocket = null;
        }
        const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${wsProtocol}//${window.location.host}/api/v1/ws/discovery`;
        console.log('🔌 Connecting to WebSocket:', wsUrl);
        app.websocket = new WebSocket(wsUrl);
        app.websocket.onopen = () => {
            console.log('✅ WebSocket connected successfully');
            app.websocket.send(JSON.stringify({
                type: 'ping',
                timestamp: new Date().toISOString()
            }));
        };
        app.websocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(app, data);
            } catch (error) {
                console.error('❌ WebSocket message error:', error);
            }
        };
        app.websocket.onclose = (event) => {
            console.log('🔌 WebSocket disconnected:', event.code, event.reason);
            app.websocket = null;
            if (app.currentLidarSession) {
                setTimeout(() => connectWebSocket(app), 2000);
            }
        };
        app.websocket.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
        };
    } catch (error) {
        console.error('❌ Failed to connect WebSocket:', error);
    }
}

export function handleWebSocketMessage(app, data) {
    if (window.Logger) {
        window.Logger.websocket('debug', `Message received: ${data.type}`, { keys: Object.keys(data) });
        if (data.type === 'lidar_tile') {
            // ...handle lidar_tile if needed...
        }
    }
    if (data.type === 'patch_result') {
        console.log('[DEBUG] patch_result message:', data);
        app.handlePatchResult?.(data.patch || data);
    }
    if (data.type === 'detection_result') {
        console.log('[DEBUG] detection_result message:', data);
        app.handleDetectionResult?.(data);
    }
    switch (data.type) {
        case 'lidar_tile':
            app.handleLidarTileUpdate?.(data);
            break;
        case 'lidar_heatmap_tile':
            app.handleLidarHeatmapTileUpdate?.(data);
            break;
        case 'lidar_progress':
            // ...handle progress if needed...
            break;
        case 'session_completed':
        case 'session_complete':
        case 'lidar_completed':
            app.completeDetectionAnimation?.();
            break;
        case 'session_stopped':
            // ...handle session stopped if needed...
            break;
        case 'session_failed':
        case 'lidar_error':
            // ...handle error if needed...
            break;
        default:
            break;
    }
}

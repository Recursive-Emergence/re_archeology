/**
 * Frontend Configuration for RE-Archaeology
 * Centralized settings for debugging, logging, and development features
 */

window.AppConfig = {
    // Logging configuration
    logging: {
        // Default log level: 'DEBUG', 'INFO', 'WARN', 'ERROR', 'SILENT'
        level: 'SILENT', // Set to SILENT to disable console noise by default
        
        // Enable/disable specific logging categories
        categories: {
            app: true,
            map: true,
            lidar: true,
            websocket: false, // Disable WebSocket logs by default (very verbose)
            visualization: false, // Disable visualization logs by default (very verbose)
            animation: false
        },
        
        // Rate limiting settings
        maxLogsPerSecond: 5,
        
        // Performance logging
        enablePerformanceLogging: false
    },
    
    // Development settings
    development: {
        // Show detailed error messages
        verboseErrors: false,
        
        // Enable debug UI elements
        showDebugInfo: false,
        
        // Mock data for testing
        useMockData: false
    },
    
    // Animation settings
    animation: {
        // Reduce animation frequency for performance
        reducedAnimations: false,
        
        // Disable animations completely
        disableAnimations: false
    },
    
    // API settings
    api: {
        // Timeout for API requests (ms)
        timeout: 30000,
        
        // Retry attempts for failed requests
        maxRetries: 3
    },
    
    // WebSocket settings
    websocket: {
        // Auto-reconnect settings
        autoReconnect: true,
        reconnectDelay: 3000,
        maxReconnectAttempts: 5
    }
};

// Override config with URL parameters for easy debugging
(function() {
    const urlParams = new URLSearchParams(window.location.search);
    
    // Override log level
    if (urlParams.has('logLevel')) {
        window.AppConfig.logging.level = urlParams.get('logLevel').toUpperCase();
    }
    
    // Enable verbose mode
    if (urlParams.has('verbose')) {
        window.AppConfig.logging.level = 'DEBUG';
        window.AppConfig.development.verboseErrors = true;
        window.AppConfig.development.showDebugInfo = true;
    }
    
    // Silent mode
    if (urlParams.has('silent')) {
        window.AppConfig.logging.level = 'SILENT';
    }
    
    // Debug specific categories
    ['app', 'map', 'lidar', 'websocket', 'visualization', 'animation'].forEach(category => {
        if (urlParams.has(`debug${category.charAt(0).toUpperCase() + category.slice(1)}`)) {
            window.AppConfig.logging.categories[category] = true;
        }
    });
})();

// Console helper for quick log level changes
window.setLogLevel = function(level) {
    if (window.Logger) {
        window.Logger.setLevel(level);
        window.AppConfig.logging.level = level.toUpperCase();
        console.log(`Log level set to: ${level.toUpperCase()}`);
        console.log('Available levels: DEBUG, INFO, WARN, ERROR, SILENT');
        console.log('Example: setLogLevel("SILENT") to disable all logs');
    }
};

// Console helper to show current config
window.showConfig = function() {
    console.group('🔧 RE-Archaeology Configuration');
    console.log('Logging Level:', window.AppConfig.logging.level);
    console.log('Logging Categories:', window.AppConfig.logging.categories);
    console.log('Development Mode:', window.AppConfig.development);
    console.groupEnd();
};

// Show config on startup if in development
if (window.location.hostname === 'localhost' || window.AppConfig.development.showDebugInfo) {
    console.log('🔧 RE-Archaeology Config loaded. Use showConfig() to view settings or setLogLevel("SILENT") to reduce logs.');
}

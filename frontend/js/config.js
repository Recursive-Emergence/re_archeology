/**
 * Frontend Configuration
 * Automatically detects the environment and sets appropriate API endpoints
 */

class AppConfig {
    constructor() {
        this.environment = this.detectEnvironment();
        this.apiBase = this.getApiBase();
        this.googleClientId = this.getGoogleClientId();
    }
    
    detectEnvironment() {
        const hostname = window.location.hostname;
        const port = window.location.port;
        
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'development';
        } else if (hostname.includes('run.app') || hostname.includes('appspot.com')) {
            return 'cloud';
        } else if (hostname.includes('vercel.app') || hostname.includes('netlify.app')) {
            return 'deploy';
        } else {
            return 'production';
        }
    }
    
    getApiBase() {
        // In all environments, API is served from the same origin
        return `/api/v1`;
    }
    
    getGoogleClientId() {
        // For now, using the same client ID across environments
        // In production, this should be environment-specific
        return "555743158084-ribsom4oerhv0jgohosoit190p8bh72n.apps.googleusercontent.com";
    }
    
    getBaseUrl() {
        return `${window.location.protocol}//${window.location.host}`;
    }
    
    log() {
        console.log('App Configuration:', {
            environment: this.environment,
            hostname: window.location.hostname,
            baseUrl: this.getBaseUrl(),
            apiBase: this.apiBase,
            googleClientId: this.googleClientId
        });
    }
}

// Export as global config
window.AppConfig = new AppConfig();

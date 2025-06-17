/**
 * Application Bootstrap
 * Main initialization script for the RE-Archaeology Framework
 */

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 DOM loaded, initializing app...');
    
    // Log configuration
    if (window.AppConfig) {
        window.AppConfig.log();
    }
    
    // Update Google OAuth with dynamic client ID
    const googleOnload = document.getElementById('g_id_onload');
    if (googleOnload && window.AppConfig) {
        googleOnload.setAttribute('data-client_id', window.AppConfig.googleClientId);
        googleOnload.setAttribute('data-error_callback', 'handleGoogleError');
        console.log('⚙️ Google OAuth configured with client ID:', window.AppConfig.googleClientId);
    }
    
    // Initialize the unified app
    try {
        console.log('🔧 Creating unified app...');
        window.unifiedApp = new UnifiedREArchaeologyApp();
        console.log('✅ Unified app created successfully');
        
        // Initialize the app
        console.log('🚀 Initializing unified app...');
        await window.unifiedApp.init();
        console.log('✅ Unified app initialized successfully');
    } catch (error) {
        console.error('❌ Failed to create/initialize unified app:', error);
        console.error('Stack trace:', error.stack);
    }
    
    // Initialize collapsible panels
    if (typeof initializeCollapsiblePanels === 'function') {
        initializeCollapsiblePanels();
    }
});

// Check for Google API availability with retries
function checkGoogleAPI() {
    if (window.google && window.google.accounts) {
        console.log('✅ Google API loaded successfully');
        return true;
    } else {
        console.log('⚠️ Google API not yet loaded, will retry...');
        return false;
    }
}

// Retry Google API loading
setTimeout(() => {
    if (!checkGoogleAPI()) {
        setTimeout(() => {
            if (!checkGoogleAPI()) {
                console.error('❌ Google API failed to load after multiple attempts');
            }
        }, 2000);
    }
}, 2000);

// Additional check when window is fully loaded
window.addEventListener('load', function() {
    console.log('🌍 Window fully loaded');
    
    // Final check for Google API
    if (window.google && window.google.accounts) {
        console.log('✅ Google API confirmed ready');
        
        // Initialize Google Sign-In if not already done
        try {
            window.google.accounts.id.initialize({
                client_id: window.AppConfig?.googleClientId || '555743158084-ribsom4oerhv0jgohosoit190p8bh72n.apps.googleusercontent.com',
                callback: window.handleGoogleLogin,
                error_callback: window.handleGoogleError,
                auto_select: false,
                cancel_on_tap_outside: false
            });
            console.log('✅ Google Sign-In re-initialized');
        } catch (error) {
            console.warn('⚠️ Google Sign-In initialization warning:', error);
        }
    } else {
        console.error('❌ Google API still not available after window load');
    }
});
/**
 * Application Bootstrap
 * Main initialization script for the RE-Archaeology Framework
 */

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async function() {
    const googleOnload = document.getElementById('g_id_onload');
    if (googleOnload && window.AppConfig) {
        googleOnload.setAttribute('data-client_id', window.AppConfig.googleClientId);
        googleOnload.setAttribute('data-error_callback', 'handleGoogleError');
    }
    
    try {
        window.unifiedApp = new UnifiedREArchaeologyApp();
        await window.unifiedApp.init();
    } catch (error) {
        console.error('Failed to initialize app:', error);
    }
    
    if (typeof initializeCollapsiblePanels === 'function') {
        initializeCollapsiblePanels();
    }
});

function checkGoogleAPI() {
    return window.google && window.google.accounts;
}

setTimeout(() => {
    if (!checkGoogleAPI()) {
        setTimeout(() => {
            if (!checkGoogleAPI()) {
                console.error('Google API failed to load');
            }
        }, 2000);
    }
}, 2000);

window.addEventListener('load', function() {
    if (window.google && window.google.accounts) {
        try {
            window.google.accounts.id.initialize({
                client_id: window.AppConfig?.googleClientId || '555743158084-ribsom4oerhv0jgohosoit190p8bh72n.apps.googleusercontent.com',
                callback: window.handleGoogleLogin,
                error_callback: window.handleGoogleError,
                auto_select: false,
                cancel_on_tap_outside: false
            });
        } catch (error) {
            console.warn('Google Sign-In initialization warning:', error);
        }
    }
});
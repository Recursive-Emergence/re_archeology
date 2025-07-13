// Entry point for RE-Archaeology App
import { REArchaeologyApp } from './app-core.js';
import { gcsPollingService } from './gcs-polling.js';

// Enable debug logging temporarily
if (window.Logger) window.Logger.setLevel('DEBUG');

console.log('[MAIN] Main.js module loaded');
console.log('[MAIN] Document ready state:', document.readyState);

function initializeApp() {
    console.log('[MAIN] Initializing app...');
    window.reArchaeologyApp = new REArchaeologyApp();
    
    // Add GCS polling service to app
    window.reArchaeologyApp.gcsPollingService = gcsPollingService;
    
    console.log('[MAIN] REArchaeologyApp instance created:', window.reArchaeologyApp);
    window.reArchaeologyApp.init().then(() => {
        console.log('[MAIN] App initialization completed');
        console.log('[MAIN] GCS polling will be started by task-list for running tasks');
    }).catch(error => {
        console.error('[MAIN] App initialization failed:', error);
    });
}


// Always initialize immediately since modules load after DOM is ready
console.log('[MAIN] Initializing app immediately (modules load after DOM ready)');
initializeApp();

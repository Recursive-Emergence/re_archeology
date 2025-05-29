/**
 * Thread interface management for RE-Archaeology
 * 
 * This file now serves as a compatibility layer for the consolidated code in main_app.js
 * It provides function redirects to the MainApp instance to maintain backward compatibility
 */

// The original initialization is now handled by MainApp class
// This is just a placeholder to maintain backward compatibility

// Authentication functions
async function loginUser() {
    if (typeof app !== 'undefined') {
        app.loginUser();
    } else {
        console.error("Main app not initialized");
    }
}

async function registerUser() {
    if (typeof app !== 'undefined') {
        app.registerUser();
    } else {
        console.error("Main app not initialized");
    }
}

function showLogin() {
    if (typeof app !== 'undefined') {
        app.showLogin();
    } else {
        console.error("Main app not initialized");
    }
}

function showRegistration() {
    if (typeof app !== 'undefined') {
        app.showRegistration();
    } else {
        console.error("Main app not initialized");
    }
}

function logout() {
    if (typeof app !== 'undefined') {
        app.logout();
    } else {
        console.error("Main app not initialized");
    }
}

// Main interface functions
function showMainInterface() {
    if (typeof app !== 'undefined') {
        app.showMainInterface();
    } else {
        console.error("Main app not initialized");
    }
}

// Thread management
async function loadThreads() {
    if (typeof app !== 'undefined') {
        await app.loadData();
    } else {
        console.error("Main app not initialized");
    }
}

function displayThreads(threads) {
    if (typeof app !== 'undefined') {
        app.renderThreadsList();
    } else {
        console.error("Main app not initialized");
    }
}

async function selectThread(threadId) {
    if (typeof app !== 'undefined') {
        await app.selectThread(threadId);
    } else {
        console.error("Main app not initialized");
    }
}

async function loadThreadContent(thread) {
    if (typeof app !== 'undefined') {
        await app.loadThreadContent(thread);
    } else {
        console.error("Main app not initialized");
    }
}

function createHypothesisCard(hypothesis) {
    if (typeof app !== 'undefined') {
        return app.createHypothesisCard(hypothesis);
    } else {
        console.error("Main app not initialized");
        return '';
    }
}

// Modal functions
function showNewThreadModal() {
    if (typeof app !== 'undefined') {
        app.showCreateThreadModal();
    } else {
        console.error("Main app not initialized");
    }
}

async function createNewThread() {
    if (typeof app !== 'undefined') {
        await app.handleCreateThread();
    } else {
        console.error("Main app not initialized");
    }
}

function showNewHypothesisModal() {
    if (typeof app !== 'undefined') {
        app.showCreateHypothesisModal();
    } else {
        console.error("Main app not initialized");
    }
}

async function createNewHypothesis() {
    if (typeof app !== 'undefined') {
        await app.handleCreateHypothesis();
    } else {
        console.error("Main app not initialized");
    }
}

// Utility functions delegated to app instance
function escapeHtml(text) {
    if (typeof app !== 'undefined') {
        return app.escapeHtml(text);
    } else {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

function formatDate(dateString) {
    if (typeof app !== 'undefined') {
        return app.formatDate(dateString);
    } else {
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        } catch (error) {
            return dateString;
        }
    }
}

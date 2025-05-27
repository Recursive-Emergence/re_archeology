/**
 * Thread interface management for RE-Archaeology MVP1
 */

let authModal, newThreadModal, newHypothesisModal;

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Initialize modals
    authModal = new bootstrap.Modal(document.getElementById('authModal'));
    newThreadModal = new bootstrap.Modal(document.getElementById('newThreadModal'));
    newHypothesisModal = new bootstrap.Modal(document.getElementById('newHypothesisModal'));
    
    // Check if user is already logged in
    const currentUser = neo4jAPI.getCurrentUser();
    if (currentUser) {
        showMainInterface();
    } else {
        authModal.show();
    }
});

// Authentication functions
async function loginUser() {
    const email = document.getElementById('loginEmail').value.trim();
    
    if (!email) {
        alert('Please enter your email');
        return;
    }
    
    try {
        const user = await neo4jAPI.getUserByEmail(email);
        neo4jAPI.setCurrentUser(user);
        authModal.hide();
        showMainInterface();
    } catch (error) {
        alert('User not found. Please register first.');
        console.error('Login error:', error);
    }
}

async function registerUser() {
    const name = document.getElementById('registerName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const role = document.getElementById('registerRole').value;
    
    if (!name || !email) {
        alert('Please fill in all fields');
        return;
    }
    
    try {
        const userData = { name, email, role };
        const user = await neo4jAPI.createUser(userData);
        neo4jAPI.setCurrentUser(user);
        authModal.hide();
        showMainInterface();
    } catch (error) {
        alert('Registration failed: ' + error.message);
        console.error('Registration error:', error);
    }
}

function showLogin() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
}

function showRegistration() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
}

function logout() {
    neo4jAPI.clearCurrentUser();
    location.reload();
}

// Main interface functions
function showMainInterface() {
    const currentUser = neo4jAPI.getCurrentUser();
    document.getElementById('currentUserName').textContent = currentUser.name;
    loadThreads();
}

// Thread management
async function loadThreads() {
    try {
        const threads = await neo4jAPI.getAllThreads();
        displayThreads(threads);
    } catch (error) {
        console.error('Error loading threads:', error);
        document.getElementById('threadsList').innerHTML = '<div class="p-3 text-light">Error loading threads</div>';
    }
}

function displayThreads(threads) {
    const threadsList = document.getElementById('threadsList');
    
    if (threads.length === 0) {
        threadsList.innerHTML = '<div class="p-3 text-light">No threads yet. Create the first one!</div>';
        return;
    }
    
    threadsList.innerHTML = threads.map(thread => `
        <div class="thread-item" onclick="selectThread('${thread.id}')">
            <div class="fw-bold">${escapeHtml(thread.title)}</div>
            <small class="text-light">${formatDate(thread.created_at)}</small>
            ${thread.tags && thread.tags.length > 0 ? 
                `<div class="mt-1">${thread.tags.map(tag => `<span class="badge bg-secondary me-1">${escapeHtml(tag)}</span>`).join('')}</div>` : 
                ''
            }
        </div>
    `).join('');
}

async function selectThread(threadId) {
    try {
        // Update active thread styling
        document.querySelectorAll('.thread-item').forEach(item => item.classList.remove('active'));
        event.currentTarget.classList.add('active');
        
        // Load thread details
        const thread = await neo4jAPI.getThread(threadId);
        neo4jAPI.setCurrentThread(thread);
        
        // Update content area
        document.getElementById('contentTitle').textContent = thread.title;
        document.getElementById('contentSubtitle').textContent = `Created: ${formatDate(thread.created_at)}`;
        
        // Load thread content (hypotheses, discussions, etc.)
        await loadThreadContent(thread);
        
    } catch (error) {
        console.error('Error selecting thread:', error);
        alert('Error loading thread content');
    }
}

async function loadThreadContent(thread) {
    const contentArea = document.getElementById('contentArea');
    
    // Load hypotheses related to this thread
    try {
        const allHypotheses = await neo4jAPI.getAllHypotheses();
        const threadHypotheses = allHypotheses.filter(h => h.emerged_from_thread === thread.id);
        
        let contentHTML = `
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h5>Thread Discussion</h5>
                <button class="btn btn-sm btn-primary" onclick="showNewHypothesisModal()">
                    <i class="fas fa-lightbulb"></i> Propose Hypothesis
                </button>
            </div>
        `;
        
        if (threadHypotheses.length === 0) {
            contentHTML += `
                <div class="text-center text-muted py-4">
                    <i class="fas fa-lightbulb fa-2x mb-3"></i>
                    <p>No hypotheses proposed yet. Be the first to contribute!</p>
                </div>
            `;
        } else {
            contentHTML += '<div class="hypotheses-list">';
            for (const hypothesis of threadHypotheses) {
                contentHTML += createHypothesisCard(hypothesis);
            }
            contentHTML += '</div>';
        }
        
        contentArea.innerHTML = contentHTML;
        
    } catch (error) {
        console.error('Error loading thread content:', error);
        contentArea.innerHTML = '<div class="alert alert-danger">Error loading thread content</div>';
    }
}

function createHypothesisCard(hypothesis) {
    const confidenceColor = hypothesis.confidence_score >= 0.7 ? 'success' : 
                           hypothesis.confidence_score >= 0.4 ? 'warning' : 'danger';
    
    return `
        <div class="card hypothesis-card">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <h6 class="card-title mb-0">Hypothesis</h6>
                    <span class="badge bg-${confidenceColor}">
                        ${Math.round(hypothesis.confidence_score * 100)}% confidence
                    </span>
                </div>
                <p class="card-text">${escapeHtml(hypothesis.statement)}</p>
                <small class="text-muted">
                    <i class="fas fa-clock"></i> ${formatDate(hypothesis.created_at)} | 
                    <i class="fas fa-tag"></i> ${hypothesis.status}
                </small>
            </div>
        </div>
    `;
}

// Modal functions
function showNewThreadModal() {
    newThreadModal.show();
}

async function createNewThread() {
    const title = document.getElementById('newThreadTitle').value.trim();
    const tagsInput = document.getElementById('newThreadTags').value.trim();
    
    if (!title) {
        alert('Please enter a thread title');
        return;
    }
    
    const currentUser = neo4jAPI.getCurrentUser();
    const tags = tagsInput ? tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
    
    try {
        const threadData = {
            title,
            starter_user_id: currentUser.id,
            tags
        };
        
        await neo4jAPI.createThread(threadData);
        newThreadModal.hide();
        
        // Clear form
        document.getElementById('newThreadTitle').value = '';
        document.getElementById('newThreadTags').value = '';
        
        // Reload threads
        loadThreads();
        
    } catch (error) {
        alert('Error creating thread: ' + error.message);
        console.error('Create thread error:', error);
    }
}

function showNewHypothesisModal() {
    const currentThread = neo4jAPI.getCurrentThread();
    if (!currentThread) {
        alert('Please select a thread first');
        return;
    }
    newHypothesisModal.show();
}

async function createNewHypothesis() {
    const statement = document.getElementById('newHypothesisStatement').value.trim();
    const confidence = parseFloat(document.getElementById('newHypothesisConfidence').value);
    
    if (!statement) {
        alert('Please enter a hypothesis statement');
        return;
    }
    
    const currentUser = neo4jAPI.getCurrentUser();
    const currentThread = neo4jAPI.getCurrentThread();
    
    try {
        const hypothesisData = {
            statement,
            confidence_score: confidence,
            proposed_by_user: currentUser.id,
            emerged_from_thread: currentThread.id
        };
        
        await neo4jAPI.createHypothesis(hypothesisData);
        newHypothesisModal.hide();
        
        // Clear form
        document.getElementById('newHypothesisStatement').value = '';
        document.getElementById('newHypothesisConfidence').value = '0.5';
        
        // Reload thread content
        loadThreadContent(currentThread);
        
    } catch (error) {
        alert('Error creating hypothesis: ' + error.message);
        console.error('Create hypothesis error:', error);
    }
}

// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    } catch (error) {
        return dateString;
    }
}

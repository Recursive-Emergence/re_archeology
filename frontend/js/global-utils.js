/**
 * Global Utilities and Callback Functions
 * Contains global functions and UI helpers
 */

// Google OAuth callbacks
window.handleGoogleLogin = function(response) {
    console.log('🔐 Global Google login callback triggered');
    console.log('Response:', response);
    console.log('UnifiedApp available:', !!window.unifiedApp);
    
    if (window.unifiedApp) {
        window.unifiedApp.handleGoogleLogin(response);
    } else {
        console.error('❌ UnifiedApp not available for Google login');
        // Store response for later processing
        window._pendingGoogleAuth = response;
    }
};

window.handleGoogleError = function(error) {
    console.log('❌ Global Google error callback triggered');
    console.log('Error:', error);
    console.log('UnifiedApp available:', !!window.unifiedApp);
    
    if (window.unifiedApp) {
        window.unifiedApp.handleGoogleError(error);
    } else {
        console.error('Google Sign-In Error (no app):', error);
    }
};

// Toggle function for collapsible control groups
window.toggleControlGroup = function(headerElement) {
    const controlGroup = headerElement.parentElement;
    const content = controlGroup.querySelector('.control-content');
    const toggleIcon = headerElement.querySelector('.toggle-icon');
    
    if (content.style.display === 'none' || content.style.display === '') {
        content.style.display = 'block';
        toggleIcon.textContent = '▼';
        controlGroup.classList.remove('collapsed');
    } else {
        content.style.display = 'none';
        toggleIcon.textContent = '▶';
        controlGroup.classList.add('collapsed');
    }
};

// Utility function to initialize collapsible panels
function initializeCollapsiblePanels() {
    // Initialize collapsible panels - collapse some by default
    const collapsibleGroups = document.querySelectorAll('.control-group[data-collapsible="true"]');
    collapsibleGroups.forEach((group, index) => {
        const header = group.querySelector('h3');
        // Collapse Detection Settings and Visualization panels by default
        if (header && (header.textContent.includes('Detection Settings') || 
            header.textContent.includes('Visualization'))) {
            toggleControlGroup(header);
        }
    });
}

// Utility functions for visualization
window.drawMiniHistogram = function(canvasId, data) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    if (!data || data.length === 0) {
        // Draw placeholder
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#666';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('No Data', width / 2, height / 2);
        return;
    }
    
    // Find max value for scaling
    const maxValue = Math.max(...data);
    if (maxValue === 0) return;
    
    // Draw bars
    const barWidth = width / data.length;
    data.forEach((value, index) => {
        const barHeight = (value / maxValue) * (height - 20);
        const x = index * barWidth;
        const y = height - 15 - barHeight;
        
        // Color based on value
        const intensity = value / maxValue;
        ctx.fillStyle = `hsl(${120 * intensity}, 70%, 50%)`;
        ctx.strokeStyle = '#333';
        
        // Draw bar
        ctx.fillRect(x, y, barWidth - 1, barHeight);
        
        // Draw outline
        ctx.strokeRect(x, y, barWidth - 1, barHeight);
    });
    
    // Draw axes
    ctx.strokeStyle = '#555';
    ctx.beginPath();
    ctx.moveTo(10, height - 15);
    ctx.lineTo(width - 10, height - 15);
    ctx.moveTo(10, 15);
    ctx.lineTo(10, height - 15);
    ctx.stroke();
    
    // Add sample labels
    ctx.fillStyle = '#666';
    ctx.font = '8px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Sample Data', width / 2, height - 3);
};

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        initializeCollapsiblePanels,
        drawMiniHistogram: window.drawMiniHistogram
    };
}
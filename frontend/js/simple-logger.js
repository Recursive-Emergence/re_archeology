/**
 * Simple logging utility to reduce console spam
 */

class SimpleLogger {
    constructor() {
        // Log levels: 0=silent, 1=error, 2=warn, 3=info, 4=debug
        this.logLevel = parseInt(localStorage.getItem('re_log_level') || '3');
        this.lastMessages = new Map(); // For throttling repeated messages
    }
    
    setLevel(level) {
        this.logLevel = level;
        localStorage.setItem('re_log_level', level.toString());
        console.log(`🔧 Log level set to: ${level} (0=silent, 1=error, 2=warn, 3=info, 4=debug)`);
    }
    
    error(...args) {
        if (this.logLevel >= 1) console.error(...args);
    }
    
    warn(...args) {
        if (this.logLevel >= 2) console.warn(...args);
    }
    
    info(...args) {
        if (this.logLevel >= 3) console.log(...args);
    }
    
    debug(...args) {
        if (this.logLevel >= 4) console.log(...args);
    }
    
    // Throttled logging - only logs once every 'intervalMs' for the same message
    throttle(key, intervalMs, level, ...args) {
        const now = Date.now();
        const lastTime = this.lastMessages.get(key) || 0;
        
        if (now - lastTime >= intervalMs) {
            this.lastMessages.set(key, now);
            this[level](...args);
        }
    }
}

// Global logger instance
window.ReLogger = new SimpleLogger();

// Helper to quickly change log levels in browser console:
// ReLogger.setLevel(1) - errors only
// ReLogger.setLevel(2) - errors + warnings
// ReLogger.setLevel(3) - normal (default)
// ReLogger.setLevel(4) - verbose debug

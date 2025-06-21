/**
 * Centralized logging utility for RE-Archaeology frontend
 * Provides configurable logging levels and reduces console noise
 */

class Logger {
    constructor() {
        // Set logging level based on environment
        // 'DEBUG', 'INFO', 'WARN', 'ERROR', 'SILENT'
        this.level = this.getLogLevel();
        this.levels = {
            'DEBUG': 0,
            'INFO': 1,
            'WARN': 2,
            'ERROR': 3,
            'SILENT': 4
        };
        
        // Tracking for rate limiting
        this.rateLimits = new Map();
        this.maxLogsPerSecond = 5;
    }

    getLogLevel() {
        // Check config first
        if (window.AppConfig?.logging?.level) {
            return window.AppConfig.logging.level;
        }
        
        // Check for URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const urlLevel = urlParams.get('logLevel');
        
        if (urlLevel) {
            return urlLevel.toUpperCase();
        }
        
        // Default to INFO in production, DEBUG in development
        return window.location.hostname === 'localhost' ? 'DEBUG' : 'INFO';
    }

    shouldLog(level, message) {
        const levelValue = this.levels[level] || 0;
        const currentLevelValue = this.levels[this.level] || 0;
        
        if (levelValue < currentLevelValue) {
            return false;
        }

        // Rate limiting for repeated messages
        const now = Date.now();
        const key = `${level}:${message.substring(0, 50)}`;
        const maxLogs = window.AppConfig?.logging?.maxLogsPerSecond || this.maxLogsPerSecond;
        
        if (this.rateLimits.has(key)) {
            const { count, lastTime } = this.rateLimits.get(key);
            
            if (now - lastTime < 1000) {
                if (count >= maxLogs) {
                    return false;
                }
                this.rateLimits.set(key, { count: count + 1, lastTime: now });
            } else {
                this.rateLimits.set(key, { count: 1, lastTime: now });
            }
        } else {
            this.rateLimits.set(key, { count: 1, lastTime: now });
        }

        return true;
    }

    formatMessage(category, message, data = null) {
        const timestamp = new Date().toISOString().substring(11, 23);
        let formatted = `[${timestamp}] ${category}: ${message}`;
        
        if (data !== null && data !== undefined) {
            formatted += ` | ${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}`;
        }
        
        return formatted;
    }

    debug(category, message, data = null) {
        if (this.shouldLog('DEBUG', message)) {
            console.debug(this.formatMessage(category, message, data));
        }
    }

    info(category, message, data = null) {
        if (this.shouldLog('INFO', message)) {
            console.info(this.formatMessage(category, message, data));
        }
    }

    warn(category, message, data = null) {
        if (this.shouldLog('WARN', message)) {
            console.warn(this.formatMessage(category, message, data));
        }
    }

    error(category, message, data = null) {
        if (this.shouldLog('ERROR', message)) {
            console.error(this.formatMessage(category, message, data));
        }
    }

    // Convenience methods for common categories
    app(level, message, data = null) {
        if (window.AppConfig?.logging?.categories?.app !== false) {
            this[level]('APP', message, data);
        }
    }

    map(level, message, data = null) {
        if (window.AppConfig?.logging?.categories?.map !== false) {
            this[level]('MAP', message, data);
        }
    }

    lidar(level, message, data = null) {
        if (window.AppConfig?.logging?.categories?.lidar !== false) {
            this[level]('LIDAR', message, data);
        }
    }

    websocket(level, message, data = null) {
        if (window.AppConfig?.logging?.categories?.websocket !== false) {
            this[level]('WS', message, data);
        }
    }

    visualization(level, message, data = null) {
        if (window.AppConfig?.logging?.categories?.visualization !== false) {
            this[level]('VIZ', message, data);
        }
    }

    animation(level, message, data = null) {
        if (window.AppConfig?.logging?.categories?.animation !== false) {
            this[level]('ANIM', message, data);
        }
    }

    // Group related logs to reduce noise
    group(title, logs = []) {
        if (this.shouldLog('DEBUG', title)) {
            console.group(title);
            logs.forEach(({ level, category, message, data }) => {
                this[level](category, message, data);
            });
            console.groupEnd();
        }
    }

    // Performance timing
    time(label) {
        if (this.shouldLog('DEBUG', label)) {
            console.time(label);
        }
    }

    timeEnd(label) {
        if (this.shouldLog('DEBUG', label)) {
            console.timeEnd(label);
        }
    }

    // Set logging level dynamically
    setLevel(level) {
        this.level = level.toUpperCase();
        this.info('LOGGER', `Log level set to: ${this.level}`);
    }

    // Clear rate limits
    clearRateLimits() {
        this.rateLimits.clear();
    }
}

// Create global logger instance
window.Logger = new Logger();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logger;
}

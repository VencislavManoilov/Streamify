class Logger {
    constructor() {
        this.logs = [];
        this.maxLogSize = 1000; // Maximum number of logs to keep in memory
    }

    /**
     * Add a log entry
     * @param {string} message - The message to log
     * @param {string} level - The log level (info, error, warn, etc.)
     * @private
     */
    _addLog(message, level = 'info') {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            message,
            level
        };
        
        this.logs.push(logEntry);
        
        // Trim logs if they exceed max size
        if (this.logs.length > this.maxLogSize) {
            this.logs = this.logs.slice(0, this.maxLogSize);
        }
        
        // Also log to console
        console[level](message);
        
        return logEntry;
    }

    /**
     * Log an info message
     * @param {string} message - The message to log
     */
    log(message) {
        return this._addLog(message, 'log');
    }

    /**
     * Log an info message
     * @param {string} message - The message to log
     */
    info(message) {
        return this._addLog(message, 'info');
    }

    /**
     * Log an error message
     * @param {string} message - The message to log
     */
    error(message) {
        return this._addLog(message, 'error');
    }

    /**
     * Log a warning message
     * @param {string} message - The message to log
     */
    warn(message) {
        return this._addLog(message, 'warn');
    }

    /**
     * Get all logs
     * @returns {Array} Array of log entries
     */
    getLogs() {
        return this.logs;
    }

    /**
     * Get logs filtered by level
     * @param {string} level - Log level to filter by
     * @returns {Array} Filtered log entries
     */
    getLogsByLevel(level) {
        return this.logs.filter(log => log.level === level);
    }

    /**
     * Get the most recent logs
     * @param {number} count - Number of logs to retrieve
     * @returns {Array} Recent log entries
     */
    getRecentLogs(count = 10) {
        return this.logs.slice(0, count);
    }

    /**
     * Clear all logs
     */
    clearLogs() {
        this.logs = [];
    }
}

// Create a singleton instance
const logger = new Logger();

module.exports = logger;

/**
 * Badminton App - Shared Utility Functions
 * Centralized utilities to reduce code duplication
 */

window.BadmintonUtils = window.BadmintonUtils || {};

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML
 */
window.BadmintonUtils.escapeHtml = function(text) {
    // Escaper også anførselstegn — outputtet bruges i HTML-attributter
    // (value="...", title="...", data-*), hvor " og ' ellers kan bryde ud.
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

/**
 * Format ISO date string to Danish locale
 * @param {string} isoString - ISO date string
 * @returns {string} Formatted date string
 */
window.BadmintonUtils.formatDate = function(isoString) {
    const date = new Date(isoString);
    return date.toLocaleDateString('da-DK', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

/**
 * Show a two-step confirmation dialog for destructive actions
 * @param {string} title - First dialog title
 * @param {string} message - First dialog message
 * @param {string} finalTitle - Second dialog title (default: "SIDSTE ADVARSEL")
 * @param {string} finalMessage - Second dialog message
 * @param {Function} action - Async function to execute if confirmed
 * @param {Function} showMessage - The showMessage function from the calling script
 * @returns {Promise<boolean>} True if action completed, false if cancelled
 */
window.BadmintonUtils.confirmDestructiveAction = async function(
    title,
    message,
    finalMessage,
    action,
    showMessage,
    finalTitle = 'SIDSTE ADVARSEL'
) {
    return new Promise((resolve) => {
        showMessage(title, message, [
            {
                text: 'Annuller',
                style: 'secondary',
                callback: () => resolve(false)
            },
            {
                text: 'Ja, Fortsæt',
                style: 'danger',
                callback: () => {
                    showMessage(finalTitle, finalMessage, [
                        {
                            text: 'Annuller',
                            style: 'secondary',
                            callback: () => resolve(false)
                        },
                        {
                            text: 'Ja, Bekræft',
                            style: 'danger',
                            callback: async () => {
                                try {
                                    await action();
                                    resolve(true);
                                } catch (error) {
                                    console.error('Destructive action failed:', error);
                                    resolve(false);
                                }
                            }
                        }
                    ]);
                }
            }
        ]);
    });
};

/**
 * Event Listener Registry for cleanup
 * Tracks all event listeners for proper cleanup on page unload
 */
window.BadmintonUtils.ListenerRegistry = class {
    constructor() {
        this.listeners = [];
        this.setupCleanup();
    }

    /**
     * Add an event listener and track it
     * @param {Element} element - DOM element
     * @param {string} event - Event name
     * @param {Function} handler - Event handler
     * @param {Object} options - Event listener options
     */
    add(element, event, handler, options = {}) {
        element.addEventListener(event, handler, options);
        this.listeners.push({ element, event, handler, options });
    }

    /**
     * Remove a specific event listener
     * @param {Element} element - DOM element
     * @param {string} event - Event name
     * @param {Function} handler - Event handler
     */
    remove(element, event, handler) {
        element.removeEventListener(event, handler);
        this.listeners = this.listeners.filter(
            l => !(l.element === element && l.event === event && l.handler === handler)
        );
    }

    /**
     * Remove all tracked event listeners
     */
    cleanup() {
        this.listeners.forEach(({ element, event, handler }) => {
            try {
                element.removeEventListener(event, handler);
            } catch (error) {
                console.error('Error removing listener:', error);
            }
        });
        this.listeners = [];
    }

    /**
     * Setup automatic cleanup on page unload
     */
    setupCleanup() {
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    /**
     * Get count of tracked listeners (for debugging)
     */
    getCount() {
        return this.listeners.length;
    }
};

/**
 * Timeout Registry for cleanup
 * Tracks all timeouts and intervals for proper cleanup
 */
window.BadmintonUtils.TimeoutRegistry = class {
    constructor() {
        this.timeouts = new Set();
        this.intervals = new Set();
        this.setupCleanup();
    }

    /**
     * Set a timeout and track it
     * @param {Function} callback - Function to call
     * @param {number} delay - Delay in milliseconds
     * @returns {number} Timeout ID
     */
    setTimeout(callback, delay) {
        const id = setTimeout(() => {
            this.timeouts.delete(id);
            callback();
        }, delay);
        this.timeouts.add(id);
        return id;
    }

    /**
     * Set an interval and track it
     * @param {Function} callback - Function to call
     * @param {number} delay - Delay in milliseconds
     * @returns {number} Interval ID
     */
    setInterval(callback, delay) {
        const id = setInterval(callback, delay);
        this.intervals.add(id);
        return id;
    }

    /**
     * Clear a timeout
     * @param {number} id - Timeout ID
     */
    clearTimeout(id) {
        clearTimeout(id);
        this.timeouts.delete(id);
    }

    /**
     * Clear an interval
     * @param {number} id - Interval ID
     */
    clearInterval(id) {
        clearInterval(id);
        this.intervals.delete(id);
    }

    /**
     * Clear all tracked timeouts and intervals
     */
    cleanup() {
        this.timeouts.forEach(id => clearTimeout(id));
        this.intervals.forEach(id => clearInterval(id));
        this.timeouts.clear();
        this.intervals.clear();
    }

    /**
     * Setup automatic cleanup on page unload
     */
    setupCleanup() {
        window.addEventListener('beforeunload', () => this.cleanup());
    }
};

console.log('✓ BadmintonUtils loaded');

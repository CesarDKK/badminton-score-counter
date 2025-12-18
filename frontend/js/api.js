/**
 * Badminton Counter API Client
 * Centralized API communication for all frontend pages
 */

const API_BASE_URL = '/api';

class BadmintonAPI {
    constructor() {
        this.token = sessionStorage.getItem('authToken');
    }

    /**
     * Make authenticated API request
     * @param {string} endpoint - API endpoint (e.g., '/settings')
     * @param {object} options - Fetch options
     * @returns {Promise} - Response JSON
     */
    async request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        // Add auth token if available and not explicitly disabled
        if (this.token && options.requiresAuth !== false) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const response = await fetch(`${API_BASE_URL}${endpoint}`, {
                ...options,
                headers
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: response.statusText }));
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`API Error [${endpoint}]:`, error);
            throw error;
        }
    }

    // ==================== Authentication ====================

    /**
     * Login with admin password
     * @param {string} password - Admin password
     * @returns {Promise<object>} - { success, token }
     */
    async login(password) {
        const result = await this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ password }),
            requiresAuth: false
        });

        if (result.token) {
            this.token = result.token;
            sessionStorage.setItem('authToken', result.token);
        }

        return result;
    }

    /**
     * Logout (clear token)
     */
    logout() {
        this.token = null;
        sessionStorage.removeItem('authToken');
    }

    /**
     * Check if user is authenticated
     * @returns {boolean}
     */
    isAuthenticated() {
        return !!this.token;
    }

    // ==================== Settings ====================

    /**
     * Get all settings
     * @returns {Promise<object>} - { courtCount }
     */
    async getSettings() {
        return this.request('/settings', { requiresAuth: false });
    }

    /**
     * Update admin password
     * @param {string} newPassword - New password
     * @returns {Promise<object>} - { success }
     */
    async updatePassword(newPassword) {
        return this.request('/settings/password', {
            method: 'PUT',
            body: JSON.stringify({ newPassword })
        });
    }

    /**
     * Update court count
     * @param {number} courtCount - Number of courts (1-20)
     * @returns {Promise<object>} - { success }
     */
    async updateCourtCount(courtCount) {
        return this.request('/settings/court-count', {
            method: 'PUT',
            body: JSON.stringify({ courtCount })
        });
    }

    /**
     * Get theme settings
     * @returns {Promise<object>} - Theme object with all colors
     */
    async getTheme() {
        return this.request('/settings/theme', { requiresAuth: false });
    }

    /**
     * Update theme settings
     * @param {object} themeData - { themeName, colorPrimary, colorAccent, colorBgDark, colorBgContainer, colorBgCard }
     * @returns {Promise<object>} - { success }
     */
    async updateTheme(themeData) {
        return this.request('/settings/theme', {
            method: 'PUT',
            body: JSON.stringify(themeData)
        });
    }

    // ==================== Courts ====================

    /**
     * Get all courts
     * @returns {Promise<Array>} - Array of court objects
     */
    async getCourts() {
        return this.request('/courts', { requiresAuth: false });
    }

    /**
     * Get specific court
     * @param {number} courtId - Court ID
     * @returns {Promise<object>} - Court object
     */
    async getCourt(courtId) {
        return this.request(`/courts/${courtId}`, { requiresAuth: false });
    }

    /**
     * Update court settings
     * @param {number} courtId - Court ID
     * @param {object} data - { isActive, isDoubles, gameMode }
     * @returns {Promise<object>} - { success }
     */
    async updateCourt(courtId, data) {
        return this.request(`/courts/${courtId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    // ==================== Game States ====================

    /**
     * Get current game state for court
     * @param {number} courtId - Court ID
     * @returns {Promise<object>} - Game state object
     */
    async getGameState(courtId) {
        return this.request(`/game-states/${courtId}`, { requiresAuth: false });
    }

    /**
     * Update game state
     * @param {number} courtId - Court ID
     * @param {object} gameState - Complete game state object
     * @returns {Promise<object>} - { success }
     */
    async updateGameState(courtId, gameState) {
        return this.request(`/game-states/${courtId}`, {
            method: 'PUT',
            body: JSON.stringify(gameState),
            requiresAuth: false // Allow public updates during gameplay
        });
    }

    /**
     * Reset court (delete game state)
     * @param {number} courtId - Court ID
     * @returns {Promise<object>} - { success }
     */
    async resetGameState(courtId) {
        return this.request(`/game-states/${courtId}`, {
            method: 'DELETE'
        });
    }

    // ==================== Match History ====================

    /**
     * Get match history for specific court
     * @param {number} courtId - Court ID
     * @param {number} limit - Max results (default 10)
     * @returns {Promise<Array>} - Array of match objects
     */
    async getCourtMatchHistory(courtId, limit = 10) {
        return this.request(`/match-history/${courtId}?limit=${limit}`, { requiresAuth: false });
    }

    /**
     * Get all match history
     * @param {number} limit - Max results (default 30)
     * @param {number} offset - Offset for pagination (default 0)
     * @returns {Promise<Array>} - Array of match objects
     */
    async getAllMatchHistory(limit = 30, offset = 0) {
        return this.request(`/match-history/all?limit=${limit}&offset=${offset}`, { requiresAuth: false });
    }

    /**
     * Save match result
     * @param {object} matchData - { courtId, winnerName, loserName, gamesWon, duration }
     * @returns {Promise<object>} - { success, id }
     */
    async saveMatchResult(matchData) {
        return this.request('/match-history', {
            method: 'POST',
            body: JSON.stringify(matchData),
            requiresAuth: false // Allow public saves after match completion
        });
    }

    // ==================== Sponsors ====================

    /**
     * Get all sponsor images
     * @returns {Promise<Array>} - Array of image objects
     */
    async getSponsorImages() {
        return this.request('/sponsors/images', { requiresAuth: false });
    }

    /**
     * Get sponsor settings
     * @returns {Promise<object>} - { slideDuration }
     */
    async getSponsorSettings() {
        return this.request('/sponsors/settings', { requiresAuth: false });
    }

    /**
     * Update sponsor settings
     * @param {number} slideDuration - Slide duration in seconds (3-60)
     * @returns {Promise<object>} - { success }
     */
    async updateSponsorSettings(slideDuration) {
        return this.request('/sponsors/settings', {
            method: 'PUT',
            body: JSON.stringify({ slideDuration })
        });
    }

    /**
     * Upload sponsor images
     * @param {FormData} formData - FormData with 'images' field
     * @returns {Promise<object>} - { success, images: [{ id, filename, url }] }
     */
    async uploadSponsorImages(formData) {
        // Special handling for multipart/form-data
        const headers = {};
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        // Don't set Content-Type header - browser will set it with boundary

        const response = await fetch(`${API_BASE_URL}/sponsors/upload`, {
            method: 'POST',
            headers,
            body: formData
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(error.error || `Upload Error: HTTP ${response.status}`);
        }

        return await response.json();
    }

    /**
     * Delete sponsor image
     * @param {number} imageId - Image ID
     * @returns {Promise<object>} - { success }
     */
    async deleteSponsorImage(imageId) {
        return this.request(`/sponsors/${imageId}`, {
            method: 'DELETE'
        });
    }

    /**
     * Delete all sponsor images
     * @returns {Promise<object>} - { success, deletedCount }
     */
    async deleteAllSponsorImages() {
        return this.request('/sponsors/all', {
            method: 'DELETE'
        });
    }
}

// Create and export singleton instance
window.BadmintonAPI = new BadmintonAPI();

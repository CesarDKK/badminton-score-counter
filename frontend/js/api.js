/**
 * Badminton Counter API Client
 * Centralized API communication for all frontend pages
 */

const API_BASE_URL = '/api';

class BadmintonAPI {
    constructor() {
        this.token = sessionStorage.getItem('authToken');
        this._initDeviceToken();
    }

    // Læser ?dt=<jwt> fra URL, gemmer i sessionStorage og renser URL
    _initDeviceToken() {
        const params = new URLSearchParams(window.location.search);
        const dt = params.get('dt');
        if (dt) {
            sessionStorage.setItem('deviceToken', dt);
            params.delete('dt');
            const clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
            window.history.replaceState({}, '', clean);
        }
        // Brug device token som auth hvis ingen klub admin session findes
        if (!this.token) {
            const deviceToken = sessionStorage.getItem('deviceToken');
            if (deviceToken) this.token = deviceToken;
        }
    }

    // Returner decoded payload fra JWT uden verifikation (til client-side brug)
    getTokenPayload() {
        const token = this.token;
        if (!token) return null;
        try {
            return JSON.parse(atob(token.split('.')[1]));
        } catch { return null; }
    }

    isDeviceSession() {
        const p = this.getTokenPayload();
        return p && p.role === 'device';
    }

    isClubAdminSession() {
        const p = this.getTokenPayload();
        return p && p.role === 'club_admin';
    }

    // Returnerer array af side-noegler klub-admin maa tilgaa, eller null = alle sider.
    getPagePermissions() {
        const p = this.getTokenPayload();
        if (!p || p.role !== 'club_admin') return null;
        return Array.isArray(p.permissions) ? p.permissions : null;
    }

    isSuperAdminSession() {
        const p = this.getTokenPayload();
        return p && p.role === 'super_admin';
    }

    /**
     * Make authenticated API request with retry logic
     * @param {string} endpoint - API endpoint (e.g., '/settings')
     * @param {object} options - Fetch options
     * @param {number} retries - Number of retries (default: 3)
     * @returns {Promise} - Response JSON
     */
    async request(endpoint, options = {}, retries = 3) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        // Add auth token if available and not explicitly disabled
        if (this.token && options.requiresAuth !== false) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        const timeout = options.timeout || 30000; // 30 second default timeout
        const maxRetries = retries;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Create abort controller for timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                const response = await fetch(`${API_BASE_URL}${endpoint}`, {
                    ...options,
                    headers,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const error = await response.json().catch(() => ({ error: response.statusText }));
                    const err = new Error(error.error || `HTTP ${response.status}`);
                    err.status = response.status;
                    err.endpoint = endpoint;

                    // Don't retry on 4xx client errors (except 429 Too Many Requests)
                    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                        throw err;
                    }

                    // On 5xx server errors or 429, retry
                    if (attempt < maxRetries) {
                        const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff: 1s, 2s, 4s
                        console.warn(`API Error [${endpoint}] (attempt ${attempt}/${maxRetries}): ${err.message}. Retrying in ${delay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }

                    throw err;
                }

                return await response.json();
            } catch (error) {
                // Handle timeout
                if (error.name === 'AbortError') {
                    error.message = `Request timeout after ${timeout}ms`;
                }

                // Handle network errors - retry
                if (attempt < maxRetries && (error.name === 'AbortError' || error.message.includes('fetch'))) {
                    const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff
                    console.warn(`Network error [${endpoint}] (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                console.error(`API Error [${endpoint}] - All retries exhausted:`, error);
                throw error;
            }
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
     * Toggle reset button visibility
     * @param {boolean} showResetButton - Whether to show reset button
     * @returns {Promise<object>} - { success }
     */
    async updateResetButtonVisibility(showResetButton) {
        return this.request('/settings/reset-button', {
            method: 'PUT',
            body: JSON.stringify({ showResetButton })
        });
    }

    async updateTvQrVisibility(hideTvQr) {
        return this.request('/settings/tv-qr', {
            method: 'PUT',
            body: JSON.stringify({ hideTvQr })
        });
    }

    /**
     * Update court page version
     * @param {string} courtVersion - Court version ('v2' or 'v3')
     * @returns {Promise<object>} - { success }
     */
    async updateCourtVersion(courtVersion) {
        return this.request('/settings/court-version', {
            method: 'PUT',
            body: JSON.stringify({ courtVersion })
        });
    }

    /**
     * Update TV view version
     * @param {string} tvVersion - TV version ('v2' or 'v3')
     * @returns {Promise<object>} - { success }
     */
    async updateTVVersion(tvVersion) {
        return this.request('/settings/tv-version', {
            method: 'PUT',
            body: JSON.stringify({ tvVersion })
        });
    }

    async updateDefaultGameMode(gameMode) {
        return this.request('/settings/game-mode', {
            method: 'PUT',
            body: JSON.stringify({ gameMode })
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
            method: 'DELETE',
            requiresAuth: false // Allow public reset during gameplay
        });
    }

    /**
     * Get all game states in a single batch request (for overview page)
     * @returns {Promise<Array>} - Array of game state objects with courtId
     */
    async getAllGameStates() {
        return this.request('/game-states/batch/all', { requiresAuth: false });
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
     * Get the newest match on a court across match_history, tournament_matches
     * and team_match_games (since turneringskampe ikke duplikeres i match_history).
     * @param {number} courtId - Court number
     * @returns {Promise<object|null>} - Normalized match object or null
     */
    async getLatestMatchForCourt(courtId) {
        return this.request(`/match-history/${courtId}/latest`, { requiresAuth: false });
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

    /**
     * Delete all match history
     * @returns {Promise<object>} - { success, message }
     */
    async deleteAllMatchHistory() {
        return this.request('/match-history/all', {
            method: 'DELETE',
            requiresAuth: true
        });
    }

    // ==================== Sponsors ====================

    /**
     * Get all sponsor images
     * @param {string} type - Optional filter: 'slideshow' or 'court'
     * @param {boolean} includeInactive - Include inactive images (for admin view)
     * @returns {Promise<Array>} - Array of image objects
     */
    async getSponsorImages(type = null, includeInactive = false) {
        let queryParam = '';
        if (type) {
            queryParam = `?type=${type}`;
            if (includeInactive) {
                queryParam += '&includeInactive=true';
            }
        } else if (includeInactive) {
            queryParam = '?includeInactive=true';
        }
        return this.request(`/sponsors/images${queryParam}`, { requiresAuth: false });
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

    // ==================== Klub-logoer (Superadmin) ====================

    async getLogos() {
        return this.request('/super-admin/logos');
    }

    /** Offentlig liste over centrale klub-logoer (til matching/visning) */
    async getPublicLogos() {
        return this.request('/logos', { requiresAuth: false });
    }

    async getPlayerLogos() {
        return this.request('/player-logos', { requiresAuth: false });
    }

    async setPlayerLogo(playerName, logoId) {
        return this.request('/player-logos', {
            method: 'PUT',
            body: JSON.stringify({ playerName, logoId })
        });
    }

    async clearPlayerLogo(playerName) {
        return this.request(`/player-logos?name=${encodeURIComponent(playerName)}`, {
            method: 'DELETE'
        });
    }

    async uploadLogo(file, clubName, aliases) {
        const fd = new FormData();
        fd.append('image', file);
        fd.append('clubName', clubName);
        fd.append('aliases', aliases || '');
        const headers = {};
        if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
        const response = await fetch(`${API_BASE_URL}/super-admin/logos`, {
            method: 'POST', headers, body: fd
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(error.error || `Upload Error: HTTP ${response.status}`);
        }
        return await response.json();
    }

    async updateLogo(id, clubName, aliases) {
        return this.request(`/super-admin/logos/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ clubName, aliases })
        });
    }

    async deleteLogo(id) {
        return this.request(`/super-admin/logos/${id}`, { method: 'DELETE' });
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

    /**
     * Update court assignments for a sponsor image
     * @param {number} imageId - Image ID
     * @param {Array<number>} courts - Array of court numbers
     * @returns {Promise<object>} - { success }
     */
    async updateSponsorImageCourts(imageId, courts) {
        return this.request(`/sponsors/${imageId}/courts`, {
            method: 'PUT',
            body: JSON.stringify({ courts })
        });
    }

    /**
     * Toggle active status for sponsor image
     * @param {number} imageId - Image ID
     * @param {boolean} isActive - Active status
     * @returns {Promise<object>} - { success }
     */
    async toggleSponsorImageActive(imageId, isActive) {
        return this.request(`/sponsors/${imageId}/active`, {
            method: 'PUT',
            body: JSON.stringify({ isActive })
        });
    }

    /**
     * Set expiration date for sponsor image
     * @param {number} imageId - Image ID
     * @param {string|null} expirationDate - ISO date string or null to clear
     * @returns {Promise<object>} - { success }
     */
    async setSponsorImageExpiration(imageId, expirationDate) {
        return this.request(`/sponsors/${imageId}/expiration`, {
            method: 'PUT',
            body: JSON.stringify({ expirationDate })
        });
    }

    // ==================== Player Info ====================

    /**
     * Get all players
     * @returns {Promise<Array>} - Array of player objects
     */
    async getPlayers() {
        return this.request('/player-info', { requiresAuth: false });
    }

    /**
     * Get specific player
     * @param {number} playerId - Player ID
     * @returns {Promise<object>} - Player object
     */
    async getPlayer(playerId) {
        return this.request(`/player-info/${playerId}`, { requiresAuth: false });
    }

    /**
     * Create new player
     * @param {object} playerData - { name, club, ageGroup }
     * @returns {Promise<object>} - { success, id, message }
     */
    async createPlayer(playerData) {
        return this.request('/player-info', {
            method: 'POST',
            body: JSON.stringify(playerData)
        });
    }

    /**
     * Update player
     * @param {number} playerId - Player ID
     * @param {object} playerData - { name, club, ageGroup }
     * @returns {Promise<object>} - { success, message }
     */
    async updatePlayer(playerId, playerData) {
        return this.request(`/player-info/${playerId}`, {
            method: 'PUT',
            body: JSON.stringify(playerData)
        });
    }

    /**
     * Delete player
     * @param {number} playerId - Player ID
     * @returns {Promise<object>} - { success, message }
     */
    async deletePlayer(playerId) {
        return this.request(`/player-info/${playerId}`, {
            method: 'DELETE'
        });
    }

    /**
     * Delete all players in age group
     * @param {string} ageGroup - Age group (U9, U11, U13, U15, U17, U19)
     * @returns {Promise<object>} - { success, deletedCount, message }
     */
    async deletePlayersByAgeGroup(ageGroup) {
        return this.request(`/player-info/age-group/${ageGroup}`, {
            method: 'DELETE'
        });
    }

    /**
     * Import multiple players at once
     * @param {Array} players - Array of player objects [{ name, club, ageGroup }]
     * @returns {Promise<object>} - { success, imported, skipped, message }
     */
    async importPlayers(players) {
        return this.request('/player-info/import', {
            method: 'POST',
            body: JSON.stringify({ players })
        });
    }

    // ==================== Team Matches (Holdkamp) ====================

    /** Get active team match with all games */
    async getActiveTeamMatch() {
        return this.request('/team-matches/active');
    }

    /** Get ALL active team matches with games */
    async getActiveTeamMatches() {
        return this.request('/team-matches/active-all');
    }

    /** Get the active game on a given court (+ its team match), or null */
    async getTeamMatchByCourt(courtId) {
        return this.request(`/team-matches/by-court/${courtId}`);
    }

    /** Get all finished team matches with games */
    async getTeamMatchHistory() {
        return this.request('/team-matches/history');
    }

    /** Create a new team match */
    async createTeamMatch(data) {
        return this.request('/team-matches', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    /** Update a specific game within a team match */
    async updateTeamMatchGame(teamMatchId, gameId, data) {
        return this.request(`/team-matches/${teamMatchId}/games/${gameId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    /** Mark team match as finished */
    async finishTeamMatch(teamMatchId) {
        return this.request(`/team-matches/${teamMatchId}/finish`, {
            method: 'PUT'
        });
    }

    /** Delete a team match */
    async deleteTeamMatch(teamMatchId) {
        return this.request(`/team-matches/${teamMatchId}`, {
            method: 'DELETE'
        });
    }

    /** Delete ALL team matches */
    async deleteAllTeamMatches() {
        return this.request('/team-matches', {
            method: 'DELETE'
        });
    }

    // ==================== Tournaments (Planlagte kampe) ====================

    /** Get all active tournaments with their matches */
    async getActiveTournaments() {
        return this.request('/tournaments/active');
    }

    /** Get tournament history (finished) */
    async getTournamentHistory() {
        return this.request('/tournaments/history');
    }

    /** Create a new tournament. sourceTournamentId (valgfri) = TS-UUID, gør senere "Opdater" muligt. */
    async createTournament(name, sourceTournamentId = null) {
        return this.request('/tournaments', {
            method: 'POST',
            body: JSON.stringify({ name, sourceTournamentId })
        });
    }

    /** Genhent TS-data og opdatér en importeret turnering (pending-kampe). */
    async syncTournamentImport(tournamentId) {
        return this.request(`/tournaments/${tournamentId}/sync-import`, {
            method: 'POST'
        });
    }

    /** Add a match to a tournament */
    async addTournamentMatch(tournamentId, match) {
        return this.request(`/tournaments/${tournamentId}/matches`, {
            method: 'POST',
            body: JSON.stringify(match)
        });
    }

    /** Update a match within a tournament */
    async updateTournamentMatch(tournamentId, matchId, updates) {
        return this.request(`/tournaments/${tournamentId}/matches/${matchId}`, {
            method: 'PUT',
            body: JSON.stringify(updates)
        });
    }

    /** Mark a tournament as finished */
    async finishTournament(tournamentId) {
        return this.request(`/tournaments/${tournamentId}/finish`, {
            method: 'PUT'
        });
    }

    /** Delete a tournament (cascade removes matches) */
    async deleteTournament(tournamentId) {
        return this.request(`/tournaments/${tournamentId}`, {
            method: 'DELETE'
        });
    }

    /** Delete ALL tournaments (used by Kamphistorik nuke button) */
    async deleteAllTournaments() {
        return this.request('/tournaments', {
            method: 'DELETE'
        });
    }

    /** Delete a single match from a tournament */
    async deleteTournamentMatch(tournamentId, matchId) {
        return this.request(`/tournaments/${tournamentId}/matches/${matchId}`, {
            method: 'DELETE'
        });
    }

    /** Bulk-add multiple matches to a tournament (used by import) */
    async addTournamentMatchesBulk(tournamentId, matches) {
        return this.request(`/tournaments/${tournamentId}/matches/bulk`, {
            method: 'POST',
            body: JSON.stringify({ matches })
        });
    }

    /** Preview a tournament import from tournamentsoftware.com URL */
    async previewTournamentImport(url) {
        return this.request('/import/tournament/preview', {
            method: 'POST',
            body: JSON.stringify({ url }),
            timeout: 45000 // scraping kan tage tid
        });
    }

    // ==================== Club Admin Auth ====================

    async loginAsClubAdmin(username, password) {
        const result = await this.request('/club-admin/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
            requiresAuth: false
        });
        if (result.token) {
            this.token = result.token;
            sessionStorage.setItem('authToken', result.token);
        }
        return result;
    }

    async changeClubAdminPassword(currentPassword, newPassword) {
        return this.request('/club-admin/password', {
            method: 'PUT',
            body: JSON.stringify({ currentPassword, newPassword })
        });
    }

    // ==================== Device Tokens ====================

    async getDeviceTokens() {
        return this.request('/device-tokens');
    }

    async createDeviceToken(name, destination, locked, showQrOnTv) {
        const body = { name, destination, locked };
        if (showQrOnTv !== undefined) body.showQrOnTv = showQrOnTv;
        return this.request('/device-tokens', {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    async updateDeviceToken(id, data) {
        return this.request(`/device-tokens/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async deleteDeviceToken(id) {
        return this.request(`/device-tokens/${id}`, {
            method: 'DELETE'
        });
    }

    async permanentlyDeleteDeviceToken(id) {
        return this.request(`/device-tokens/${id}/permanent`, {
            method: 'DELETE'
        });
    }

    // ==================== Super Admin ====================

    async loginAsSuperAdmin(username, password) {
        const result = await this.request('/super-admin/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
            requiresAuth: false
        });
        if (result.token) {
            this.token = result.token;
            sessionStorage.setItem('superAdminToken', result.token);
            sessionStorage.setItem('authToken', result.token);
        }
        return result;
    }

    async getSuperAdminClubs() {
        return this.request('/super-admin/clubs');
    }

    async createClub(name, subdomain) {
        return this.request('/super-admin/clubs', {
            method: 'POST',
            body: JSON.stringify({ name, subdomain })
        });
    }

    async toggleClub(id) {
        return this.request(`/super-admin/clubs/${id}/toggle`, {
            method: 'PUT'
        });
    }

    async getClubAdmins(clubId) {
        return this.request(`/super-admin/clubs/${clubId}/admins`);
    }

    async createClubAdmin(clubId, username, password, email, pagePermissions = null) {
        return this.request(`/super-admin/clubs/${clubId}/admins`, {
            method: 'POST',
            body: JSON.stringify({ username, password, email, pagePermissions })
        });
    }

    async updateClubAdminPermissions(clubId, adminId, pagePermissions) {
        return this.request(`/super-admin/clubs/${clubId}/admins/${adminId}/permissions`, {
            method: 'PUT',
            body: JSON.stringify({ pagePermissions })
        });
    }

    async deleteClub(clubId) {
        return this.request(`/super-admin/clubs/${clubId}`, { method: 'DELETE' });
    }

    async deleteClubAdmin(clubId, adminId) {
        return this.request(`/super-admin/clubs/${clubId}/admins/${adminId}`, {
            method: 'DELETE'
        });
    }

    async changeClubAdminPassword(clubId, adminId, password) {
        return this.request(`/super-admin/clubs/${clubId}/admins/${adminId}/password`, {
            method: 'PUT',
            body: JSON.stringify({ password })
        });
    }

    async changeSuperAdminPassword(currentPassword, newPassword) {
        return this.request('/super-admin/change-password', {
            method: 'PUT',
            body: JSON.stringify({ currentPassword, newPassword })
        });
    }

    // ==================== Super Admin — Football Clubs ====================

    async getFootballClubs() {
        return this.request('/super-admin/football/clubs');
    }

    async createFootballClub(name, subdomain) {
        return this.request('/super-admin/football/clubs', {
            method: 'POST',
            body: JSON.stringify({ name, subdomain })
        });
    }

    async toggleFootballClub(id) {
        return this.request(`/super-admin/football/clubs/${id}/toggle`, {
            method: 'PUT'
        });
    }

    async deleteFootballClub(clubId) {
        return this.request(`/super-admin/football/clubs/${clubId}`, { method: 'DELETE' });
    }

    async getFootballClubAdmins(clubId) {
        return this.request(`/super-admin/football/clubs/${clubId}/admins`);
    }

    async createFootballClubAdmin(clubId, username, password, email) {
        return this.request(`/super-admin/football/clubs/${clubId}/admins`, {
            method: 'POST',
            body: JSON.stringify({ username, password, email })
        });
    }

    async deleteFootballClubAdmin(clubId, adminId) {
        return this.request(`/super-admin/football/clubs/${clubId}/admins/${adminId}`, {
            method: 'DELETE'
        });
    }

    async changeFootballClubAdminPassword(clubId, adminId, password) {
        return this.request(`/super-admin/football/clubs/${clubId}/admins/${adminId}/password`, {
            method: 'PUT',
            body: JSON.stringify({ password })
        });
    }

    // ==================== Mode ====================

    async getMode() {
        return this.request('/mode', { requiresAuth: false });
    }
}

// Create and export singleton instance
window.BadmintonAPI = new BadmintonAPI();

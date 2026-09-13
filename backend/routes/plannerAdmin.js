/**
 * Admin-endpoints til fanen "Badmintonplanner": ugeplan (tidsvinduer og baner
 * pr. ugedag), API-nøgler og kald-log. Kræver admin-login OG side-rettigheden
 * 'planner' (tildeles pr. klub-admin fra super-admin).
 *
 *   GET    /api/planner/config
 *   PUT    /api/planner/config
 *   GET    /api/planner/tokens
 *   POST   /api/planner/tokens
 *   DELETE /api/planner/tokens/:id            (tilbagekald)
 *   DELETE /api/planner/tokens/:id/permanent  (slet tilbagekaldt nøgle)
 *   GET    /api/planner/log?limit=50
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { query, queryOne } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { requirePage } = require('../middleware/pagePermission');
const tid = require('../config/plannerTid');
const { hentConfig, gemConfig, statusFor, ENDPOINT_STI } = require('./plannerIntegration');

router.use(authMiddleware, requirePage('planner'));

// GET /api/planner/config
router.get('/config', async (req, res, next) => {
    try {
        const config = await hentConfig();
        res.json({ ...config, status: statusFor(config), endpointPath: ENDPOINT_STI });
    } catch (e) { next(e); }
});

// PUT /api/planner/config — { enabled, days: { "1": { from, to, courts } } }
router.put('/config', async (req, res, next) => {
    try {
        const n = tid.normaliserConfig(req.body);
        if (n.error) return res.status(400).json({ error: n.error });
        await gemConfig(n.value);
        res.json({ ...n.value, status: statusFor(n.value), endpointPath: ENDPOINT_STI });
    } catch (e) { next(e); }
});

// GET /api/planner/tokens
router.get('/tokens', async (req, res, next) => {
    try {
        const rows = await query(
            `SELECT id, token, name, is_active, created_at, last_used_at, revoked_at
             FROM planner_tokens ORDER BY created_at DESC`
        );
        res.json(rows);
    } catch (e) { next(e); }
});

// POST /api/planner/tokens — { name }
router.post('/tokens', async (req, res, next) => {
    try {
        const name = tid.rensTekst(req.body && req.body.name, 100);
        if (!name) return res.status(400).json({ error: 'Giv nøglen et navn' });
        const token = crypto.randomBytes(32).toString('hex');
        const r = await query('INSERT INTO planner_tokens (token, name) VALUES (?, ?)', [token, name]);
        const created = await queryOne(
            'SELECT id, token, name, is_active, created_at, last_used_at, revoked_at FROM planner_tokens WHERE id = ?',
            [r.insertId]
        );
        res.status(201).json(created);
    } catch (e) { next(e); }
});

// DELETE /api/planner/tokens/:id — tilbagekald (virker med det samme)
router.delete('/tokens/:id', async (req, res, next) => {
    try {
        const r = await query(
            'UPDATE planner_tokens SET is_active = 0, revoked_at = NOW() WHERE id = ? AND is_active = 1',
            [req.params.id]
        );
        if (r.affectedRows === 0) return res.status(404).json({ error: 'Nøgle ikke fundet eller allerede tilbagekaldt' });
        res.json({ success: true });
    } catch (e) { next(e); }
});

// DELETE /api/planner/tokens/:id/permanent — kun tilbagekaldte nøgler
router.delete('/tokens/:id/permanent', async (req, res, next) => {
    try {
        const r = await query('DELETE FROM planner_tokens WHERE id = ? AND is_active = 0', [req.params.id]);
        if (r.affectedRows === 0) return res.status(400).json({ error: 'Tilbagekald nøglen først' });
        res.json({ success: true });
    } catch (e) { next(e); }
});

// GET /api/planner/log?limit=50 — seneste kald, nyeste først
router.get('/log', async (req, res, next) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const rows = await query(
            `SELECT id, received_at, token_name, ip, endpoint, http_status, round_id, label, match_count, result_json, error_text
             FROM planner_log ORDER BY id DESC LIMIT ${limit}`
        );
        res.json(rows.map(r => {
            let result = null;
            if (r.result_json) { try { result = JSON.parse(r.result_json); } catch { /* tomt */ } }
            return { ...r, result, result_json: undefined };
        }));
    } catch (e) { next(e); }
});

module.exports = router;

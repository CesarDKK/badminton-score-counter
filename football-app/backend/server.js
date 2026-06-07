const express = require('express');
const cors = require('cors');
const path = require('path');

const { tenantMiddleware } = require('./middleware/tenant');

const authRoutes = require('./routes/auth');
const tournamentRoutes = require('./routes/tournaments');
const matchRoutes = require('./routes/matches');
const teamRoutes = require('./routes/teams');

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';

app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Tenant middleware kører på ALLE requests og udleder klub fra subdomain.
// Sætter req.clubId / req.clubSubdomain / req.clubName (eller null på apex).
app.use(tenantMiddleware);

app.use('/api/auth', authRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api', matchRoutes);
app.use('/api/teams', teamRoutes);

app.use('/api/uploads', express.static(UPLOAD_DIR, {
  maxAge: '1d',
  immutable: false,
}));

app.use((err, req, res, next) => {
  console.error('unhandled error', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Football backend listening on port ${PORT}`);
});

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── CORS ──────────────────────────────────────────────────────
// In production, only allow requests from your Netlify frontend.
// Netlify's own proxy already rewrites /api/* so the browser
// origin will be your Netlify domain, not the Render domain.
// Set ALLOWED_ORIGIN=https://your-site.netlify.app in Render env vars.
const corsOptions = {
  origin: isProd
    ? (process.env.ALLOWED_ORIGIN || '*')   // set in Render dashboard
    : '*',                                   // open in local dev
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));
app.options('/{*path}', cors(corsOptions)); // preflight

// ── BODY PARSING ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── STATIC FILES ──────────────────────────────────────────────
// On Render the backend also serves uploads (audio, social images).
// The frontend (HTML) is served by Netlify — not needed here in prod,
// but kept so the app still works when running locally.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
if (!isProd) {
  app.use(express.static(path.join(__dirname, 'public')));
}

// ── API ROUTES ────────────────────────────────────────────────
app.use('/api/auth',   require('./routes/auth').default);
app.use('/api/music',  require('./routes/music').default);
app.use('/api/social', require('./routes/social').default);

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', env: process.env.NODE_ENV, time: new Date().toISOString() })
);

// ── SPA FALLBACK (local dev only) ────────────────────────────
if (!isProd) {
  app.get('/{*path}', (req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
  );
}

// ── START ─────────────────────────────────────────────────────
getDb().then(() => {
  app.listen(PORT, () => {
    console.log(`🎵 SOLACE ${isProd ? 'PRODUCTION' : 'DEV'} running at http://localhost:${PORT}`);
    if (isProd) console.log(`   CORS origin: ${process.env.ALLOWED_ORIGIN || '* (open)'}`);
  });
}).catch(err => {
  console.error('❌ DB init failed:', err);
  process.exit(1);
});

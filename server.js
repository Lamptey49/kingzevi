import 'dotenv/config';
import express from 'express';
import cors    from 'cors';
import path    from 'path';
import { fileURLToPath } from 'url';
import { connect }       from './db/connection.js';
import authRouter        from './routes/auth.js';
import musicRouter       from './routes/music.js';
import socialRouter      from './routes/social.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app       = express();
const PORT      = process.env.PORT ?? 3000;
const isProd    = process.env.NODE_ENV === 'production';

// ── CORS ──────────────────────────────────────────────────────
const corsOptions = {
  origin:         isProd ? (process.env.ALLOWED_ORIGIN ?? '*') : '*',
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials:    true,
};
app.use(cors(corsOptions));
app.options('/{*path}', cors(corsOptions));

// ── BODY / STATIC ─────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
if (!isProd) app.use(express.static(path.join(__dirname, 'public')));

// ── API ROUTES ────────────────────────────────────────────────
app.use('/api/auth',   authRouter);
app.use('/api/music',  musicRouter);
app.use('/api/social', socialRouter);

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', db: 'mongodb', env: process.env.NODE_ENV, time: new Date().toISOString() }),
);

if (!isProd) {
  app.get('/{*path}', (req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'index.html')),
  );
}

// ── START ─────────────────────────────────────────────────────
connect()
  .then(() => app.listen(PORT, () =>
    console.log(`🎵 KINGZEVI ${isProd ? 'PRODUCTION' : 'DEV'} → http://localhost:${PORT}`),
  ))
  .catch((err) => {
    console.error('❌ Startup failed:', err.message);
    process.exit(1);
  });

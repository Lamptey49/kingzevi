require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE_URL = (process.env.API_BASE_URL || '').replace(/\/$/, '');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get('/config.js', (req, res) => {
  res.type('application/javascript').send(
    `window.__APP_CONFIG__ = ${JSON.stringify({ apiBaseUrl: API_BASE_URL })};`
  );
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/music', require('./routes/music'));
app.use('/api/social', require('./routes/social'));
app.use('/api/admin', require('./routes/admin'));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'dashboard.html')));
app.get(['/fan-dashboard', '/fan-dashboard/'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'fan-dashboard.html')));
app.get('/{*path}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

getDb().then(() => {
  app.listen(PORT, () => console.log(`🎵 SOLACE running at http://localhost:${PORT}`));
});

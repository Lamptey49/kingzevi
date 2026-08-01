import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { all, get, run } from '../db/database.js';
import { requireAuth, requireArtist, optionalAuth } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// ── Audio upload ──────────────────────────────────────────────
const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, uuid() + path.extname(file.originalname)),
});

const upload = multer({
  storage: audioStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'];
    allowed.includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true)
      : cb(new Error('Audio files only'));
  },
});

// ── GET /api/music ────────────────────────────────────────────
router.get('/', optionalAuth, (req, res) => {
  const { type } = req.query;
  let sql = `
    SELECT m.*, u.username AS artist_name, u.avatar AS artist_avatar,
      (SELECT COUNT(*) FROM tracks t WHERE t.music_id = m.id) AS track_count,
      (SELECT COUNT(*) FROM streams s JOIN tracks t ON s.track_id = t.id WHERE t.music_id = m.id) AS stream_count
    FROM music m
    JOIN users u ON u.id = m.artist_id`;
  const params = [];
  if (type) { sql += ' WHERE m.type = ?'; params.push(type); }
  sql += ' ORDER BY m.created_at DESC';

  const music = all(sql, params);
  music.forEach((m) => {
    m.tracks = all('SELECT * FROM tracks WHERE music_id = ? ORDER BY track_number', [m.id]);
    m.allow_download = Boolean(m.allow_download);
  });
  res.json({ music });
});

// ── GET /api/music/stats/artist ───────────────────────────────
router.get('/stats/artist', requireArtist, (req, res) => {
  res.json({
    tracks:    get('SELECT COUNT(*) AS c FROM tracks t JOIN music m ON m.id = t.music_id WHERE m.artist_id = ?', [req.user.id]).c,
    albums:    get("SELECT COUNT(*) AS c FROM music WHERE artist_id = ? AND type = 'album'", [req.user.id]).c,
    streams:   get('SELECT COUNT(*) AS c FROM streams s JOIN tracks t ON s.track_id = t.id JOIN music m ON t.music_id = m.id WHERE m.artist_id = ?', [req.user.id]).c,
    downloads: get('SELECT COUNT(*) AS c FROM downloads d JOIN music m ON d.music_id = m.id WHERE m.artist_id = ?', [req.user.id]).c,
  });
});

// ── GET /api/music/:id ────────────────────────────────────────
router.get('/:id', optionalAuth, (req, res) => {
  const m = get(
    'SELECT m.*, u.username AS artist_name FROM music m JOIN users u ON u.id = m.artist_id WHERE m.id = ?',
    [req.params.id],
  );
  if (!m) return res.status(404).json({ error: 'Not found' });
  m.tracks = all('SELECT * FROM tracks WHERE music_id = ? ORDER BY track_number', [m.id]);
  m.allow_download = Boolean(m.allow_download);
  res.json({ music: m });
});

// ── POST /api/music ───────────────────────────────────────────
router.post('/', requireArtist, upload.array('audio', 20), (req, res) => {
  try {
    const { type, title, genre, year, emoji, description, allow_download, tracks } = req.body;
    if (!type || !title) return res.status(400).json({ error: 'type and title required' });

    const mid = uuid();
    run(
      'INSERT INTO music (id,type,title,genre,year,emoji,description,allow_download,artist_id) VALUES (?,?,?,?,?,?,?,?,?)',
      [mid, type, title, genre ?? null, year ? parseInt(year, 10) : null,
       emoji ?? (type === 'album' ? '💿' : '🎵'),
       description ?? null,
       allow_download === 'false' ? 0 : 1,
       req.user.id],
    );

    if (type === 'single') {
      const file = req.files?.[0];
      run('INSERT INTO tracks (id,music_id,track_number,title,filename) VALUES (?,?,?,?,?)',
        [uuid(), mid, 1, title, file?.filename ?? null]);
    } else {
      const trackList = tracks
        ? (typeof tracks === 'string' ? JSON.parse(tracks) : tracks)
        : [];
      const files = req.files ?? [];
      trackList.forEach((t, i) =>
        run('INSERT INTO tracks (id,music_id,track_number,title,duration,filename) VALUES (?,?,?,?,?,?)',
          [uuid(), mid, i + 1, t.title ?? `Track ${i + 1}`, t.duration ?? '0:00', files[i]?.filename ?? null]),
      );
    }

    const created = get(
      'SELECT m.*, u.username AS artist_name FROM music m JOIN users u ON u.id = m.artist_id WHERE m.id = ?',
      [mid],
    );
    created.tracks = all('SELECT * FROM tracks WHERE music_id = ? ORDER BY track_number', [mid]);
    created.allow_download = Boolean(created.allow_download);
    res.status(201).json({ music: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/music/:id ─────────────────────────────────────
router.delete('/:id', requireArtist, (req, res) => {
  const m = get('SELECT * FROM music WHERE id = ?', [req.params.id]);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.artist_id !== req.user.id) return res.status(403).json({ error: 'Not your music' });
  run('DELETE FROM tracks WHERE music_id = ?', [req.params.id]);
  run('DELETE FROM music WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ── POST /api/music/stream/:trackId ──────────────────────────
router.post('/stream/:trackId', optionalAuth, (req, res) => {
  const t = get('SELECT id FROM tracks WHERE id = ?', [req.params.trackId]);
  if (!t) return res.status(404).json({ error: 'Track not found' });
  run('INSERT INTO streams (id,user_id,track_id) VALUES (?,?,?)',
    [uuid(), req.user?.id ?? null, req.params.trackId]);
  res.json({ success: true });
});

// ── POST /api/music/download/:id ──────────────────────────────
router.post('/download/:id', requireAuth, (req, res) => {
  const m = get('SELECT * FROM music WHERE id = ? AND allow_download = 1', [req.params.id]);
  if (!m) return res.status(404).json({ error: 'Not found or download not allowed' });
  run('INSERT INTO downloads (id,user_id,music_id) VALUES (?,?,?)',
    [uuid(), req.user.id, req.params.id]);
  res.json({ success: true });
});

export default router;

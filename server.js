const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { initDb, listMusic, run, all } = require('./src/db');
const {
  authenticateUser,
  createSession,
  currentUser,
  logout,
  registerUser,
  requireAuth,
  requireRole
} = require('./src/auth');

const app = express();
const port = Number(process.env.PORT || 3000);
const rootDir = __dirname;
const uploadDir = path.join(rootDir, 'uploads');

fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const safeBase = path
        .basename(file.originalname, path.extname(file.originalname))
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'audio';
      cb(null, `${Date.now()}-${safeBase}${path.extname(file.originalname).toLowerCase()}`);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) cb(null, true);
    else cb(new Error('Only audio files are allowed.'));
  }
});

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(uploadDir));
app.use('/admin', requireAuth, requireRole('artist', 'admin'), express.static(path.join(rootDir, 'admin'), { extensions: ['html'] }));
app.use(express.static(rootDir, { extensions: ['html'] }));

function cleanText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function cleanYear(value) {
  const year = Number.parseInt(value, 10);
  if (!Number.isFinite(year)) return new Date().getFullYear();
  return Math.min(2030, Math.max(2000, year));
}

function createId(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res, next) => {
  try {
    res.json({ user: await currentUser(req) });
  } catch (error) {
    next(error);
  }
});
app.get('/', (_req, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

app.get('/admin', (_req, res) => {
  res.redirect('/admin/');
});

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const user = await registerUser({
      name: req.body.name,
      email: req.body.email,
      password: req.body.password,
      requestedRole: req.body.role
    });
    await createSession(res, user.id);
    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const user = await authenticateUser(req.body);
    await createSession(res, user.id);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    await logout(req, res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/music', async (_req, res, next) => {
  try {
    res.json(await listMusic());
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/music', requireAuth, requireRole('artist', 'admin'), async (_req, res, next) => {
  try {
    res.json(await listMusic());
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/users', requireAuth, requireRole('artist', 'admin'), async (_req, res, next) => {
  try {
    const users = await all(
      `SELECT id, name, email, role, created_at AS createdAt
       FROM users
       ORDER BY datetime(created_at) DESC`
    );
    res.json({ users });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/dashboard', requireAuth, requireRole('artist', 'admin'), async (_req, res, next) => {
  try {
    const music = await listMusic();
    const users = await all(
      `SELECT id, name, email, role, created_at AS createdAt
       FROM users
       ORDER BY datetime(created_at) DESC`
    );
    res.json({
      music,
      users,
      stats: {
        totalUsers: users.length,
        totalSingles: music.singles.length,
        totalAlbums: music.albums.length
      }
    });
  } catch (error) {
    next(error);
  }
});

app.post(
  '/api/music/singles',
  requireAuth,
  requireRole('artist', 'admin'),
  upload.single('audio'),
  async (req, res, next) => {
    try {
      const title = cleanText(req.body.title);
      if (!title) return res.status(400).json({ error: 'Track title is required.' });

      const id = createId('s');
      await run(
        `INSERT INTO singles
         (id, title, genre, release_year, emoji, description, allow_download, audio_path, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          title,
          cleanText(req.body.genre, 'Other'),
          cleanYear(req.body.year),
          cleanText(req.body.emoji, '🎵').slice(0, 8),
          cleanText(req.body.desc),
          req.body.download === 'false' ? 0 : 1,
          req.file ? `/uploads/${req.file.filename}` : null,
          req.user.id
        ]
      );

      res.status(201).json(await listMusic());
    } catch (error) {
      next(error);
    }
  }
);

app.post('/api/music/albums', requireAuth, requireRole('artist', 'admin'), async (req, res, next) => {
  try {
    const title = cleanText(req.body.title);
    if (!title) return res.status(400).json({ error: 'Album title is required.' });

    const id = createId('a');
    const tracks = Array.isArray(req.body.tracks) && req.body.tracks.length
      ? req.body.tracks
      : [{ name: 'Track 1', dur: '3:00' }];

    await run(
      `INSERT INTO albums
       (id, title, genre, release_year, emoji, description, allow_download, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        title,
        cleanText(req.body.genre, 'Other'),
        cleanYear(req.body.year),
        cleanText(req.body.emoji, '💿').slice(0, 8),
        cleanText(req.body.desc),
        req.body.download === false ? 0 : 1,
        req.user.id
      ]
    );

    for (let index = 0; index < tracks.length; index += 1) {
      await run(
        `INSERT INTO album_tracks (album_id, title, duration, track_order)
         VALUES (?, ?, ?, ?)`,
        [
          id,
          cleanText(tracks[index].name, `Track ${index + 1}`),
          cleanText(tracks[index].dur, '3:00'),
          index + 1
        ]
      );
    }

    res.status(201).json(await listMusic());
  } catch (error) {
    next(error);
  }
});

app.put('/api/music/singles/:id', requireAuth, requireRole('artist', 'admin'), async (req, res, next) => {
  try {
    const single = await get('SELECT id FROM singles WHERE id = ?', [req.params.id]);
    if (!single) return res.status(404).json({ error: 'Single not found.' });

    await run(
      `UPDATE singles SET title = ?, genre = ?, release_year = ?, emoji = ?, description = ?, allow_download = ?
       WHERE id = ?`,
      [
        cleanText(req.body.title),
        cleanText(req.body.genre, 'Other'),
        cleanYear(req.body.year),
        cleanText(req.body.emoji, '🎵').slice(0, 8),
        cleanText(req.body.desc),
        req.body.download === false ? 0 : 1,
        req.params.id
      ]
    );

    res.json(await listMusic());
  } catch (error) {
    next(error);
  }
});

app.delete('/api/music/singles/:id', requireAuth, requireRole('artist', 'admin'), async (req, res, next) => {
  try {
    await run('DELETE FROM singles WHERE id = ?', [req.params.id]);
    res.json(await listMusic());
  } catch (error) {
    next(error);
  }
});

app.put('/api/music/albums/:id', requireAuth, requireRole('artist', 'admin'), async (req, res, next) => {
  try {
    const album = await get('SELECT id FROM albums WHERE id = ?', [req.params.id]);
    if (!album) return res.status(404).json({ error: 'Album not found.' });

    await run(
      `UPDATE albums SET title = ?, genre = ?, release_year = ?, emoji = ?, description = ?, allow_download = ?
       WHERE id = ?`,
      [
        cleanText(req.body.title),
        cleanText(req.body.genre, 'Other'),
        cleanYear(req.body.year),
        cleanText(req.body.emoji, '💿').slice(0, 8),
        cleanText(req.body.desc),
        req.body.download === false ? 0 : 1,
        req.params.id
      ]
    );

    if (Array.isArray(req.body.tracks)) {
      await run('DELETE FROM album_tracks WHERE album_id = ?', [req.params.id]);
      const tracks = req.body.tracks.length ? req.body.tracks : [{ name: 'Track 1', dur: '3:00' }];
      for (let index = 0; index < tracks.length; index += 1) {
        await run(
          `INSERT INTO album_tracks (album_id, title, duration, track_order)
           VALUES (?, ?, ?, ?)`,
          [
            req.params.id,
            cleanText(tracks[index].name, `Track ${index + 1}`),
            cleanText(tracks[index].dur, '3:00'),
            index + 1
          ]
        );
      }
    }

    res.json(await listMusic());
  } catch (error) {
    next(error);
  }
});

app.delete('/api/music/albums/:id', requireAuth, requireRole('artist', 'admin'), async (req, res, next) => {
  try {
    await run('DELETE FROM albums WHERE id = ?', [req.params.id]);
    res.json(await listMusic());
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  const message = status === 500 ? 'Server error.' : error.message;
  if (status === 500) console.error(error);
  res.status(status).json({ error: message });
});

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`KZ server running at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  });

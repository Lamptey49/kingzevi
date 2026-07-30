const express = require('express');
const { all } = require('../db/database');
const { requireArtist } = require('../middleware/auth');

const router = express.Router();

function toMusicItem(row, tracks = []) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    genre: row.genre,
    year: row.year,
    emoji: row.emoji,
    desc: row.description,
    download: Boolean(row.allow_download),
    audioPath: row.filename ? `/uploads/${row.filename}` : null,
    artistId: row.artist_id,
    artistName: row.artist_name,
    createdAt: row.created_at,
    tracks
  };
}

router.get('/dashboard', requireArtist, (req, res) => {
  const users = all(`
    SELECT id, username AS name, username, email, role, avatar, created_at AS createdAt
    FROM users
    ORDER BY datetime(created_at) DESC
  `);

  const rows = all(`
    SELECT m.*, u.username AS artist_name,
           (SELECT filename FROM tracks t WHERE t.music_id=m.id ORDER BY t.track_number LIMIT 1) AS filename
    FROM music m
    JOIN users u ON u.id=m.artist_id
    ORDER BY datetime(m.created_at) DESC
  `);

  const tracks = all(`
    SELECT id, music_id AS musicId, track_number AS trackNumber, title, duration, filename
    FROM tracks
    ORDER BY track_number ASC
  `);

  const music = rows.map((row) => toMusicItem(
    row,
    tracks
      .filter((track) => track.musicId === row.id)
      .map((track) => ({
        ...track,
        audioPath: track.filename ? `/uploads/${track.filename}` : null
      }))
  ));

  res.json({
    stats: {
      totalUsers: users.length,
      totalSingles: music.filter((item) => item.type === 'single').length,
      totalAlbums: music.filter((item) => item.type === 'album').length
    },
    users,
    music: {
      singles: music.filter((item) => item.type === 'single'),
      albums: music.filter((item) => item.type === 'album')
    }
  });
});

module.exports = router;

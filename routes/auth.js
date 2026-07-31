const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { get, run } = require('../db/database');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role, avatar } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'Username, email, and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (get('SELECT id FROM users WHERE email = ?', [email])) return res.status(409).json({ error: 'Email already in use' });
    if (get('SELECT id FROM users WHERE username = ?', [username])) return res.status(409).json({ error: 'Username already taken' });

    const userRole = role === 'artist' ? 'artist' : 'fan';
    const userAvatar = avatar || (userRole === 'artist' ? '🎤' : '🎧');
    const hash = await bcrypt.hash(password, 12);
    const id = uuid();
    run('INSERT INTO users (id,username,email,password_hash,role,avatar) VALUES (?,?,?,?,?,?)', [id, username, email, hash, userRole, userAvatar]);

    const token = signToken({ id, username, email, role: userRole, avatar: userAvatar });
    res.status(201).json({ token, user: { id, username, email, role: userRole, avatar: userAvatar } });
  } catch (e) { res.status(500).json({ error: 'Registration failed' }); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });

    const token = signToken({ id: user.id, username: user.username, email: user.email, role: user.role, avatar: user.avatar });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role, avatar: user.avatar } });
  } catch (e) { res.status(500).json({ error: 'Login failed' }); }
});

router.get('/me', requireAuth, (req, res) => {
  const user = get('SELECT id,username,email,role,avatar,bio,created_at FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const { get, run } = require('../db/database');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads', 'tmp') });

router.post('/register', async (req, res) => {
  try {
    const { email, password, role, avatar } = req.body;
    const username = String(req.body.username || req.body.name || '').trim();
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

router.put('/profile', requireAuth, upload.single('avatar'), async (req, res) => {
  try {
    const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const username = String(req.body.username || req.body.name || user.username || '').trim();
    const email = String(req.body.email || user.email || '').trim();
    const bio = String(req.body.bio ?? user.bio ?? '');
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');

    if (!username || !email) return res.status(400).json({ error: 'Username and email are required' });

    const existingUser = get('SELECT id FROM users WHERE (email = ? OR username = ?) AND id != ?', [email, username, user.id]);
    if (existingUser) return res.status(409).json({ error: 'Email or username is already taken' });

    let avatar = user.avatar;
    if (req.body && req.body.avatar) {
      avatar = req.body.avatar;
    }
    if (req.file) {
      const uploadsDir = path.join(__dirname, '..', 'uploads', 'avatars');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const safeName = `${uuid()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const targetPath = path.join(uploadsDir, safeName);
      fs.renameSync(req.file.path, targetPath);
      avatar = `/uploads/avatars/${safeName}`;
    }

    if (currentPassword || newPassword) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password is required to change your password' });
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
      if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
      const hash = await bcrypt.hash(newPassword, 12);
      run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
    }

    run('UPDATE users SET username = ?, email = ?, bio = ?, avatar = ? WHERE id = ?', [username, email, bio, avatar, user.id]);

    const updatedUser = get('SELECT id,username,email,role,avatar,bio,created_at FROM users WHERE id = ?', [req.user.id]);
    const token = signToken({ id: updatedUser.id, username: updatedUser.username, email: updatedUser.email, role: updatedUser.role, avatar: updatedUser.avatar });

    res.json({ token, user: updatedUser });
  } catch (error) {
    res.status(500).json({ error: 'Profile update failed' });
  }
});

router.post('/logout', (req, res) => {
  res.json({ success: true });
});

module.exports = router;

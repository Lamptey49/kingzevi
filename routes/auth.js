import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../db/models.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = Router();

// ── POST /api/auth/register ───────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role, avatar } = req.body;

    if (!username || !email || !password)
      return res.status(400).json({ error: 'Username, email, and password are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const conflict = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (conflict?.email === email.toLowerCase())
      return res.status(409).json({ error: 'Email already in use' });
    if (conflict?.username === username)
      return res.status(409).json({ error: 'Username already taken' });

    const userRole   = role === 'artist' ? 'artist' : 'fan';
    const userAvatar = avatar ?? (userRole === 'artist' ? '🎤' : '🎧');
    const hash       = await bcrypt.hash(password, 12);

    const user = await User.create({
      username, email, password_hash: hash, role: userRole, avatar: userAvatar,
    });

    const payload = { id: user.id, username, email, role: userRole, avatar: userAvatar };
    res.status(201).json({ token: signToken(payload), user: payload });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Invalid email or password' });

    const payload = { id: user.id, username: user.username, email: user.email, role: user.role, avatar: user.avatar };
    res.json({ token: signToken(payload), user: payload });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password_hash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: { id: user.id, username: user.username, email: user.email, role: user.role, avatar: user.avatar, bio: user.bio, created_at: user.created_at } });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

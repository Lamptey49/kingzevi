const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'solace_secret_2026';

const signToken = payload => jwt.sign(payload, SECRET, { expiresIn: '7d' });

function requireAuth(req, res, next) {
  const h = req.headers['authorization'];
  const tok = h && h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!tok) return res.status(401).json({ error: 'Authentication required' });
  try { req.user = jwt.verify(tok, SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

function requireArtist(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'artist') return res.status(403).json({ error: 'Artist access required' });
    next();
  });
}

function optionalAuth(req, res, next) {
  const h = req.headers['authorization'];
  const tok = h && h.startsWith('Bearer ') ? h.slice(7) : null;
  if (tok) { try { req.user = jwt.verify(tok, SECRET); } catch {} }
  next();
}

module.exports = { signToken, requireAuth, requireArtist, optionalAuth };

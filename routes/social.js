import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { all, get, run } from '../db/database.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// ── Image upload ──────────────────────────────────────────────
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/social');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, uuid() + path.extname(file.originalname)),
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    allowed.includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true)
      : cb(new Error('Image files only (jpg, png, gif, webp)'));
  },
});

// ── Helper ────────────────────────────────────────────────────
function enrichPosts(posts, userId) {
  return posts.map((p) => ({
    ...p,
    liked_by_me: userId
      ? Boolean(get('SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?', [p.id, userId]))
      : false,
  }));
}

// ── GET /api/social/posts ─────────────────────────────────────
router.get('/posts', optionalAuth, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const offset = (Math.max(parseInt(req.query.page,  10) || 1,  1) - 1) * limit;

  const posts = all(
    `SELECT p.*, u.username, u.avatar, u.role
     FROM posts p
     JOIN users u ON u.id = p.user_id
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  const total = get('SELECT COUNT(*) AS c FROM posts').c;

  res.json({
    posts: enrichPosts(posts, req.user?.id),
    total,
    page:  Math.floor(offset / limit) + 1,
    pages: Math.ceil(total / limit),
  });
});

// ── POST /api/social/posts ────────────────────────────────────
router.post('/posts', requireAuth, uploadImage.single('image'), (req, res) => {
  try {
    const { content } = req.body;
    const file = req.file;

    if (!content && !file)
      return res.status(400).json({ error: 'Post must have text or an image' });
    if (content?.length > 1000)
      return res.status(400).json({ error: 'Post text must be under 1000 characters' });

    const id       = uuid();
    const postType = file ? 'image' : 'text';
    const imageUrl = file ? `/uploads/social/${file.filename}` : null;

    run(
      'INSERT INTO posts (id,user_id,content,image_filename,image_url,post_type) VALUES (?,?,?,?,?,?)',
      [id, req.user.id, content ?? null, file?.filename ?? null, imageUrl, postType],
    );

    const post = get(
      `SELECT p.*, u.username, u.avatar, u.role
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.id = ?`,
      [id],
    );
    res.status(201).json({ post: enrichPosts([post], req.user.id)[0] });
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ error: err.message ?? 'Failed to create post' });
  }
});

// ── DELETE /api/social/posts/:id ──────────────────────────────
router.delete('/posts/:id', requireAuth, (req, res) => {
  const post = get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.user_id !== req.user.id) return res.status(403).json({ error: 'Not your post' });

  if (post.image_filename) {
    const fp = path.join(__dirname, '../uploads/social', post.image_filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  run('DELETE FROM comments  WHERE post_id = ?', [req.params.id]);
  run('DELETE FROM post_likes WHERE post_id = ?', [req.params.id]);
  run('DELETE FROM posts      WHERE id = ?',      [req.params.id]);
  res.json({ success: true });
});

// ── POST /api/social/posts/:id/like ──────────────────────────
router.post('/posts/:id/like', requireAuth, (req, res) => {
  const post = get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const existing = get(
    'SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?',
    [req.params.id, req.user.id],
  );

  if (existing) {
    run('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    run('UPDATE posts SET like_count = MAX(0, like_count - 1) WHERE id = ?', [req.params.id]);
    res.json({ liked: false, like_count: Math.max(0, (post.like_count ?? 0) - 1) });
  } else {
    run('INSERT INTO post_likes (id,post_id,user_id) VALUES (?,?,?)',
      [uuid(), req.params.id, req.user.id]);
    run('UPDATE posts SET like_count = like_count + 1 WHERE id = ?', [req.params.id]);
    res.json({ liked: true, like_count: (post.like_count ?? 0) + 1 });
  }
});

// ── GET /api/social/posts/:id/comments ───────────────────────
router.get('/posts/:id/comments', optionalAuth, (req, res) => {
  const comments = all(
    `SELECT c.*, u.username, u.avatar, u.role
     FROM comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ?
     ORDER BY c.created_at ASC`,
    [req.params.id],
  );
  res.json({ comments });
});

// ── POST /api/social/posts/:id/comments ──────────────────────
router.post('/posts/:id/comments', requireAuth, (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });
  if (content.length > 500) return res.status(400).json({ error: 'Comment must be under 500 characters' });

  const post = get('SELECT id FROM posts WHERE id = ?', [req.params.id]);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const id = uuid();
  run('INSERT INTO comments (id,post_id,user_id,content) VALUES (?,?,?,?)',
    [id, req.params.id, req.user.id, content.trim()]);
  run('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?', [req.params.id]);

  const comment = get(
    `SELECT c.*, u.username, u.avatar, u.role
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.id = ?`,
    [id],
  );
  res.status(201).json({ comment });
});

// ── DELETE /api/social/comments/:id ──────────────────────────
router.delete('/comments/:id', requireAuth, (req, res) => {
  const c = get('SELECT * FROM comments WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Comment not found' });
  if (c.user_id !== req.user.id) return res.status(403).json({ error: 'Not your comment' });

  run('DELETE FROM comments WHERE id = ?', [req.params.id]);
  run('UPDATE posts SET comment_count = MAX(0, comment_count - 1) WHERE id = ?', [c.post_id]);
  res.json({ success: true });
});

// ── GET /api/social/stats ─────────────────────────────────────
router.get('/stats', optionalAuth, (req, res) => {
  res.json({
    total_posts:    get('SELECT COUNT(*) AS c FROM posts').c,
    total_comments: get('SELECT COUNT(*) AS c FROM comments').c,
    total_likes:    get('SELECT COUNT(*) AS c FROM post_likes').c,
    active_fans:    get('SELECT COUNT(DISTINCT user_id) AS c FROM posts').c,
  });
});

export default router;

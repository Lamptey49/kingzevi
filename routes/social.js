import { Router }        from 'express';
import multer            from 'multer';
import path              from 'path';
import fs                from 'fs';
import { fileURLToPath } from 'url';
import { Post, PostLike, Comment } from '../db/models.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router    = Router();

// ── Image upload ──────────────────────────────────────────────
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/social');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true)
      : cb(new Error('Image files only (jpg, png, gif, webp)'));
  },
});

// ── Serialiser ────────────────────────────────────────────────
function serializePost(post, likedByMe = false) {
  const u = post.user_id;                       // populated User doc
  return {
    id:            post._id.toString(),
    user_id:       u?._id?.toString() ?? post.user_id?.toString(),
    content:       post.content ?? null,
    image_url:     post.image_url ?? null,
    post_type:     post.post_type,
    like_count:    post.like_count,
    comment_count: post.comment_count,
    created_at:    post.created_at,
    liked_by_me:   likedByMe,
    username:      u?.username ?? '',
    avatar:        u?.avatar   ?? '🎧',
    role:          u?.role     ?? 'fan',
  };
}

// ── GET /api/social/posts ─────────────────────────────────────
router.get('/posts', optionalAuth, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const page   = Math.max(parseInt(req.query.page,  10) || 1,  1);
    const skip   = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      Post.find()
        .populate('user_id', 'username avatar role')
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Post.countDocuments(),
    ]);

    // Build liked-by-me map in one query
    let likedSet = new Set();
    if (req.user) {
      const likes = await PostLike.find({
        post_id: { $in: posts.map(p => p._id) },
        user_id: req.user.id,
      }).select('post_id').lean();
      likedSet = new Set(likes.map(l => l.post_id.toString()));
    }

    res.json({
      posts: posts.map(p => serializePost(p, likedSet.has(p._id.toString()))),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

// ── POST /api/social/posts ────────────────────────────────────
router.post('/posts', requireAuth, uploadImage.single('image'), async (req, res) => {
  try {
    const { content } = req.body;
    const file = req.file;

    if (!content && !file)
      return res.status(400).json({ error: 'Post must have text or an image' });
    if (content?.length > 1000)
      return res.status(400).json({ error: 'Post text must be under 1000 characters' });

    const post = await Post.create({
      user_id:        req.user.id,
      content:        content || null,
      image_filename: file?.filename ?? null,
      image_url:      file ? `/uploads/social/${file.filename}` : null,
      post_type:      file ? 'image' : 'text',
    });

    const populated = await Post.findById(post._id)
      .populate('user_id', 'username avatar role')
      .lean();

    res.status(201).json({ post: serializePost(populated, false) });
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ error: err.message ?? 'Failed to create post' });
  }
});

// ── DELETE /api/social/posts/:id ──────────────────────────────
router.delete('/posts/:id', requireAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.user_id.toString() !== req.user.id)
      return res.status(403).json({ error: 'Not your post' });

    // Delete image file if present
    if (post.image_filename) {
      const fp = path.join(__dirname, '../uploads/social', post.image_filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }

    await Promise.all([
      Comment.deleteMany({ post_id: post._id }),
      PostLike.deleteMany({ post_id: post._id }),
      post.deleteOne(),
    ]);

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── POST /api/social/posts/:id/like  (toggle) ────────────────
router.post('/posts/:id/like', requireAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const existing = await PostLike.findOne({ post_id: post._id, user_id: req.user.id });

    if (existing) {
      await existing.deleteOne();
      const updated = await Post.findByIdAndUpdate(
        post._id,
        { $inc: { like_count: -1 } },
        { new: true },
      );
      res.json({ liked: false, like_count: Math.max(0, updated.like_count) });
    } else {
      await PostLike.create({ post_id: post._id, user_id: req.user.id });
      const updated = await Post.findByIdAndUpdate(
        post._id,
        { $inc: { like_count: 1 } },
        { new: true },
      );
      res.json({ liked: true, like_count: updated.like_count });
    }
  } catch {
    res.status(500).json({ error: 'Failed to toggle like' });
  }
});

// ── GET /api/social/posts/:id/comments ───────────────────────
router.get('/posts/:id/comments', optionalAuth, async (req, res) => {
  try {
    const comments = await Comment.find({ post_id: req.params.id })
      .populate('user_id', 'username avatar role')
      .sort({ created_at: 1 })
      .lean();

    res.json({
      comments: comments.map(c => ({
        id:         c._id.toString(),
        post_id:    c.post_id.toString(),
        user_id:    c.user_id?._id?.toString(),
        content:    c.content,
        created_at: c.created_at,
        username:   c.user_id?.username ?? '',
        avatar:     c.user_id?.avatar   ?? '🎧',
        role:       c.user_id?.role     ?? 'fan',
      })),
    });
  } catch {
    res.status(500).json({ error: 'Failed to load comments' });
  }
});

// ── POST /api/social/posts/:id/comments ──────────────────────
router.post('/posts/:id/comments', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });
    if (content.length > 500) return res.status(400).json({ error: 'Comment must be under 500 characters' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const comment = await Comment.create({ post_id: post._id, user_id: req.user.id, content: content.trim() });
    await Post.findByIdAndUpdate(post._id, { $inc: { comment_count: 1 } });

    const populated = await Comment.findById(comment._id)
      .populate('user_id', 'username avatar role')
      .lean();

    res.status(201).json({
      comment: {
        id:         populated._id.toString(),
        post_id:    populated.post_id.toString(),
        user_id:    populated.user_id?._id?.toString(),
        content:    populated.content,
        created_at: populated.created_at,
        username:   populated.user_id?.username ?? '',
        avatar:     populated.user_id?.avatar   ?? '🎧',
        role:       populated.user_id?.role     ?? 'fan',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/social/comments/:id ──────────────────────────
router.delete('/comments/:id', requireAuth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.user_id.toString() !== req.user.id)
      return res.status(403).json({ error: 'Not your comment' });

    await Post.findByIdAndUpdate(comment.post_id, { $inc: { comment_count: -1 } });
    await comment.deleteOne();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── GET /api/social/stats ─────────────────────────────────────
router.get('/stats', optionalAuth, async (req, res) => {
  try {
    const [total_posts, total_comments, total_likes, active_fans] = await Promise.all([
      Post.countDocuments(),
      Comment.countDocuments(),
      PostLike.countDocuments(),
      Post.distinct('user_id').then(ids => ids.length),
    ]);
    res.json({ total_posts, total_comments, total_likes, active_fans });
  } catch {
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

export default router;

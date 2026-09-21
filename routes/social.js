import mongoose from 'mongoose';
import { Router }        from 'express';
import multer            from 'multer';
import { Post, PostLike, Comment } from '../db/models.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { uploadBuffer, deleteImage } from '../lib/cloudinary.js';

const router = Router();

// ── Image upload ───────────────────────────────────────────────
// memoryStorage keeps the file in RAM as a Buffer — no local disk
// involved at all. The buffer goes straight to Cloudinary.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },  // 8 MB cap
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    ok.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Images only — jpg, png, gif or webp'));
  },
});

// ── Serialisers ────────────────────────────────────────────────
function serializePost(post, likedByMe = false) {
  const u = post.user_id;
  return {
    id:            post._id.toString(),
    user_id:       u?._id?.toString() ?? post.user_id?.toString(),
    content:       post.content      ?? null,
    image_url:     post.image_url    ?? null,
    post_type:     post.post_type,
    like_count:    post.like_count,
    comment_count: post.comment_count,
    created_at:    post.created_at,
    liked_by_me:   likedByMe,
    username:      u?.username   ?? '',
    avatar:        u?.avatar     ?? '🎧',
    avatar_url:    u?.avatar_url ?? null,
    role:          u?.role       ?? 'fan',
  };
}

function serializeComment(c) {
  return {
    id:         c._id.toString(),
    post_id:    c.post_id.toString(),
    user_id:    c.user_id?._id?.toString(),
    content:    c.content,
    created_at: c.created_at,
    username:   c.user_id?.username   ?? '',
    avatar:     c.user_id?.avatar     ?? '🎧',
    avatar_url: c.user_id?.avatar_url ?? null,
    role:       c.user_id?.role       ?? 'fan',
  };
}

// ── GET /api/social/posts ──────────────────────────────────────
router.get('/posts', optionalAuth, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 20, 50));
    const page  = Math.max(parseInt(req.query.page,  10) || 1,  1);

    let filter = {};
    if (req.query.cursor) {
      try {
        const cursor = JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString());
        const date = new Date(cursor.created_at);
        if (!mongoose.isValidObjectId(cursor.id) || !Number.isFinite(date.getTime())) throw new Error();
        filter = { $or: [{ created_at: { $lt: date } }, { created_at: date, _id: { $lt: cursor.id } }] };
      } catch { return res.status(400).json({ error: 'Invalid posts cursor' }); }
    }
    const [rows, total] = await Promise.all([
      Post.find(filter)
        .populate('user_id', 'username avatar avatar_url role')
        .sort({ created_at: -1, _id: -1 })
        .skip(req.query.cursor ? 0 : (page - 1) * limit)
        .limit(limit + 1)
        .lean(),
      Post.countDocuments(),
    ]);

    const posts = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = posts.at(-1);
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
      has_more: hasMore,
      next_cursor: hasMore && last ? Buffer.from(JSON.stringify({ created_at: last.created_at, id: last._id })).toString('base64url') : null,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('GET /posts error:', err);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

// ── POST /api/social/posts ─────────────────────────────────────
router.post('/posts', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const { content } = req.body;
    const file = req.file;

    if (!content?.trim() && !file)
      return res.status(400).json({ error: 'Post must have text or an image' });
    if (content && content.length > 1000)
      return res.status(400).json({ error: 'Post text must be under 1000 characters' });

    let image_url       = null;
    let image_public_id = null;

    if (file) {
      // Upload buffer directly to Cloudinary — zero disk I/O
      const result = await uploadBuffer(file.buffer, {
        // Eager transform: cap at 1200px wide, auto quality, auto format
        eager: [{ width: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
      });
      image_url       = result.eager?.[0]?.secure_url ?? result.secure_url;
      image_public_id = result.public_id;
    }

    const post = await Post.create({
      user_id:         req.user.id,
      content:         content?.trim() || null,
      image_url,
      image_public_id,
      post_type:       file ? 'image' : 'text',
    });

    const populated = await Post.findById(post._id)
      .populate('user_id', 'username avatar avatar_url role')
      .lean();

    res.status(201).json({ post: serializePost(populated, false) });
  } catch (err) {
    console.error('POST /posts error:', err);
    res.status(500).json({ error: err.message ?? 'Failed to create post' });
  }
});

// ── DELETE /api/social/posts/:id ──────────────────────────────
router.delete('/posts/:id', requireAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post)                                    return res.status(404).json({ error: 'Post not found' });
    if (post.user_id.toString() !== req.user.id)  return res.status(403).json({ error: 'Not your post' });

    // Delete image from Cloudinary (safe no-op if no image or already gone)
    await deleteImage(post.image_public_id);

    await Promise.all([
      Comment.deleteMany(  { post_id: post._id }),
      PostLike.deleteMany( { post_id: post._id }),
      post.deleteOne(),
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /posts error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── POST /api/social/posts/:id/like ───────────────────────────
router.post('/posts/:id/like', requireAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const existing = await PostLike.findOne({ post_id: post._id, user_id: req.user.id });

    if (existing) {
      await existing.deleteOne();
      const updated = await Post.findByIdAndUpdate(post._id, { $inc: { like_count: -1 } }, { new: true });
      res.json({ liked: false, like_count: Math.max(0, updated.like_count) });
    } else {
      await PostLike.create({ post_id: post._id, user_id: req.user.id });
      const updated = await Post.findByIdAndUpdate(post._id, { $inc: { like_count: 1  } }, { new: true });
      res.json({ liked: true, like_count: updated.like_count });
    }
  } catch {
    res.status(500).json({ error: 'Failed to toggle like' });
  }
});

// ── GET /api/social/posts/:id/comments ────────────────────────
router.get('/posts/:id/comments', optionalAuth, async (req, res) => {
  try {
    const comments = await Comment.find({ post_id: req.params.id })
      .populate('user_id', 'username avatar avatar_url role')
      .sort({ created_at: 1 })
      .lean();
    res.json({ comments: comments.map(serializeComment) });
  } catch {
    res.status(500).json({ error: 'Failed to load comments' });
  }
});

// ── POST /api/social/posts/:id/comments ───────────────────────
router.post('/posts/:id/comments', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim())      return res.status(400).json({ error: 'Comment cannot be empty' });
    if (content.length > 500)  return res.status(400).json({ error: 'Comment must be under 500 characters' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const comment   = await Comment.create({ post_id: post._id, user_id: req.user.id, content: content.trim() });
    await Post.findByIdAndUpdate(post._id, { $inc: { comment_count: 1 } });

    const populated = await Comment.findById(comment._id)
      .populate('user_id', 'username avatar avatar_url role')
      .lean();

    res.status(201).json({ comment: serializeComment(populated) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/social/comments/:id ───────────────────────────
router.delete('/comments/:id', requireAuth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment)                                       return res.status(404).json({ error: 'Comment not found' });
    if (comment.user_id.toString() !== req.user.id)    return res.status(403).json({ error: 'Not your comment' });

    await Post.findByIdAndUpdate(comment.post_id, { $inc: { comment_count: -1 } });
    await comment.deleteOne();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── GET /api/social/stats ──────────────────────────────────────
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

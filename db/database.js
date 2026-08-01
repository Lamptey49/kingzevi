import initSqlJs from 'sql.js/dist/sql-asm.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES modules don't have __dirname — derive it from import.meta.url
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDbPath() {
  const configuredPath = process.env.DB_PATH?.trim();
  if (configuredPath) return path.resolve(configuredPath);

  if (process.env.NODE_ENV === 'production') {
    return '/data/solace.db';
  }

  return path.join(__dirname, '..', 'data', 'solace.db');
}

function migrateLegacyDatabase(targetPath) {
  const legacyPaths = [
    path.join(__dirname, '..', 'solace.db'),
    path.join('/tmp', 'solace.db'),
  ].filter(candidate => candidate && candidate !== targetPath && fs.existsSync(candidate));

  if (!legacyPaths.length || fs.existsSync(targetPath)) return;

  const sourcePath = legacyPaths[0];
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.copyFileSync(sourcePath, targetPath);
  console.log(`📦 Migrated database from ${sourcePath} → ${targetPath}`);
}

const DB_PATH = resolveDbPath();

let db = null;

export async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs({ locateFile: file => path.join(__dirname, '../node_modules/sql.js/dist/', file) });

  // Ensure the parent directory exists (critical on first boot in prod
  // where /data is a freshly mounted empty disk)
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created database directory: ${dir}`);
  }

  migrateLegacyDatabase(DB_PATH);

  db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  console.log(` Database: ${fs.existsSync(DB_PATH) ? 'loaded existing' : 'created new'} → ${DB_PATH}`);

  initSchema();
  return db;
}

export function save() {
  if (!db) return;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'fan',
      avatar TEXT DEFAULT '🎧',
      bio TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS music (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('single','album')),
      title TEXT NOT NULL,
      genre TEXT,
      year INTEGER,
      emoji TEXT DEFAULT '🎵',
      description TEXT,
      allow_download INTEGER DEFAULT 1,
      artist_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (artist_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      music_id TEXT NOT NULL,
      track_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      duration TEXT DEFAULT '0:00',
      filename TEXT,
      FOREIGN KEY (music_id) REFERENCES music(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      music_id TEXT NOT NULL,
      downloaded_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS streams (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      track_id TEXT NOT NULL,
      streamed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT,
      image_filename TEXT,
      image_url TEXT,
      post_type TEXT NOT NULL DEFAULT 'text' CHECK(post_type IN ('text','image')),
      like_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS post_likes (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  save();
}

export function all(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function get(sql, params = []) {
  return all(sql, params)[0] ?? null;
}

export function run(sql, params = []) {
  db.run(sql, params);
  save();
}

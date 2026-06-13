const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'darkexplorer.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id          TEXT PRIMARY KEY,
    label       TEXT,
    token       TEXT UNIQUE NOT NULL,
    enrolled_at INTEGER NOT NULL,
    last_seen   INTEGER
  );

  CREATE TABLE IF NOT EXISTS otps (
    code       TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS files (
    path       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    ext        TEXT,
    size       INTEGER,
    mtime      INTEGER,
    ctime      INTEGER,
    is_dir     INTEGER NOT NULL DEFAULT 0,
    searchable TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
  CREATE INDEX IF NOT EXISTS idx_files_ext  ON files(ext);
  CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime);

  CREATE TABLE IF NOT EXISTS bookmarks (
    id         TEXT PRIMARY KEY,
    path       TEXT,
    url        TEXT,
    label      TEXT,
    device_id  TEXT REFERENCES devices(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspace_state (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tags (
    path       TEXT PRIMARY KEY,
    color      TEXT,
    label      TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shares (
    id           TEXT PRIMARY KEY,
    token        TEXT UNIQUE NOT NULL,
    path         TEXT NOT NULL,
    is_dir       INTEGER NOT NULL DEFAULT 0,
    expires_at   INTEGER,                 -- NULL = never
    max_uses     INTEGER,                 -- NULL = unlimited
    used_count   INTEGER NOT NULL DEFAULT 0,
    created_by   TEXT,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);

  CREATE TABLE IF NOT EXISTS disk_nodes (
    path        TEXT PRIMARY KEY,
    parent_path TEXT,
    name        TEXT NOT NULL,
    size        INTEGER NOT NULL DEFAULT 0,
    is_dir      INTEGER NOT NULL DEFAULT 0,
    scanned_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_disk_nodes_parent ON disk_nodes(parent_path);

  CREATE TABLE IF NOT EXISTS disk_scan_state (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    status        TEXT NOT NULL DEFAULT 'idle',
    current_path  TEXT,
    scanned_count INTEGER NOT NULL DEFAULT 0,
    started_at    INTEGER,
    finished_at   INTEGER
  );
`);

db.prepare('INSERT OR IGNORE INTO disk_scan_state (id, status, scanned_count) VALUES (1, \'idle\', 0)').run();

// Migration: drop the old per-folder JSON blob disk cache (replaced by disk_nodes)
try {
  const hasOld = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='disk_cache'").get();
  if (hasOld) db.exec('DROP TABLE disk_cache');
} catch {}

// Migrations for schema additions
try { db.prepare('ALTER TABLE bookmarks ADD COLUMN url TEXT').run(); } catch {}

// Migration: drop NOT NULL from bookmarks.path so URL-only bookmarks work
try {
  const pathCol = db.prepare("PRAGMA table_info(bookmarks)").all().find(c => c.name === 'path');
  if (pathCol && pathCol.notnull) {
    db.exec(`
      BEGIN;
      ALTER TABLE bookmarks RENAME TO _bm_old;
      CREATE TABLE bookmarks (
        id         TEXT PRIMARY KEY,
        path       TEXT,
        url        TEXT,
        label      TEXT,
        device_id  TEXT REFERENCES devices(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      );
      INSERT INTO bookmarks (id, path, url, label, device_id, created_at)
        SELECT id, path, url, label, device_id, created_at FROM _bm_old;
      DROP TABLE _bm_old;
      COMMIT;
    `);
  }
} catch (e) { console.error('[db] bookmarks migration failed:', e.message); }

module.exports = db;

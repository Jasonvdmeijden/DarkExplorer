const crypto = require('crypto');
const fsp    = require('fs/promises');
const db     = require('./db');

function _token() {
  return crypto.randomBytes(18).toString('base64url'); // 24-char URL-safe token
}

async function create({ path, expiresAt, maxUses, deviceId }) {
  const s = await fsp.stat(path);
  const id    = crypto.randomUUID();
  const token = _token();
  db.prepare(`INSERT INTO shares (id, token, path, is_dir, expires_at, max_uses, used_count, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(id, token, path, s.isDirectory() ? 1 : 0, expiresAt || null, maxUses || null, deviceId || null, Date.now());
  return { id, token, path, isDir: s.isDirectory(), expiresAt: expiresAt || null, maxUses: maxUses || null };
}

function listForPath(path) {
  return db.prepare('SELECT * FROM shares WHERE path = ? ORDER BY created_at DESC').all(path);
}

function listAll() {
  return db.prepare('SELECT * FROM shares ORDER BY created_at DESC').all();
}

function revoke(id) {
  db.prepare('DELETE FROM shares WHERE id = ?').run(id);
}

// Returns the share if token is valid AND not expired AND not exhausted; null otherwise
function resolveToken(token) {
  const row = db.prepare('SELECT * FROM shares WHERE token = ?').get(token);
  if (!row) return null;
  if (row.expires_at && row.expires_at < Date.now()) return null;
  if (row.max_uses && row.used_count >= row.max_uses) return null;
  return row;
}

function recordUse(id) {
  db.prepare('UPDATE shares SET used_count = used_count + 1 WHERE id = ?').run(id);
}

module.exports = { create, listForPath, listAll, revoke, resolveToken, recordUse };

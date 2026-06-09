const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const OTP_TTL_MS = 60 * 60 * 1000; // 1 hour

function generateOtp() {
  // clean expired otps first
  db.prepare('DELETE FROM otps WHERE expires_at < ?').run(Date.now());

  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  db.prepare('INSERT INTO otps (code, expires_at, used) VALUES (?, ?, 0)')
    .run(code, Date.now() + OTP_TTL_MS);
  return code;
}

function enrollDevice(code, label) {
  db.prepare('DELETE FROM otps WHERE expires_at < ?').run(Date.now());

  const otp = db.prepare('SELECT * FROM otps WHERE code = ? AND used = 0').get(code);
  if (!otp) return { ok: false, error: 'Invalid or expired OTP' };

  const id = uuidv4();
  const token = uuidv4();
  const now = Date.now();

  db.prepare('INSERT INTO devices (id, label, token, enrolled_at, last_seen) VALUES (?, ?, ?, ?, ?)')
    .run(id, label || 'Device', token, now, now);
  db.prepare('UPDATE otps SET used = 1 WHERE code = ?').run(code);

  return { ok: true, token, deviceId: id };
}

function validateToken(token) {
  if (!token) return null;
  const device = db.prepare('SELECT * FROM devices WHERE token = ?').get(token);
  if (!device) return null;
  try {
    db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(Date.now(), device.id);
  } catch { /* non-critical — skip if DB busy */ }
  return device;
}

function listDevices() {
  return db.prepare('SELECT id, label, enrolled_at, last_seen FROM devices').all();
}

function revokeDevice(id) {
  db.prepare('DELETE FROM devices WHERE id = ?').run(id);
}

module.exports = { generateOtp, enrollDevice, validateToken, listDevices, revokeDevice };

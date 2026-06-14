const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const mime = require('mime-types');

// Fire-and-forget: tell the disk cache about a filesystem change so it can
// bubble the size delta up to ancestors without a full rescan.
function _notify(targetPath) {
  try { require('./disk').notifyChange(targetPath); } catch {}
}

async function list(dirPath) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const items = await Promise.all(entries.map(async (e) => {
    const full = path.join(dirPath, e.name);
    try {
      const stat = await fsp.stat(full);
      return {
        name: e.name,
        path: full,
        isDir: e.isDirectory(),
        size: stat.size,
        mtime: stat.mtimeMs,
        ctime: stat.birthtimeMs,
        ext: e.isDirectory() ? null : path.extname(e.name).toLowerCase(),
        mime: e.isDirectory() ? null : (mime.lookup(e.name) || 'application/octet-stream')
      };
    } catch {
      return null;
    }
  }));
  const filtered = items.filter(Boolean);

  // Detect iPhone Live Photo pairs: <basename>.HEIC + <basename>.MOV in the same folder.
  // Attach the MOV's full path to the HEIC item so the client can play it as a looping live photo.
  const movByBase = new Map();
  for (const it of filtered) {
    if (it.isDir) continue;
    if (it.ext === '.mov') {
      const base = path.basename(it.name, path.extname(it.name)).toLowerCase();
      movByBase.set(base, it.path);
    }
  }
  for (const it of filtered) {
    if (it.isDir) continue;
    if (it.ext === '.heic' || it.ext === '.heif') {
      const base = path.basename(it.name, path.extname(it.name)).toLowerCase();
      const mov  = movByBase.get(base);
      if (mov) it.livePhotoMov = mov;
    }
  }
  return filtered;
}

async function stat(filePath) {
  const s = await fsp.stat(filePath);
  const name = path.basename(filePath);
  return {
    name,
    path: filePath,
    isDir: s.isDirectory(),
    size: s.size,
    mtime: s.mtimeMs,
    ctime: s.birthtimeMs,
    ext: s.isDirectory() ? null : path.extname(name).toLowerCase(),
    mime: s.isDirectory() ? null : (mime.lookup(name) || 'application/octet-stream')
  };
}

// Hard cap: anything bigger than this is refused outright for preview
const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;   // 5 MB
// Soft cap: files between SOFT and MAX are read partially (head only)
const PREVIEW_SOFT_BYTES = 256 * 1024;       // 256 KB

async function read(filePath) {
  const s = await fsp.stat(filePath);
  if (s.size > PREVIEW_MAX_BYTES) {
    return { tooLarge: true, size: s.size, limit: PREVIEW_MAX_BYTES };
  }
  if (s.size > PREVIEW_SOFT_BYTES) {
    // Read only first PREVIEW_SOFT_BYTES bytes
    const fh = await fsp.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(PREVIEW_SOFT_BYTES);
      await fh.read(buf, 0, PREVIEW_SOFT_BYTES, 0);
      return { content: buf.toString('utf8'), truncated: true, size: s.size, shown: PREVIEW_SOFT_BYTES };
    } finally { await fh.close(); }
  }
  return { content: await fsp.readFile(filePath, 'utf8') };
}

async function readBinary(filePath) {
  const s = await fsp.stat(filePath);
  if (s.size > PREVIEW_MAX_BYTES) {
    return { tooLarge: true, size: s.size, limit: PREVIEW_MAX_BYTES };
  }
  const buf = await fsp.readFile(filePath);
  return { content: buf.toString('base64') };
}

async function write(filePath, content) {
  await fsp.writeFile(filePath, content, 'utf8');
  _notify(filePath);
}

async function mkdir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
  _notify(dirPath);
}

async function remove(targets) {
  for (const t of targets) {
    await fsp.rm(t, { recursive: true, force: true });
    _notify(t);
  }
}

async function copy(sources, destDir) {
  for (const src of sources) {
    const dest = path.join(destDir, path.basename(src));
    await copyEntry(src, dest);
    _notify(dest);
  }
}

async function copyEntry(src, dest) {
  const s = await fsp.stat(src);
  if (s.isDirectory()) {
    await fsp.mkdir(dest, { recursive: true });
    const entries = await fsp.readdir(src);
    for (const e of entries) {
      await copyEntry(path.join(src, e), path.join(dest, e));
    }
  } else {
    await fsp.copyFile(src, dest);
  }
}

async function move(sources, destDir) {
  for (const src of sources) {
    const dest = path.join(destDir, path.basename(src));
    try {
      await fsp.rename(src, dest);
    } catch {
      // cross-device move
      await copyEntry(src, dest);
      await fsp.rm(src, { recursive: true, force: true });
    }
    _notify(src);
    _notify(dest);
  }
}

async function rename(filePath, newName) {
  const dest = path.join(path.dirname(filePath), newName);
  await fsp.rename(filePath, dest);
  // Update tags if renamed
  const db = require('./db');
  db.prepare('UPDATE tags SET path = ? WHERE path = ?').run(dest, filePath);
  _notify(filePath);
  _notify(dest);
  return dest;
}

function setTag(path, color, label) {
  const db = require('./db');
  if (!color && !label) {
    db.prepare('DELETE FROM tags WHERE path = ?').run(path);
  } else {
    db.prepare('INSERT OR REPLACE INTO tags (path, color, label, updated_at) VALUES (?, ?, ?, ?)')
      .run(path, color || null, label || null, Date.now());
  }
  return { ok: true };
}

function getTags(paths) {
  const db = require('./db');
  const placeholders = paths.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM tags WHERE path IN (${placeholders})`).all(paths);
}

function listTags() {
  const db = require('./db');
  return db.prepare('SELECT * FROM tags').all();
}

async function duplicate(filePath) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  let name = `${base} copy${ext}`;
  let dest = path.join(dir, name);
  let counter = 1;

  while (fs.existsSync(dest)) {
    name = `${base} copy ${++counter}${ext}`;
    dest = path.join(dir, name);
  }

  await copyEntry(filePath, dest);
  _notify(dest);
  return dest;
}

function roots() {
  if (process.platform === 'win32') {
    // return available drive letters
    const { execSync } = require('child_process');
    try {
      const out = execSync('wmic logicaldisk get name', { encoding: 'utf8' });
      return out.split('\n')
        .map(l => l.trim())
        .filter(l => /^[A-Z]:$/.test(l))
        .map(d => d + '\\');
    } catch {
      return ['C:\\'];
    }
  }
  return ['/'];
}

// True if `p` is a drive root (e.g. 'C:\' on Windows, '/' on POSIX) — the only
// level where a folder's size can meaningfully be shown "out of" the disk's
// real total capacity.
function isDriveRoot(p) {
  return process.platform === 'win32' ? /^[A-Za-z]:\\?$/.test(p) : p === path.sep;
}

// Win32_LogicalDisk.DriveType per drive letter, e.g. { 'C:\\': 3, 'X:\\': 4 }.
// 2=Removable, 3=Local Fixed, 4=Network, 5=CD-ROM, 6=RAM Disk.
function driveTypes() {
  if (process.platform !== 'win32') return {};
  const { execSync } = require('child_process');
  try {
    const out = execSync('wmic logicaldisk get caption,drivetype', { encoding: 'utf8' });
    const map = {};
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^([A-Za-z]):\s+(\d+)/);
      if (m) map[m[1].toUpperCase() + ':\\'] = parseInt(m[2], 10);
    }
    return map;
  } catch {
    return {};
  }
}

// Total capacity of the drive `rootPath` lives on, or null if `rootPath` isn't
// a drive root.
function driveTotalBytes(rootPath) {
  if (!isDriveRoot(rootPath)) return null;
  try {
    const stats = fs.statfsSync(rootPath);
    return stats.blocks * stats.bsize;
  } catch {
    return null;
  }
}

// Folder-size walk: bounded by time + entry count, with an in-memory cache.
// Walks are serialized (no Promise.all recursion) to cap memory + open-FD use.
// Throttle: only N walks may run concurrently across the whole server.

const _sizeCache = new Map();   // path → { size, partial, expires }
const SIZE_TTL_MS    = 60 * 1000;       // memo for 1 minute
const TIME_BUDGET_MS = 2000;            // give up after 2s per request
const ENTRY_BUDGET   = 50000;           // stop after 50k entries
const MAX_CONCURRENT = 2;

let _active = 0;
const _queue = [];

function _runQueued(fn) {
  return new Promise((resolve) => {
    const task = async () => {
      _active++;
      try { resolve(await fn()); }
      finally {
        _active--;
        const next = _queue.shift();
        if (next) next();
      }
    };
    if (_active < MAX_CONCURRENT) task();
    else _queue.push(task);
  });
}

async function _walk(dirPath, ctx) {
  if (Date.now() > ctx.deadline || ctx.count >= ENTRY_BUDGET) { ctx.partial = true; return 0; }
  let total = 0;
  let entries;
  try { entries = await fsp.readdir(dirPath, { withFileTypes: true }); }
  catch { return 0; }
  for (const e of entries) {
    if (Date.now() > ctx.deadline || ctx.count >= ENTRY_BUDGET) { ctx.partial = true; break; }
    ctx.count++;
    const full = path.join(dirPath, e.name);
    try {
      if (e.isDirectory()) total += await _walk(full, ctx);
      else { const s = await fsp.stat(full); total += s.size; }
    } catch {}
  }
  return total;
}

async function folderSize(dirPath) {
  const cached = _sizeCache.get(dirPath);
  if (cached && cached.expires > Date.now()) return cached.size;

  return _runQueued(async () => {
    const ctx = { deadline: Date.now() + TIME_BUDGET_MS, count: 0, partial: false };
    const size = await _walk(dirPath, ctx);
    // Cache complete results longer; partial results only briefly so we may try again later
    _sizeCache.set(dirPath, {
      size,
      partial: ctx.partial,
      expires: Date.now() + (ctx.partial ? 5000 : SIZE_TTL_MS)
    });
    return size;
  });
}

module.exports = { list, stat, read, readBinary, write, mkdir, remove, copy, move, rename, duplicate, setTag, getTags, listTags, roots, folderSize, isDriveRoot, driveTotalBytes, driveTypes };

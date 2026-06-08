const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const chokidar = require('chokidar');
const db = require('./db');
const config = require('./config');

const TEXT_EXTS = new Set([
  '.txt','.md','.js','.mjs','.cjs','.ts','.tsx','.jsx','.json','.yaml','.yml',
  '.html','.htm','.css','.scss','.less','.xml','.svg','.sh','.bash','.zsh',
  '.py','.rb','.go','.rs','.java','.c','.cpp','.h','.cs','.php','.sql',
  '.env','.ini','.toml','.cfg','.conf','.log','.csv'
]);

const upsert = db.prepare(`
  INSERT INTO files (path, name, ext, size, mtime, ctime, is_dir, searchable)
  VALUES (@path, @name, @ext, @size, @mtime, @ctime, @is_dir, @searchable)
  ON CONFLICT(path) DO UPDATE SET
    name=excluded.name, ext=excluded.ext, size=excluded.size,
    mtime=excluded.mtime, ctime=excluded.ctime, is_dir=excluded.is_dir,
    searchable=excluded.searchable
`);

const remove = db.prepare('DELETE FROM files WHERE path = ?');

function buildSearchable(filePath, stat) {
  const name = path.basename(filePath);
  const ext = path.extname(name).replace('.', '');
  const size = formatSize(stat.size);
  const mtime = new Date(stat.mtimeMs).toISOString().replace('T', ' ').slice(0, 16);
  return `${filePath} ${name} ${ext} ${size} ${mtime}`.toLowerCase();
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}b`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}kb`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)}mb`;
  return `${(bytes / 1073741824).toFixed(1)}gb`;
}

function isExcluded(filePath) {
  const excl = config.search.exclusions;
  const parts = filePath.split(/[\\/]/);
  for (const rule of excl) {
    if (rule.startsWith('*.')) {
      if (filePath.endsWith(rule.slice(1))) return true;
    } else {
      if (parts.includes(rule)) return true;
    }
  }
  return false;
}

function upsertFile(filePath, stat) {
  const name = path.basename(filePath);
  upsert.run({
    path: filePath,
    name,
    ext: path.extname(name).toLowerCase() || null,
    size: stat.size,
    mtime: stat.mtimeMs,
    ctime: stat.birthtimeMs || stat.ctimeMs,
    is_dir: stat.isDirectory() ? 1 : 0,
    searchable: buildSearchable(filePath, stat)
  });
}

function startWatcher() {
  const roots = process.platform === 'win32'
    ? getDriveRoots()
    : ['/'];

  const watcher = chokidar.watch(roots, {
    persistent: true,
    ignoreInitial: false,
    ignored: (p) => isExcluded(p),
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    depth: Infinity
  });

  watcher
    .on('add', (p, stat) => { if (stat && !isExcluded(p)) upsertFile(p, stat); })
    .on('addDir', (p, stat) => { if (stat && !isExcluded(p)) upsertFile(p, stat); })
    .on('change', (p, stat) => { if (stat && !isExcluded(p)) upsertFile(p, stat); })
    .on('unlink', (p) => remove.run(p))
    .on('unlinkDir', (p) => remove.run(p))
    .on('error', (err) => console.error('[watcher]', err.message));

  return watcher;
}

function getDriveRoots() {
  try {
    const { execSync } = require('child_process');
    const out = execSync('wmic logicaldisk get name', { encoding: 'utf8' });
    return out.split('\n')
      .map(l => l.trim())
      .filter(l => /^[A-Z]:$/.test(l))
      .map(d => d + '\\');
  } catch {
    return ['C:\\'];
  }
}

// --- fuzzy filename search ---

function trigramScore(text, query) {
  if (!query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.includes(q)) return 1;
  const tTri = trigrams(t);
  const qTri = trigrams(q);
  if (qTri.size === 0) return 0;
  let hits = 0;
  for (const tri of qTri) if (tTri.has(tri)) hits++;
  return hits / qTri.size;
}

function trigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3));
  return set;
}

function searchFilename(query, limit = 50) {
  const rows = db.prepare('SELECT path, name, ext, size, mtime, is_dir, searchable FROM files').all();
  const scored = rows
    .map(r => ({ ...r, score: trigramScore(r.searchable, query) }))
    .filter(r => r.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(({ score: _s, searchable: _t, ...r }) => r);
}

// --- content search ---

async function searchContent({ term, isRegex, includes, excludes, page = 0, pageSize = 100 }) {
  let pattern;
  try {
    pattern = new RegExp(isRegex ? term : escapeRegex(term), 'i');
  } catch {
    return { error: 'Invalid regex' };
  }

  const includeGlobs = (includes || []).map(globToRegex);
  const excludeGlobs = (excludes || [...config.search.exclusions]).map(globToRegex);
  const maxSize = config.search.maxFileSizeBytes;

  const rows = db.prepare('SELECT path, size FROM files WHERE is_dir = 0').all();

  const candidates = rows.filter(r => {
    if (r.size > maxSize) return false;
    if (!TEXT_EXTS.has(path.extname(r.path).toLowerCase())) return false;
    if (excludeGlobs.some(re => re.test(r.path))) return false;
    if (includeGlobs.length && !includeGlobs.some(re => re.test(r.path))) return false;
    return true;
  });

  const results = [];
  for (const { path: filePath } of candidates) {
    try {
      const text = await fsp.readFile(filePath, 'utf8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          results.push({ path: filePath, line: i + 1, text: lines[i].trim() });
          if (results.length >= (page + 1) * pageSize + pageSize) break;
        }
      }
    } catch { /* skip unreadable */ }
    if (results.length >= (page + 1) * pageSize + pageSize) break;
  }

  const start = page * pageSize;
  return {
    results: results.slice(start, start + pageSize),
    total: results.length,
    page,
    pageSize
  };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegex(glob) {
  const escaped = glob
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '§DOUBLE§')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/§DOUBLE§/g, '.*');
  return new RegExp(escaped, 'i');
}

module.exports = { startWatcher, searchFilename, searchContent };

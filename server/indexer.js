/**
 * Background filesystem indexer — runs as a child process so its I/O
 * and thread-pool usage don't affect the main server's event loop.
 *
 * Writes to the same SQLite file as the main process.
 * WAL mode + busy_timeout handles any write contention.
 */
const fsp  = require('fs/promises');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Open DB directly (not via the shared db module, which belongs to the main process)
const Database = require('better-sqlite3');
const dbPath = path.join(__dirname, '..', 'data', 'darkexplorer.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 10000');

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

// Errors caught inside the body so the transaction always commits — never rolls back.
// better-sqlite3 calls process.abort() on rollback failure, which kills the process.
const batchUpsert = db.transaction((rows) => {
  for (const r of rows) {
    try { upsert.run(r); } catch {}
  }
});

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}b`;
  if (bytes < 1048576) return `${(bytes/1024).toFixed(1)}kb`;
  if (bytes < 1073741824) return `${(bytes/1048576).toFixed(1)}mb`;
  return `${(bytes/1073741824).toFixed(1)}gb`;
}

function isExcluded(filePath) {
  const excl = config.search.exclusions;
  const name = path.basename(filePath);
  
  // Skip hidden files/folders on Unix-like systems
  if (process.platform !== 'win32' && name.startsWith('.') && name !== '.') {
    return true;
  }

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

function makeRow(filePath, s) {
  const name = path.basename(filePath);
  const ext  = path.extname(name).toLowerCase() || null;
  const size = formatSize(s.size);
  const mtime = new Date(s.mtimeMs).toISOString().replace('T',' ').slice(0,16);
  return {
    path: filePath,
    name,
    ext,
    size: s.size,
    mtime: s.mtimeMs,
    ctime: s.birthtimeMs || s.ctimeMs,
    is_dir: s.isDirectory() ? 1 : 0,
    searchable: `${filePath} ${name} ${ext||''} ${size} ${mtime}`.toLowerCase()
  };
}

const BATCH = 100;
let queue = [];
let ftsQueue = [];

const deleteFts = db.prepare('DELETE FROM files_fts WHERE path = ?');
const insertFts = db.prepare('INSERT INTO files_fts (path, content) VALUES (?, ?)');

const batchFts = db.transaction((rows) => {
  for (const r of rows) {
    try {
      deleteFts.run(r.path);
      insertFts.run(r.path, r.content);
    } catch {}
  }
});

function flush() {
  if (queue.length > 0) {
    const batch = queue.splice(0, BATCH);
    try { batchUpsert(batch); } catch { /* SQLITE_BUSY on COMMIT — skip batch */ }
  }
  if (ftsQueue.length > 0) {
    const batch = ftsQueue.splice(0, BATCH);
    try { batchFts(batch); } catch { /* SQLITE_BUSY on COMMIT — skip batch */ }
  }
}

async function enqueue(row) {
  queue.push(row);
  if (queue.length >= BATCH) {
    flush();
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function enqueueFts(row) {
  ftsQueue.push(row);
  if (ftsQueue.length >= BATCH) {
    flush();
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

function getRoots() {
  if (process.platform === 'win32') {
    try {
      const out = execSync('wmic logicaldisk get name', { encoding: 'utf8' });
      return out.split('\n').map(l=>l.trim()).filter(l=>/^[A-Z]:$/.test(l)).map(d=>d+'\\');
    } catch { return ['C:\\']; }
  }
  const roots = [];
  const projRoot = path.resolve(__dirname, '..');
  roots.push(projRoot); // Project files first

  const home = os.homedir();
  if (!roots.includes(home)) roots.push(home);
  return roots;
}

async function crawl(dirPath) {
  let entries;
  try { entries = await fsp.readdir(dirPath, { withFileTypes: true }); }
  catch { return; }

  for (const e of entries) {
    const full = path.join(dirPath, e.name);
    if (isExcluded(full)) continue;
    try {
      const s = await fsp.stat(full);
      const row = makeRow(full, s);
      await enqueue(row);

      if (!row.is_dir && row.ext && TEXT_EXTS.has(row.ext) && s.size <= 100 * 1024) {
        try {
          const content = await fsp.readFile(full, 'utf8');
          await enqueueFts({ path: full, content });
        } catch {}
      }
    } catch { continue; }
    if (e.isDirectory()) await crawl(full);
  }
}

(async () => {
  // Clear the files table for a fresh start on Mac/Linux when exclusions change
  if (process.platform !== 'win32') {
    db.prepare('DELETE FROM files').run();
    db.prepare('DELETE FROM files_fts').run();
  }

  const roots = getRoots();
  console.log(`[indexer] starting — roots: ${roots.join(', ')}`);
  for (const root of roots) {
    console.log(`[indexer] crawling ${root}...`);
    await crawl(root);
  }
  flush(); // final partial batch
  console.log('[indexer] complete');
  db.close();
})().catch(e => {
  console.error('[indexer] fatal:', e.message);
  process.exit(1);
});

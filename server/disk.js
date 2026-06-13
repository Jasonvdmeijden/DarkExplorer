/* Disk usage analyzer — recursive size tree, cached in SQLite.
 *
 * Design:
 *  - The whole tree rooted at `rootPath` is built by crawling the filesystem
 *    (we do NOT depend on the search index — that table is empty on Windows).
 *  - Result is persisted to the `disk_cache` table keyed by path. Subsequent
 *    scans of the same path return the cached tree instantly. A refresh is
 *    triggered when the cache is older than CACHE_TTL_MS or when the caller
 *    explicitly asks for a refresh.
 *  - Concurrency is bounded so the event loop stays responsive while crawling.
 *  - The returned tree is pruned (top N children per node + tiny items merged
 *    into a "smaller objects…" group) so the client renderer doesn't drown
 *    in a 50 k-node array.
 */
const fs  = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
const MAX_CHILDREN = 30;                         // per node in the pruned tree
const MIN_PCT_OF_PARENT = 0.0025;                // 0.25 % of parent size to be visible

// Walk concurrency: max parallel readdir/stat work
const MAX_INFLIGHT = 32;
// Per-scan time budget so a misbehaving FS doesn't lock us forever
const SCAN_TIMEOUT_MS = 5 * 60 * 1000;  // 5 minutes

let _wsBroadcast = null;
function _progress(msg, count) {
  if (_wsBroadcast) {
    try { _wsBroadcast({ type: 'disk:progress', data: { scanned: count, current: msg } }); }
    catch {}
  }
}

// Lightweight semaphore for bounded concurrency
function _semaphore(max) {
  let active = 0;
  const q = [];
  return {
    async run(fn) {
      if (active >= max) await new Promise(r => q.push(r));
      active++;
      try { return await fn(); }
      finally {
        active--;
        const next = q.shift();
        if (next) next();
      }
    }
  };
}

async function _crawl(rootPath, onProgress) {
  const sem = _semaphore(MAX_INFLIGHT);
  const t0 = Date.now();
  let scanned = 0;
  let lastTick = 0;

  async function walkDir(dirPath) {
    if (Date.now() - t0 > SCAN_TIMEOUT_MS) {
      return { name: path.basename(dirPath), path: dirPath, size: 0, isDir: true, children: [] };
    }
    let entries;
    try { entries = await sem.run(() => fsp.readdir(dirPath, { withFileTypes: true })); }
    catch { return { name: path.basename(dirPath), path: dirPath, size: 0, isDir: true, children: [] }; }

    const node = { name: path.basename(dirPath) || dirPath, path: dirPath, size: 0, isDir: true, children: [] };

    const tasks = entries.map(async (ent) => {
      const full = path.join(dirPath, ent.name);
      try {
        if (ent.isSymbolicLink()) return; // skip symlinks to avoid loops
        if (ent.isDirectory()) {
          const child = await walkDir(full);
          node.children.push(child);
          node.size += child.size;
        } else if (ent.isFile()) {
          const stat = await sem.run(() => fsp.stat(full));
          node.children.push({ name: ent.name, path: full, size: stat.size, isDir: false });
          node.size += stat.size;
          scanned++;
          // Throttled progress updates: max one push per 200 ms
          const now = Date.now();
          if (now - lastTick > 200) {
            lastTick = now;
            onProgress && onProgress(scanned, full);
          }
        }
      } catch { /* permission denied / locked file etc. — ignore */ }
    });

    await Promise.all(tasks);
    return node;
  }

  const root = await walkDir(rootPath);
  return { root, fileCount: scanned };
}

// Prune the tree: keep MAX_CHILDREN largest items per node plus anything bigger
// than MIN_PCT_OF_PARENT of the parent's size. Merge the rest into a "smaller…" bucket.
function _prune(node) {
  if (!node.isDir || !node.children) return;
  node.children.sort((a, b) => b.size - a.size);
  const visible = [];
  let smallerSize = 0;
  for (let i = 0; i < node.children.length; i++) {
    const c = node.children[i];
    const ratio = c.size / (node.size || 1);
    if (visible.length < MAX_CHILDREN && ratio >= MIN_PCT_OF_PARENT) {
      if (c.isDir) _prune(c);
      visible.push(c);
    } else {
      smallerSize += c.size;
    }
  }
  if (smallerSize > 0) {
    visible.push({
      name: 'smaller objects…',
      path: node.path + path.sep + '__smaller__',
      size: smallerSize,
      isDir: false,
      isGroup: true
    });
  }
  node.children = visible;
}

function _getCache(db, rootPath) {
  try {
    const row = db.prepare('SELECT tree_json, total_size, file_count, scanned_at FROM disk_cache WHERE path = ?').get(rootPath);
    if (!row) return null;
    return {
      tree: JSON.parse(row.tree_json),
      totalSize: row.total_size,
      fileCount: row.file_count,
      scannedAt: row.scanned_at
    };
  } catch { return null; }
}

function _putCache(db, rootPath, tree, totalSize, fileCount) {
  try {
    db.prepare(`INSERT OR REPLACE INTO disk_cache (path, tree_json, total_size, file_count, scanned_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run(rootPath, JSON.stringify(tree), totalSize, fileCount, Date.now());
  } catch (e) {
    console.warn('[disk] cache write failed:', e.message);
  }
}

async function scan(rootPath, { refresh = false } = {}, wsClient) {
  if (!rootPath) throw new Error('No path provided');
  _wsBroadcast = wsClient ? (msg) => wsClient.send(JSON.stringify(msg)) : null;

  const db = require('./db');

  // Cache check — return immediately if fresh and not asked to refresh
  if (!refresh) {
    const cached = _getCache(db, rootPath);
    if (cached && (Date.now() - cached.scannedAt) < CACHE_TTL_MS) {
      return {
        ...cached.tree,
        _cached: true,
        _scannedAt: cached.scannedAt,
        _fileCount: cached.fileCount
      };
    }
  }

  _progress('Crawling filesystem…', 0);

  const { root, fileCount } = await _crawl(rootPath, (count, current) => {
    _progress(current, count);
  });

  _prune(root);

  _putCache(db, rootPath, root, root.size, fileCount);
  _progress('Done.', fileCount);

  return {
    ...root,
    _cached: false,
    _scannedAt: Date.now(),
    _fileCount: fileCount
  };
}

function clearCache(rootPath) {
  const db = require('./db');
  if (rootPath) db.prepare('DELETE FROM disk_cache WHERE path = ?').run(rootPath);
  else          db.prepare('DELETE FROM disk_cache').run();
  return { ok: true };
}

module.exports = { scan, clearCache };

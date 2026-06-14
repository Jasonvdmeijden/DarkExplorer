/* Disk usage analyzer — whole-system size index, cached in SQLite (disk_nodes).
 *
 * Design:
 *  - `disk_nodes` holds one row per filesystem entry across every drive root
 *    (`files.roots()`): files store their own size, directories store the
 *    recursive total of their children. `parent_path` links each row to its
 *    parent so any subtree can be read straight out of SQL without re-crawling.
 *  - A background full-system scan (singleton) populates the table the first
 *    time the server starts with an empty cache, broadcasting progress as it
 *    goes so every connected client sees the same state.
 *  - `notifyChange(path)` is called by file-mutation hooks (files.js, upload)
 *    and incrementally recalculates: it updates/removes the single affected
 *    node, then "bubbles up" the size delta through `parent_path` ancestors —
 *    no rescan of the whole tree. Genuinely new/unknown directories get a
 *    bounded subtree crawl.
 *  - `getTree()` is a fast, synchronous read straight from `disk_nodes` — it
 *    never blocks on a crawl, so `disk:scan` requests can't time out.
 */
const fsp = require('fs/promises');
const path = require('path');

const MAX_CHILDREN       = 30;     // per node in the pruned tree
const MIN_PCT_OF_PARENT  = 0.0025; // 0.25 % of parent size to be visible
const MAX_TREE_DEPTH     = 5;      // levels of children below the requested root
const MAX_INFLIGHT       = 32;     // bounded concurrency for readdir/stat
const WRITE_BATCH        = 500;    // rows per transaction while crawling
const PROGRESS_MS        = 500;    // throttle for scan-progress broadcasts
const CACHE_UPDATE_MS    = 1000;   // throttle for incremental cache-update broadcasts

let _broadcaster = null;
function setBroadcaster(fn) { _broadcaster = fn; }
function _broadcast(type, data) {
  if (!_broadcaster) return;
  try { _broadcaster(JSON.stringify({ type, data })); } catch {}
}

let _cacheUpdateTimer = null;
let _pendingCacheUpdatePath = null;
function _broadcastCacheUpdate(p) {
  _pendingCacheUpdatePath = p;
  if (_cacheUpdateTimer) return;
  _cacheUpdateTimer = setTimeout(() => {
    _cacheUpdateTimer = null;
    _broadcast('disk:cache-update', { path: _pendingCacheUpdatePath });
  }, CACHE_UPDATE_MS);
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

function _parentOf(p) {
  const parent = path.dirname(p);
  return parent === p ? null : parent;
}

// ── Writer: batches upserts into disk_nodes ────────────────────────────
function _makeWriter(db) {
  const stmt = db.prepare(`
    INSERT INTO disk_nodes (path, parent_path, name, size, is_dir, scanned_at)
    VALUES (@path, @parent_path, @name, @size, @is_dir, @scanned_at)
    ON CONFLICT(path) DO UPDATE SET
      parent_path=excluded.parent_path, name=excluded.name, size=excluded.size,
      is_dir=excluded.is_dir, scanned_at=excluded.scanned_at
  `);
  let batch = [];
  const runBatch = db.transaction((rows) => { for (const r of rows) stmt.run(r); });

  function flush() {
    if (!batch.length) return;
    runBatch(batch);
    batch = [];
  }
  function write(row) {
    batch.push(row);
    if (batch.length >= WRITE_BATCH) flush();
  }
  return { write, flush };
}

// ── Crawl a subtree, writing every node (post-order) ────────────────────
async function _crawlAndStore(db, rootPath, onProgress) {
  const sem = _semaphore(MAX_INFLIGHT);
  const writer = _makeWriter(db);
  let scanned = 0;
  let lastTick = 0;

  async function walk(dirPath) {
    const parent = _parentOf(dirPath);
    let entries;
    try { entries = await sem.run(() => fsp.readdir(dirPath, { withFileTypes: true })); }
    catch {
      writer.write({ path: dirPath, parent_path: parent, name: path.basename(dirPath) || dirPath, size: 0, is_dir: 1, scanned_at: Date.now() });
      return 0;
    }

    let total = 0;
    await Promise.all(entries.map(async (ent) => {
      const full = path.join(dirPath, ent.name);
      try {
        if (ent.isSymbolicLink()) return; // skip symlinks to avoid loops
        if (ent.isDirectory()) {
          total += await walk(full);
        } else if (ent.isFile()) {
          const stat = await sem.run(() => fsp.stat(full));
          writer.write({ path: full, parent_path: dirPath, name: ent.name, size: stat.size, is_dir: 0, scanned_at: Date.now() });
          total += stat.size;
          scanned++;
          const now = Date.now();
          if (now - lastTick > PROGRESS_MS) {
            lastTick = now;
            onProgress && onProgress(scanned, full);
          }
        }
      } catch { /* permission denied / locked file etc. — ignore */ }
    }));

    writer.write({ path: dirPath, parent_path: parent, name: path.basename(dirPath) || dirPath, size: total, is_dir: 1, scanned_at: Date.now() });
    return total;
  }

  const size = await walk(rootPath);
  writer.flush();
  return { size, fileCount: scanned };
}

// ── Bubble-up: adjust ancestor sizes by `delta` without rescanning ──────
function _bubbleUp(db, startParentPath, delta) {
  if (!delta) return;
  const upd = db.prepare('UPDATE disk_nodes SET size = MAX(0, size + ?), scanned_at = ? WHERE path = ?');
  const getParent = db.prepare('SELECT parent_path FROM disk_nodes WHERE path = ?');
  const now = Date.now();
  let cur = startParentPath;
  while (cur) {
    const res = upd.run(delta, now, cur);
    if (res.changes === 0) break; // ancestor not tracked — stop
    const row = getParent.get(cur);
    cur = row ? row.parent_path : null;
  }
}

// Inclusive lower / exclusive upper bounds for a `path` prefix range scan, e.g.
// 'C:\dev' -> ['C:\dev\', 'C:\dev]'). Lets subtree queries use the `path`
// primary-key index directly — a LIKE 'prefix%' pattern with ESCAPE '\' can't
// use the index here because '\' is both the path separator and the escape
// character, forcing a full-table scan (seconds on a multi-million-row
// disk_nodes table). Drive roots (e.g. 'C:\') already end in `path.sep`, so
// don't double it up — that would push `lo` past their children.
function _subtreeRange(rootPath) {
  const lo = rootPath.endsWith(path.sep) ? rootPath : rootPath + path.sep;
  const hi = lo.slice(0, -1) + String.fromCharCode(lo.charCodeAt(lo.length - 1) + 1);
  return [lo, hi];
}

function _deleteSubtree(db, targetPath) {
  const [lo, hi] = _subtreeRange(targetPath);
  db.prepare('DELETE FROM disk_nodes WHERE path >= ? AND path < ?').run(lo, hi);
}

function _countSubtree(db, rootPath) {
  try {
    const [lo, hi] = _subtreeRange(rootPath);
    const row = db.prepare('SELECT COUNT(*) AS c FROM disk_nodes WHERE path >= ? AND path < ? AND is_dir = 0')
      .get(lo, hi);
    return row.c;
  } catch { return null; }
}

// ── Background full-system scan (singleton) ─────────────────────────────
let _scanning = false;

async function startFullScan() {
  if (_scanning) return;
  _scanning = true;
  const db = require('./db');
  const filesMod = require('./files');

  db.prepare(`UPDATE disk_scan_state SET status='scanning', current_path=NULL, scanned_count=0, started_at=?, finished_at=NULL WHERE id=1`)
    .run(Date.now());
  _broadcast('disk:scan-progress', { scanned: 0, current: 'Starting scan…', scanning: true });

  let grandTotal = 0;
  let lastBroadcast = 0;
  try {
    const roots = filesMod.roots();
    for (const root of roots) {
      const base = grandTotal;
      const { fileCount } = await _crawlAndStore(db, root, (count, current) => {
        const now = Date.now();
        if (now - lastBroadcast > PROGRESS_MS) {
          lastBroadcast = now;
          const total = base + count;
          db.prepare('UPDATE disk_scan_state SET current_path=?, scanned_count=? WHERE id=1').run(current, total);
          _broadcast('disk:scan-progress', { scanned: total, current, scanning: true });
        }
      });
      grandTotal = base + fileCount;
    }
  } catch (e) {
    console.error('[disk] full scan failed:', e.message);
  } finally {
    db.prepare(`UPDATE disk_scan_state SET status='done', current_path=NULL, scanned_count=?, finished_at=? WHERE id=1`)
      .run(grandTotal, Date.now());
    _scanning = false;
    _broadcast('disk:scan-complete', { path: null });
  }
}

// ── Subtree rescan (Rescan button / refresh) ─────────────────────────────
const _subtreeScanning = new Set();

async function startSubtreeScan(rootPath) {
  if (_subtreeScanning.has(rootPath)) return;
  _subtreeScanning.add(rootPath);
  const db = require('./db');
  let lastBroadcast = 0;
  try {
    const before = db.prepare('SELECT size FROM disk_nodes WHERE path = ?').get(rootPath);
    const oldSize = before ? before.size : 0;

    const { size: newSize } = await _crawlAndStore(db, rootPath, (count, current) => {
      const now = Date.now();
      if (now - lastBroadcast > PROGRESS_MS) {
        lastBroadcast = now;
        _broadcast('disk:scan-progress', { scanned: count, current, scanning: true, path: rootPath });
      }
    });

    const parent = _parentOf(rootPath);
    if (parent) _bubbleUp(db, parent, newSize - oldSize);

    _broadcast('disk:cache-update', { path: rootPath });
    _broadcast('disk:scan-complete', { path: rootPath });
  } catch (e) {
    console.error('[disk] subtree scan failed:', rootPath, e.message);
  } finally {
    _subtreeScanning.delete(rootPath);
  }
}

// ── Incremental recalculation on file/dir change ─────────────────────────
async function notifyChange(targetPath) {
  if (!targetPath) return;
  try {
    const db = require('./db');
    const existing = db.prepare('SELECT * FROM disk_nodes WHERE path = ?').get(targetPath);
    const parent = _parentOf(targetPath);

    let stat = null;
    try { stat = await fsp.stat(targetPath); } catch { /* deleted */ }

    if (!stat) {
      if (!existing) return; // never tracked — nothing to do
      _deleteSubtree(db, targetPath);
      db.prepare('DELETE FROM disk_nodes WHERE path = ?').run(targetPath);
      if (parent) _bubbleUp(db, parent, -existing.size);
      _broadcastCacheUpdate(parent || targetPath);
      return;
    }

    if (stat.isDirectory()) {
      if (existing) return; // already tracked — descendant changes bubble up on their own
      const { size } = await _crawlAndStore(db, targetPath, () => {});
      if (parent) _bubbleUp(db, parent, size);
      _broadcastCacheUpdate(parent || targetPath);
      return;
    }

    // file
    const oldSize = existing ? existing.size : 0;
    db.prepare(`
      INSERT INTO disk_nodes (path, parent_path, name, size, is_dir, scanned_at)
      VALUES (@path, @parent_path, @name, @size, 0, @scanned_at)
      ON CONFLICT(path) DO UPDATE SET
        parent_path=excluded.parent_path, name=excluded.name, size=excluded.size,
        is_dir=0, scanned_at=excluded.scanned_at
    `).run({ path: targetPath, parent_path: parent, name: path.basename(targetPath), size: stat.size, scanned_at: Date.now() });

    if (parent) _bubbleUp(db, parent, stat.size - oldSize);
    _broadcastCacheUpdate(parent || targetPath);
  } catch (e) {
    console.warn('[disk] notifyChange failed for', targetPath, e.message);
  }
}

// ── Tree reads (pure SQL, fast) ───────────────────────────────────────────
// Returns { children, total } where `total` is the effective size of `rootPath`:
// the stored size, or the sum of (effective) children sizes, whichever is larger.
// This guarantees parent.size >= sum(children.size) for the sunburst layout even
// when stored disk_nodes totals haven't caught up with their children yet.
//
// Fetches level-by-level with batched `parent_path IN (...)` queries instead of
// one query per node — a naive per-node recursive query fans out to ~MAX_CHILDREN
// ^ MAX_TREE_DEPTH synchronous DB calls for deep, wide trees (e.g. node_modules),
// which blocks the event loop for seconds since better-sqlite3 is synchronous.
const _CHILD_BATCH = 400; // keep IN(...) lists well under SQLite's variable limit

function _buildChildren(db, rootPath, rootSize) {
  const root = { children: [] };
  let frontier = [{ path: rootPath, size: rootSize, node: root }];
  const levels = [];

  for (let depth = 0; depth < MAX_TREE_DEPTH && frontier.length; depth++) {
    levels.push(frontier);
    const byParent = new Map();
    for (let i = 0; i < frontier.length; i += _CHILD_BATCH) {
      const chunk = frontier.slice(i, i + _CHILD_BATCH).map(f => f.path);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT path, parent_path, name, size, is_dir FROM (
          SELECT path, parent_path, name, size, is_dir,
                 ROW_NUMBER() OVER (PARTITION BY parent_path ORDER BY size DESC) AS rn
          FROM disk_nodes WHERE parent_path IN (${placeholders})
        ) WHERE rn <= ?
        ORDER BY parent_path, size DESC
      `).all(...chunk, MAX_CHILDREN);
      for (const r of rows) {
        let arr = byParent.get(r.parent_path);
        if (!arr) byParent.set(r.parent_path, arr = []);
        arr.push(r);
      }
    }

    const nextFrontier = [];
    for (const f of frontier) {
      const rows = byParent.get(f.path) || [];
      const visible = [];
      for (const r of rows) {
        if (visible.length >= MAX_CHILDREN) break;
        if (r.size / (f.size || 1) < MIN_PCT_OF_PARENT) break; // sorted desc — rest are smaller too
        const child = { name: r.name, path: r.path, size: r.size, isDir: !!r.is_dir };
        if (r.is_dir) {
          child.children = [];
          if (depth + 1 < MAX_TREE_DEPTH) nextFrontier.push({ path: r.path, size: r.size, node: child });
        }
        visible.push(child);
      }
      f.node.children = visible;
    }
    frontier = nextFrontier;
  }

  // Bottom-up: fold each node's children into its effective size before its
  // parent sums them (same `max(stored, sum(children))` rule as before).
  for (let depth = levels.length - 1; depth >= 0; depth--) {
    for (const f of levels[depth]) {
      const node = f.node;
      let shownSize = 0;
      for (const c of node.children) shownSize += c.size;
      const total = Math.max(f.size, shownSize);
      const smaller = total - shownSize;
      if (smaller > 0) {
        node.children.push({ name: 'smaller objects…', path: f.path + path.sep + '__smaller__', size: smaller, isDir: false, isGroup: true });
      }
      node.size = total;
    }
  }

  return { children: root.children, total: root.size };
}

function _getScanState(db) {
  return db.prepare('SELECT * FROM disk_scan_state WHERE id = 1').get()
    || { status: 'idle', current_path: null, scanned_count: 0 };
}

function getTree(rootPath, { refresh = false } = {}) {
  if (!rootPath) throw new Error('No path provided');
  const db = require('./db');

  const rootRow = db.prepare('SELECT * FROM disk_nodes WHERE path = ?').get(rootPath);
  const globalScanning = _getScanState(db).status === 'scanning';

  let tree;
  if (!rootRow) {
    tree = { name: path.basename(rootPath) || rootPath, path: rootPath, size: 0, isDir: true, children: [], _empty: true };
  } else {
    tree = { name: rootRow.name, path: rootRow.path, size: rootRow.size, isDir: !!rootRow.is_dir };
    if (rootRow.is_dir) {
      const { children, total } = _buildChildren(db, rootPath, rootRow.size);
      tree.children = children;
      tree.size = total;
    }
  }

  setImmediate(() => {
    try {
      const totalNodes = db.prepare('SELECT COUNT(*) AS c FROM disk_nodes').get().c;
      if (totalNodes === 0 && !globalScanning) startFullScan();
      // No cached row at all (e.g. a folder created after the one-time full scan
      // finished) — the full scan won't run again, so nothing else would ever
      // populate it. Kick off a subtree scan on first visit, not just on refresh.
      else if (refresh || !rootRow) startSubtreeScan(rootPath);
    } catch (e) { console.warn('[disk] background scan trigger failed:', e.message); }
  });

  // "Building cache…" is per-folder, not global. `_crawlAndStore` writes nodes
  // post-order, so if rootRow exists its entire subtree is already fully cached —
  // it stays "done" even while a whole-system scan or another folder's rescan is
  // running elsewhere. Only show "building" when this exact path is mid-rescan,
  // or has no cached data yet and the one-time full scan will eventually reach it.
  const scanning = _subtreeScanning.has(rootPath) || (!rootRow && globalScanning);

  return {
    ...tree,
    scanning,
    _scannedAt: rootRow ? rootRow.scanned_at : null,
    _fileCount: rootRow ? _countSubtree(db, rootPath) : null
  };
}

function initBackgroundScan() {
  const db = require('./db');
  const totalNodes = db.prepare('SELECT COUNT(*) AS c FROM disk_nodes').get().c;
  const state = _getScanState(db);
  // status==='scanning' on startup means a previous run was killed mid-scan —
  // resume so disk_scan_state doesn't stay stuck forever.
  if (totalNodes === 0 || state.status === 'scanning') startFullScan();
}

function clearCache(rootPath) {
  const db = require('./db');
  if (rootPath) {
    const row = db.prepare('SELECT size, parent_path FROM disk_nodes WHERE path = ?').get(rootPath);
    _deleteSubtree(db, rootPath);
    db.prepare('DELETE FROM disk_nodes WHERE path = ?').run(rootPath);
    if (row && row.parent_path) _bubbleUp(db, row.parent_path, -row.size);
    startSubtreeScan(rootPath);
  } else {
    db.prepare('DELETE FROM disk_nodes').run();
    db.prepare(`UPDATE disk_scan_state SET status='idle', current_path=NULL, scanned_count=0, started_at=NULL, finished_at=NULL WHERE id=1`).run();
    startFullScan();
  }
  return { ok: true };
}

module.exports = { getTree, notifyChange, clearCache, setBroadcaster, initBackgroundScan };

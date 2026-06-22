# Summary

## Project Overview
DarkExplorer is a file/disk analyzer web app (Node.js server on port 3322 + browser frontend) with a WebSocket-based API, SQLite backend, and Git integration. Working directory: `C:\dev\ai\AIFactory\session-workspace\3571c661-f705-4f9d-8391-b7943bb4cdf1`.

## Major Work Completed This Session

### Disk Cache Rework (Phase A)
- Migrated caching to SQLite (`disk_nodes`, `disk_scan_state` tables) for persistence across clients
- Whole-system background scan that never blocks the frontend API (`disk:scan` returns in ~1ms)
- Incremental bubble-up recalculation: when files are created/deleted, ancestors' sizes adjust atomically via `_bubbleUp()`
- Progressive sunburst rendering showing "Building cache..." state as data arrives
- Fixed critical stale-size bug: `_crawlAndStore` had `total += await walk(...)` which captured stale totals before awaiting; concurrent sibling walks clobbered each other. Fixed with `const subtotal = await walk(...); total += subtotal;` — now all directory sizes match their children's sum exactly.

### Git Operations (Phase B)
- Added fetch/pull/push, stash (save/list/apply/pop/drop), merge & rebase with conflict/in-progress UI banners
- Ahead/behind badges showing commit count
- Fixed pre-existing bug in `git.status()`: used `trim().split('\n')` which stripped the leading space off porcelain output, corrupting unstaged-only file paths and status codes (e.g., `" M file.txt"` → `"M .txt"`). Fixed with proper `split(/\r?\n/).filter(...)`.

### Performance Fixes (Critical)
**Three major bottlenecks:**

1. `_buildChildren` issued one query per tree node (800K+ synchronous queries for deep trees). Rewritten as batch BFS with `parent_path IN (...)` and `ROW_NUMBER()` — now ≤5 queries total.

2. `_countSubtree`/`_deleteSubtree` used `LIKE 'prefix%' ESCAPE '\'` defeating index optimization, forcing full 3.4M-row table scans (~24s per call). Replaced with direct `path >= ? AND path < ?` range scans.

3. `initBackgroundScan()` didn't resume mid-scan restarts (kept `disk_scan_state.status = 'scanning'` forever if server crashed during scan). Now also resumes if `status==='scanning'` on startup.

**Result:** `disk:scan(C:\)` improved from 35.5s → 1.6s; normal folders 28-44s → ~100ms. Sizes unchanged.

### Cache Persistence & Display
**Problem:** Folders that didn't exist when the one-time full scan ran showed "Building cache..." forever; nothing auto-triggered their scan.  
**Fix:** `getTree()` now calls `startSubtreeScan(rootPath)` whenever `!rootRow` (first visit to any uncached path).

**Problem:** Single global `disk_scan_state.status` meant all folders showed "Building..." during any background scan anywhere.  
**Fix:** `scanning` flag now computed per-path using `_subtreeScanning` set — true only if *this exact* folder is being crawled or has never been cached.

### Drive-Level Features
- Added "X of Y GB" display for drive-root folders (e.g., "150GB of 950GB"), using `fs.statfsSync()` to get real drive capacity
- Server `fs:roots` and `fs:list` now return `driveType` via `wmic logicaldisk get caption,drivetype`
- New `public/js/drives.js` module with `Drives.icon(path, isDir)` returning:
  - 🖴 for local/fixed drives
  - 🌐 for network drives
  - 💽 for removable
  - 💿 for CD-ROM
  - Falls back to folder icon
- Integrated into all icon call sites: `tree.js`, `explorer.js` (all views), `preview.js`, `disk.js`, `bookmarks.js`, `favourites.js`, `search.js`

### Mobile/CSS Fixes
After pulling upstream commit `533006e` ("glass effect + Mac-style grouping"), the disk analyzer list panel broke on mobile:
- List wasn't moved to bottom; wasn't filling vertical height
- Merge silently dropped ~60 lines of disk-analyzer and git-panel CSS rules
- Restored all missing blocks (header/title/status styling, git sync/stash/conflict-banner CSS)
- Verified mobile and desktop layouts via Playwright screenshots

### Disk-List Row Interactions
- Click → navigate (folders) or preview (files)
- Right-click/double-tap → context menu
- Middle-click/ctrl-click/triple-tap → open in new tab
- Fixed mobile scrolling by adding `flex: 1; min-height: 0` to `.disk-list-container` in mobile media query

## Current Server State
- Running on port 3322, healthy
- All migrations applied cleanly
- Background full-system scan completed (ran from cold DB, now serving from cache)
- All features verified end-to-end via WebSocket and browser

## Modified Files
`server/disk.js`, `server/files.js`, `public/js/disk.js`, `public/js/drives.js`, `public/css/app.css`, `public/js/{tree,explorer,preview,bookmarks,favourites,search,app}.js`, `index.html`, `TASK.md`, `plan.md`

## Known Limitations
- No network drives on this machine to fully visual-test 🌐 icon (mapping is correct; applies uniformly)

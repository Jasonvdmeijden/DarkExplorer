# DarkExplorer — Tasks

States: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Phase 1 — Project scaffold
- [x] package.json + .gitignore
- [x] config.json (defaults: port 3322, origins, shell, search exclusions)
- [x] server/config.js

## Phase 2 — Database
- [x] server/db.js (schema: devices, otps, files, bookmarks)

## Phase 3 — Backend modules
- [x] server/auth.js (OTP gen, enrollment, token validation, --gen-otp CLI flag, /admin/gen-otp endpoint)
- [x] server/files.js (list, stat, read, write, mkdir, copy, move, delete)
- [x] server/search.js (chokidar watcher, SQLite upsert, fuzzy filename search, content search)
- [x] server/thumbnails.js (sharp images, ffmpeg video frames, canvas code thumbnails, disk cache)
- [x] server/terminal.js (node-pty PTY, command runner fallback, shell switching)
- [x] server/upload.js (multer handler)
- [x] server/index.js (Express + WebSocket, route all message types, auth middleware)

## Phase 4 — Auto-start scripts
- [x] scripts/start.bat
- [x] scripts/start.sh
- [x] scripts/setup.bat (schtasks, idempotent)
- [x] scripts/setup.sh (systemd / launchd, idempotent, auto-detects OS)

## Phase 5 — Frontend shell
- [x] public/enroll.html (OTP enrollment page)
- [x] public/index.html (app shell)
- [x] public/css/app.css (layout, base styles, CSS variables)
- [x] public/css/themes/dark.css (Vault dark palette)
- [x] public/css/themes/light.css (Vault light palette)

## Phase 6 — Frontend JS modules
- [x] public/js/ws.js (WebSocket client wrapper, reconnect, request/response matching)
- [x] public/js/app.js (boot, auth check, layout init)
- [x] public/js/explorer.js (directory listing, navigation, back/forward history, breadcrumbs)
- [x] public/js/tabs.js (open, close, switch tabs)
- [x] public/js/panels.js (left/right/top/bottom panels, split pane, drag-resize)
- [x] public/js/clipboard.js (server buffer mode + download mode)
- [x] public/js/preview.js (routing per type; Rich/Raw/Meta toggle; markdown via marked.js+mermaid.js; code via highlight.js with line numbers; HTML via sandboxed iframe srcdoc; image; PDF via pdf.js; video/audio via HTML5; collapsible metadata sidebar)
- [x] public/js/terminal.js (xterm.js init, PTY bridge, mode toggle)
- [x] public/js/search.js (filename fuzzy UI, content search UI, results panel)
- [x] public/js/bookmarks.js (bookmark panel, add/remove)
- [x] public/js/theme.js (CSS variable switching, theme load)
- [x] public/js/theme-builder.js (colour picker UI, live preview, save custom theme)

## Phase 7 — Views
- [x] Mosaic view (justified-row layout engine, thumbnail requests, slider)
- [x] Details view (columns, sort, resize, show/hide)
- [x] List view (compact icon + name)
- [x] Context menu (all actions wired up)
- [x] Inline rename (F2, click-to-edit)
- [x] Multi-select (shift+click, ctrl+click)
- [x] Path bar (breadcrumb + editable text input toggle)

## Phase 8 — Polish & integration
- [x] Drag and drop upload (drop onto pane)
- [x] Keyboard shortcuts (F2, Del, Ctrl+C/X/V, Alt+arrows, Ctrl+`)
- [x] Responsive layout (CSS breakpoints for phone/tablet/desktop)
- [x] ffmpeg missing → graceful fallback to static icon
- [x] Search exclusion rules respected in filename and content search
- [x] Thumbnail disk cache keyed by path+mtime
- [x] public/js/theme-builder.js (colour picker UI, live preview, save custom theme)

## Bug fixes
- [x] Enrollment redirect loop — removed server-side GET / guard (was redirecting back to /enroll because cookie timing); client-side app.js guard is sufficient

## Phase 9 — Behaviour & persistence
- [x] Executable files (.exe/.msi/.bat/.cmd/.ps1/.sh) run on double-click; preview requires explicit context menu selection
- [x] Workspace state persistence + cross-device sync via SQLite + WebSocket broadcast (tabs, active tab, view mode, sort, expanded tree nodes, split pane paths, panel width, mosaic size)

## Phase 10 — UX polish
- [x] Props-dialog and preview-modal centered via position:fixed + transform on dialog[open]
- [x] Disk I/O speed (MB/s) + network Mbps stat chips with heat color
- [x] Double-tap context menu on mobile (replaced long-press which conflicts with iOS)
- [x] Folder sizes aggregated recursively, shown in properties and details view
- [x] Search icon visible on mobile; search panel goes full-screen on mobile
- [x] Rename is optimistic — UI updates immediately before WS round-trip
- [x] Preview modal drag-resize (50%–90% of screen), symmetric from center, persisted in localStorage
- [x] Horizontal resize unblocked (CSS max-width override); modal stays open during drag
- [x] Breadcrumb clicks navigate to that path (stopPropagation prevents pathbar input opening)
- [x] Context menu: Copy name / Copy path / Copy folder path
- [x] Images and videos use object-fit:contain + fill container in resized preview modal
- [x] Bookmark add fully async with error feedback and status display
- [x] Search shows spinner while awaiting results
- [x] Browser back/forward buttons drive in-app navigation via pushState + popstate

## Phase 11 — Disk cache rework + Git sync/stash/merge/rebase
- [x] server/db.js: `disk_nodes` + `disk_scan_state` schema (drops old `disk_cache`)
- [x] server/disk.js rewrite: whole-system DB-backed cache, background full scan, subtree rescan, `notifyChange` bubble-up, broadcasts
- [x] server/files.js: hook all fs mutations (write/mkdir/remove/copy/move/rename/duplicate) into `disk.notifyChange`
- [x] server/index.js: wire `disk.setBroadcaster`/`initBackgroundScan`, `disk:scan`/`disk:clear-cache` handlers, `/upload` notifyChange hook
- [x] public/js/disk.js: progressive rendering — render partial/`_empty` trees immediately, live updates via `disk:scan-progress`/`disk:cache-update`/`disk:scan-complete`
- [x] CSS: `.disk-status.scanning` pulse, `.disk-center-status` "Building…" state
- [x] server/git.js: fetch/pull/push/ahead-behind/remotes, stash list/save/apply/pop/drop, merge/merge-abort/merge-status, rebase/rebase-continue/rebase-abort/rebase-status
- [x] server/index.js: new `git:*` WS message cases for sync/stash/merge/rebase
- [x] public/js/git.js: sync bar (fetch/pull/push + ahead/behind badge), stash section, merge/rebase pickers, conflict/in-progress banner
- [x] CSS: git sync bar, stash rows, conflict banner styles
- [x] Verify end-to-end: restarted server with new schema, confirmed `disk:scan` returns instantly mid-scan (no 30s timeout), confirmed bubble-up on file create/delete updates ancestor sizes + broadcasts `disk:cache-update`, confirmed git remotes/ahead-behind/fetch/stash/merge-status/rebase-status all work over WS; fixed two bugs found during verification (git status porcelain parsing, stale scan-state resume on restart)
- [x] Fix folder sizes not aggregating recursive subdirectory totals: `_buildChildren`/`getTree` now compute each dir's effective size as `max(stored size, sum of children's effective sizes)` bottom-up, so the sunburst always satisfies `parent.size >= sum(children.size)`; verified against `C:\`, project root, and `C:\dev\ai\AIFactory` — totals now sum exactly
- [x] Disk-list rows are now fully interactive: click → navigate (folders) or open preview (files), right-click/double-tap → full context menu (via new `Explorer.selectOnly` export), middle-click/ctrl-click/triple-tap → open folder in new tab. Reuses the exact same gesture primitives as explorer.js rows (`showContextMenu`, `Tabs.attachOpenInNewTab`). Also fixed `startRename`'s selector to recognise `.disk-row-name`. Verified end-to-end via Playwright: context menu shows full item list, click-navigate works, click-preview opens correct file, middle-click opens new tab
- [x] Fix disk-list not scrolling on mobile: `.disk-list-container` had no bounded height when `.disk-body` switches to `flex-direction: column` (mobile media query), so `.disk-list { flex:1; overflow-y:auto }` had nothing to constrain against. Added `flex: 1; min-height: 0` to `.disk-list-container` in the `@media (max-width: 768px)` block. Verified at 390px viewport: list height now bounded (scrollHeight > clientHeight, scrollable: true, scrollTop responds)
- [x] Fix disk-analyzer event-loop lockup on navigation: `getTree()` runs synchronously in the WS handler and had two O(n) blocking SQL patterns — (1) `_buildChildren` issued one query per tree node, fanning out to ~30^4 synchronous calls for deep/wide trees; rewritten as a level-batched BFS (`parent_path IN (...)` + `ROW_NUMBER()` top-N-per-group, ≤5 queries total). (2) `_countSubtree`/`_deleteSubtree` used `LIKE 'prefix%' ESCAPE '\'`, which can't use the `path` PK index because `\` is both the path separator and escape char, forcing a full 3.4M-row `SCAN disk_nodes` (~24s); replaced with a direct `path >= ? AND path < ?` PK range scan (handling the drive-root edge case where the path already ends in `\`). Verified over WS: `disk:scan(C:\)` (worst case, whole-system root) dropped from ~35.5s to ~1.6s; normal folders (e.g. project root) from ~28-44s to ~100ms. Totals/sizes unchanged (correctness preserved)
- [x] Fix "Building cache…" showing for already-cached, unchanged folders: `getTree()`'s `scanning` flag was derived from the single global `disk_scan_state.status`, so while the one-time whole-system scan (or any other folder's rescan, from any connected client) was running, *every* folder reported `scanning:true` regardless of its own cache state. `_crawlAndStore` writes nodes post-order, so a `disk_nodes` row existing for `rootPath` means its entire subtree is already fully cached. `getTree()` now computes `scanning` per-path: `_subtreeScanning.has(rootPath) || (!rootRow && globalScanning)` — true only if this exact path is mid-rescan, or has no cached row yet and the full scan will eventually reach it. Also tightened `public/js/disk.js`'s `disk:scan-progress` listener to only update the status pulse / schedule a rescan when `_currentRoot._empty || _currentRoot.scanning`, so progress broadcasts for unrelated paths/other clients no longer flash "Building cache…" on an already-settled view. Verified over WS: with a cached folder's row present, forcing `disk_scan_state.status='scanning'` still yields `scanning:false` for that folder, while a never-scanned path correctly yields `scanning:true`
- [x] Fix folders stuck forever on "Building cache…": a folder created *after* the one-time whole-system full scan finished (e.g. a new `session-workspace\<id>` dir created outside DarkExplorer's own file ops, so `notifyChange` never fired for it) has no `disk_nodes` row (`_empty:true`), but since `disk_nodes` is non-empty overall, `startFullScan` never re-runs and (before this fix) `startSubtreeScan` only ran on an explicit "Rescan" click (`refresh:true`) — so the folder's `_empty` placeholder ("this folder will fill in as the background scan reaches it") was permanently true with nothing ever filling it in. `getTree()`'s background trigger now also runs `startSubtreeScan(rootPath)` on first visit whenever `!rootRow`, not just on `refresh`. Verified over WS against `session-workspace\c33b3bd8-...` (confirmed via direct DB query to have zero rows, parent included): first `disk:scan` returns `_empty:true` immediately as before, but now auto-fires a subtree crawl — `disk:scan-progress` then `disk:scan-complete` arrive within ~1s, and `disk_nodes` gets a row for the folder (size 5,125,874, 3 children)

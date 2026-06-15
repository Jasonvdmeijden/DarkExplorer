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
- [x] Show drive-capacity "X of Y" at drive-root level: `getTree()` returns a new `_diskTotal` field — the real total capacity of the drive `rootPath` lives on, via `fs.statfsSync(rootPath).blocks * bsize` (`_isDriveRoot`: `/^[A-Za-z]:\\?$/` on Windows, `path.sep` on POSIX) — or `null` for any non-drive-root path. `public/js/disk.js`/`app.css` render "X of Y" (cached size of drive total) only for drive roots (e.g. `C:\`, `D:\`); ordinary folders show just their own size as before. Verified: `C:\` → `_diskTotal` 1,020,234,625,024 (≈950GB); subfolders → `null`
- [x] Fix `_crawlAndStore` losing sibling-directory totals (pre-existing bug since the very first full scan): `total += await walk(full)` reads `total` *before* awaiting, so when `Promise.all` runs sibling directory walks concurrently, each sibling captures a stale `total` at its synchronous start and the last one to resolve overwrites the others' contributions — any directory with 2+ subdirectories silently lost all-but-one subdirectory's size. This explains the long-standing implausibly tiny cached sizes for `C:\Windows`, `C:\Users`, `C:\Program Files`, etc. Fixed by splitting into `const subtotal = await walk(full); total += subtotal;` (no `await` on the RHS of `+=`). Verified via isolated `:memory:` repro (children sum now exactly equals parent row: 10,402,367,524 == 10,402,367,524) and a live corrective rescan of `C:\dev\ai\AIFactory` (children sum 10,467,943,517 == row size 10,467,943,517). Triggered a full background refresh-rescan of `C:\` with the fixed logic to correct the remaining top-level folders left over from the original buggy scan — runs non-blocking in the background (`disk:scan-progress` confirmed streaming)
- [x] Extend "X of Y" drive total to Details view + Properties dialog: `fs:folder-size` now returns `{ size, diskTotal }` (`files.driveTotalBytes(path)`, moved from `disk.js`/`isDriveRoot`+`driveTotalBytes` now live in `files.js`). `public/js/explorer.js`'s Details-view size column and `public/js/preview.js`'s Properties dialog both render `"X of Y"` when `diskTotal` is non-null (drive roots only), else just the folder's own size. Verified over WS: `C:\` → `diskTotal: 1,020,234,625,024`, `C:\dev` → `diskTotal: null`
- [x] Drive-specific icons everywhere: `server/files.js` adds `driveTypes()` (parses `wmic logicaldisk get caption,drivetype` → `{ 'C:\\': 3, ... }`, DriveType per Win32_LogicalDisk: 2=Removable, 3=Local Fixed, 4=Network, 5=CD-ROM, 6=RAM). `fs:roots` and `fs:list` (no-path/computer view) now include `driveType` per drive. New shared `public/js/drives.js` exposes `Drives.init()` (caches `path -> driveType` from `fs:roots`, called once at boot in `app.js` before `Tree.init()`/`Tabs.restore`) and `Drives.icon(path, isDir)` — returns 🖴 (local/fixed/RAM), 🌐 (network), 💽 (removable), 💿 (CD-ROM), or `null` for non-drive-root paths. Wired into every place that rendered a hardcoded 📁 for directories: `tree.js` (`makeNode`), `explorer.js` (`fileIcon`, covers Details/List/Mosaic), `preview.js` (`fileIcon`, Properties dialog), `disk.js` (analyzer rows), `bookmarks.js` (replaces old `path.endsWith('\\') ? '💾'` heuristic, now network-drive-aware), `favourites.js`, `search.js`. Verified over WS: all 6 local drives (`C:`,`D:`,`E:`,`F:`,`G:`,`X:`) report `driveType: 3`; verified in browser via Playwright that drive roots render 🖴 while ordinary subfolders still render 📁 (swapped initial 💾 floppy-disk icon for 🖴 hard-disk per user feedback — fits the dark theme better). No network drive is currently mapped on this machine to visually confirm 🌐, but the same driveType=4 → 🌐 mapping applies uniformly

## Disk Analyzer — full rewrite
- [x] server/disk.js: replace DB-query with real FS walk, add getVolumes() for volume info
- [x] server/index.js: add disk:roots message handler
- [x] public/js/ws.js: add optional timeout param to send()
- [x] public/index.html: add storage usage bar to disk modal
- [x] public/js/disk.js: DaisyDisk-style overhaul — use disk:roots, real scan, fix rendering
- [x] public/css/app.css: improve disk analyzer styles
- [x] server/disk.js: fix macOS APFS double-counting (skip /System/Volumes via prefix match)
- [x] public/js/disk.js: fallback to fs:roots if server lacks disk:roots handler
- [x] public/js/explorer.js: guard renderView() against __disk__ path to prevent pane1.innerHTML='' destroying disk-modal-content
- [x] public/js/explorer.js: rescue disk-modal-content before pane1.innerHTML='' in _go('__disk__') to survive re-open

## Phase 12 — Terminal <-> Explorer path sync + mobile terminal keys
- [x] server/terminal.js: detect shell cwd via OSC 9;9 (cmd, via PROMPT env var) / OSC 7 (bash/zsh, PowerShell) escape sequences in PTY output, `onCwd` callback, `getCwd(id)`
- [x] server/index.js: broadcast `terminal:cwd {sid, cwd}` on change; `terminal:verify` also returns `cwd`
- [x] public/js/terminal.js: track sid->cwd map; `cd` in terminal navigates Explorer (with loop guard); Explorer navigation cd's the active terminal session (with loop guard); reuse existing session if one already has that cwd instead of spawning a new one
- [x] public/js/app.js: wire `Explorer.addNavListener(Term.syncToPath)`
- [x] public/index.html + app.css: mobile terminal toolbar — Win/Cmd, Ctrl, Alt, Shift sticky modifier buttons + Up/Down/Left/Right arrow buttons
- [x] public/js/terminal.js: wire modifier+arrow buttons into `term.onData` (Ctrl→control byte, Alt/Meta→ESC-prefix, arrows→CSI sequences with xterm modifier-param encoding)
- [x] public/js/terminal.js + app.css: `#term-keys` floats above the on-screen keyboard via `visualViewport` resize/scroll → `--kb-offset` CSS var → `translateY`
- [x] public/js/terminal.js + index.html: modifier keys reworked from one-shot "consume on next keypress" to plain on/off toggles (any combo can be active at once, stays active until tapped off); added Esc button (`data-key="esc"`, sends `\x1b`, or `\x1b\x1b` with Alt/Meta)
- [x] public/js/terminal.js: Shift toggle now uppercases typed `a-z` letters (in addition to Shift+Tab -> back-tab), so it acts like a held Shift key for case on phones without a convenient persistent shift
- [~] Verify end-to-end on cmd: cd in terminal navigates explorer; navigating explorer cd's terminal; revisiting a folder reuses its session; mobile key buttons produce correct byte sequences

## Post-merge CSS regression fix
- [x] Fix disk analyzer + git panel styling broken by the `a683be4` merge: the merge's 3-way auto-resolve silently took origin's (533006e) *deletions* of `public/css/app.css` rules wherever our side hadn't touched the same lines — even though our `public/js/disk.js`/`public/js/git.js` (Phase 11) still render markup using those class names. Net effect: `.disk-view/.disk-info/.disk-title/.disk-subtitle/.disk-actions/.disk-status(.scanning)/#disk-refresh/.disk-list-title/.disk-list-size/.disk-list-meta/.disk-loading/.disk-empty/.disk-error/.disk-row*` and the entire `.git-sync-bar/.git-ahead-behind/.git-stash-*/.git-conflict-*/.git-op-*` block (plus the `@keyframes disk-status-pulse` used by `.disk-center-status`'s "Building cache" pulse) had zero CSS — and the `@media (max-width:768px)` rule that stacks the disk-analyzer sunburst above the list (and makes the list `flex:1`/full-width) was dropped entirely, so on phones the list stayed beside the sunburst at its fixed desktop width instead of moving below and filling the remaining height. Restored all of the above (re-added from pre-merge `4c3a0b2`, keeping origin's `#disk-center-text{pointer-events:none}` addition), and removed origin's now-dead `.disk-list-item/.disk-item-name/.disk-swatch/.disk-bar-bg/.disk-del-btn/.disk-list-group/.disk-list-empty/#disk-tabs/.disk-tab*/#disk-breadcrumb/.disk-crumb/.disk-storage-*` rules (no longer referenced by any JS). Verified via Playwright at 700×1000 (triggers the 768px mobile stack but keeps the disk-view toolbar button visible): `.disk-body` is `flex-direction:column`, sunburst on top, `.disk-list-container` full-width below it filling the remaining height; desktop layout and the Git panel's sync bar / ahead-behind badge / stash section all render correctly too

## Glass theme rework
- [x] `public/js/theme.js`: compute `--glass-*` custom properties (base/panel/surface/hover/selected/active/border/wallpaper) at runtime from the active theme's own `--bg-base`/`--text-primary`/`--accent`/`--accent-2`, recomputed on theme/mode switch (stylesheet `load` listener) and on glass toggle
- [x] `public/css/glass-effect.css` rewritten: `body.glass-effect` redefines core layout vars to the new `--glass-*` vars + sets the wallpaper background; curated selector list gets a frosted-card treatment (blur/border/radius/shadow), all theme-driven — removed hardcoded photo URLs and forced light/dark text overrides
- [x] `dracula.css` / `solarized-light.css`: added the 12 standard vars (`--bg-active`, `--text-inverse`, `--accent-hover`, `--accent-2`, `--accent-2-hover`, `--warn`, `--shadow`, `--radius/-sm/-lg`, `--font-size`, `--font-mono`) that all other 22 theme files already define and that app.css depends on 77×
- [x] `app.css` disk analyzer: replaced hardcoded `rgba(0,0,0,...)`/`rgba(255,255,255,...)` overlays (`.disk-header`, `#disk-refresh`, `.disk-list-container`, `.disk-list-header` + mobile) with `var(--bg-panel)`/`var(--border)`
- [x] `app.css` modal glows: replaced hardcoded Vault-purple `rgba(124,110,245,...)` box-shadows on `dialog#preview-modal`/`dialog#props-dialog` with `color-mix(in srgb, var(--accent) X%, transparent)`
- [x] Verified statically (no browser tool available this session): all 24 theme files now define every var read by `_updateGlassVars`/app.css/glass-effect.css as 6-digit hex where required; all glass-effect.css selectors resolve to real elements (removed one dead `#disk-modal-content` selector); confirmed updated CSS/JS served live by the running dev server on :3322
- [x] Frosted readability pass: bumped `--glass-base/-panel/-surface` opacity 0.16/0.26/0.38 → 0.35/0.50/0.62 and frosted-card `backdrop-filter` blur 40px → 60px (`theme.js`/`glass-effect.css`), so panel/modal text sits on a more opaque tint while the wallpaper still bleeds through as a soft blur
- [x] Fixed panel/terminal resize broken in glass mode: `body.glass-effect .splitter { display:none }` removed the splitter's hit-area entirely (panels.js drag-resize binds `mousedown` on the splitter element). Replaced with `background: transparent` (keeps it in-flow + draggable, invisible until interacted with) plus glass-scoped `:hover`/`.dragging` → `var(--accent)` to preserve the drag-highlight
- [x] Added "Animate" toggle to theme picker popover (`public/js/theme.js`): second `.ui-switch` row next to "Glass", disabled/dimmed when glass mode is off, persisted as `de_glass_animate`. Toggling either switch re-renders the popover so the Animate row's enabled state stays in sync. `apply()` sets `body.glass-animate` when both glass + animate are on; `glass-effect.css` adds `@keyframes glass-drift` animating `background-position` over `background-size:200% 200%` (30s ease-in-out infinite alternate), with `prefers-reduced-motion: reduce` disabling it
- [x] Panel translucency tuned back down (too opaque after the readability pass): `--glass-base/-panel/-surface` 0.35/0.50/0.62 → 0.20/0.30/0.42, kept 60px blur. Wallpaper gradient reworked from 3 large overlapping ellipses (60-65% falloff) to 4 compact circular blobs (~40-45% falloff, alternating `--accent`/`--accent-2`) per corner for more visible colour variation
- [x] Fixed `#tabs-bar` vertical scrollbar: `#btn-new-tab`/`#btn-split` had `line-height: 34px`, forcing each button's box (border-box) to exactly 34px tall — but `#tabs-bar { height: 34px }` is also border-box, so its 1px (normal mode) / 2px (glass mode, full `border` vs `border-bottom`) of border ate into the content box, making the buttons 1-2px taller than the content area and tripping `overflow-y:auto` (implied by `overflow-x:auto`). Changed `line-height: 34px` → `line-height: 1`; `#tabs-bar`'s existing `align-items:center` now centers the buttons instead
- [x] Moved dark/light mode toggle into the theme picker popover as a third `.ui-switch` row ("Dark", checked = dark mode) alongside "Glass"/"Animate" — calls existing `toggle()`. Removed the standalone `#btn-theme` (◑) toolbar button and its `_wire()` listener
- [x] Removed the Theme Builder feature entirely: deleted `public/js/theme-builder.js`, its `<script>` tag, and `#btn-settings` (⚙ toolbar button, its only entry point). Updated the `@media (max-width:480px)` rule (`:not(#btn-theme)` → `:not(#btn-theme-picker)`) and the `@media (max-width:768px)` hidden-button list (dropped `#btn-settings`/`#btn-theme`) in `app.css`, plus a stale comment in `explorer.js`
- [x] Wallpaper reworked into an "ink in water" look: 5 radial-gradient blobs (4 corners + center, alternating `--accent`/`--accent-2`) each with a 3-stop soft falloff (full → dim → transparent over ~70-75% radius) so overlapping blobs blend into in-between hues instead of showing flat gaps. `.glass-animate` now drifts each blob along its own `background-position` path (5 comma-separated values, 50s ease-in-out alternate) for a slow merging/swirling motion
- [x] Wallpaper still read as flat/blurry vs. user's alcohol-ink reference photo — reworked `--glass-wallpaper` to a conic-gradient "swirl" (organic colour bands from a single point) layered over 4 tighter ink-drop blobs (28% falloff vs old 35%, higher alphas 0.85-0.95 vs 0.60-0.70) for crisper colour separation; `body.glass-effect` adds `background-blend-mode: overlay, normal, normal, normal, normal` so the swirl overlay-mixes into more varied hues. Also dropped frosted-card `backdrop-filter` blur 60px → 22px (the large blur was smoothing all wallpaper texture into a uniform haze). Updated `.glass-animate` keyframes for the new 5-layer (1 conic + 4 radial) stack
- [x] Still "too big and blurred ... a light show" — reworked `--glass-wallpaper` again to 2 large soft-edged `--accent`/`--accent-2` ink-pool ellipses plus a `repeating-conic-gradient` "vein" layer of hard 3-4deg accent/accent2/base wedges where they meet, blended via `background-blend-mode: hard-light, normal, normal` for high-contrast marbled streaks (hard edges) against the soft pools (soft edges). Dropped frosted-card blur 22px → 14px so the vein texture survives. Updated `.glass-animate` to the new 3-layer stack
- [x] Abandoned CSS-gradient approach entirely — CSS gradients are mathematically smooth, can't produce real ink-mixing texture. Replaced with an inline `<svg id="glass-ink-bg">` in `index.html` using `feTurbulence` (fractalNoise) + `feDisplacementMap` to warp `--accent`/`--accent-2` radial-gradient pools through noise: a low-frequency / scale 260 warp gives big organic marbled fingers with hard ink-bleed edges, layered with a higher-frequency / scale 90 warp at `mix-blend-mode: overlay` for fine vein texture. SVG is `position:fixed; z-index:-1; pointer-events:none`, shown only under `body.glass-effect`; stop-colors use `var(--accent)`/`var(--accent-2)` so it auto-updates on theme change. Removed `--glass-wallpaper` from `theme.js`. `.glass-animate` now slowly counter-translates/-rotates/-scales the two SVG layers (90s + 70s ease-in-out alternate) so the marbled fingers flow past each other
- [x] Sharpened ink edges + sped up animation per user: radial-gradient stops compressed (0%→100%, 45%→95%, 55%→0% — near-step alpha instead of smooth fade); added `feComponentTransfer feFuncA type="linear" slope="4" intercept="-0.6"` (and slope=5/intercept=-0.8 on the fine layer) after `feDisplacementMap` to threshold alpha and collapse remaining gradient falloff into a hard ink boundary; bumped displacement scale 260→320 (big) / 90→110 (fine); fine layer opacity 0.7→0.85; animation durations 90s/70s → 24s/18s with bigger transform amplitudes (±5% translate, ±8-9° rotate, scale 1.10-1.12)

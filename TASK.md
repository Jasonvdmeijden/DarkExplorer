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

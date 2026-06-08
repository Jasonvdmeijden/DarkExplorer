# DarkExplorer — Tasks

States: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Phase 1 — Project scaffold
- [ ] package.json + .gitignore
- [ ] config.json (defaults: port 3322, origins, shell, search exclusions)
- [ ] server/config.js

## Phase 2 — Database
- [ ] server/db.js (schema: devices, otps, files, bookmarks)

## Phase 3 — Backend modules
- [ ] server/auth.js (OTP gen, enrollment, token validation, --gen-otp CLI flag, /admin/gen-otp endpoint)
- [ ] server/files.js (list, stat, read, write, mkdir, copy, move, delete)
- [ ] server/search.js (chokidar watcher, SQLite upsert, fuzzy filename search, content search)
- [ ] server/thumbnails.js (sharp images, ffmpeg video frames, canvas code thumbnails, disk cache)
- [ ] server/terminal.js (node-pty PTY, command runner fallback, shell switching)
- [ ] server/upload.js (multer handler)
- [ ] server/index.js (Express + WebSocket, route all message types, auth middleware)

## Phase 4 — Auto-start scripts
- [ ] scripts/start.bat
- [ ] scripts/start.sh
- [ ] scripts/setup.bat (schtasks, idempotent)
- [ ] scripts/setup.sh (systemd / launchd, idempotent, auto-detects OS)

## Phase 5 — Frontend shell
- [ ] public/enroll.html (OTP enrollment page)
- [ ] public/index.html (app shell)
- [ ] public/css/app.css (layout, base styles, CSS variables)
- [ ] public/css/themes/dark.css (Vault dark palette)
- [ ] public/css/themes/light.css (Vault light palette)

## Phase 6 — Frontend JS modules
- [ ] public/js/ws.js (WebSocket client wrapper, reconnect, request/response matching)
- [ ] public/js/app.js (boot, auth check, layout init)
- [ ] public/js/explorer.js (directory listing, navigation, back/forward history, breadcrumbs)
- [ ] public/js/tabs.js (open, close, switch tabs)
- [ ] public/js/panels.js (left/right/top/bottom panels, split pane, drag-resize)
- [ ] public/js/clipboard.js (server buffer mode + download mode)
- [ ] public/js/preview.js (text/code, image, PDF, video preview routing)
- [ ] public/js/terminal.js (xterm.js init, PTY bridge, mode toggle)
- [ ] public/js/search.js (filename fuzzy UI, content search UI, results panel)
- [ ] public/js/bookmarks.js (bookmark panel, add/remove)
- [ ] public/js/theme.js (CSS variable switching, theme load)
- [ ] public/js/theme-builder.js (colour picker UI, live preview, save custom theme)

## Phase 7 — Views
- [ ] Mosaic view (justified-row layout engine, thumbnail requests, slider)
- [ ] Details view (columns, sort, resize, show/hide)
- [ ] List view (compact icon + name)
- [ ] Context menu (all actions wired up)
- [ ] Inline rename (F2, click-to-edit)
- [ ] Multi-select (shift+click, ctrl+click, drag box)
- [ ] Path bar (breadcrumb + editable text input toggle)

## Phase 8 — Polish & integration
- [ ] Drag and drop (move files, upload by dropping onto panel)
- [ ] Keyboard shortcuts (F2 rename, Del delete, Ctrl+C/X/V, Ctrl+F search)
- [ ] Responsive layout (phone, tablet, desktop breakpoints)
- [ ] ffmpeg missing → graceful fallback to static icon
- [ ] Search exclusion rules respected in both filename and content search
- [ ] Thumbnail disk cache invalidation on file change

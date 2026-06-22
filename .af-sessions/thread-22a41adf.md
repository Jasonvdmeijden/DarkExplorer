# DarkExplorer Development Summary

## Project Overview
A cross-platform web file explorer built with Node.js + vanilla JavaScript. Supports tabs, split panes, file preview, real-time search, terminal, git integration, and cross-device state sync. Internet-facing with OTP device enrollment.

## Technology Stack
- **Backend:** Node.js + Express, SQLite (FTS5), WebSocket (`ws`)
- **Frontend:** Vanilla HTML/CSS/JS, CDN libraries (highlight.js, pdf.js, mammoth.js, SheetJS)
- **File watching:** Native `fs.watch()` (replaced chokidar on Windows to avoid libuv crashes)
- **Terminal:** node-pty + xterm.js
- **Port:** 3322 (configurable), allowed origins in config.json

## Key Architecture Decisions
- **Auth:** OTP-based device enrollment (one-time code + long-lived device tokens stored in `devices_state` table)
- **Search:** Fuzzy on filenames/metadata, exact/regex on file contents
- **Clipboard:** User chooses per action (server buffer or browser download)
- **State sync:** All tabs, panels, tree expansion, search filters, view modes persisted in SQLite `workspace_state` table, pushed via WebSocket to all connected clients
- **Mobile:** Full responsive design with drawer panels; search/preview full-screen on phones

## Core Features Implemented
- **Views:** Mosaic (justified-row gallery), Details (sortable columns), List (compact)
- **Preview:** Text/code (syntax highlight), Markdown (mermaid diagrams), HTML (sandbox iframe), PDF, images, video/audio, CSV, DOCX/XLSX/PPTX, ZIP, URLs (open in new tab)
- **Properties:** Modal showing full file metadata, folder sizes calculated recursively
- **Terminal:** Full PTY (cmd/PowerShell on Windows, bash on Mac/Linux), switchable
- **Git panel:** Latest 5 commits, branch switching, staging/unstaging, file diffs
- **Search:** Full-text across all drives, include/exclude rules, debounced (600ms)
- **Multi-select:** Click, Shift+click range, Ctrl+click toggle, drag-to-select box
- **Rename:** Inline with instant feedback (optimistic UI)
- **Zip:** Extract here/to path, download folders as ZIP, zip selected files
- **Execution:** Double-click .exe/.msi/.bat/.cmd/.ps1/.sh to run
- **Bookmarks:** Folders and URLs, per-device persistence
- **System stats:** CPU/RAM/disk usage, network speed (heat-mapped by usage %)

## Recent Bug Fixes
1. **Left panel on mobile** — changed from `transform` on `display: none` to `display: flex` in mobile media query
2. **Terminal blank on iOS** — added double `requestAnimationFrame` for layout computation, `term.focus()` call, touchstart listener for keyboard
3. **Preview modal centering** — switched from `inset: 0` to `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%)` (works on iOS Safari top-layer)
4. **Server crashes** — removed indexer child process (eliminated DB contention on Windows), added `busy_timeout` and process-level error handlers

## Outstanding Issues (Current Turn)
1. **Images/videos in resized modal** — need to dynamically scale with modal resize (currently fixed aspect ratio)
2. **Bookmark saving** — add/update bookmark endpoint not persisting URLs to database (especially from bookmark panel input)

## File Structure
```
server/: index.js, auth.js, files.js, search.js, terminal.js, upload.js, thumbnails.js, db.js, config.js, stats.js
public/: index.html, enroll.html
public/css/: app.css, themes/dark.css, themes/light.css
public/js/: app.js, ws.js, explorer.js, tabs.js, panels.js, clipboard.js, preview.js, 
           terminal.js, search.js, bookmarks.js, theme.js, theme-builder.js, tree.js, 
           state.js, git.js, stats.js
scripts/: start.bat, start.sh, setup.bat, setup.sh
data/: darkexplorer.db, themes/
```

## Key Implementation Notes
- Preview modal supports 50%–90% resize with handle in bottom-right corner; size persists in localStorage
- Breadcrumb navigation via path bar with `stopPropagation()` to prevent text input mode
- Context menu includes copy name/path/folder-path options
- Folder sizes calculated on-demand with recursive walk, displayed as "Calculating…" then updated
- Mobile: drawer panels with backdrop, full-screen search/preview, double-tap for context menu
- State sync: every action saves to SQLite, broadcast via `state:push` to other connected clients
- Terminal: focus/keyboard handling for iOS, double RAFs for layout
- All modals centered via CSS `translate(-50%, -50%)` for cross-browser consistency

## User Preferences Documented
- KISS principle, no over-engineering
- Solve problems autonomously, don't ask for help except on genuinely ambiguous requirements
- Simple, clean, boring code beats clever code
- Responsive to phone/tablet/desktop without framework-specific breakpoints

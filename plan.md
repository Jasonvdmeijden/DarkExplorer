# DarkExplorer — Architecture Plan

## What it is
A web-based file explorer. Node.js backend, vanilla JS frontend (no build step, no framework). All real-time communication over WebSocket. Deployed internet-facing behind the user's own reverse proxy.

---

## Stack

| Concern | Tool |
|---|---|
| HTTP + static files | Express |
| Real-time (all FS ops) | `ws` WebSocket |
| Database | `better-sqlite3` |
| File watching | `chokidar` |
| Terminal (PTY) | `node-pty` + `xterm.js` (CDN) |
| File upload | `multer` |
| Image thumbnails | `sharp` |
| Video thumbnails | `ffmpeg` (system) + `fluent-ffmpeg` |
| Code thumbnails | `canvas` (node-canvas) |
| PDF preview | `pdf.js` (CDN) |
| Syntax highlight | `highlight.js` (CDN) |
| Markdown render | `marked.js` (CDN) |
| Diagram render | `mermaid.js` (CDN) |

---

## File Structure

```
DarkExplorer/
├── server/
│   ├── index.js        # entry — Express + WebSocket server
│   ├── auth.js         # OTP, device enrollment, token validation
│   ├── files.js        # FS ops: list, stat, read, copy, move, delete, mkdir
│   ├── search.js       # SQLite metadata index, fuzzy filename, content search
│   ├── terminal.js     # node-pty sessions, shell switching, command runner fallback
│   ├── upload.js       # multer upload to target path
│   ├── thumbnails.js   # image/video/code thumbnail generation
│   ├── db.js           # SQLite connection + schema init
│   └── config.js       # config.json loader
├── public/
│   ├── index.html      # app shell (authenticated)
│   ├── enroll.html     # device enrollment
│   ├── css/
│   │   ├── app.css
│   │   └── themes/
│   │       ├── dark.css
│   │       └── light.css
│   └── js/
│       ├── app.js          # boot, auth check, layout init
│       ├── ws.js           # WebSocket client wrapper
│       ├── explorer.js     # directory listing, navigation, history
│       ├── tabs.js         # tab open/close/switch
│       ├── panels.js       # left/right/top/bottom panels, split pane, drag resize
│       ├── clipboard.js    # server buffer + download model
│       ├── preview.js      # text/image/pdf/video preview routing
│       ├── terminal.js     # xterm.js init + PTY bridge
│       ├── search.js       # search UI + results
│       ├── bookmarks.js    # bookmark panel CRUD
│       ├── theme.js        # CSS variable switching
│       └── theme-builder.js# theme builder UI + custom theme save
├── data/
│   ├── darkexplorer.db
│   └── themes/             # user custom themes (JSON)
├── scripts/
│   ├── start.bat           # Windows: start server
│   ├── start.sh            # Linux/Mac: start server
│   ├── setup.bat           # Windows: register Task Scheduler entry at logon
│   └── setup.sh            # Linux/Mac: systemd (Linux) or launchd (Mac)
├── config.json
├── package.json
├── plan.md
├── CLAUDE.md
└── TASK.md
```

---

## Config (config.json defaults)

```json
{
  "port": 3322,
  "origins": [
    "http://explorer.somevault.co.za",
    "http://192.168.88.253:3322",
    "http://localhost:3322"
  ],
  "shell": {
    "windows": "cmd",
    "linux": "bash",
    "mac": "bash"
  },
  "search": {
    "maxFileSizeBytes": 524288,
    "exclusions": ["node_modules", ".git", "dist", "build", "__pycache__", "*.min.js", "*.min.css"]
  },
  "thumbnails": {
    "rowHeight": 200,
    "maxWidth": 400
  },
  "theme": "dark"
}
```

---

## Database Schema (SQLite)

```sql
CREATE TABLE IF NOT EXISTS devices (
  id       TEXT PRIMARY KEY,
  label    TEXT,
  token    TEXT UNIQUE NOT NULL,
  enrolled_at INTEGER,
  last_seen   INTEGER
);

CREATE TABLE IF NOT EXISTS otps (
  code       TEXT PRIMARY KEY,
  expires_at INTEGER,
  used       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS files (
  path       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  ext        TEXT,
  size       INTEGER,
  mtime      INTEGER,
  ctime      INTEGER,
  is_dir     INTEGER DEFAULT 0,
  searchable TEXT   -- combined: path + name + ext + formatted dates + size label
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id         TEXT PRIMARY KEY,
  path       TEXT NOT NULL,
  label      TEXT,
  device_id  TEXT,
  created_at INTEGER
);
```

---

## Auth Flow

1. Admin runs `node server/index.js --gen-otp` or hits `GET http://localhost:3322/admin/gen-otp` (localhost only).
2. OTP printed/returned. Valid for 1 hour, single use.
3. New device visits the app → redirected to `enroll.html` → enters OTP.
4. Server validates → issues device token (UUID) → stored in `devices` table.
5. Token saved in browser `localStorage`. Sent on every WebSocket handshake.
6. All subsequent requests authenticated by token.

---

## WebSocket Protocol

All messages: `{ id, type, payload }` → `{ id, type, ok, data?, error? }`

### Message types

```
fs:list         list directory contents
fs:stat         file/folder metadata
fs:read         read file text content
fs:write        write file text content
fs:mkdir        create directory
fs:copy         copy file(s) server-side
fs:move         move/rename file(s)
fs:delete       delete file(s)
fs:watch        subscribe to directory change events
fs:unwatch      unsubscribe

search:filename  fuzzy search against metadata index
search:content   exact/regex content search with include/exclude patterns

terminal:create  create PTY or command-runner session
terminal:input   send input to session
terminal:resize  resize PTY
terminal:destroy close session
terminal:switch  switch shell (cmd ↔ PowerShell on Windows)

clipboard:set    store paths in server buffer
clipboard:get    retrieve server buffer
clipboard:clear  clear server buffer

bookmark:list    list bookmarks
bookmark:add     add bookmark
bookmark:remove  remove bookmark

thumbnail:get    request compressed thumbnail for a file
```

Uploads: `POST /upload?path=<dir>` (multipart, authenticated via token header).
Downloads: `GET /download?path=<file>` (authenticated via token query param).

---

## Search

### Filename / path (fuzzy)
- SQLite `files` table holds a `searchable` string per file: `full/path/to/file.ts  ts  4.2kb  2024-03-15  14:32`
- Query: load candidates from SQLite → score each `searchable` string using trigram similarity → return ranked results.
- Supports metadata terms: extension, date, size label, path fragments.

### Content (exact / regex)
- User provides: search term, include globs (`*.ts`, `src/**`), exclude globs (`node_modules`).
- Server filters `files` table by include/exclude patterns.
- Reads matching files line by line, collects matches with line numbers.
- Returns paginated results (100 per page).

---

## Views

| View | Description |
|---|---|
| **Mosaic** | Justified-row layout. Items packed into rows at a shared height (slider-adjustable). Images/videos at natural aspect ratio; code files as 1:1 highlighted square thumbnail. |
| **Details** | Columns: name, size, type, modified, created. Sortable (click header), resizable (drag), show/hide per column. |
| **List** | Compact single-column, small icon + name. |

---

## Preview Panel

Toggle bar at top: `[ Rich ]  [ Raw ]  |  [ Meta ]`

| File type | Rich view | Raw view |
|---|---|---|
| Markdown | `marked.js` renders HTML; fenced `mermaid` blocks rendered by `mermaid.js` (flowcharts, sequence, Gantt, ER, class diagrams) | Raw source, `highlight.js` |
| Code | `highlight.js` with line numbers | Plain text |
| HTML | Sandboxed `<iframe sandbox="allow-scripts" srcdoc="...">` — rendered in-browser, isolated | Raw source, `highlight.js` |
| Image | Native `<img>` | EXIF/metadata panel |
| PDF | `pdf.js` viewer | — |
| Video / audio | HTML5 `<video>` / `<audio>` | — |

**Meta sidebar** (collapsible, shown via Meta toggle):
- Name, full path, type, extension, size, modified, created, encoding (UTF-8 etc.)
- Always available regardless of file type.

---

## UI Chrome

```
[ ← ] [ → ] [ ↑ ]  [ C: › Users › Jason › Projects ]  [search]  [view toggle]  [⚙]
```

- Back / forward: per-tab history stack in memory.
- Up: navigate to parent directory.
- Breadcrumb: each segment clickable. Click the bar to switch to editable text input (type a path directly).
- Path bar doubles as scope indicator for search.

---

## Context Menu

```
Open
Open in new tab
Open in split pane
─────────────────
Open terminal here
Search from here
─────────────────
Cut   Copy   Paste   Download
─────────────────
Rename (F2)
New folder
Delete (Del)
─────────────────
Properties
```

---

## Terminal

- **Windows:** cmd by default. Switch to PowerShell via toolbar button or `terminal:switch` message.
- **Linux / Mac:** bash.
- Shell override available in `config.json`.
- Two modes: **PTY** (xterm.js, full interactive) and **Command runner** (plain text output). Togglable.
- "Open terminal here" from context menu: opens terminal panel and runs `cd <path>`.

---

## Theming

- All colours as CSS custom properties on `:root`.
- Built-in: `dark.css`, `light.css` (Vault aesthetic — deep navy/purple base, teal accent).
- Custom themes: stored as JSON in `data/themes/`, loaded at runtime and injected as a `<style>` block.
- Theme builder UI: colour picker per variable, live preview, save with a name.

### Vault dark palette
| Variable | Value | Role |
|---|---|---|
| `--bg-base` | `#12121a` | Window background |
| `--bg-surface` | `#1c1c28` | Panels, cards |
| `--bg-hover` | `#252535` | Row hover |
| `--bg-selected` | `#2a2a45` | Selected item |
| `--border` | `#2d2d45` | Dividers |
| `--text-primary` | `#e2e2f0` | Main text |
| `--text-secondary` | `#8888aa` | Labels, metadata |
| `--accent` | `#7c6ef5` | Buttons, highlights |
| `--accent-2` | `#4ecdc4` | Secondary highlights |

---

## Auto-start

| OS | Mechanism |
|---|---|
| Windows | Task Scheduler entry at user logon via `schtasks` (no admin required) |
| Linux | `systemd` user service |
| Mac | `launchd` plist in `~/Library/LaunchAgents` |

`setup.bat` / `setup.sh` are idempotent — safe to run again.
`setup.sh` auto-detects Linux vs Mac.
Both scripts check for Node.js and ffmpeg and print a warning if missing.

---

## Thumbnails

- **Images:** `sharp` resizes to target dimensions, returns WebP. Only thumbnail size sent to browser; full res loaded in preview panel.
- **Videos:** `fluent-ffmpeg` extracts 3 frames, returned as WebP strip. Falls back to static icon if ffmpeg not installed.
- **Code/text:** `node-canvas` renders first ~40 lines with syntax highlight colours as a 1:1 square WebP (minimap style).
- Thumbnail cache: stored in `data/thumbcache/` keyed by `path + mtime`. Invalidated when file changes.

---

## Decisions Log

| Date | Decision | Reason |
|---|---|---|
| 2026-06-08 | SQLite for metadata index, not in-memory map | Persists across restarts, survives large filesystems |
| 2026-06-08 | Content search on-demand (no FTS5 content store) | Full-filesystem FTS5 index would be 50–100 GB |
| 2026-06-08 | Fuzzy search on combined metadata string | Lets user search by date, ext, size, path in one query |
| 2026-06-08 | cmd default on Windows, switchable to PowerShell | User preference; cmd is lighter, PowerShell available |
| 2026-06-08 | Gallery renamed to Mosaic view | Justified-row layout, user's preferred term |
| 2026-06-08 | Both OTP methods (CLI + localhost endpoint) | Flexibility — terminal access not always available |
| 2026-06-08 | Server clipboard buffer + download both available | User picks per action |
| 2026-06-13 | Disk usage cache rewritten as whole-system `disk_nodes` index (one row per fs entry, file size or recursive dir total), replacing per-folder `disk_cache` blobs | Single source of truth shared by all clients; `getTree()` is a pure SQL read so `disk:scan` never blocks/times out |
| 2026-06-13 | Background full scan is a singleton crawl over `files.roots()`, post-order writes (children before parents), batched `db.transaction()` upserts | Avoids redundant concurrent scans; parent sizes are always derived from already-written child rows |
| 2026-06-13 | Incremental updates via `notifyChange(path)` + `_bubbleUp()` walking `parent_path` chain, called from every `files.js` mutation (write/mkdir/remove/copy/move/rename/duplicate) and `/upload` | Avoids full rescans on every fs change — O(depth) update instead of O(tree) |
| 2026-06-13 | Move/rename of a large tracked directory = delete subtree at source + bounded re-crawl at destination (not a path-prefix rewrite) | Simplest correct behaviour; cost is paid once in the background, no special-casing of bulk path rewrites |
| 2026-06-13 | Disk scan does NOT apply `config.search.exclusions` | Matches prior behaviour — disk usage should reflect true on-disk size including node_modules etc. |
| 2026-06-13 | `initBackgroundScan()` restarts `startFullScan()` if `disk_scan_state.status==='scanning'` on startup (not just when `disk_nodes` is empty) | A server restart mid-scan otherwise leaves `disk_scan_state` stuck on "scanning" forever since the in-memory `_scanning` flag resets but the DB row doesn't |
| 2026-06-13 | Async git ops (fetch/pull/push/stash apply-pop/merge/rebase) run with `NO_PROMPT_ENV` (`GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true`, `GIT_SEQUENCE_EDITOR=true`) | Prevents indefinite hangs on credential prompts or editor invocations from a headless server |
| 2026-06-13 | Fixed `git.status()` porcelain parser: `out.trim().split('\n')` → `out.split(/\r?\n/).filter(...)` | `.trim()` stripped the leading space off the first porcelain line whenever it began with `" M "` (unstaged-only change), corrupting that file's path and status code |
| 2026-06-13 | `_buildChildren`/`getTree` compute each directory's effective size as `max(stored disk_nodes.size, sum of children's effective sizes)`, bottom-up, read-time only (no write-back) | Some `disk_nodes` directory totals lag behind their children (bubble-up can hit a row before the full-scan's post-order write finalizes it), breaking the sunburst's `parent.size >= sum(children.size)` invariant; computing effective size at read time fixes display without a full rescan |

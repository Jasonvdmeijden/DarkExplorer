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
| 2026-06-14 | Drive-root folders show `_diskTotal` (real total capacity via `fs.statfsSync(rootPath).blocks * bsize`) so the UI can render "X of Y"; all other folders get `_diskTotal: null` | Only a drive root has a meaningful "out of" denominator — subfolder sizes are already bounded by their parent in the sunburst |
| 2026-06-14 | `_crawlAndStore`'s `walk()`: `total += await walk(full)` → `const subtotal = await walk(full); total += subtotal;` | `total += await expr` reads `total` *before* awaiting; concurrent sibling directory walks (`Promise.all`) each capture a stale `total` and the last to resolve clobbers the others — any directory with 2+ subdirectories silently lost all-but-one subdirectory's size since the first full scan. Fixed and re-verified via isolated `:memory:` repro + live corrective rescan; triggered a full background `C:\` refresh-rescan to correct the rest of the tree under the old buggy totals |
| 2026-06-14 | "X of Y" extended beyond the disk analyzer: `fs:folder-size` now returns `{ size, diskTotal }`, consumed by Details-view size column and Properties dialog | One denominator helper (`files.driveTotalBytes`) reused everywhere a folder size is shown, instead of duplicating drive-root detection per view |
| 2026-06-14 | Drive icons are driven by `Win32_LogicalDisk.DriveType` (`server/files.js: driveTypes()`, parsed from `wmic logicaldisk get caption,drivetype`), exposed on `fs:roots`/`fs:list` and consumed via a shared `public/js/drives.js` (`Drives.icon(path, isDir)`, cached map populated once at boot) | One shared lookup avoids 7 separate ad-hoc `path.endsWith('\\') ? '💾' : ...` heuristics (one already existed in `bookmarks.js` and couldn't distinguish network vs local drives); icon mapping: 2=💽 removable, 3=🖴 local fixed, 4=🌐 network, 5=💿 CD-ROM, 6=🖴 RAM disk |
| 2026-06-14 | After merging `origin/main` (`a683be4`), restored a large block of `app.css` rules that the 3-way merge silently dropped (`.disk-view/.disk-info/.disk-title/.disk-subtitle/.disk-actions/.disk-status/#disk-refresh/.disk-list-title/.disk-list-size/.disk-list-meta/.disk-loading/.disk-empty/.disk-error/.disk-row*`, `@keyframes disk-status-pulse`, the disk-analyzer mobile stacking media query, and the entire `.git-sync-bar/.git-ahead-behind/.git-stash-*/.git-conflict-*/.git-op-*` block); removed origin's now-unreferenced `.disk-list-item/.disk-tab*/#disk-breadcrumb/.disk-storage-*` rules | Origin's commit (`533006e`) deleted these rules as part of an alternate disk-analyzer CSS naming scheme, but our `public/js/disk.js`/`git.js` (Phase 11) still render markup using the old class names — git took the deletions wherever our side hadn't touched the same lines, since that's a non-conflicting 3-way merge. Always grep JS for class-name usage after a merge that touches shared CSS, not just resolve marked conflicts |
| 2026-06-14 | Terminal cwd detection uses shell-reported OSC escape sequences (OSC 9;9 for cmd via injected `PROMPT` env var and PowerShell via a `prompt` function override sent as PTY input; OSC 7 for bash/zsh via `PROMPT_COMMAND`), scanned server-side in `server/terminal.js` (`makeCwdScanner`) and broadcast as `terminal:cwd {sid, cwd}` | Reuses the shell's own prompt-rendering — no extra polling/process, works for any `cd`/`pushd`/`Set-Location` regardless of how it was typed. Only the cmd path is verified on this Windows dev machine; PowerShell/bash injections are best-effort/unverified (low risk: if the injection doesn't take, cwd sync simply doesn't fire for that shell, terminal itself is unaffected) |
| 2026-06-15 | Glass mode's translucent colours + wallpaper are computed at runtime (`public/js/theme.js: _updateGlassVars`) from the *active theme's own* `--bg-base`/`--text-primary`/`--accent`/`--accent-2` (hex → rgba), written as new `--glass-*` custom properties on `<html>` | Previous glass-effect.css hardcoded fixed Unsplash photo URLs + forced white/black text per light/dark — looked wrong against non-Vault themes. Computing from the active theme's own colours makes glass mode match whichever theme + light/dark mode is selected, for all 24 theme variants, without enumerating per-theme CSS |
| 2026-06-15 | `body.glass-effect` redefines the small set of core vars app.css already builds on (`--bg-base/-surface/-panel/-hover/-selected/-active`, `--border`, `--scrollbar-track`) to point at `--glass-*`, instead of writing per-component glass rules | Cascades the glass look to ~90% of the UI (toolbar, panels, rows, tabs, menus, dialogs) for free since app.css is already var-driven; only the remaining ~20 "card" surfaces need an explicit frosted-card rule (blur/border/shadow) in glass-effect.css |
| 2026-06-15 | `--glass-*` use new variable names rather than `body.glass-effect { --bg-base: color-mix(in srgb, var(--bg-base) ...) }` | Self-referencing a custom property inside its own redefinition is a cycle per the CSS spec → the property computes to its guaranteed-invalid value (transparent black), silently breaking every dependent rule |
| 2026-06-15 | Added the 12 standard vars (`--bg-active`, `--text-inverse`, `--accent-hover`, `--accent-2`, `--accent-2-hover`, `--warn`, `--shadow`, `--radius`, `--radius-sm`, `--radius-lg`, `--font-size`, `--font-mono`) to `dracula.css` and `solarized-light.css`, matching the other 22 theme files | These 2 themes were missing vars used 77× across app.css (border-radius, shadows, glass rendering all came out blank for them); values chosen to match each theme's existing palette/conventions (e.g. Dracula `--accent-2: #8be9fd` cyan, Solarized `--warn: #cb4b16`) |
| 2026-06-15 | Disk-analyzer hardcoded `rgba(0,0,0,...)`/`rgba(255,255,255,...)` overlays (`.disk-header`, `#disk-refresh`, `.disk-list-container`, `.disk-list-header`) replaced with `var(--bg-panel)`/`var(--border)`; preview-modal/props-dialog hardcoded Vault-purple shadow glows (`rgba(124,110,245,...)`) replaced with `color-mix(in srgb, var(--accent) X%, transparent)` | Same fixed-dark-overlay issue as the photo backgrounds — these didn't respond to theme or glass mode. `color-mix` keeps the glow tinted to whichever theme's accent colour is active |
| 2026-06-15 | Re-tuned glass values after first pass looked too subtle ("transparency gone"): panel opacities `--glass-base/-panel/-surface` 0.30/0.42/0.55 → 0.16/0.26/0.38; wallpaper gradient alphas 0.40/0.32/0.18 → 0.65/0.55/0.40 with larger ellipses; frosted-card blur 28px→40px, saturate 160%→180% | Verified via Playwright screenshots (chromium, headed off): the first pass's wallpaper gradients were too low-contrast against a near-black `--bg-base` and the 55% panel opacity left almost no visible blur/see-through. Lower panel opacity + bolder wallpaper + stronger blur reproduces the old photo-glass's frosted look while staying theme-derived; confirmed across Vault dark/light, Dracula dark, Solarized light, Ocean dark |
| 2026-06-14 | Explorer→terminal sync (`Term.syncToPath`) only acts if a terminal session is already open (`if (!sid) return`); it never auto-opens the terminal panel | `AskUserQuestion` failed (tool returned `"Answer questions?"` with no detail, twice) so this was decided without user input as the simplest default — syncing an already-visible terminal is unsurprising, while an explorer click silently popping open a terminal panel would not be. User can ask to change this if they'd prefer auto-open |
| 2026-06-14 | Session reuse: client keeps a `sid -> normalized cwd` map (`sessions`, populated from `terminal:cwd` broadcasts + `terminal:verify`); navigating to a path matching another open session's cwd switches the active `sid` and calls `term.clear()` rather than spawning a new PTY | Matches "if a folder already has a terminal open, reopen that session, don't make a new one" — `term.clear()` trades scrollback for simplicity (no output-history replay needed) |
| 2026-06-14 | Loop prevention between explorer nav and terminal `cd` uses two one-shot flags, `_pendingExplorerSync`/`_pendingTermSync`, each cleared the first time the corresponding echo is observed | Both directions go through the same `Explorer.addNavListener`/`terminal:cwd` paths, so without a guard a `cd` would re-trigger a nav which re-triggers a `cd`, etc. |
| 2026-06-14 | Mobile terminal toolbar: Ctrl/Alt/Shift/Meta are sticky one-shot toggle buttons consumed by the next keypress or arrow tap (`_applyMods`/`_consumeMods`); GUI/Cmd (Meta) is encoded the same as Alt (ESC-prefix); arrow buttons use xterm's standard `\x1b[1;<N><letter>` modifier-parameter CSI encoding | Phones have no physical modifier/arrow keys. There's no standard terminal meaning for a literal Super/Cmd key, so mapping it to Alt's ESC-prefix avoids inventing a non-standard protocol while still giving it *some* effect. CSI modifier encoding makes Ctrl/Shift/Alt+Arrow behave identically to a physical keyboard (e.g. Ctrl+Right = word-jump in readline) |
| 2026-06-15 | Mobile terminal modifiers changed from one-shot "consume on next keypress" (`_consumeMods`) to plain on/off toggles read directly from `_modFlags` (`_applyMods`/`_modParam` no longer reset state); added an Esc button (`\x1b`, or `\x1b\x1b` if Alt/Meta held) | User reported modifiers "not actually modifying" input and Shift "not switching on/off", and asked for multiple modifiers active at once. A one-shot consume tied to the *next* `onData` event is timing-sensitive — a stray/duplicate `onData` from a mobile virtual keyboard (composition events) can silently eat the armed modifier before the real keystroke arrives. Toggling like held keys (stays on until tapped off) removes that race, directly supports multiple simultaneous modifiers, and matches "switch on/off" — tradeoff is the user must remember to toggle a modifier off, same as a real held key |
| 2026-06-15 | `_applyMods`: when Shift toggle is on, lowercase `a-z` input is uppercased before being sent (one-directional — uppercase input from the OS keyboard's own autocapitalize is left as-is) | User: "Shift is not making text uppercase as I type". On-screen Shift previously only affected Shift+Tab; phones without a convenient persistent shift key need it to actually case-shift letters. One-directional avoids double-negating already-uppercase input from the device's own autocapitalize |
| 2026-06-15 | Glass surfaces re-tuned again for readability: `--glass-base/-panel/-surface` 0.16/0.26/0.38 → 0.35/0.50/0.62; frosted-card `backdrop-filter` blur 40px → 60px | User: panels/modals need a "frosted blurry look ... to keep their content readable". The previous pass (row above) prioritised wallpaper visibility but left panel surfaces too see-through for text contrast; higher surface opacity + more blur keeps the wallpaper as a soft colour haze behind clearly-readable panels |
| 2026-06-15 | Glass-mode splitter fix: `body.glass-effect .splitter { display:none }` → `background: transparent` (+ glass-scoped `:hover`/`.dragging` → `var(--accent)`) | `display:none` removed the splitter's hit-area, so `panels.js`'s `mousedown`-based drag-resize silently stopped working in glass mode. `display:none` was only ever meant to *hide* the divider line (the 12px `#layout`/`#panes` gap already provides the "open gap" look) — keeping the element in-flow but transparent preserves both the look and the resize handlers |
| 2026-06-15 | Added "Animate" toggle to theme picker (next to "Glass"), persisted as `de_glass_animate`, disabled/dimmed when glass mode is off; implemented via `body.glass-animate { background-size:200% 200%; animation: glass-drift ... }` animating `background-position` (CSS `@keyframes`, `prefers-reduced-motion` respected) | User requested an optional animated gradient background, glass-mode-only. Pure-CSS keyframe animation on `background-position` needs no JS render loop and layers correctly on top of the `background: var(--glass-wallpaper)` shorthand (longhand `background-size`/animated `background-position` win by specificity/animation priority) |
| 2026-06-15 | Panel surfaces re-tuned down again: `--glass-base/-panel/-surface` 0.35/0.50/0.62 → 0.20/0.30/0.42 (kept the 60px frosted-card blur from the prior pass) | User: "main panels translucency is too low" (i.e. too opaque) after the previous readability bump. The 60px blur alone (vs the original 40px) provides enough diffusion for legibility, so opacity could come back down close to the original 0.16/0.26/0.38 while staying slightly higher for contrast |
| 2026-06-15 | Wallpaper gradient reworked from 3 large overlapping ellipses (75-100% size, 60-65% falloff) to 4 compact circular blobs (~40-45% falloff) in each corner, alternating `--accent`/`--accent-2` | User: gradient "doesn't have enough variation, looks a little non-existent" — the large ellipses blended into one near-flat wash. Smaller, tighter-falloff circles create distinct colour regions across the viewport for visible variation once blurred |
| 2026-06-15 | `#btn-new-tab, #btn-split`: `line-height: 34px` → `line-height: 1` | `#tabs-bar` is `height: 34px` under global `box-sizing: border-box`, so its content-box is `34px - border-width`. The buttons' `line-height: 34px` forced their own border-box height to 34px regardless, overflowing the content box by 1px (normal mode, `border-bottom` only) or 2px (glass mode, full `border`) and tripping `overflow-y:auto` (implicitly `auto` since `overflow-x:auto` is set). `#tabs-bar` already has `align-items:center`, which centers the now content-sized buttons correctly without the magic line-height |
| 2026-06-15 | Removed the standalone `#btn-theme` (◑ dark/light toggle) button; moved it into the theme picker popover as a 3rd toggle row ("Dark") next to "Glass"/"Animate" | User: consolidate dark/light mode into the theme picker as a toggle like Glass/Animate. One picker now controls theme, mode, glass, and animation |
| 2026-06-15 | Removed the Theme Builder feature (`public/js/theme-builder.js`, its script tag, `#btn-settings`) | User asked to remove it. It was the only consumer of `#btn-settings`; updated the two mobile media-query button lists in `app.css` (`:not(#btn-theme)` → `:not(#btn-theme-picker)`, dropped `#btn-settings`/`#btn-theme` from the hidden list) so the theme picker stays reachable on small screens |
| 2026-06-15 | Wallpaper rewritten as 5 soft 3-stop radial-gradient "ink drop" blobs (4 corners + center, alternating `--accent`/`--accent-2`, falloff to transparent over 70-75%) instead of 4 compact hard-edged circles; `.glass-animate` drifts each blob's `background-position` independently (5 comma-separated values) over 50s | User wanted the background to look "more like ink floating in water and merging/mixing", not isolated corner dots. Wide soft falloffs let overlapping blobs visually blend into intermediate hues; independent per-layer position keyframes make the blobs slide past/through each other rather than moving in lockstep |
| 2026-06-15 | Wallpaper reworked again: replaced the 5 soft blobs with a conic-gradient "swirl" (1 layer, organic colour bands from one point) + 4 tighter radial blobs (28% falloff, alpha 0.85-0.95 vs old 0.60-0.70); added `background-blend-mode: overlay, normal, normal, normal, normal` on `body.glass-effect`; reduced frosted-card `backdrop-filter` blur 60px → 22px | User attached a reference photo of alcohol-ink/fluid-art texture and said the previous result "is much too blurry, I dont think the ink effect is happening". The 60px blur was smoothing the entire wallpaper into a uniform haze regardless of its gradient shape; the conic-gradient swirl + overlay blend gives organic, higher-contrast colour banding, and tighter/brighter radial blobs survive the lower blur with visible colour-separation edges |
| 2026-06-15 | Wallpaper reworked a third time: down to 2 large soft-edged `--accent`/`--accent-2` ink-pool ellipses + 1 `repeating-conic-gradient` "vein" layer (hard 3-4deg accent/accent2/base wedges, 10 repeats around 360deg) where the pools meet; `background-blend-mode: hard-light, normal, normal`; frosted-card blur 22px → 14px | User: still "too big and blurred ... ink mixing full of texture hard and soft edges, not a light show". Two broad colour pools (soft edges) match the reference photo's two-mass composition better than 4-5 symmetric blobs; the repeating-conic vein layer gives genuinely hard-edged marbled streaks at the boundary, and `hard-light` blending produces high-contrast mixed hues rather than a smooth glow |
| 2026-06-15 | Abandoned CSS-gradient wallpaper entirely; new approach is inline `<svg id="glass-ink-bg">` in `index.html` using `feTurbulence` (fractalNoise) + `feDisplacementMap` to warp `--accent`/`--accent-2` radial-gradient pools through fractal noise — two filter pairs: low-freq (baseFreq 0.009/0.014, scale 260) for big marbled fingers with hard ink-bleed edges, high-freq (baseFreq 0.025/0.030, scale 90) for fine vein texture at `mix-blend-mode: overlay`. SVG is `position:fixed; z-index:-1; pointer-events:none`, shown only under `body.glass-effect`. `.glass-animate` counter-translates/-rotates/-scales the two SVG layers via CSS transforms (90s/70s alternate). Removed the old `--glass-wallpaper` from `theme.js` | User: "currently there is absolutely wrong and needs to be fixed ... ink floating and mixing with lots of texture and blending". CSS gradients are mathematically smooth and can't produce real ink mixing — `feDisplacementMap` warps gradients through noise, which is what actually produces ink-in-water's organic, irregular, mixed-edge texture. Stop-colors use `var(--accent)`/`var(--accent-2)` so the SVG auto-restyles on theme change |

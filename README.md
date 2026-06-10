# DarkExplorer

A web-based file explorer that runs on your machine and serves your filesystem to any device — desktop or mobile — over the network. Built on Node.js with a vanilla JS frontend, no build step, all real-time over WebSocket.

> Browse, preview, search, edit, and run a terminal in your files from any browser on any device.

---

## Features

### Browsing & previews
- **Three views** — Details (sortable, resizable columns), List (compact), Gallery (image/video tiles)
- **Gallery short-clip thumbnails** — videos play a 5-second clip from the midpoint of the source on hover; first-time generation uses your platform's best hardware encoder (NVENC → QSV → AMF → MediaFoundation on Windows, VideoToolbox on macOS, NVENC/QSV/VAAPI on Linux), with hardware decode acceleration too
- **Image formats supported** — JPEG, PNG, GIF, WebP, AVIF, SVG, BMP, ICO, TIFF, plus **HEIC/HEIF** (decoded via heic-convert WebAssembly when sharp lacks the HEVC plugin) and **RAW** formats (DNG / CR2 / CR3 / NEF / ARW / RAF / ORF / RW2)
- **Animated GIFs** — preserved through the thumbnail pipeline as animated WebP
- **iPhone Live Photos** — when a `.HEIC` is found alongside a same-basename `.MOV`, the gallery loops the live video and the preview plays it once before settling on the still image, with a "LIVE" badge
- **Video preview** — universal playback through `/transcode`: an on-the-fly remuxer that copies H.264 streams untouched and re-encodes incompatible audio (EAC3, AC3, DTS) to AAC. Output is a `+faststart` MP4 cached on disk (LRU-capped at 20 GB) with full HTTP Range support for instant seeking. Direct serving for already-compatible MP4/WebM/M4V; transparent fallback if the browser rejects the source.
- **Built-in preview also handles** — PDFs (pdf.js), Markdown (rich render with mermaid diagrams), syntax-highlighted code, sandboxed HTML (`<iframe srcdoc sandbox>`), CSV (table view), and a side-by-side **diff viewer** (with synthesized diffs for untracked and deleted files)
- **Large-file gating** — files larger than 5 MB return a download/open-in-tab landing page instead of buffering; files between 256 KB and 5 MB show the first 256 KB with a "showing first N KB" banner
- **Mobile swipe carousel** — drag horizontally between adjacent images/videos with rubber-band resistance at the ends; drag down to dismiss; pinch-to-zoom on images; `loadedmetadata` and `canplay` events handled correctly so the loading spinner never gets stuck
- **iOS Safari hardened** — `playsinline` so videos don't trigger the full-screen takeover (and pause-then-exit no longer breaks the player); `overscroll-behavior: none` everywhere to kill rubber-band; safe-area-inset support for notches, dynamic islands, and curved edges

### Tabs, panes, navigation
- **Tabs** — multiple folders open at once. Middle-click / Ctrl+click / triple-tap (mobile) any folder to open it in a new tab. Works in the file list, tree, Favourites, and Bookmarks.
- **Split panes** — open a folder side-by-side with another
- **Tree** — collapsible directory tree on the left, persists expanded state
- **Smart back button** — when navigation history is exhausted, the Back button climbs to the parent directory automatically (only disabled at a true filesystem root)
- **Browser back/forward integration** — actually drives in-app navigation via `pushState` + `popstate`

### Sidebars
- **Favourites** — flat list of the top-10 most-accessed folders, ordered by visit count. Tap an entry to navigate; if an entry is a file (e.g. a single file you keep returning to), it opens the parent folder and the file in preview. Auto-prunes paths that no longer exist on every panel render.
- **Bookmarks** — pin folder paths, file paths, or URLs. File bookmarks open the parent folder + preview; URL bookmarks render in an iframe with an "open in new tab" fallback for sites that block embedding. Server prunes broken filesystem bookmarks on every list call.
- **Git panel** — VS Code-style status, stage/unstage, commit, branch switch, diff view. When the current folder isn't a repo, two explicit buttons offer **Clone repo here** (`git clone <url> .`) or **Init & link** (`git init` + `git remote add origin <url>`). When you're inside a repo, the panel also has a collapsible **Add submodule** section (`git submodule add`). If submodules already exist, a dropdown at the top of the panel lets you swap the entire panel between the main repo and any submodule — stage/commit/diff/log all operate against the selected repo.

### Search
- Fuzzy filename search and full-text content search across watched folders
- Mobile-friendly full-screen panel
- Spinner while results are loading

### Terminal
- Full PTY via `node-pty`, with a Python PTY bridge fallback for macOS
- Sessions are shared across all connected devices — start a shell on your desktop, see and interact with it on your phone
- Theme follows the active app theme (light/dark + chosen palette) and updates live without reattaching the PTY
- Mobile keeps it full-screen with a smaller font for better column count

### Themes (12 themes × 2 modes = 24 palettes)
- **Vault** — default deep navy + violet
- **Dracula** — dark purple palette + light companion
- **Solarized** — dark + light
- **Retro Arcade** — neon pink + cyan on near-black / cream
- **Vice City** — Miami sunset / vaporwave
- **Earthy** — warm browns and terracotta
- **Forest** — deep greens + gold
- **Pastel** — soft pinks, lavenders, mint
- **Hacker** — Matrix green on pitch black / dark-green on paper
- **Clean** — minimal grayscale
- **High Contrast** — AAA accessibility (pure black/white + bold accents)
- **Ocean** — deep blue + cyan / sky blue + amber
- Each theme reserves saturated colour for the chrome (toolbar, sidebars, dialogs) and a neutral background for the file-listing area, so themes feel distinctive without making content hard to read
- **Theme picker** (🎨 button) opens a popover with all themes and their dark/light variants; light/dark toggle is inside the popover (and on the toolbar on desktop)
- **highlight.js theme switches with light/dark mode** — code blocks read cleanly in either mode
- **Custom themes** — full colour-picker theme builder under the ⚙ button

### File operations
- Drag-drop upload, multi-select, inline rename (optimistic)
- Copy / cut / paste with server-side staging buffer
- Zip + unzip
- Open in default app (Windows `start`, macOS `open`, Linux `xdg-open`)
- Properties dialog with three tabs:
  - **General** — name, path, size (recursive for folders, bounded walk so huge trees don't hang)
  - **Sharing** — create time-limited token share links (expiry + optional max-use). Folders are zipped on the fly when shared via the public `/share/:token` route.
  - **Security** — OS-level info (owner, octal/rwx on Unix; read-only attribute on Windows)

### Identity & sync
- **OTP device enrollment** — first-time setup generates a one-time code; each device gets a long-lived token
- **Cross-device workspace state** — open tabs, view mode, active terminal, and panel selection sync in real time across every connected device

### Live system stats
- CPU, memory, disk I/O, network throughput chips in the status bar
- Mobile: compact value-only chips with the chip label collapsed; heat-coloured values that auto-darken on light themes for legibility

---

## Quick Start

### One-command install (Mac / Linux)

```bash
git clone https://github.com/Jasonvdmeijden/DarkExplorer.git
cd DarkExplorer
bash scripts/setup.sh
```

### One-command install (Windows)

```cmd
git clone https://github.com/Jasonvdmeijden/DarkExplorer.git
cd DarkExplorer
scripts\setup.bat
```

What the setup does:
1. Installs Node.js if missing (`brew` / `apt` / `dnf` / `pacman` / `winget`)
2. Installs ffmpeg if missing (required for video thumbnails / transcoding)
3. Runs `npm install` (compiles native modules for your platform)
4. Generates a first-device enrollment OTP and prints it
5. Registers an autostart entry so DarkExplorer launches on every boot:
   - **Windows** — Scheduled Task at logon
   - **macOS** — launchd user agent
   - **Linux** — systemd user service (`loginctl enable-linger` so it runs without a logged-in session)
6. Starts the server immediately at <http://localhost:3322>

Open the URL in your browser, enter the OTP, and you're in.

---

## Manual setup

If you'd rather not use the setup scripts:

```bash
npm install                              # install deps
node server/index.js --gen-otp           # print an enrollment OTP
node server/index.js                     # start on port 3322
```

Then browse to `http://localhost:3322` and enter the OTP.

### Requirements

| Component | Purpose | Optional? |
|---|---|---|
| Node.js 20+ | Server runtime | required |
| ffmpeg | Video thumbnails + video transcoding | optional (graceful degradation — direct serve only, no MKV/AVI playback) |
| git | The git panel | optional (panel just won't show) |

---

## Configuration

`config.json` lives at the repo root and is merged into the defaults in `server/config.js`:

```json
{
  "port": 3322,
  "origins": ["http://localhost:3322"],
  "shell": { "windows": "cmd", "mac": "zsh", "linux": "bash" },
  "search": {
    "maxFileSizeBytes": 524288,
    "exclusions": ["node_modules", ".git", "dist", "build", "*.min.js"]
  }
}
```

- **`origins`** — CORS allow-list. Add any hostname/port you'll access the server from.
- **`shell`** — Default terminal shell per platform. Switch with the ⚡ button in the terminal toolbar.
- **`search.exclusions`** — Glob patterns excluded from filename + content indexing.

Theme choice is per-device, persisted in `localStorage` as `de_theme` + `de_mode`.

Changes to `config.json` require a server restart.

---

## Architecture

```
┌──────────────────┐  WebSocket  ┌────────────────┐  fs/net  ┌──────────────┐
│  Browser (any    │ ◀────────▶  │  Node server   │ ◀──────▶ │  Your disk   │
│  device on LAN)  │   Express   │  (port 3322)   │  child   │  + git + pty │
└──────────────────┘             └────────────────┘  procs   └──────────────┘
```

| Layer | Tech |
|---|---|
| HTTP / static | Express |
| Realtime | `ws` WebSocket — every FS op is a typed message |
| Database | `better-sqlite3` (workspace state, devices, OTPs, file index, bookmarks, tags, shares) |
| File watching | `chokidar` |
| Terminal | `node-pty` (server) + `xterm.js` (client, bundled locally under `public/vendor`) |
| Image thumbnails | `sharp` (libvips + libheif), `heic-convert` (WASM HEVC) fallback for HEIC/HEIF |
| Video thumbnails / transcoding | `ffmpeg` via `fluent-ffmpeg` with GPU encoder auto-detection (NVENC / QSV / AMF / VideoToolbox / VAAPI) |
| Code thumbnails | `canvas` (node-canvas) |
| Preview rendering | `pdf.js`, `highlight.js` (dark + light pair, swapped on theme change), `marked`, `mermaid` (CDN, optional) |

### Layout

```
DarkExplorer/
├── server/
│   ├── index.js           Express + WS router, /serve, /transcode, /share/:token
│   ├── auth.js            OTP + device tokens
│   ├── db.js              SQLite schema + migrations
│   ├── files.js           list / read / write / copy / move / folderSize / Live Photo detection
│   ├── search.js          chokidar watcher + sqlite index
│   ├── indexer.js         background filesystem crawler
│   ├── terminal.js        node-pty (Win/Linux) + Python-PTY bridge (macOS)
│   ├── thumbnails.js      image / video-clip / code thumbnails, HEIC/RAW pipeline, GPU encoder probe
│   ├── git.js             git CLI wrapper (status, diff, stage, commit, clone, init+link, submodule add, list submodules)
│   ├── stats.js           CPU/mem/disk/net stats (Win WMIC / Linux /proc / Mac iostat+netstat)
│   ├── shares.js          public token-gated share links
│   ├── security.js        OS-level permissions surface
│   ├── upload.js          multer
│   └── zip.js             zip / unzip via adm-zip
├── public/
│   ├── index.html         App shell
│   ├── enroll.html        First-time OTP enrollment
│   ├── css/
│   │   ├── app.css        Layout + tokens
│   │   └── themes/        24 palette files (12 themes × dark/light)
│   ├── js/                ~17 modules — explorer, preview, terminal, git, search, tabs, panels, theme, favourites, bookmarks, stats, …
│   └── vendor/            xterm.js + addon-fit (bundled locally, no CDN required)
├── scripts/
│   ├── setup.{sh,bat}     One-command installer per OS
│   ├── start.{sh,bat}     Bare launcher used by autostart entries
│   └── gen-themes.js      Theme palette generator (re-emits the 20 generated *.css files)
├── config.json            Runtime config
└── data/                  SQLite DB + thumb cache + transcode cache (gitignored)
```

### Security model

- **Token auth on every WebSocket frame and HTTP request** — no token, no access.
- **OTP enrollment** — codes are single-use, expire in 1 hour, generated only via CLI or admin endpoint.
- **No anonymous endpoints** except `/share/:token` (token-gated, expiry + max-use enforced server-side).
- **HTML preview is sandboxed** via `<iframe srcdoc sandbox>`.
- **CORS allowlist** in `config.json` — only listed origins can connect.

Designed to be exposed over Tailscale / VPN / reverse proxy — not the open internet. Pair with HTTPS and an IP allow-list at your reverse proxy.

---

## Cross-platform support

| Platform | Status | Notes |
|---|---|---|
| Windows 10/11 | ✅ Primary dev platform | Stats via WMIC, shell defaults to `cmd`, ffmpeg uses NVENC / QSV / AMF / MediaFoundation in that priority |
| macOS 12+ | ✅ | Stats via `iostat`/`netstat`, shell defaults to `zsh`, ffmpeg uses `h264_videotoolbox` |
| Linux (Debian/Fedora/Arch) | ✅ | Stats via `/proc`, shell defaults to `bash`, ffmpeg uses NVENC → QSV → VAAPI → libx264, systemd user service for autostart |

Native modules (`better-sqlite3`, `sharp`, `node-pty`, `canvas`, `heic-convert`) are compiled per platform — always run `npm install` on the target machine, never copy `node_modules` across OSes.

---

## CLI

```bash
node server/index.js                  # run the server
node server/index.js --gen-otp        # print a one-hour enrollment code
node scripts/gen-themes.js            # regenerate theme CSS files from the palette source
```

---

## Updating

```bash
git pull
npm install            # picks up any new deps
# On Windows: re-run scripts\setup.bat to refresh autostart
# On Mac/Linux: launchd/systemd will pick up changes on next restart
```

---

## Uninstalling

**Windows:**
```cmd
schtasks /delete /tn "DarkExplorer" /f
```

**macOS:**
```bash
launchctl unload ~/Library/LaunchAgents/co.somevault.darkexplorer.plist
rm ~/Library/LaunchAgents/co.somevault.darkexplorer.plist
```

**Linux:**
```bash
systemctl --user disable --now darkexplorer
rm ~/.config/systemd/user/darkexplorer.service
```

Then delete the repo directory.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Video thumbnails are missing or all icons | Install ffmpeg (`brew install ffmpeg` / `apt install ffmpeg` / `winget install Gyan.FFmpeg`) and restart |
| MKV/AVI plays without sound | Browser doesn't support the embedded audio codec (EAC3, AC3, DTS, TrueHD). Refresh — the `/transcode` fallback re-encodes audio to AAC automatically. |
| HEIC photos don't show thumbnails | Sharp's bundled libheif may lack the HEVC decoder plugin on your platform — heic-convert (WebAssembly) handles those. Hard-refresh in case stale 204 negatives are cached. |
| `Error: AttachConsole failed` in logs | Harmless. node-pty's cleanup helper logs this on Windows; PTY sessions still work. |
| Terminal opens but is blank | Hard-refresh the browser (Ctrl+F5). `public/vendor/xterm.js` may be cached from before it existed. |
| Page is unreachable after running for a while on a huge drive | Folder-size walks are bounded (2 s deadline, 50 k entries, 2 concurrent) — should not happen with the current code. If it does, file a bug with the path you navigated to. |
| Stats chips stay at `—` on Mac/Linux | Make sure `iostat` / `netstat` exist (they ship by default). Run them manually to confirm. |
| First load of a big photo folder feels slow | HEIC decoding via WebAssembly is CPU-bound. Concurrency is capped at `cores/2` so the event loop stays responsive. Thumbnails are cached after the first view — second visit is instant. |
| Want to use a different port | Set `"port"` in `config.json` and restart. Don't forget to add the new origin to `"origins"`. |

---

## Contributing

Issues and PRs welcome. Keep changes small and focused — KISS over clever, vanilla JS only on the frontend (no build step), well-known patterns over invented abstractions. See `CLAUDE.md` for the design guidelines.

---

## License

MIT — see [LICENSE](LICENSE) if present, otherwise treat as MIT.

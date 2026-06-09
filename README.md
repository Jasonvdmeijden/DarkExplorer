# DarkExplorer

A web-based file explorer that runs on your machine and serves your filesystem to any device — desktop or mobile — over the network. Built on Node.js with a vanilla JS frontend, no build step, all real-time over WebSocket.

> Browse, preview, search, edit, and run a terminal in your files from any browser on any device.

---

## Features

- **Three views** — Details (sortable columns), List (compact), Gallery (image/video tiles with 5-second video preview clips)
- **Built-in preview** — images, videos, PDFs, markdown (rich render), syntax-highlighted code, HTML (sandboxed iframe), diff viewer
- **Integrated terminal** — full PTY via `node-pty`, shared across devices, drop into any folder
- **Git panel** — VS Code-style status, stage/unstage, commit, branch switch, diff view (including new-file and deleted-file diffs)
- **Search** — fuzzy filename search and content search across watched folders
- **Tabs + split panes + tree** — multiple folders open at once
- **Bookmarks** — pin filesystem paths or web URLs (URL bookmarks render in an iframe with a fallback "open in new tab" banner for sites that block embedding)
- **Live system stats** — CPU, memory, disk I/O, network throughput in the status bar
- **OTP device enrollment** — first-time setup generates a one-time code; each device gets a long-lived token
- **Cross-device sync** — workspace state (open tabs, view mode, active terminal) syncs across all connected devices in real time
- **Mobile-friendly** — full-screen modals for preview/properties/terminal/search; double-tap context menu; resized terminal font
- **Theming** — built-in dark/light themes plus a colour-picker theme builder
- **Drag-drop upload, multi-select, inline rename, keyboard shortcuts**

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
2. Installs ffmpeg if missing (required for video thumbnails)
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
| ffmpeg | Video thumbnails | optional (graceful degradation) |
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
  },
  "theme": "dark"
}
```

- **`origins`** — CORS allow-list. Add any hostname/port you'll access the server from.
- **`shell`** — Default terminal shell per platform. Switch with the ⚡ button in the terminal toolbar.
- **`search.exclusions`** — Glob patterns excluded from filename + content indexing.

Changes require a restart.

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
| Database | `better-sqlite3` (workspace state, devices, OTPs, file index, bookmarks) |
| File watching | `chokidar` |
| Terminal | `node-pty` (server) + `xterm.js` (client, bundled locally under `public/vendor`) |
| Thumbnails | `sharp` (images), `ffmpeg` via `fluent-ffmpeg` (video clips), `canvas` (code) |
| Preview rendering | `pdf.js`, `highlight.js`, `marked`, `mermaid` (CDN, optional) |

### Layout

```
DarkExplorer/
├── server/
│   ├── index.js           Express + WS router
│   ├── auth.js            OTP + device tokens
│   ├── db.js              SQLite schema + migrations
│   ├── files.js           list / read / write / copy / move / folderSize
│   ├── search.js          chokidar watcher + sqlite index
│   ├── indexer.js         background filesystem crawler
│   ├── terminal.js        node-pty sessions + runner fallback
│   ├── thumbnails.js      image / video-clip / code thumbnails
│   ├── git.js             git CLI wrapper (status, diff, stage, commit…)
│   ├── stats.js           CPU/mem/disk/net stats (Win WMIC / Linux /proc / Mac iostat+netstat)
│   ├── upload.js          multer
│   └── zip.js             zip / unzip via adm-zip
├── public/
│   ├── index.html         App shell
│   ├── enroll.html        First-time OTP enrollment
│   ├── css/               Theme palettes + layout
│   ├── js/                ~15 modules — explorer, preview, terminal, git, search, tabs, panels, …
│   └── vendor/            xterm.js + addon-fit (bundled locally, no CDN required)
├── scripts/               setup + start scripts per OS
├── config.json            Runtime config
└── data/                  SQLite DB + thumb cache (gitignored)
```

### Security

- **Token auth on every WebSocket frame and HTTP request** — no token, no access.
- **OTP enrollment** — codes are single-use, expire in 1 hour, generated only via CLI or admin endpoint.
- **No anonymous endpoints** — even `/` redirects to `/enroll` for unauthenticated clients.
- **HTML preview is sandboxed** via `<iframe srcdoc sandbox>`.
- **CORS allowlist** in `config.json` — only listed origins can connect.

This is designed to be exposed over Tailscale / VPN / reverse proxy — not the open internet. Pair with HTTPS and an IP allow-list at your reverse proxy.

---

## Cross-platform support

| Platform | Status | Notes |
|---|---|---|
| Windows 10/11 | ✅ Primary dev platform | Stats via WMIC, shell defaults to `cmd` |
| macOS 12+ | ✅ | Stats via `iostat`/`netstat`, shell defaults to `zsh`, ffmpeg uses `h264_videotoolbox` hardware encoder |
| Linux (Debian/Fedora/Arch) | ✅ | Stats via `/proc`, shell defaults to `bash`, systemd user service for autostart |

Native modules (`better-sqlite3`, `sharp`, `node-pty`, `canvas`) are compiled per platform — always run `npm install` on the target machine, never copy `node_modules` across OSes.

---

## CLI

```bash
node server/index.js                  # run the server
node server/index.js --gen-otp        # print a one-hour enrollment code
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
| `Error: AttachConsole failed` in logs | Harmless. node-pty's cleanup helper logs this on Windows; PTY sessions still work. |
| Terminal opens but is blank | Hard-refresh the browser (Ctrl+F5). `public/vendor/xterm.js` may be cached from before it existed. |
| Page is unreachable after running for a while on a huge drive | Folder-size walks are bounded (2s deadline, 50k entries, 2 concurrent) — should not happen with the current code. If it does, file a bug with the path you navigated to. |
| Stats chips stay at `—` on Mac/Linux | Make sure `iostat` / `netstat` exist (they ship by default). Run them manually to confirm. |
| Want to use a different port | Set `"port"` in `config.json` and restart. Don't forget to add the new origin to `"origins"`. |

---

## Contributing

Issues and PRs welcome. Keep changes small and focused — KISS over clever, vanilla JS only on the frontend (no build step), well-known patterns over invented abstractions. See `CLAUDE.md` for the design guidelines.

---

## License

MIT — see [LICENSE](LICENSE) if present, otherwise treat as MIT.

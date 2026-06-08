#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
START_SH="$SCRIPT_DIR/start.sh"
chmod +x "$START_SH"

# Dependency checks
command -v node  >/dev/null 2>&1 || echo "[WARN] node.js not found. Install from https://nodejs.org"
command -v ffmpeg >/dev/null 2>&1 || echo "[WARN] ffmpeg not found. Video thumbnails disabled. Install: apt install ffmpeg / brew install ffmpeg"

OS="$(uname -s)"

# ---- macOS: launchd ----
if [ "$OS" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/co.somevault.darkexplorer.plist"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>co.somevault.darkexplorer</string>
  <key>ProgramArguments</key> <array><string>$START_SH</string></array>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <false/>
  <key>StandardOutPath</key>   <string>$HOME/.darkexplorer.log</string>
  <key>StandardErrorPath</key> <string>$HOME/.darkexplorer.log</string>
</dict>
</plist>
PLIST
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load -w "$PLIST"
  echo "[OK] DarkExplorer registered as launchd agent. Starts on next login."

# ---- Linux: systemd user service ----
elif [ "$OS" = "Linux" ]; then
  SERVICE_DIR="$HOME/.config/systemd/user"
  mkdir -p "$SERVICE_DIR"
  cat > "$SERVICE_DIR/darkexplorer.service" <<SERVICE
[Unit]
Description=DarkExplorer file server

[Service]
ExecStart=$START_SH
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SERVICE
  systemctl --user daemon-reload
  systemctl --user enable darkexplorer
  systemctl --user start darkexplorer
  echo "[OK] DarkExplorer systemd user service enabled and started."

else
  echo "[WARN] Unsupported OS ($OS). Run start.sh manually."
fi

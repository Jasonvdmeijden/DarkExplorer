#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
START_SH="$SCRIPT_DIR/start.sh"

echo
echo "=== DarkExplorer Setup ==="
echo

OS="$(uname -s)"
chmod +x "$START_SH"

# ───── Step 1: Node.js ─────
if ! command -v node >/dev/null 2>&1; then
  echo "[INFO] Node.js not found. Installing..."
  if [ "$OS" = "Darwin" ]; then
    if ! command -v brew >/dev/null 2>&1; then
      echo "[ERROR] Homebrew not installed. Install from https://brew.sh then re-run."; exit 1
    fi
    brew install node
  elif [ "$OS" = "Linux" ]; then
    if   command -v apt-get >/dev/null 2>&1; then
      curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y nodejs npm
    elif command -v pacman >/dev/null 2>&1; then sudo pacman -S --noconfirm nodejs npm
    else echo "[ERROR] Unknown package manager. Install Node.js manually then re-run."; exit 1
    fi
  fi
fi
echo "[OK] Node.js $(node --version)"

# ───── Step 2: ffmpeg ─────
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[INFO] ffmpeg not found. Installing..."
  if [ "$OS" = "Darwin" ]; then brew install ffmpeg
  elif [ "$OS" = "Linux" ]; then
    if   command -v apt-get >/dev/null 2>&1; then sudo apt-get install -y ffmpeg
    elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y ffmpeg
    elif command -v pacman >/dev/null 2>&1; then sudo pacman -S --noconfirm ffmpeg
    else echo "[WARN] Install ffmpeg manually; video thumbnails will be disabled."
    fi
  fi
fi
command -v ffmpeg >/dev/null 2>&1 && echo "[OK] ffmpeg present." || echo "[WARN] ffmpeg missing — video thumbnails disabled."

# ───── Step 3: npm install ─────
echo
echo "[INFO] Installing npm dependencies..."
cd "$REPO_DIR"
npm install
echo "[OK] Dependencies installed."

# ───── Step 4: Generate first OTP ─────
echo
echo "[INFO] Generating enrollment OTP..."
OTP="$(node server/index.js --gen-otp 2>/dev/null | grep -oE 'OTP: [A-Z0-9]+' | awk '{print $2}' || true)"
if [ -n "$OTP" ]; then
  echo "[OK] First-device enrollment OTP: $OTP"
  echo "     Browse to http://localhost:3322 and enter this code to enroll."
else
  echo "[INFO] Generate an OTP later with:  node server/index.js --gen-otp"
fi

# ───── Step 5: Register autostart ─────
if [ "$OS" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/co.somevault.darkexplorer.plist"
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>co.somevault.darkexplorer</string>
  <key>ProgramArguments</key>  <array><string>$START_SH</string></array>
  <key>WorkingDirectory</key>  <string>$REPO_DIR</string>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardOutPath</key>   <string>$HOME/.darkexplorer.log</string>
  <key>StandardErrorPath</key> <string>$HOME/.darkexplorer.log</string>
</dict>
</plist>
PLIST
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load -w "$PLIST"
  echo "[OK] Registered as launchd agent. Starts on every login."

elif [ "$OS" = "Linux" ]; then
  SERVICE_DIR="$HOME/.config/systemd/user"
  mkdir -p "$SERVICE_DIR"
  cat > "$SERVICE_DIR/darkexplorer.service" <<SERVICE
[Unit]
Description=DarkExplorer file server
After=network.target

[Service]
ExecStart=$START_SH
WorkingDirectory=$REPO_DIR
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SERVICE
  systemctl --user daemon-reload
  systemctl --user enable darkexplorer
  systemctl --user restart darkexplorer
  # linger lets the service run even when no user is logged in
  loginctl enable-linger "$USER" 2>/dev/null || true
  echo "[OK] Registered as systemd user service. Started now and on boot."

else
  echo "[WARN] Unsupported OS ($OS). Run start.sh manually."
fi

echo
echo "=== Setup complete ==="
echo "    Open http://localhost:3322 in your browser."
echo

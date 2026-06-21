#!/bin/bash

echo "==========================================================="
echo "  DarkExplorer - Stream View WebRTC Proxy Installer"
echo "==========================================================="
echo "This script will install all dependencies required for the"
echo "ultra-low latency WebRTC streaming and Gamepad support."
echo ""

# 1. Install Rust (required to compile moonlight-web-stream)
if ! command -v cargo &> /dev/null; then
    echo "Installing Rust toolchain..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
else
    echo "Rust is already installed."
fi

if ! command -v cmake &> /dev/null; then
    echo "Installing CMake..."
    brew install cmake
fi

# 2. Install Sunshine natively on macOS or Windows
if [[ "$OSTYPE" == "darwin"* ]]; then
    if [ ! -d "/Applications/Sunshine.app" ]; then
        echo "Installing Sunshine for macOS..."
        curl -L -o /tmp/sunshine.dmg https://github.com/LizardByte/Sunshine/releases/latest/download/Sunshine-macOS-arm64.dmg
        hdiutil attach /tmp/sunshine.dmg -mountpoint /Volumes/Sunshine -nobrowse -noverify -noautoopen
        cp -R /Volumes/Sunshine/Sunshine.app /Applications/
        hdiutil detach /Volumes/Sunshine
        rm /tmp/sunshine.dmg
        echo "Sunshine installed to /Applications/Sunshine.app."
        echo "Please launch it to grant macOS Screen Recording/Accessibility permissions!"
    else
        echo "Sunshine is already installed in /Applications."
    fi
else
    echo "Please ensure Sunshine is installed on your Windows host: https://github.com/LizardByte/Sunshine/releases"
fi

# 3. Clone and Build Moonlight Web Stream proxy
PROXY_DIR="$HOME/moonlight-web-stream"
if [ ! -d "$PROXY_DIR" ]; then
    echo "Cloning moonlight-web-stream..."
    git clone https://github.com/MrCreativ3001/moonlight-web-stream.git "$PROXY_DIR"
fi

echo "Building the WebRTC proxy..."
cd "$PROXY_DIR"
npm install
source "$HOME/.cargo/env"
npm run build

echo "==========================================================="
echo "Installation complete!"
echo "To start the proxy, navigate to $PROXY_DIR and run:"
echo "npm start"
echo "==========================================================="

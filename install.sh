#!/usr/bin/env bash
set -e

REPO="https://github.com/tianhaoz95/meowtrix"
INSTALL_DIR="$HOME/.meowtrix/app"
SERVICE=false

# Parse flags
BINARY=false
SOURCE=false
for arg in "$@"; do
  case $arg in
    --service) SERVICE=true ;;
    --binary) BINARY=true ;;
    --source) SOURCE=true ;;
  esac
done

echo "🐾 Installing Meowtrix..."

# Detect OS and Arch
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
  ARCH="x64"
elif [ "$ARCH" = "aarch64" ]; then
  ARCH="arm64"
fi

# Check if we should use pre-packaged binary installation
USE_BINARY=true
if [ "$SOURCE" = true ]; then
  USE_BINARY=false
fi

if [ "$USE_BINARY" = true ]; then
  if [ "$OS" != "darwin" ] && [ "$OS" != "linux" ]; then
    if [ "$SOURCE" = false ]; then
      echo "⚠ Binary installation is only supported on macOS (Darwin) and Linux. Falling back to source installation..."
      USE_BINARY=false
    else
      echo "Error: Binary installation is only supported on macOS (Darwin) and Linux." >&2
      exit 1
    fi
  fi
fi

if [ "$USE_BINARY" = true ]; then
  echo "→ Performing zero-dependency binary installation..."

  # GitHub Releases latest release tarball URL
  RELEASE_URL="https://github.com/tianhaoz95/meowtrix/releases/latest/download/meowtrix-${OS}-${ARCH}.tar.gz"

  echo "→ Downloading latest Meowtrix release ($OS-$ARCH)..."
  mkdir -p "$HOME/.meowtrix"
  TEMP_TARBALL="$HOME/.meowtrix/meowtrix-release.tar.gz"

  if command -v curl &>/dev/null; then
    curl -LfsS "$RELEASE_URL" -o "$TEMP_TARBALL"
  elif command -v wget &>/dev/null; then
    wget -qO "$TEMP_TARBALL" "$RELEASE_URL"
  else
    echo "Error: 'curl' or 'wget' is required to download the release binary." >&2
    exit 1
  fi

  echo "→ Extracting package..."
  # Clean up existing non-git app folder to avoid dirty/mixed files
  if [ -d "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
    rm -rf "$INSTALL_DIR"
  fi

  mkdir -p "$INSTALL_DIR"
  tar -zxf "$TEMP_TARBALL" -C "$INSTALL_DIR" --strip-components=1
  rm "$TEMP_TARBALL"

  # Create launcher script pointing to bundled launcher
  LAUNCHER="$HOME/.local/bin/meowtrix"
  mkdir -p "$(dirname "$LAUNCHER")"
  cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
"$INSTALL_DIR/meowtrix" "\$@"
EOF
  chmod +x "$LAUNCHER"

else
  # Clone or update
  if [ -d "$INSTALL_DIR/.git" ]; then
    echo "→ Updating existing installation from source..."
    git -C "$INSTALL_DIR" pull --ff-only
  else
    echo "→ Cloning repository from source..."
    git clone "$REPO" "$INSTALL_DIR"
  fi

  # Install dependencies
  echo "→ Installing dependencies..."
  npm install --prefix "$INSTALL_DIR" --omit=dev --silent

  # Create launcher script
  LAUNCHER="$HOME/.local/bin/meowtrix"
  mkdir -p "$(dirname "$LAUNCHER")"
  cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
cd "$INSTALL_DIR" && node server.js "\$@"
EOF
  chmod +x "$LAUNCHER"
fi

# ── Service setup ────────────────────────────────────────────────────────────
if [ "$SERVICE" = true ]; then
  OS="$(uname -s)"

  # Determine Node binary location
  if [ -f "$INSTALL_DIR/bin/node" ]; then
    NODE_BIN="$INSTALL_DIR/bin/node"
  else
    NODE_BIN="$(command -v node)"
  fi

  if [ -z "$NODE_BIN" ]; then
    echo "Error: Could not locate Node.js binary." >&2
    exit 1
  fi

  if [ "$OS" = "Darwin" ]; then
    # macOS — launchd plist
    PLIST="$HOME/Library/LaunchAgents/com.meowtrix.plist"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>com.meowtrix</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$INSTALL_DIR/server.js</string>
  </array>
  <key>WorkingDirectory</key>  <string>$INSTALL_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MEOWTRIX_SUPERVISED</key> <string>1</string>
    <key>HOST</key> <string>0.0.0.0</string>
  </dict>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardOutPath</key>   <string>$HOME/.meowtrix/meowtrix.log</string>
  <key>StandardErrorPath</key> <string>$HOME/.meowtrix/meowtrix.log</string>
</dict>
</plist>
EOF
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    echo "✅ Meowtrix service installed via launchd (auto-starts on login)."
    echo "   Logs: ~/.meowtrix/meowtrix.log"
    echo "   Stop:  launchctl unload $PLIST"
    echo "   Start: launchctl load $PLIST"

  elif [ "$OS" = "Linux" ]; then
    # Linux — systemd user service
    SERVICE_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SERVICE_DIR"
    cat > "$SERVICE_DIR/meowtrix.service" <<EOF
[Unit]
Description=Meowtrix remote vibe engineering tool
After=network.target

[Service]
ExecStart=$NODE_BIN $INSTALL_DIR/server.js
WorkingDirectory=$INSTALL_DIR
Environment=MEOWTRIX_SUPERVISED=1
Environment=HOST=0.0.0.0
Restart=always
StandardOutput=append:$HOME/.meowtrix/meowtrix.log
StandardError=append:$HOME/.meowtrix/meowtrix.log

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable meowtrix
    systemctl --user start meowtrix
    echo "✅ Meowtrix service installed via systemd (auto-starts on login)."
    echo "   Logs:   journalctl --user -u meowtrix -f"
    echo "   Stop:   systemctl --user stop meowtrix"
    echo "   Start:  systemctl --user start meowtrix"
    echo "   Remove: systemctl --user disable meowtrix"

  else
    echo "⚠  --service is only supported on macOS and Linux." >&2
    exit 1
  fi

else
  # Add to PATH hint if needed
  if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
    echo ""
    echo "⚠  Add ~/.local/bin to your PATH to use the 'meowtrix' command:"
    echo "   echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
  fi

  echo ""
  echo "✅ Meowtrix installed! Run it with:"
  echo ""
  echo "   meowtrix"
  echo ""
  echo "Then open http://localhost:9123 in your browser."
  echo ""
  echo "Tip: to install as an auto-starting service, re-run with --service:"
  echo "   curl -fsSL https://raw.githubusercontent.com/tianhaoz95/meowtrix/main/install.sh | bash -s -- --service"
  echo ""
  echo "Tip: to install from source instead of binary, re-run with --source:"
  echo "   curl -fsSL https://raw.githubusercontent.com/tianhaoz95/meowtrix/main/install.sh | bash -s -- --source"
fi

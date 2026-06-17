#!/usr/bin/env bash
set -e

REPO="https://github.com/tianhaoz95/meowtrix"
INSTALL_DIR="$HOME/.meowtrix/app"
SERVICE=false

# Parse flags
for arg in "$@"; do
  case $arg in
    --service) SERVICE=true ;;
  esac
done

echo "🐾 Installing Meowtrix..."

# Check dependencies
for cmd in git node npm; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: '$cmd' is required but not found. Please install it and try again." >&2
    exit 1
  fi
done

# Clone or update
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "→ Updating existing installation..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "→ Cloning repository..."
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

# ── Service setup ────────────────────────────────────────────────────────────
if [ "$SERVICE" = true ]; then
  OS="$(uname -s)"

  if [ "$OS" = "Darwin" ]; then
    # macOS — launchd plist
    PLIST="$HOME/Library/LaunchAgents/com.meowtrix.plist"
    NODE_BIN="$(command -v node)"
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
    NODE_BIN="$(command -v node)"
    cat > "$SERVICE_DIR/meowtrix.service" <<EOF
[Unit]
Description=Meowtrix remote vibe engineering tool
After=network.target

[Service]
ExecStart=$NODE_BIN $INSTALL_DIR/server.js
WorkingDirectory=$INSTALL_DIR
Restart=on-failure
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
  echo "Then open http://localhost:3000 in your browser."
  echo ""
  echo "Tip: to install as an auto-starting service, re-run with --service:"
  echo "   curl -fsSL https://raw.githubusercontent.com/tianhaoz95/meowtrix/main/install.sh | bash -s -- --service"
fi

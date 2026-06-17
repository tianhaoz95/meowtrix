#!/usr/bin/env bash
set -e

REPO="https://github.com/tianhaoz95/meowtrix"
INSTALL_DIR="$HOME/.meowtrix/app"

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

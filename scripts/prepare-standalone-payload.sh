#!/usr/bin/env bash
# ==============================================================================
# Prepares the standalone-payload/ directory containing Node.js runtime,
# server.js, public assets, and production node_modules with native node-pty.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PAYLOAD_DIR="$ROOT/standalone-payload"

NODE_VERSION="${NODE_VERSION:-20.11.1}"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

if [ "$ARCH" = "x86_64" ]; then
  ARCH="x64"
elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  ARCH="arm64"
fi

echo "==> Preparing Meowtrix Standalone payload for $OS-$ARCH (Node v$NODE_VERSION)..."

rm -rf "$PAYLOAD_DIR"
mkdir -p "$PAYLOAD_DIR/bin"

# 1. Obtain Node.js binary
TEMP_DOWNLOAD="$(mktemp -d)"
trap 'rm -rf "$TEMP_DOWNLOAD"' EXIT

if [ -n "${MEOWTRIX_NODE_BIN:-}" ] && [ -f "$MEOWTRIX_NODE_BIN" ]; then
  echo "    Using provided MEOWTRIX_NODE_BIN: $MEOWTRIX_NODE_BIN"
  cp "$MEOWTRIX_NODE_BIN" "$PAYLOAD_DIR/bin/node"
else
  TARBALL_URL=""
  if [ "$OS" = "darwin" ]; then
    TARBALL_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-${ARCH}.tar.gz"
  elif [ "$OS" = "linux" ]; then
    TARBALL_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${ARCH}.tar.xz"
  else
    echo "!! Unsupported OS: $OS" >&2
    exit 1
  fi

  echo "    Downloading Node.js binary from $TARBALL_URL..."
  curl -fsSL "$TARBALL_URL" -o "$TEMP_DOWNLOAD/node.tar"

  mkdir -p "$TEMP_DOWNLOAD/extracted"
  if [[ "$TARBALL_URL" == *.tar.xz ]]; then
    tar -xf "$TEMP_DOWNLOAD/node.tar" -C "$TEMP_DOWNLOAD/extracted" --strip-components=1
  else
    tar -zxf "$TEMP_DOWNLOAD/node.tar" -C "$TEMP_DOWNLOAD/extracted" --strip-components=1
  fi
  cp "$TEMP_DOWNLOAD/extracted/bin/node" "$PAYLOAD_DIR/bin/node"
fi

chmod +x "$PAYLOAD_DIR/bin/node"

# 2. Copy source and helper files
echo "    Copying application files..."
cp "$ROOT/server.js" "$PAYLOAD_DIR/server.js"
cp "$ROOT/package.json" "$PAYLOAD_DIR/package.json"
cp -R "$ROOT/public" "$PAYLOAD_DIR/public"
mkdir -p "$PAYLOAD_DIR/bin"
cp "$ROOT/bin/mtx" "$PAYLOAD_DIR/bin/mtx"
chmod +x "$PAYLOAD_DIR/bin/mtx"

# 3. Install production dependencies using the target node binary
echo "    Installing production dependencies..."
(
  cd "$PAYLOAD_DIR"
  export PATH="$PAYLOAD_DIR/bin:$PATH"
  npm install --omit=dev --silent
)

echo "==> Standalone payload successfully assembled at: $PAYLOAD_DIR"

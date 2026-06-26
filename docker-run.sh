#!/usr/bin/env bash
# docker-run.sh — Runs Meowtrix inside a Docker container using a random untaken host port.
# Mounts the current directory to /workspace and persists settings in an isolated Docker volume.

set -e

# Help command
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  echo "Usage: ./docker-run.sh [workspace_dir]"
  echo "Runs Meowtrix in a Docker container with an isolated workspace and settings."
  echo ""
  echo "Arguments:"
  echo "  [workspace_dir]  The directory to mount as the container workspace (defaults to current directory)"
  exit 0
fi

# Determine workspace directory
WORKSPACE_DIR="${1:-$PWD}"
if [ ! -d "$WORKSPACE_DIR" ]; then
  echo "❌ Error: Workspace directory '$WORKSPACE_DIR' does not exist." >&2
  exit 1
fi
WORKSPACE_DIR=$(cd "$WORKSPACE_DIR" && pwd)

echo "🐾 Preparing to run Meowtrix in Docker..."

# Check dependencies
if ! command -v docker &>/dev/null; then
  echo "❌ Error: 'docker' command is required but not found. Please install Docker." >&2
  exit 1
fi

if ! docker info &>/dev/null; then
  echo "❌ Error: Docker daemon is not running. Please start Docker and try again." >&2
  exit 1
fi

# Build the Docker image
echo "→ Building Docker image 'meowtrix-dev'..."
docker build -t meowtrix-dev .

# Detect a random untaken port on the host if not specified
if [ -z "$PORT" ]; then
  echo "→ Searching for an available port..."
  if command -v node &>/dev/null; then
    PORT=$(node -e '
      const server = require("net").createServer();
      server.listen(0, () => {
        console.log(server.address().port);
        server.close();
      });
    ' 2>/dev/null)
  fi

  if [ -z "$PORT" ] && command -v python3 &>/dev/null; then
    PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("", 0)); print(s.getsockname()[1]); s.close()' 2>/dev/null)
  fi

  if [ -z "$PORT" ]; then
    # Fallback to random number in dynamic range
    PORT=$((1025 + RANDOM % 64511))
  fi
fi

echo "✅ Using port: $PORT"

# Best-effort detection of the host's LAN IP so other devices can connect
LAN_IP=""
if command -v node &>/dev/null; then
  LAN_IP=$(node -e '
    const os = require("os");
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === "IPv4" && !net.internal) { console.log(net.address); process.exit(0); }
      }
    }
  ' 2>/dev/null)
fi
if [ -z "$LAN_IP" ] && command -v ipconfig &>/dev/null; then
  LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
fi

URL="http://localhost:${PORT}"
echo "🐾 Starting Meowtrix container..."
echo "   URL:           $URL"
if [ -n "$LAN_IP" ]; then
  echo "   LAN URL:       http://${LAN_IP}:${PORT}   (open this on other devices)"
fi
echo "   Workspace:     $WORKSPACE_DIR"
echo "   Settings Vol:  meowtrix-dev-settings"
echo "   Ctrl-C to stop."
echo ""

# Determine application directory (where the script itself is located)
APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Determine if running in an interactive terminal
DOCKER_FLAGS="-i"
if [ -t 0 ]; then
  DOCKER_FLAGS="-it"
fi

# Run Docker container
# -p binds the random host port to container's 9123
# -v mounts application code directory to /app
# -v keeps container's node_modules (prevents overwriting by host node_modules)
# -v mounts workspace directory
# -v mounts named volume for settings persistence
# -e MEOWTRIX_WORKSPACE configures server.js to use that path for home/cwd
# -e HOTRELOAD=1 enables hot reload in server.js
# -e HOST=0.0.0.0 makes the in-container server bind to all interfaces so the
#   published port (and thus other devices on the LAN) can actually reach it;
#   binding to the container's loopback would be unreachable through -p.
exec docker run --rm $DOCKER_FLAGS \
  -p "$PORT:9123" \
  -v "$APP_DIR:/app" \
  -v "/app/node_modules" \
  -v "$WORKSPACE_DIR:/workspace" \
  -v "meowtrix-dev-settings:/root/.meowtrix" \
  -e MEOWTRIX_WORKSPACE=/workspace \
  -e HOTRELOAD=1 \
  -e HOST=0.0.0.0 \
  meowtrix-dev \
  bash start.sh


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

# Detect a random untaken port on the host
echo "→ Searching for an available port..."
PORT=""

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

echo "✅ Using port: $PORT"

URL="http://localhost:${PORT}"
echo "🐾 Starting Meowtrix container..."
echo "   URL:           $URL"
echo "   Workspace:     $WORKSPACE_DIR"
echo "   Settings Vol:  meowtrix-dev-settings"
echo "   Ctrl-C to stop."
echo ""

# Open browser shortly after container starts
(
  sleep 1.5
  if command -v open &>/dev/null; then
    open "$URL"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$URL"
  fi
) &

# Determine application directory (where the script itself is located)
APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Run Docker container
# -p binds the random host port to container's 9123
# -v mounts application code directory to /app
# -v keeps container's node_modules (prevents overwriting by host node_modules)
# -v mounts workspace directory
# -v mounts named volume for settings persistence
# -e MEOWTRIX_WORKSPACE configures server.js to use that path for home/cwd
# -e HOTRELOAD=1 enables hot reload in server.js
docker run --rm -it \
  -p "$PORT:9123" \
  -v "$APP_DIR:/app" \
  -v "/app/node_modules" \
  -v "$WORKSPACE_DIR:/workspace" \
  -v "meowtrix-dev-settings:/root/.meowtrix" \
  -e MEOWTRIX_WORKSPACE=/workspace \
  -e HOTRELOAD=1 \
  meowtrix-dev \
  bash start.sh


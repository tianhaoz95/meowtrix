#!/usr/bin/env bash
# serve.sh — Serves the Meowtrix Style Redesign Visualizer locally

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DIR/../../.." && pwd)"

echo "🚀 Starting Meowtrix Style Redesign Site..."

if command -v node >/dev/null 2>&1; then
  exec node "$DIR/server.js" "$@"
elif command -v python3 >/dev/null 2>&1; then
  PORT="${1:-8420}"
  echo "Node not found, falling back to python3 http.server on port $PORT..."
  cd "$DIR/../site"
  exec python3 -m http.server "$PORT"
else
  echo "Error: Neither Node.js nor Python3 is installed." >&2
  exit 1
fi

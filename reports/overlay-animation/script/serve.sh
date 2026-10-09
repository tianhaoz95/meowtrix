#!/usr/bin/env bash
# Serve the overlay call-out animation review site locally.
#   ./reports/overlay-animation/script/serve.sh            # http://127.0.0.1:8124
#   ./reports/overlay-animation/script/serve.sh --open     # ...and open it in the browser
#   ./reports/overlay-animation/script/serve.sh --port 9000
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v node >/dev/null 2>&1; then
  exec node "${SCRIPT_DIR}/serve.js" "$@"
elif command -v python3 >/dev/null 2>&1; then
  PORT="${PORT:-8124}"
  echo "Node not found; serving with python3 on http://127.0.0.1:${PORT}"
  exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "${SCRIPT_DIR}/../site"
else
  echo "Error: neither node nor python3 is installed." >&2
  exit 1
fi

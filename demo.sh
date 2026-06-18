#!/usr/bin/env bash
# Run Meowtrix as a serverless demo: no Node server, no PTYs.
# Just serves public/ as static files and opens the page in ?demo mode, where
# terminals become an in-browser JavaScript REPL and settings/layout persist to
# localStorage. See public/demo.js.
#
# Because it's pure static hosting, you can also deploy public/ to GitHub Pages,
# Netlify, etc. and link to <site>/?demo — this script is just for local runs.
set -e

PORT="${PORT:-8080}"
ROOT="$(cd "$(dirname "$0")" && pwd)/public"
URL="http://localhost:${PORT}/?demo"

echo "🐾 Meowtrix demo (serverless) → ${URL}"
echo "   Serving ${ROOT}"
echo "   Ctrl-C to stop."

# Open the browser shortly after the server comes up.
( sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  fi
) &

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT" --directory "$ROOT"
elif command -v npx >/dev/null 2>&1; then
  exec npx --yes serve -l "$PORT" "$ROOT"
else
  echo "Need python3 or npx to serve static files." >&2
  exit 1
fi

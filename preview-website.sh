#!/usr/bin/env bash
# preview-website.sh — Starts a local server for the website.
# Pass --capture to first re-capture fresh screenshots using Playwright.

set -e

# Change directory to the root of the project
cd "$(dirname "$0")"

CAPTURE=0
for arg in "$@"; do
  case "$arg" in
    --capture) CAPTURE=1 ;;
  esac
done

if [ "$CAPTURE" -eq 1 ]; then
  echo "🐾 Capturing fresh workspace screenshots using E2E Playwright test..."
  npm run screenshots
else
  echo "🐾 Skipping screenshot capture (pass --capture to recapture)."
fi

echo "🐾 Starting local web server to serve the website..."
PORT=5173
URL="http://localhost:${PORT}"

if command -v npx &>/dev/null; then
  echo "→ Serving './website' folder on ${URL} using http-server..."
  # -p specifies port, -o automatically opens the URL in the default browser
  npx --yes http-server website -p $PORT -o
elif command -v python3 &>/dev/null; then
  echo "→ Serving './website' folder on ${URL} using python3 http.server..."
  
  # Run python server in background
  python3 -m http.server $PORT --directory website &
  PY_PID=$!
  
  # Trap to kill python process on exit
  trap 'kill $PY_PID' INT TERM EXIT
  
  # Wait a moment for server to spin up, then open browser
  sleep 1
  if command -v open &>/dev/null; then
    open "$URL"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$URL"
  fi
  
  echo "🐾 Server is running. Press Ctrl+C to stop."
  wait $PY_PID
else
  echo "❌ Error: Neither 'npx' nor 'python3' was found. Please install Node.js or Python to serve the site."
  exit 1
fi

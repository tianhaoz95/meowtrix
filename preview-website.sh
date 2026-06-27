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
  echo "🐾 Capturing fresh feature GIFs (screen recordings → GIF via ffmpeg)..."
  if ! command -v ffmpeg &>/dev/null; then
    echo "⚠️  ffmpeg not found — skipping feature GIF capture. Install ffmpeg to recapture the Features page recordings."
  else
    npm run gifs
  fi
else
  echo "🐾 Skipping screenshot/GIF capture (pass --capture to recapture)."
fi

echo "🐾 Assembling site locally into './_site' (matching GitHub Pages layout)..."
rm -rf _site
mkdir -p _site
cp -R website/. _site/
mkdir -p _site/demo
cp -R public/. _site/demo/
touch _site/.nojekyll

echo "🐾 Starting local web server to serve the website..."
PORT=5173
URL="http://localhost:${PORT}"

if command -v npx &>/dev/null; then
  echo "→ Serving './_site' folder on ${URL} using http-server..."
  # -p specifies port, -o automatically opens the URL in the default browser
  npx --yes http-server _site -p $PORT -o
elif command -v python3 &>/dev/null; then
  echo "→ Serving './_site' folder on ${URL} using python3 http.server..."
  
  # Run python server in background
  python3 -m http.server $PORT --directory _site &
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

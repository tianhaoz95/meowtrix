#!/usr/bin/env bash
# Start Meowtrix with file watcher + browser hot reload
# Uses nodemon (via npx) — no global install required

# Pass HOTRELOAD=1 so server.js can serve the reload SSE endpoint
export HOTRELOAD=1

npx --yes nodemon \
  --watch server.js \
  --watch public \
  --ext js,css,html \
  --signal SIGKILL \
  server.js

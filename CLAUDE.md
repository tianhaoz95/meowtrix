# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Meowtrix — a browser-based remote workspace ("vibe engineering tool"). The UI is a tiling pane layout where each pane holds tabs, and each tab is either a PTY-backed terminal (xterm.js) or an embedded browser. A single Node server hosts both the static frontend and a WebSocket that multiplexes PTY sessions. Meant to be run on a host machine and reached over the network (or a tunnel like ngrok).

## Commands

```bash
npm install        # install deps (node-pty compiles natively)
npm start          # run the server on PORT (default 9123)
./start.sh         # dev mode: nodemon + browser hot-reload (sets HOTRELOAD=1)
```

There is no test suite, linter, or build step — the frontend is plain ES scripts served directly from `public/`, loaded via `<script>` tags in `index.html` (no bundler, no modules). After editing frontend code, just reload the page (or use `./start.sh` for auto-reload).

## Architecture

**Single server, two responsibilities** (`server.js`):
- **HTTP**: serves `public/`, the settings/session REST API, and the embedding proxy.
- **WebSocket**: PTY lifecycle (`pty:create/input/resize/destroy`) plus active-session coordination messages.

**Network binding defaults to loopback.** `resolveHost()` (`server.js`) picks the listen address: `--network`/`-n` → `0.0.0.0`, `--host <addr>` or the `HOST` env var → that address, otherwise `127.0.0.1`. Since reaching the server means getting a shell and there is *no* built-in auth, the safe default is localhost-only (use over an SSH tunnel); LAN/remote exposure is an explicit opt-in. The startup log prints the chosen mode plus a tunnel hint or a warning accordingly.

**PTYs outlive WebSocket connections.** The `ptys` Map keys each PTY by id and keeps a rolling ~200KB output buffer. On reconnect, `pty:create` with an existing id replays the buffer and reattaches the live stream instead of spawning a new shell — this is what makes refreshes and network blips non-destructive. Closing a browser tab/WS only detaches listeners; the shell keeps running.

**Single-session enforcement is server-coordinated** (`server.js` + `public/app.js`). Only one client is the "active" session; every other connected client (across browsers and devices, not just tabs) sees the inactive overlay. The newest client to send `session:claim` wins; others get a `session:state` broadcast and drop to the overlay until they press "Move session here". When the active socket drops, the server hands off to the most-recently-connected remaining client. This is deliberately *not* done via BroadcastChannel/localStorage so it works cross-device.

**Workspace layout is serialized to the server, not the PTYs.** `captureWorkspaceState`/`restoreWorkspaceState` (`public/app.js`) persist the pane/split/tab tree (including flex ratios and PTY ids) to `~/.meowtrix/session.json` via `/api/session`. Restoring rebuilds the DOM and reconnects each terminal to its still-alive PTY by id. Only the active session may write the session (an inactive tab holds stale layout); saves are debounced, and a `beforeunload` beacon flushes the final state.

**The embedding proxy** (`/proxy`) fetches pages server-side, strips `X-Frame-Options`/CSP frame directives, and rewrites `href`/`src`/`action` URLs to route back through the proxy — letting otherwise un-embeddable sites render in the browser-pane iframe. Two route shapes exist for a reason: `/proxy?url=` for initial loads, and `/proxy/<encoded>` (target in the path) so GET-form submissions don't wipe the target when the browser replaces the query string with form fields. Google, sign-in flows, and heavily bot-protected sites still won't embed.

## Frontend module map (`public/`, all global-scope, load order matters)

Load order in `index.html`: `ws.js` → `pane.js` → `layout.js` → `app.js` → `mobile.js` → `settings.js` → `palette.js`. Functions are shared via the global scope (e.g. `wsSend`, `getAllPanes`, `applyStickyMods`, `runAppShortcut`), so cross-file calls are plain function references, not imports.

- **`ws.js`** — the single WebSocket, auto-reconnect (1s), and the `ptyCallbacks` map (ptyId → xterm Terminal). Queues `pty:create` calls made before the socket opens.
- **`pane.js`** — pane/tab model and registry, tab creation for terminals and browsers, tab drag-and-drop (HTML5 DnD for mouse + a parallel Pointer-Events path for touch), and broadcast-input fan-out.
- **`layout.js`** — splitting panes and the draggable dividers. Splits are *flat*: splitting again in the same direction adds an equal sibling rather than nesting; sizes are unitless flex-grow ratios so they survive window/screen resizes.
- **`app.js`** — session bootstrap/claim/handoff logic, workspace serialize/restore, keyboard shortcuts, and double-click/double-tap → autocomplete (Tab) in the active terminal.
- **`mobile.js`** — on-screen key bar above the soft keyboard. Ctrl/Alt/Cmd are *sticky* modifiers applied at the PTY-input layer (`applyStickyMods`, called from xterm `onData`) rather than via synthetic keyboard events, because mobile keyboards don't emit reliable keydowns.
- **`settings.js`** — settings panel, live application of terminal font/scrollback/theme.
- **`palette.js`** — the `⌘K` / `Ctrl·⌘+Shift+P` command palette: a fuzzy launcher whose commands are rebuilt on each open and call the same shared action functions as the toolbar (`splitPane`, `addTab`, `closeActivePane`, `setBroadcastInput`, `setTheme`, `openSettings`, plus `cycleTab`/`cyclePane`). The open shortcut deliberately avoids `Ctrl+K`/`Ctrl+P` so it doesn't collide with terminal readline bindings.

## Persisted state (host machine)

- `~/.meowtrix/settings.json` — theme, terminal font/size/scrollback, shell, browser homepage. Server merges over `DEFAULT_SETTINGS`.
- `~/.meowtrix/session.json` — serialized workspace layout (panes, splits, tabs, PTY ids).

Both live under `$HOME/.meowtrix/`. PTY state itself is in-memory only — restarting the server kills all shells.

## Distribution

`install.sh` clones/updates into `~/.meowtrix/app`, installs prod deps, and writes a `meowtrix` launcher to `~/.local/bin`. With `--service` it installs a launchd agent (macOS) or systemd user service (Linux) that auto-starts on login and restarts on crash. The README's install commands curl this script from GitHub.

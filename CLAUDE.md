# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Meowtrix — a browser-based remote workspace ("vibe engineering tool"). The UI is a tiling pane layout where each pane holds tabs, and each tab is one of: a PTY-backed terminal (xterm.js), an embedded browser, or a code editor (Monaco + a file tree over the host filesystem). A single Node server hosts both the static frontend and a WebSocket that multiplexes PTY sessions. Meant to be run on a host machine and reached over the network (or a tunnel like ngrok).

## Commands

```bash
npm install        # install deps (node-pty compiles natively)
npm start          # run the server on PORT (default 9123)
./start.sh         # dev mode: nodemon + browser hot-reload (sets HOTRELOAD=1)
npm run test:e2e   # run playwright e2e tests
npm run screenshots # generate showcase screenshots using playwright
./preview-website.sh # capture screenshots & start local server for website
```

Playwright E2E tests reside in `tests/`. The frontend is plain ES scripts served directly from `public/`, loaded via `<script>` tags in `index.html` (no bundler, no modules). After editing frontend code, reload the page (or use `./start.sh` for auto-reload).

## Architecture

**Single server, two responsibilities** (`server.js`):
- **HTTP**: serves `public/`, the settings/session REST API, and the embedding proxy.
- **WebSocket**: PTY lifecycle (`pty:create/input/resize/destroy`), active-session coordination, and scheduled-Enter timers (`schedule:create/cancel`, broadcast back as `schedule:state`/`schedule:fired`).

**Network binding defaults to loopback.** `resolveHost()` (`server.js`) picks the listen address: `--network`/`-n` → `0.0.0.0`, `--host <addr>` or the `HOST` env var → that address, otherwise `127.0.0.1`. Since reaching the server means getting a shell and there is *no* built-in auth, the safe default is localhost-only (use over an SSH tunnel); LAN/remote exposure is an explicit opt-in. The startup log prints the chosen mode plus a tunnel hint or a warning accordingly. **Exception: a `--service` install sets `HOST=0.0.0.0` in the launchd/systemd unit** (see Distribution), so an auto-starting service is network-reachable by default — the assumption being that a service is meant to be reached from other devices, unlike the manual launcher.

**PTYs outlive WebSocket connections.** The `ptys` Map keys each PTY by id and keeps a rolling ~200KB output buffer. On reconnect, `pty:create` with an existing id replays the buffer and reattaches the live stream instead of spawning a new shell — this is what makes refreshes and network blips non-destructive. Closing a browser tab/WS only detaches listeners; the shell keeps running.

  The replay is **width-sensitive**: the buffer is raw bytes laid out for the PTY's grid size, and rendering it into a *narrower* xterm strands zsh's `PROMPT_EOL_MARK` (a reverse-video `%`) at the start of every prompt line. So on reconnect the server sends `pty:created {cols, rows}` (the PTY's generation size) *before* the buffer; the client (`ws.js`/`pane.js` `onPtyRestore`) snaps the xterm to that size, writes the buffer, then re-fits to its actual pane on the write callback (`onReplayDone`), which reflows the already-correct content cleanly. New PTYs get a plain `pty:created` (no size) and skip this.

**Scheduled Enter presses are server-side timers** (`server.js`, the `schedules` map keyed by PTY id). A client sends `schedule:create {ptyId, fireAt}`; the server arms a `setTimeout` that writes a lone `\r` to that PTY when it fires, then broadcasts the change. Living server-side (next to the PTYs) is what lets a schedule survive page refreshes, reconnects, and device handoffs — clients are stateless renderers that reconcile their lock overlays from `schedule:state` broadcasts (sent on every change and to each client on connect). In-memory only: a server restart kills the PTYs, so there's nothing left to fire into. See `public/schedule.js`.

**Single-session enforcement is server-coordinated** (`server.js` + `public/app.js`). Only one client is the "active" session; every other connected client (across browsers and devices, not just tabs) sees the inactive overlay. The newest client to send `session:claim` wins; others get a `session:state` broadcast and drop to the overlay until they press "Move session here". When the active socket drops, the server hands off to the most-recently-connected remaining client. This is deliberately *not* done via BroadcastChannel/localStorage so it works cross-device.

**Workspace layout is serialized to the server, not the PTYs.** `captureWorkspaceState`/`restoreWorkspaceState` (`public/app.js`) persist the pane/split/tab tree (including flex ratios and PTY ids) to `~/.meowtrix/session.json` via `/api/session`. Restoring rebuilds the DOM and reconnects each terminal to its still-alive PTY by id. Only the active session may write the session (an inactive tab holds stale layout); saves are debounced, and a `beforeunload` beacon flushes the final state.

**The code editor is client-side over a thin file API.** A code-editor tab (`public/editor.js`) is Monaco (the VS Code editor, lazy-loaded from CDN via its AMD loader) plus a self-built file-tree sidebar and per-file tabs. It has **no PTY** — the server just exposes `/api/fs/list|read|write` (plus `/api/fs/home` for the folder-picker default, `server.js`, next to `/api/download`), and the editor reads/writes files directly. The folder-open prompt (`promptForFolder` in `app.js`) uses `/api/fs/list` for live directory autocomplete.

If the opened folder is a git repo, the editor sidebar gains a **Source Control** view (toggled next to the file tree in `editor.js`). It's backed by `/api/git/*` endpoints (`server.js`) that shell out via `execFile('git', ['-C', root, …])` — `status` (porcelain v1 `-z`, parsed into staged/worktree entries + branch/ahead/behind), `filediff` (HEAD/index/worktree blobs via `git show`, fed to a Monaco diff editor), and POST `stage`/`unstage`/`discard`/`commit`/`push`/`pull`. Same no-sandbox stance as the file API; `execFile` (no shell) keeps paths/messages out of a command line. The repo check on tab init reveals the view only when `status` reports `isRepo`. Same no-sandbox stance as download (the user already has full shell access), with guards for oversized/binary files on read. Because content lives on disk, an editor tab persists only its root directory (`editorDir` in the workspace state) and re-fetches files on reconnect rather than reattaching a process — so a refresh re-opens the folder but drops unsaved buffer edits. Opened via the tab-type picker (which prompts for a folder), the palette, or `mtx code <dir>` in a terminal (which prints OSC 5380, picked up by a `registerOscHandler(5380)` in `pane.js` → `triggerOpenEditor`). Cmd/Ctrl+S writes the active file via `PUT /api/fs/write`.

**`mtx` is a small host CLI** (`bin/mtx`, put on every shell's PATH at spawn) that talks to the browser via private OSC sequences: `mtx download <file>` (OSC 5379 → `triggerDownload`) and `mtx code <dir>` (OSC 5380 → `triggerOpenEditor`). Both OSCs are stripped from the PTY replay buffer (`DOWNLOAD_OSC_RE`/`EDITOR_OSC_RE` in `server.js`) so a reconnect doesn't re-fire them.

**Self-update is git-based and supervisor-driven** (`server.js` self-update section + `public/update.js`). Since the app is normally a git clone in `~/.meowtrix/app` (see `install.sh`), updating is `git pull --ff-only` (reinstalling deps only when `package.json`/the lockfile moved), then `process.exit(0)` so the launchd/systemd unit relaunches on the new code. The server only auto-exits when actually supervised — `install.sh --service` sets `MEOWTRIX_SUPERVISED=1` and uses launchd `KeepAlive`/systemd `Restart=always` (clean exits must relaunch); the bare `meowtrix` launcher isn't supervised, so it pulls but asks the user to restart. A background `git fetch`+compare runs ~hourly (gated by the `autoUpdate` setting) and only *notifies* via a `update:state` WS broadcast; the actual pull/restart is user-triggered (the `#update-banner` "Update & restart" button or the palette's "Update & restart Meowtrix"), because a restart kills every in-memory PTY — the user picks the moment. Endpoints: `GET /api/update/check` (fetch+compare, broadcasts) and `POST /api/update/apply` (pull, then exit if supervised). Like schedules, the client is a stateless renderer of `update:state` (cached and re-sent on each WS connect). Same no-auth stance as the rest of the app: anyone who can reach the server already has a shell here, so a remote-triggered pull grants nothing new.

**The embedding proxy** (`/proxy`) fetches pages server-side, strips `X-Frame-Options`/CSP frame directives, and rewrites `href`/`src`/`action` URLs to route back through the proxy — letting otherwise un-embeddable sites render in the browser-pane iframe. Two route shapes exist for a reason: `/proxy?url=` for initial loads, and `/proxy/<encoded>` (target in the path) so GET-form submissions don't wipe the target when the browser replaces the query string with form fields. Google, sign-in flows, and heavily bot-protected sites still won't embed.

## Frontend module map (`public/`, all global-scope, load order matters)

Load order in `index.html`: `ws.js` → `pane.js` → `editor.js` → `layout.js` → `app.js` → `mobile.js` → `settings.js` → `palette.js` → `schedule.js` → `update.js`. Functions are shared via the global scope (e.g. `wsSend`, `getAllPanes`, `applyStickyMods`, `runAppShortcut`), so cross-file calls are plain function references, not imports.

- **`ws.js`** — the single WebSocket, auto-reconnect (1s), and the `ptyCallbacks` map (ptyId → xterm Terminal). Queues `pty:create` calls made before the socket opens.
- **`pane.js`** — pane/tab model and registry, tab creation for terminals and browsers, tab drag-and-drop (HTML5 DnD for mouse + a parallel Pointer-Events path for touch), and broadcast-input fan-out.
- **`layout.js`** — splitting panes and the draggable dividers. Splits are *flat*: splitting again in the same direction adds an equal sibling rather than nesting; sizes are unitless flex-grow ratios so they survive window/screen resizes.
- **`app.js`** — session bootstrap/claim/handoff logic, workspace serialize/restore, keyboard shortcuts, and double-click/double-tap → autocomplete (Tab) in the active terminal.
- **`mobile.js`** — on-screen key bar above the soft keyboard. Ctrl/Alt/Cmd are *sticky* modifiers applied at the PTY-input layer (`applyStickyMods`, called from xterm `onData`) rather than via synthetic keyboard events, because mobile keyboards don't emit reliable keydowns.
- **`settings.js`** — settings panel, live application of terminal font/scrollback/theme.
- **`palette.js`** — the `⌘K` / `Ctrl·⌘+Shift+P` command palette: a fuzzy launcher whose commands are rebuilt on each open and call the same shared action functions as the toolbar (`splitPane`, `addTab`, `closeActivePane`, `setBroadcastInput`, `setTheme`, `openSettings`, `openScheduleDialog`, plus `cycleTab`/`cyclePane`). The open shortcut deliberately avoids `Ctrl+K`/`Ctrl+P` so it doesn't collide with terminal readline bindings.
- **`editor.js`** — the code-editor tab: `ensureMonaco()` (cached lazy CDN load) and `initEditorTab(tab, viewEl, dir)` (file-tree sidebar via `/api/fs/list`, per-file Monaco models opened via `/api/fs/read` with dirty tracking, Cmd/Ctrl+S → `/api/fs/write`). Lays out Monaco on the `tab.onActivate` hook (called from `activateTab` in `pane.js`) and a `ResizeObserver`.
- **`update.js`** — the self-update banner + actions. Renders `#update-banner` from the server's `update:state` (`onUpdateState`), and exposes `checkForUpdateNow()` / `applyUpdateNow()` (POST to `/api/update/*`, then poll-and-reload once the restarted server answers). Loaded after `schedule.js`; palette commands reference its functions at runtime.
- **`schedule.js`** — the "schedule an Enter key press" feature (toolbar ⏰ / palette). For agents gated behind a rolling usage quota: type the next command, then queue an `Enter` for later (a relative delay or a clock time). The **timer lives server-side** (see below), so this file only sends `schedule:create`/`schedule:cancel` and *renders* the server's reported schedule state (`onScheduleState`/`reconcileSchedules`): a scheduled terminal tab is locked behind a blurred overlay — its input is swallowed via a `tab.schedule` guard in `pane.js`'s `onData` — until the server fires it or the user cancels. Because the client is stateless here, a refresh just re-receives the state and re-draws the lock.

## Persisted state (host machine)

- `~/.meowtrix/settings.json` — theme, terminal font/size/scrollback, shell, browser homepage, `autoUpdate` (background update check). Server merges over `DEFAULT_SETTINGS`.
- `~/.meowtrix/session.json` — serialized workspace layout (panes, splits, tabs, PTY ids).

Both live under `$HOME/.meowtrix/`. PTY state itself is in-memory only — restarting the server kills all shells.

## Distribution

`install.sh` clones/updates into `~/.meowtrix/app`, installs prod deps, and writes a `meowtrix` launcher to `~/.local/bin`. With `--service` it installs a launchd agent (macOS) or systemd user service (Linux) that auto-starts on login and restarts on crash. The service also sets `MEOWTRIX_SUPERVISED=1` (and uses launchd `KeepAlive` / systemd `Restart=always`) so the in-app self-update can `process.exit(0)` and be relaunched on the new code. The service unit also sets `HOST=0.0.0.0` so it binds to all interfaces by default (see "Network binding" above) — to scope a service install back to localhost, edit `HOST` to `127.0.0.1` in the unit and reload it. The README's install commands curl this script from GitHub.

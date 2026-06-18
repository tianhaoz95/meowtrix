# 🐾 Meowtrix

Remote vibe engineering tool — a browser-based workspace with tiling split panes, each pane holding tabs that are either a PTY-backed terminal or an embedded browser. Run it on a host machine and reach it from any browser on your network (or anywhere via a tunnel); shells live on the server, so refreshes, device switches, and network blips don't kill your work.

**[Website & docs](https://tianhaoz95.github.io/meowtrix/)** · **[Live demo](https://tianhaoz95.github.io/meowtrix/demo/?demo)** · **[User guide](https://tianhaoz95.github.io/meowtrix/docs/)** · **[Developer docs](https://tianhaoz95.github.io/meowtrix/dev/)**

## Features

- **Tiling panes & tabs** — split vertically or horizontally, drag dividers to resize; each pane holds multiple tabs
- **Persistent terminals** — full PTY-backed shells via xterm.js that outlive the connection; refresh or reconnect and they reattach with replayed scrollback
- **Embedded browser panes** — built-in browser with a server-side proxy that strips frame-blocking headers so otherwise un-embeddable pages render in a pane
- **Cross-device sessions** — server-coordinated single active session; move the whole workspace between browsers and devices and your layout follows
- **Command palette** — `⌘K` (or `Ctrl/⌘+Shift+P`) fuzzy launcher for every action: split, new tab, switch tabs/panes, broadcast, themes, settings
- **Localhost-first** — binds to `127.0.0.1` by default so it's not exposed to your network; opt into LAN/remote access explicitly (see [Network access](#network-access--security))
- **Broadcast input** — mirror keystrokes to every visible terminal at once (like tmux `synchronize-panes`)
- **Mobile-ready** — on-screen key bar with sticky Ctrl/Alt/Cmd modifiers and double-tap autocomplete
- **10 themes** — Midnight, Daylight, Ocean, Matrix, Ember, Sakura, Bubblegum, Catppuccin, Cappuccino, Synthwave; terminals are themed to match
- **No build step** — plain ES scripts served directly; settings & layout persist to `~/.meowtrix/`

## Prerequisites

Meowtrix runs on the **host machine** (macOS or Linux) — you only need a browser on the devices you connect from. On the host you'll need:

- **Node.js 18+** and **npm** — runs the server
- **git** — the installer clones the repo
- **A C/C++ build toolchain** — `node-pty` compiles natively on install:
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Linux:** `build-essential` (or `gcc`/`make`) and `python3`

> The `--service` auto-start mode is supported on macOS (launchd) and Linux (systemd) only. Windows is not supported by the installer.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/tianhaoz95/meowtrix/main/install.sh | bash
```

Then run:

```bash
meowtrix
```

And open `http://localhost:9123` in your browser.

### Install as a service (auto-start on login)

```bash
curl -fsSL https://raw.githubusercontent.com/tianhaoz95/meowtrix/main/install.sh | bash -s -- --service
```

Uses **launchd** on macOS and **systemd** on Linux. Meowtrix will start automatically on login and restart if it crashes.

### Update

Re-run the installer — it pulls the latest into `~/.meowtrix/app`:

```bash
curl -fsSL https://raw.githubusercontent.com/tianhaoz95/meowtrix/main/install.sh | bash
```

## Quick start (from source)

```bash
npm install      # node-pty compiles natively
npm start        # serves on PORT (default 9123)
```

Then open `http://localhost:9123` in your browser.

## Network access & security

Meowtrix hands whoever can reach it a **real shell on the host**, so by default it binds to **`127.0.0.1` (localhost only)** — reachable from the host itself but invisible to the rest of the network. There are two safe ways to use it remotely:

**1. SSH tunnel (recommended).** Leave the default localhost binding and forward the port over SSH from your client machine:

```bash
ssh -L 9123:localhost:9123 <user>@<host>
# then open http://localhost:9123 in your local browser
```

This keeps Meowtrix off the network entirely — only your authenticated SSH session can reach it. Tunnels like `ngrok http 9123` also work with the default binding, since they connect to localhost on the host.

**2. Bind to the network.** To reach Meowtrix directly from other devices on a **trusted** LAN, bind to all interfaces:

```bash
meowtrix --network         # or: meowtrix --host 0.0.0.0
# from source:
HOST=0.0.0.0 npm start
```

Then open `http://<host-ip>:9123` from any device. You can also bind to one specific interface with `--host <addr>` or the `HOST` env var.

> ⚠️ `--network` exposes a shell to anyone who can reach the port — there is no built-in authentication. Only do this on a network you trust, or front it with your own auth/firewall.

### Dev mode (hot reload)

```bash
./start.sh       # nodemon + browser hot-reload
```

## Try the demo (no install)

Meowtrix can run entirely in the browser with no server — terminals become an in-browser JavaScript REPL, and layout/settings persist to `localStorage`.

- **Online:** [tianhaoz95.github.io/meowtrix/demo/?demo](https://tianhaoz95.github.io/meowtrix/demo/?demo)
- **Locally:** `./demo.sh` (serves the static demo and opens it)

In demo mode the browser pane loads URLs directly (no proxy), so only sites that allow embedding will appear.

## Keyboard shortcuts

Use `⌘` on macOS or `Ctrl` elsewhere.

| Shortcut | Action |
|---|---|
| `⌘K` / `Ctrl+Shift+P` | Open the command palette |
| `⌘\` | Split vertical |
| `⌘-` | Split horizontal |
| `⌘T` | New tab |
| `⌘W` | Close tab |

The **command palette** (`⌘K`, or `Ctrl/⌘+Shift+P`) is a fuzzy launcher for every action — splitting, new terminal/browser tabs, switching tabs and panes, broadcast input, theme switching, and settings. Type to filter, arrow keys to move, `Enter` to run.

Double-click (or double-tap) inside a terminal to send `Tab` for autocomplete.

## Settings

Settings are saved to `~/.meowtrix/settings.json` on the host machine; the workspace layout is saved to `~/.meowtrix/session.json`.

| Setting | Default |
|---|---|
| Theme | Midnight (dark) |
| Terminal font size | 13 |
| Terminal font | Cascadia Code |
| Scrollback | 10,000 lines |
| Shell | `$SHELL` (falls back to `/bin/bash`) |
| Browser homepage | blank (shows a start page) |

## How it works

A single `server.js` hosts the static frontend, the settings/session REST API, and a WebSocket that multiplexes PTY sessions; PTYs are kept in memory and outlive WebSocket connections so reconnects are non-destructive. The frontend is plain global-scope ES scripts under `public/` (no bundler). See the [developer docs](https://tianhaoz95.github.io/meowtrix/dev/) and `CLAUDE.md` for the full architecture.

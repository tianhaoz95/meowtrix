# 🐾 Meowtrix

Remote vibe engineering tool — a browser-based workspace with split panes, each pane being a terminal or a browser tab.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/tianhaoz95/meowtrix/main/install.sh | bash
```

Then run:

```bash
meowtrix
```

And open `http://localhost:3000` in your browser.

## Update

```bash
curl -fsSL https://raw.githubusercontent.com/tianhaoz95/meowtrix/main/install.sh | bash
```



- **Split panes** — split vertically or horizontally, drag dividers to resize
- **Terminals** — full PTY-backed terminals via xterm.js, multiple tabs per pane
- **Browser panes** — built-in browser with server-side proxy to bypass iframe restrictions
- **Settings** — font, shell, homepage, scrollback, theme — persisted to `~/.meowtrix/settings.json`
- **Light / dark theme**

## Quick start

```bash
npm install
npm start
```

Then open `http://localhost:3000` in your browser.

To expose it over the internet, run it on a server or use a tunnel:

```bash
# Example with ngrok
ngrok http 3000
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘\` | Split vertical |
| `⌘-` | Split horizontal |
| `⌘T` | New tab |
| `⌘W` | Close tab |

## Settings

Settings are saved to `~/.meowtrix/settings.json` on the host machine.

| Setting | Default |
|---|---|
| Theme | dark |
| Terminal font size | 13 |
| Terminal font | Cascadia Code |
| Shell | `$SHELL` |
| Scrollback | 10,000 lines |
| Browser homepage | https://google.com |

# 🐾 Meowtrix: Your Dream Terminal & Workspace for Vibe Engineering

Have you ever found yourself in the middle of a late-night hacking session, juggling five terminal windows, two documentation tabs, a local web preview, and a git diff viewer, wishing it could all just live in one cohesive, beautiful interface?

And then, a sudden Wi-Fi hiccup kills your active SSH terminal processes. Or you have to step away from your desk, only to realize you can’t easily pick up *exactly* where you left off from your laptop or iPad without setting up a dozen tmux splits again.

Enter **Meowtrix** — a lightweight, self-hosted, browser-based remote workspace designed to be the ultimate developer environment for "vibe engineering."

---

## What is Vibe Engineering?

It's that elusive state of pure, uninterrupted flow. It's when your tools stay out of your way, your environment looks gorgeous, and everything you need — from your terminal shells to your local previews, editors, and documentation — is accessible in a single workspace. 

Meowtrix is built specifically to enable this flow state. It runs on a host machine (your beefy development workstation, a home server, or a cloud VPS) and exposes a premium, responsive tiling interface that you can connect to from any browser on any device.

Here is why Meowtrix might just become your new favorite daily driver.

---

## 🚀 Key Features of Meowtrix

### 1. Tiling Split Panes and Tabs (Zero Clutter)
Unlike typical window managers or desktop environments, Meowtrix splits your workspace into clean, unitless tiling panes (flex-grow ratios) that respond beautifully to screen resizes. You can split panes vertically or horizontally and drag dividers to resize them. Each pane can host multiple tabs, letting you mix and match terminals, browsers, and editors exactly how you want.

### 2. Zero-Drop Persistent Terminals
Terminals in Meowtrix are fully functional, PTY-backed shells (powered by `xterm.js` and `node-pty`) running directly on your host. But here is the magic: **they outlive your connection**. If your browser crashes, your network blips, or you refresh the page, the shell process keeps running on the server. When you reconnect, Meowtrix replays the scrollback buffer and seamlessly reattaches the live stream. Your shell history, environment variables, and running processes are completely preserved.

### 3. In-Pane Embedded Web Browsing
Normally, browsers prevent you from embedding websites like Google or documentation pages inside iframes using headers like `X-Frame-Options` or Content Security Policies (CSP). Meowtrix bypasses this using an **embedding proxy** running on the server. It strips frame-blocking headers and rewrites URLs, allowing you to load docs, search engines, and local dev server previews directly inside a pane next to your terminal.

### 4. Thin-Client Code Editor (Monaco)
Need to make quick code edits or review a workspace directory? Meowtrix has a built-in code editor tab backed by VS Code's core engine, **Monaco**. It features:
* **Interactive File Tree:** Browse files on your host machine.
* **Live Markdown & HTML Previews:** Side-by-side renders of markdown and HTML documents.
* **Full Git / Source Control View:** Stage/unstage changes, view side-by-side diffs, commit, push, and pull.
* **AI Commit Messages:** Generates smart commit messages automatically based on your changes.
* **Zero Sandboxing:** It operates directly on your host machine's filesystem so you don't have to deal with mounting container paths.

### 5. Scheduled Enter Presses (⏰)
Running tasks that are gated by API usage quotas or need to trigger after a specific duration? You can schedule a virtual `Enter` keypress to fire at a specific time or after a delay. Because this timer is hosted server-side, it will fire and execute your typed command even if your browser is closed.

### 6. Mochi, the AI Chat Pet & Keystroke Combo FX (🐾)
What's "vibe engineering" without the actual vibes?
* **Mochi:** An on-device desktop companion (with 12 cute animal faces to choose from) powered entirely locally via Google Chrome's built-in LLM (Gemini Nano).
* **Combo FX:** Feel the power of your code as you type! Level up your typing streak to trigger satisfying screen shakes, particle bursts, edge glows, and heat-tinted combo readouts.

---

## 🛠️ The Architecture: Simple and Lightweight

Under the hood, Meowtrix is extremely lean:
* **No Bundler / Build Step:** The frontend is written in plain, global-scope ES scripts served directly from the `public/` folder. This keeps page loads lightning-fast and makes customization trivial.
* **Single Node.js Server:** A single `server.js` file handles the HTTP server, the WebSocket protocol that multiplexes PTY sessions, and filesystem REST APIs.
* **Host-Bound Security:** Out of the box, Meowtrix binds only to loopback (`127.0.0.1`) so that your host terminal is never exposed to the network. When you want to access it from another device, you can tunnel securely via SSH (`ssh -L 9123:localhost:9123`) or opt-in to network binding if you are on a trusted local network.

---

## 📦 Getting Started

You can install and run Meowtrix in under a minute.

### The Quick Install (Zero-Dependency Binary)
Run the automated installer on your macOS or Linux host:
```bash
curl -fsSL https://raw.githubusercontent.com/tianhaoz95/meowtrix/main/install.sh | bash
```
Once installed, start it up:
```bash
meowtrix
```
Open `http://localhost:9123` in your browser and you're ready to roll!

### Run in a Service Mode (Auto-start on Boot)
If you want Meowtrix to act as a persistent daemon that launches on system boot:
```bash
curl -fsSL https://raw.githubusercontent.com/tianhaoz95/meowtrix/main/install.sh | bash -s -- --service
```
This configures a system service (`launchd` on macOS, `systemd` on Linux) that stays alive in the background and auto-restarts on crash.

### Isolated Container Testing (Docker)
Want to try it without touching your host settings? Run:
```bash
./docker-run.sh
```
This builds an isolated container, mounts the workspace, and maps settings to a Docker volume so your host environment stays clean.

---

## 🏁 Join the Vibe

Meowtrix is open-source and ready for customization. Whether you want to configure one of its **10 premium visual themes** (like *Synthwave*, *Catppuccin*, or *Matrix*), trigger actions using the command palette (`⌘K`), or write custom plugins, it's designed to bend to your workflow.

* **GitHub Repository:** [github.com/tianhaoz95/meowtrix](https://github.com/tianhaoz95/meowtrix)
* **Official Website & Docs:** [tianhaoz95.github.io/meowtrix](https://tianhaoz95.github.io/meowtrix/)
* **Live Demo (No Install):** [tianhaoz95.github.io/meowtrix/demo/?demo](https://tianhaoz95.github.io/meowtrix/demo/?demo)

Give it a spin, customize your theme, and let Mochi accompany you on your next coding adventure. Happy vibe engineering! 🐾

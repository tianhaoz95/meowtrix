const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const https = require('https');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { URL } = require('url');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Hot reload (dev only) ────────────────────────────────────────────────────
if (process.env.HOTRELOAD) {
  const reloadClients = new Set();
  app.get('/__reload', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    reloadClients.add(res);
    req.on('close', () => reloadClients.delete(res));
  });
  // nodemon sends SIGUSR2 before restarting
  process.on('SIGUSR2', () => {
    reloadClients.forEach(r => r.write('data: reload\n\n'));
  });
}

// Inject hot-reload snippet into index.html in dev mode
app.get('/', (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  if (process.env.HOTRELOAD) {
    html = html.replace('</body>', `<script>
(function(){var s=new EventSource('/__reload');s.onmessage=function(){location.reload()};s.onerror=function(){setTimeout(function(){location.reload()},500)}})();
</script></body>`);
  }
  res.send(html);
});

// ── Settings persistence ─────────────────────────────────────────────────────
const SETTINGS_FILE = path.join(os.homedir(), '.meowtrix', 'settings.json');
const DEFAULT_SETTINGS = {
  theme: 'dark',
  termFontSize: 13,
  termFontFamily: 'Cascadia Code, JetBrains Mono, Menlo, Monaco, monospace',
  termScrollback: 10000,
  shell: process.env.SHELL || '/bin/bash',
  browserHomepage: '', // blank → new browser tabs show the local start page
};

function readSettings() {
  let s;
  try { s = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
  // Migrate the old Google homepage default → new tabs now open a local start
  // page (Google can't be proxied anyway), so clear the stale default.
  if (/^https?:\/\/(www\.)?google\.com\/?$/i.test(s.browserHomepage || '')) {
    s.browserHomepage = DEFAULT_SETTINGS.browserHomepage;
  }
  return s;
}

function writeSettings(data) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/settings', (req, res) => res.json(readSettings()));
app.post('/api/settings', (req, res) => {
  const merged = { ...readSettings(), ...req.body };
  writeSettings(merged);
  res.json(merged);
});
app.post('/api/settings/reset', (req, res) => {
  writeSettings({ ...DEFAULT_SETTINGS });
  res.json({ ...DEFAULT_SETTINGS });
});

// ── Session state persistence ────────────────────────────────────────────────
const SESSION_FILE = path.join(os.homedir(), '.meowtrix', 'session.json');
app.get('/api/session', (req, res) => {
  try { res.json(JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'))); }
  catch { res.json(null); }
});
app.post('/api/session', (req, res) => {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(req.body));
  res.json({ ok: true });
});

// ── File transfer: upload (client → host) and download (host → client) ───────
// Uploads land in ~/meowtrix on the host; downloads can target any file the
// host user can read (this is a personal remote workspace — the same user
// already has full shell access here, so we don't sandbox the path).
const UPLOAD_DIR = path.join(os.homedir(), 'meowtrix');

// Raw-body upload: the client POSTs one file per request with its name in the
// ?name= query and the bytes as the request body (Content-Type:
// application/octet-stream, so express.json leaves the stream untouched). This
// avoids a multipart dependency. path.basename strips any directory traversal.
app.post('/api/upload', (req, res) => {
  const name = path.basename(req.query.name || '').trim();
  if (!name || name === '.' || name === '..') return res.status(400).json({ error: 'Invalid name' });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const dest = path.join(UPLOAD_DIR, name);
  const out = fs.createWriteStream(dest);
  out.on('error', err => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
  out.on('finish', () => res.json({ ok: true, path: dest }));
  req.on('error', () => out.destroy());
  req.pipe(out);
});

// Download: stream the requested host file to the browser as an attachment.
// Triggered by the `mtx` command, which prints an OSC sequence the client turns
// into a GET here (see public/pane.js).
app.get('/api/download', (req, res) => {
  const p = req.query.path;
  if (!p) return res.status(400).send('Missing path');
  const resolved = path.resolve(p);
  fs.stat(resolved, (err, st) => {
    if (err || !st.isFile()) return res.status(404).send('Not found');
    res.download(resolved, path.basename(resolved));
  });
});

// ── Proxy: fetch server-side, strip X-Frame-Options / CSP frame directives ──
const STRIP_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
]);

// Resolve the proxied target from either /proxy?url=<enc> (initial loads) or
// /proxy/<enc>[?formquery] (rewritten links & GET-form submissions). The path
// form is essential because a GET <form> replaces its action's query string
// with the form fields — which would wipe a ?url= param — but it leaves the
// path intact, so we keep the target in the path and re-attach the form query.
function resolveProxyTarget(req) {
  if (req.params.enc != null) {
    const base = req.params.enc; // Express has already percent-decoded this
    const qIdx = req.originalUrl.indexOf('?');
    const qs = qIdx >= 0 ? req.originalUrl.slice(qIdx + 1) : '';
    if (!qs) return base;
    return base.includes('?') ? `${base}&${qs}` : `${base}?${qs}`;
  }
  return req.query.url;
}

function proxyHandler(req, res) {
  const target = resolveProxyTarget(req);
  if (!target) return res.status(400).send('Missing ?url=');
  let parsed;
  try { parsed = new URL(target); } catch { return res.status(400).send('Invalid URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).send('Only http/https');

  const lib = parsed.protocol === 'https:' ? https : http;
  const opts = {
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + parsed.search,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  };

  const proxyReq = lib.get(opts, (proxyRes) => {
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
      const next = new URL(proxyRes.headers.location, target).href;
      return res.redirect(`/proxy/${encodeURIComponent(next)}`);
    }

    Object.entries(proxyRes.headers).forEach(([k, v]) => {
      if (!STRIP_HEADERS.has(k.toLowerCase())) try { res.setHeader(k, v); } catch {}
    });
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.status(proxyRes.statusCode);

    const ct = (proxyRes.headers['content-type'] || '').toLowerCase();
    if (ct.includes('text/html')) {
      let body = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', d => { body += d; });
      proxyRes.on('end', () => {
        const base = `${parsed.protocol}//${parsed.host}`;
        // Rewrite root-relative and absolute URLs through proxy
        body = body.replace(/(href|src|action)=(["'])(\/[^"']*|https?:\/\/[^"']+)\2/gi, (_, attr, q, url) => {
          const abs = url.startsWith('/') ? base + url : url;
          return `${attr}=${q}/proxy/${encodeURIComponent(abs)}${q}`;
        });
        res.send(body);
      });
    } else {
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', err => res.status(502).send(`Proxy error: ${err.message}`));
}

app.get('/proxy', proxyHandler);        // /proxy?url=<enc>  (initial loads, legacy)
app.get('/proxy/:enc', proxyHandler);   // /proxy/<enc>      (rewritten links, GET forms)

// ── PTY / WebSocket ──────────────────────────────────────────────────────────
// ptys: id -> { proc, dataListeners: Set, buffer: string }
const ptys = new Map();

// Keep ~200KB of recent output per PTY so a reconnecting client (e.g. after a
// page refresh) can be re-hydrated with the existing terminal content.
const PTY_BUFFER_MAX = 200000;

// The private OSC sequence `mtx` emits to trigger a browser download
// (ESC ] 5379 ; <path> BEL|ST). Stripped from the replay buffer below.
const DOWNLOAD_OSC_RE = /\x1b\]5379;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

// ── Active-session coordination ──────────────────────────────────────────────
// Only one client (the most recent to claim) is the "active" session; everyone
// else is told to show the inactive overlay. Tracked here so it holds across
// browsers and devices, not just tabs in a single browser.
const sessionClients = new Set(); // every connected control socket
let activeTabId = null;

function broadcastSession() {
  const payload = JSON.stringify({ type: 'session:state', activeTabId });
  for (const c of sessionClients) {
    if (c.readyState === c.OPEN) c.send(payload);
  }
}

function attachPtyToWs(id, ptyEntry, ws) {
  const listener = (data) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'pty:data', id, data }));
  };
  ptyEntry.dataListeners.add(listener);
  const unsub = ptyEntry.proc.onData(listener);
  return () => { ptyEntry.dataListeners.delete(listener); unsub.dispose?.(); };
}

wss.on('connection', (ws) => {
  // Map of ptyId -> cleanup fn for this WS connection
  const attached = new Map();
  sessionClients.add(ws);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'session:claim': {
        // This client becomes the active session; tell everyone the new state.
        ws.tabId = msg.tabId;
        activeTabId = msg.tabId;
        broadcastSession();
        break;
      }
      case 'session:sync': {
        // A (re)connecting client that doesn't want to steal — just learn state.
        ws.tabId = msg.tabId;
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'session:state', activeTabId }));
        }
        break;
      }
      case 'pty:create': {
        const id = msg.id || uuidv4();
        if (ptys.has(id)) {
          // Reconnect: replay buffered output, then reattach the live stream.
          const entry = ptys.get(id);
          if (attached.has(id)) { attached.get(id)(); }
          if (entry.buffer && ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'pty:data', id, data: entry.buffer }));
          }
          attached.set(id, attachPtyToWs(id, entry, ws));
          ws.send(JSON.stringify({ type: 'pty:created', id }));
          // Full-screen TUIs (vim, htop, …) only repaint on SIGWINCH, so the
          // replayed buffer alone leaves them blank until the user resizes.
          // Force a redraw by briefly jiggling the PTY size. Restore to the
          // entry's *current* size when the timer fires (the client may send a
          // corrected fit in the meantime) so we don't clip the bottom line.
          try {
            entry.proc.resize(entry.cols, Math.max(1, entry.rows - 1));
            setTimeout(() => { try { entry.proc.resize(entry.cols, entry.rows); } catch {} }, 50);
          } catch {}
          break;
        }
        const shell = readSettings().shell || process.env.SHELL || (os.platform() === 'win32' ? 'cmd.exe' : 'bash');
        const ptyEnv = { ...process.env };
        delete ptyEnv.npm_config_prefix;
        // Expose the bundled `mtx` download command on PATH for every shell.
        ptyEnv.PATH = path.join(__dirname, 'bin') + path.delimiter + (ptyEnv.PATH || '');
        const proc = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols: msg.cols || 80,
          rows: msg.rows || 24,
          cwd: process.env.HOME || process.cwd(),
          env: ptyEnv,
        });
        const entry = { proc, dataListeners: new Set(), buffer: '', cols: msg.cols || 80, rows: msg.rows || 24 };
        ptys.set(id, entry);
        // Persistently buffer output (independent of any connected WS) so it can
        // be replayed on reconnect. Capped to the most recent PTY_BUFFER_MAX bytes.
        proc.onData((data) => {
          // Keep the download-trigger OSC out of the replay buffer so a
          // reconnect (which replays the buffer) doesn't re-fire the download.
          entry.buffer += data.replace(DOWNLOAD_OSC_RE, '');
          if (entry.buffer.length > PTY_BUFFER_MAX) {
            entry.buffer = entry.buffer.slice(-PTY_BUFFER_MAX);
          }
        });
        proc.onExit(() => {
          ptys.delete(id);
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'pty:exit', id }));
        });
        attached.set(id, attachPtyToWs(id, entry, ws));
        ws.send(JSON.stringify({ type: 'pty:created', id }));
        break;
      }
      case 'pty:input': { const e = ptys.get(msg.id); if (e) e.proc.write(msg.data); break; }
      case 'pty:resize': {
        const e = ptys.get(msg.id);
        if (e) { e.cols = msg.cols; e.rows = msg.rows; e.proc.resize(msg.cols, msg.rows); }
        break;
      }
      case 'pty:destroy': {
        const e = ptys.get(msg.id);
        if (e) { e.proc.kill(); ptys.delete(msg.id); }
        if (attached.has(msg.id)) { attached.get(msg.id)(); attached.delete(msg.id); }
        break;
      }
    }
  });

  ws.on('close', () => {
    // Detach data listeners but keep PTY processes alive
    attached.forEach(cleanup => cleanup());
    attached.clear();
    sessionClients.delete(ws);
    // If the active session's socket dropped, hand off to the most recently
    // connected remaining client so the others aren't stranded on the overlay.
    if (ws.tabId && ws.tabId === activeTabId) {
      const heir = [...sessionClients].reverse().find(c => c.tabId);
      activeTabId = heir ? heir.tabId : null;
      broadcastSession();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Meowtrix running at http://0.0.0.0:${PORT}`);
});

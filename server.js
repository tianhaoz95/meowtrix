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
const { execFile } = require('child_process');

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
  autoUpdate: true, // background-check the git clone for updates (see self-update below)
  comboFx: true, // keystroke-streak visual effects (see public/combo.js)
  petEnabled: false, // on-device-LLM chat pet that walks around (see public/pet.js)
  petFace: 'cat', // pet appearance id (see PET_FACES in public/pet.js)
  petSpeed: 3, // pet wander speed, 1 (lazy) … 10 (zoomies)
  petStay: false, // true → pet stays put (no wandering); drag to position it
  petX: null, // saved pet x position (px) when dragged
  petY: null, // saved pet y position (px) when dragged
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

// ── Host file-system API (code editor tab) ───────────────────────────────────
// Backs the editor tab's file tree and open/save. Same no-sandbox stance as the
// download endpoint above: this is a personal remote workspace whose user already
// has full shell access, so any file they can read/write is fair game.
const EDITOR_MAX_FILE = 2 * 1024 * 1024; // refuse to open files larger than this

// Home directory — used as the default starting point for the editor's folder
// picker / path autocomplete.
app.get('/api/fs/home', (req, res) => res.json({ home: os.homedir() }));

// List a directory: dirs first, then files, each alphabetical (case-insensitive).
app.get('/api/fs/list', (req, res) => {
  const p = req.query.path;
  if (!p) return res.status(400).json({ error: 'Missing path' });
  const resolved = path.resolve(p);
  fs.readdir(resolved, { withFileTypes: true }, (err, dirents) => {
    if (err) return res.status(404).json({ error: 'Not a directory' });
    const entries = dirents
      .map(d => ({ name: d.name, type: d.isDirectory() ? 'dir' : 'file' }))
      .sort((a, b) =>
        a.type !== b.type ? (a.type === 'dir' ? -1 : 1)
                          : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    res.json({ path: resolved, entries });
  });
});

// Read a file as text. Rejects directories, oversized files, and binary content
// (a NUL byte in the first chunk) so the editor can show a friendly message.
app.get('/api/fs/read', (req, res) => {
  const p = req.query.path;
  if (!p) return res.status(400).json({ error: 'Missing path' });
  const resolved = path.resolve(p);
  fs.stat(resolved, (err, st) => {
    if (err || !st.isFile()) return res.status(404).json({ error: 'Not a file' });
    if (st.size > EDITOR_MAX_FILE) return res.status(413).json({ error: 'File too large to edit' });
    fs.readFile(resolved, (rErr, buf) => {
      if (rErr) return res.status(500).json({ error: rErr.message });
      if (buf.includes(0)) return res.status(415).json({ error: 'Binary file' });
      res.json({ path: resolved, content: buf.toString('utf8') });
    });
  });
});

// Write a file. Raw octet-stream body (like /api/upload) so express.json leaves
// the stream untouched; the absolute target path comes in via ?path=.
app.put('/api/fs/write', (req, res) => {
  const p = req.query.path;
  if (!p) return res.status(400).json({ error: 'Missing path' });
  const resolved = path.resolve(p);
  const out = fs.createWriteStream(resolved);
  out.on('error', err => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
  out.on('finish', () => res.json({ ok: true, path: resolved }));
  req.on('error', () => out.destroy());
  req.pipe(out);
});

// ── Git API (Source Control panel in the editor) ─────────────────────────────
// Runs `git` in the editor tab's project directory via execFile (no shell, so
// paths/messages aren't interpolated into a command line). Same no-sandbox
// stance as the file API — the user already has full shell access here.
function runGit(root, args, opts = {}) {
  return new Promise((resolve) => {
    execFile('git', ['-C', path.resolve(root), ...args],
      { maxBuffer: 20 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => resolve({
        ok: !err,
        stdout: stdout || '',
        stderr: (stderr || (err && err.message) || '').toString(),
      }));
  });
}
// `git show <spec>` as raw bytes (so binary files can be detected), or null.
function gitShowBuf(root, spec) {
  return new Promise((resolve) => {
    execFile('git', ['-C', path.resolve(root), 'show', spec],
      { maxBuffer: 20 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout) => resolve(err ? null : stdout));
  });
}
function toRel(root, abs) {
  return path.relative(path.resolve(root), path.resolve(abs)).split(path.sep).join('/');
}

// Working-tree status + branch info. Returns { isRepo:false } for non-repos.
app.get('/api/git/status', async (req, res) => {
  const root = req.query.root;
  if (!root) return res.status(400).json({ error: 'Missing root' });
  const r = await runGit(root, ['status', '--porcelain=v1', '--branch', '-z']);
  if (!r.ok) return res.json({ isRepo: false });

  const parts = r.stdout.split('\0');
  let branch = '', ahead = 0, behind = 0;
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    if (entry.startsWith('## ')) {
      const head = entry.slice(3);
      branch = (head.match(/^(?:No commits yet on )?(.+?)(?:\.\.\.|$| \[)/) || [, head])[1];
      ahead = +(head.match(/ahead (\d+)/) || [, 0])[1];
      behind = +(head.match(/behind (\d+)/) || [, 0])[1];
      continue;
    }
    const x = entry[0], y = entry[1], p = entry.slice(3);
    if (x === 'R' || x === 'C') i++; // rename/copy emits the source path next; skip it
    files.push({ path: p, x, y });
  }
  res.json({ isRepo: true, branch, ahead, behind, files });
});

// Original vs modified content for a file, for the Monaco diff view.
// staged=1 → HEAD vs index; otherwise index (fallback HEAD) vs working tree.
app.get('/api/git/filediff', async (req, res) => {
  const { root, path: abs } = req.query;
  if (!root || !abs) return res.status(400).json({ error: 'Missing root/path' });
  const rel = toRel(root, abs);
  const staged = req.query.staged === '1';

  let origBuf, modBuf;
  if (staged) {
    origBuf = await gitShowBuf(root, 'HEAD:' + rel);
    modBuf = await gitShowBuf(root, ':0:' + rel);
  } else {
    origBuf = await gitShowBuf(root, ':0:' + rel) || await gitShowBuf(root, 'HEAD:' + rel);
    try { modBuf = fs.readFileSync(path.resolve(abs)); } catch { modBuf = null; }
  }
  const isBin = b => b && b.includes(0);
  if (isBin(origBuf) || isBin(modBuf)) return res.json({ binary: true, original: '', modified: '' });
  res.json({
    original: origBuf ? origBuf.toString('utf8') : '',
    modified: modBuf ? modBuf.toString('utf8') : '',
  });
});

// Mutating actions. Bodies are JSON: { root, paths?:[abs], all?, message? }.
function relsFrom(body) { return (body.paths || []).map(p => toRel(body.root, p)); }

app.post('/api/git/stage', async (req, res) => {
  const { root, all } = req.body || {};
  if (!root) return res.status(400).json({ error: 'Missing root' });
  const r = await runGit(root, all ? ['add', '-A'] : ['add', '--', ...relsFrom(req.body)]);
  res.json({ ok: r.ok, error: r.ok ? undefined : r.stderr });
});

app.post('/api/git/unstage', async (req, res) => {
  const { root, all } = req.body || {};
  if (!root) return res.status(400).json({ error: 'Missing root' });
  const r = await runGit(root, all ? ['reset', '-q', 'HEAD'] : ['reset', '-q', 'HEAD', '--', ...relsFrom(req.body)]);
  res.json({ ok: r.ok, error: r.ok ? undefined : r.stderr });
});

// Discard working-tree changes: checkout tracked files, delete untracked ones.
app.post('/api/git/discard', async (req, res) => {
  const { root, path: abs, untracked } = req.body || {};
  if (!root || !abs) return res.status(400).json({ error: 'Missing root/path' });
  if (untracked) {
    try { fs.unlinkSync(path.resolve(abs)); return res.json({ ok: true }); }
    catch (e) { return res.json({ ok: false, error: e.message }); }
  }
  const r = await runGit(root, ['checkout', '--', toRel(root, abs)]);
  res.json({ ok: r.ok, error: r.ok ? undefined : r.stderr });
});

app.post('/api/git/commit', async (req, res) => {
  const { root, message } = req.body || {};
  if (!root || !message || !message.trim()) return res.status(400).json({ error: 'Missing root/message' });
  const r = await runGit(root, ['commit', '-m', message]);
  res.json({ ok: r.ok, output: (r.stdout + r.stderr).trim() });
});

app.post('/api/git/push', async (req, res) => {
  const { root } = req.body || {};
  if (!root) return res.status(400).json({ error: 'Missing root' });
  const r = await runGit(root, ['push']);
  res.json({ ok: r.ok, output: (r.stdout + r.stderr).trim() });
});

app.post('/api/git/pull', async (req, res) => {
  const { root } = req.body || {};
  if (!root) return res.status(400).json({ error: 'Missing root' });
  const r = await runGit(root, ['pull']);
  res.json({ ok: r.ok, output: (r.stdout + r.stderr).trim() });
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
        const script = `
<script id="mtx-proxy-theme">
  (function() {
    let currentTheme = 'dark';
    try {
      currentTheme = window.parent.document.documentElement.dataset.theme || 'dark';
    } catch (e) {}
    let isDark = currentTheme !== 'light';
    
    // Mock matchMedia for CSS / JS theme helpers
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = function(query) {
      if (query && query.includes('prefers-color-scheme')) {
        const matches = query.includes('dark') ? isDark : !isDark;
        return {
          matches: matches,
          media: query,
          onchange: null,
          addListener: function() {},
          removeListener: function() {},
          addEventListener: function() {},
          removeEventListener: function() {}
        };
      }
      return originalMatchMedia ? originalMatchMedia.apply(this, arguments) : { matches: false };
    };
    
    // Apply styling tokens
    document.documentElement.setAttribute('data-theme', currentTheme);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    
    // Global listener for runtime updates from parent window
    window.__mtx_update_theme = function(theme) {
      currentTheme = theme;
      isDark = theme !== 'light';
      document.documentElement.setAttribute('data-theme', theme);
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    };

    // Intercept console logs and post to parent window
    if (!window.__mtx_console_intercepted) {
      window.__mtx_console_intercepted = true;
      
      const logLevels = ['log', 'info', 'warn', 'error', 'debug'];
      
      function serializeConsoleArg(arg) {
        if (arg === null) return null;
        if (arg === undefined) return undefined;
        
        if (arg instanceof Element) {
          return {
            __isElement: true,
            tagName: arg.tagName.toLowerCase(),
            id: arg.id || '',
            className: arg.className || ''
          };
        }

        if (arg instanceof Error) {
          return {
            __isError: true,
            name: arg.name,
            message: arg.message,
            stack: arg.stack
          };
        }

        if (typeof arg === 'function') {
          return '[Function: ' + (arg.name || 'anonymous') + ']';
        }

        if (typeof arg === 'symbol') {
          return arg.toString();
        }

        if (typeof arg === 'object') {
          try {
            const seen = new Set();
            function clone(val) {
              if (val === null || typeof val !== 'object') return val;
              if (val instanceof Element) return serializeConsoleArg(val);
              if (val instanceof Error) return serializeConsoleArg(val);
              if (seen.has(val)) return '[Circular]';
              seen.add(val);
              if (Array.isArray(val)) {
                return val.map(item => clone(item));
              }
              const res = {};
              for (const key in val) {
                if (Object.prototype.hasOwnProperty.call(val, key)) {
                  res[key] = clone(val[key]);
                }
              }
              return res;
            }
            return clone(arg);
          } catch (e) {
            return String(arg);
          }
        }

        return arg;
      }
      
      logLevels.forEach(level => {
        const original = console[level];
        console[level] = function(...args) {
          if (original) {
            try {
              original.apply(console, args);
            } catch (e) {}
          }
          try {
            const processedArgs = args.map(arg => serializeConsoleArg(arg));
            window.parent.postMessage({
              type: 'mtx:console',
              level: level,
              args: processedArgs
            }, '*');
          } catch (err) {}
        };
      });

      window.addEventListener('error', function(event) {
        try {
          window.parent.postMessage({
            type: 'mtx:console',
            level: 'error',
            args: [event.message + ' at ' + (event.filename || 'unknown') + ':' + (event.lineno || 0) + ':' + (event.colno || 0)]
          }, '*');
        } catch (err) {}
      });

      window.addEventListener('unhandledrejection', function(event) {
        try {
          let reasonMsg = event.reason;
          if (event.reason && event.reason.message) {
            reasonMsg = event.reason.message;
          } else if (typeof event.reason === 'object') {
            reasonMsg = JSON.stringify(event.reason);
          }
          window.parent.postMessage({
            type: 'mtx:console',
            level: 'error',
            args: ['Unhandled Promise Rejection: ' + reasonMsg]
          }, '*');
        } catch (err) {}
      });
    }
  })();
</script>
`;
        const headMatch = body.match(/<head[^>]*>/i);
        if (headMatch) {
          body = body.replace(headMatch[0], headMatch[0] + script);
        } else {
          body = script + body;
        }
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

// The private OSC sequences `mtx` emits: 5379 triggers a browser download
// (`mtx download`), 5380 opens a code-editor tab on a directory (`mtx code`).
// Both are ESC ] <code> ; <path> BEL|ST and are stripped from the replay buffer
// below so a reconnect (which replays the buffer) doesn't re-fire the action.
const DOWNLOAD_OSC_RE = /\x1b\]5379;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const EDITOR_OSC_RE = /\x1b\]5380;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

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

// ── Scheduled Enter key presses (server-side timers) ─────────────────────────
// A coding agent gated behind a usage quota can have its next command typed in
// and the Enter *queued* for when the quota resets. Keeping the timer here (next
// to the PTYs) instead of in the browser means it survives page refreshes,
// reconnects, and device handoffs — the client just renders whatever schedule
// state the server reports. Keyed by PTY id; firing writes a lone CR to that PTY
// exactly as if the user had pressed Return, then notifies every client.
// In-memory only: a server restart kills the PTYs, so there'd be nothing to fire
// into and nothing worth persisting.
const schedules = new Map(); // ptyId -> { fireAt, timer }
const SCHEDULE_MAX_DELAY = 7 * 24 * 3600 * 1000; // reject absurd far-future values

function scheduleSnapshot() {
  return [...schedules.entries()].map(([ptyId, s]) => ({ ptyId, fireAt: s.fireAt }));
}

function broadcastSchedules() {
  const payload = JSON.stringify({ type: 'schedule:state', schedules: scheduleSnapshot() });
  for (const c of sessionClients) {
    if (c.readyState === c.OPEN) c.send(payload);
  }
}

function clearSchedule(ptyId) {
  const s = schedules.get(ptyId);
  if (!s) return false;
  clearTimeout(s.timer);
  schedules.delete(ptyId);
  return true;
}

function armSchedule(ptyId, fireAt) {
  clearSchedule(ptyId); // replace any existing schedule on this PTY
  const delay = fireAt - Date.now();
  if (!Number.isFinite(delay) || delay > SCHEDULE_MAX_DELAY) return;
  const timer = setTimeout(() => {
    schedules.delete(ptyId);
    const entry = ptys.get(ptyId);
    if (entry) entry.proc.write('\r');
    const fired = JSON.stringify({ type: 'schedule:fired', ptyId });
    for (const c of sessionClients) if (c.readyState === c.OPEN) c.send(fired);
    broadcastSchedules();
  }, Math.max(0, delay));
  schedules.set(ptyId, { fireAt, timer });
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
  // Bring this (re)connecting client up to date on any pending schedules so a
  // refreshed page re-renders its locked tabs.
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'schedule:state', schedules: scheduleSnapshot() }));
    // …and on whatever the last update check found, so a fresh page shows the
    // "update available" banner without waiting for the next periodic check.
    if (lastUpdateInfo) ws.send(JSON.stringify(updateStatePayload()));
  }

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
            // Send the PTY's current grid size *before* the buffer so the client
            // can replay it at the width that produced it. Rendering the buffer
            // into a narrower terminal strands zsh's PROMPT_EOL_MARK (a reverse-
            // video `%`) on every prompt line — the classic "`%` before every
            // line after refresh" bug. The client snaps to this size, writes the
            // buffer, then re-fits to its pane, which reflows the (now correct)
            // content cleanly.
            ws.send(JSON.stringify({ type: 'pty:created', id, cols: entry.cols, rows: entry.rows }));
            ws.send(JSON.stringify({ type: 'pty:data', id, data: entry.buffer }));
          } else {
            ws.send(JSON.stringify({ type: 'pty:created', id }));
          }
          attached.set(id, attachPtyToWs(id, entry, ws));
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
          // Keep the download/editor-trigger OSCs out of the replay buffer so a
          // reconnect (which replays the buffer) doesn't re-fire the action.
          entry.buffer += data.replace(DOWNLOAD_OSC_RE, '').replace(EDITOR_OSC_RE, '');
          if (entry.buffer.length > PTY_BUFFER_MAX) {
            entry.buffer = entry.buffer.slice(-PTY_BUFFER_MAX);
          }
        });
        proc.onExit(() => {
          ptys.delete(id);
          if (clearSchedule(id)) broadcastSchedules(); // drop a schedule for a dead PTY
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'pty:exit', id }));
        });
        attached.set(id, attachPtyToWs(id, entry, ws));
        ws.send(JSON.stringify({ type: 'pty:created', id }));
        break;
      }
      case 'pty:input': { const e = ptys.get(msg.id); if (e) e.proc.write(msg.data); break; }
      case 'schedule:create': {
        // Arm a delayed Enter for a live PTY; echoes back via schedule:state.
        if (msg.ptyId && ptys.has(msg.ptyId) && typeof msg.fireAt === 'number') {
          armSchedule(msg.ptyId, msg.fireAt);
          broadcastSchedules();
        }
        break;
      }
      case 'schedule:cancel': {
        if (clearSchedule(msg.ptyId)) broadcastSchedules();
        break;
      }
      case 'pty:resize': {
        const e = ptys.get(msg.id);
        if (e) { e.cols = msg.cols; e.rows = msg.rows; e.proc.resize(msg.cols, msg.rows); }
        break;
      }
      case 'pty:destroy': {
        const e = ptys.get(msg.id);
        if (e) { e.proc.kill(); ptys.delete(msg.id); }
        if (attached.has(msg.id)) { attached.get(msg.id)(); attached.delete(msg.id); }
        if (clearSchedule(msg.id)) broadcastSchedules();
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

// ── Self-update ──────────────────────────────────────────────────────────────
// Meowtrix is normally a git clone in ~/.meowtrix/app (see install.sh), so an
// update is just: `git pull --ff-only`, reinstall deps if the lockfile/manifest
// moved, then exit so the supervisor (launchd/systemd) relaunches on the new
// code. We only auto-exit when actually supervised (MEOWTRIX_SUPERVISED=1, set
// by `install.sh --service`); otherwise nothing would bring us back up, so we
// still pull but tell the client to restart by hand.
//
// The check (a background `git fetch` + compare) only *notifies*; the pull and
// restart are user-triggered (palette / banner) because a restart kills every
// in-memory PTY — the user picks the moment. Same no-auth stance as the rest of
// the app: anyone who can reach this server already has a shell here, so a
// remote-triggered pull is no new capability; the background check can still be
// turned off via the `autoUpdate` setting.
const APP_ROOT = __dirname;
const IS_SUPERVISED = process.env.MEOWTRIX_SUPERVISED === '1';
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000; // hourly background check
let lastUpdateInfo = null; // cached result of the most recent check

function appGit(args, opts = {}) {
  return new Promise((resolve) => {
    execFile('git', ['-C', APP_ROOT, ...args], { maxBuffer: 4 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => resolve({
        ok: !err,
        stdout: (stdout || '').toString().trim(),
        stderr: (stderr || (err && err.message) || '').toString().trim(),
      }));
  });
}

function appVersion() {
  try { return require('./package.json').version || ''; } catch { return ''; }
}

// Inspect the local clone against its upstream. Does a `git fetch` first (unless
// fetch:false) and compares HEAD to the upstream tracking ref. Degrades cleanly
// when the install isn't a git checkout or has no upstream — `updateAvailable`
// just stays false and `error` explains why.
async function checkForUpdate({ fetch = true } = {}) {
  const info = {
    isRepo: false, supervised: IS_SUPERVISED, updateAvailable: false,
    behind: 0, ahead: 0, version: appVersion(), local: '', remote: '', error: null,
  };
  const head = await appGit(['rev-parse', 'HEAD']);
  if (!head.ok) { info.error = 'not a git checkout'; lastUpdateInfo = info; return info; }
  info.isRepo = true;
  info.local = head.stdout;
  if (fetch) {
    const f = await appGit(['fetch', '--quiet']);
    if (!f.ok) { info.error = f.stderr || 'git fetch failed'; lastUpdateInfo = info; return info; }
  }
  const up = await appGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!up.ok) { info.error = 'no upstream tracking branch'; lastUpdateInfo = info; return info; }
  const counts = await appGit(['rev-list', '--left-right', '--count', `HEAD...${up.stdout}`]);
  if (counts.ok) {
    const [ahead, behind] = counts.stdout.split(/\s+/).map(Number);
    info.ahead = ahead || 0;
    info.behind = behind || 0;
  }
  const remote = await appGit(['rev-parse', up.stdout]);
  if (remote.ok) info.remote = remote.stdout;
  info.updateAvailable = info.behind > 0;
  lastUpdateInfo = info;
  return info;
}

function updateStatePayload() { return { type: 'update:state', info: lastUpdateInfo }; }

function broadcastUpdate() {
  const payload = JSON.stringify(updateStatePayload());
  for (const c of sessionClients) if (c.readyState === c.OPEN) c.send(payload);
}

// Pull the pending update, reinstalling deps only when package.json/the lockfile
// changed, then (if supervised) signal the caller to exit so the new code loads.
async function applyUpdate() {
  const up = await appGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!up.ok) return { ok: false, output: 'no upstream tracking branch' };
  // Only act when there's actually something to pull — otherwise a supervised
  // server would exit (and relaunch) for no reason. Don't re-fetch here; the
  // caller just checked, and we want to apply exactly what was reported.
  const counts = await appGit(['rev-list', '--count', `HEAD..${up.stdout}`]);
  if (!counts.ok || Number(counts.stdout) === 0) return { ok: false, output: 'already up to date' };
  // Does the pending update touch dependencies? Check before pulling.
  const depDiff = await appGit(['diff', '--name-only', 'HEAD', up.stdout, '--', 'package.json', 'package-lock.json']);
  const depsChanged = depDiff.ok && depDiff.stdout.length > 0;

  const pull = await appGit(['pull', '--ff-only']);
  if (!pull.ok) return { ok: false, output: pull.stderr || 'git pull failed' };
  let output = pull.stdout;

  if (depsChanged) {
    output += '\nReinstalling dependencies…';
    const npm = await new Promise((resolve) => {
      execFile('npm', ['install', '--omit=dev'], { cwd: APP_ROOT, maxBuffer: 32 * 1024 * 1024 },
        (err, _out, stderr) => resolve({ ok: !err, stderr: (stderr || (err && err.message) || '').toString() }));
    });
    if (!npm.ok) return { ok: false, output: `${output}\nDependency install failed: ${npm.stderr}` };
  }

  await checkForUpdate({ fetch: false }); // refresh cache → no longer "behind"
  broadcastUpdate();
  return { ok: true, output, depsChanged, restarting: IS_SUPERVISED };
}

app.get('/api/update/check', async (req, res) => {
  const info = await checkForUpdate({ fetch: true });
  res.json(info);
  broadcastUpdate();
});

app.post('/api/update/apply', async (req, res) => {
  const result = await applyUpdate();
  res.json(result);
  // Exit only when supervised, and only after the response has had a moment to
  // flush — the supervisor relaunches us on the freshly pulled code.
  if (result.ok && IS_SUPERVISED) setTimeout(() => process.exit(0), 500);
});

// Background check: shortly after boot, then hourly. Honors the autoUpdate
// setting (re-read each tick so toggling it doesn't need a restart).
function startUpdateChecks() {
  const tick = async () => {
    if (readSettings().autoUpdate === false) return;
    try { await checkForUpdate({ fetch: true }); broadcastUpdate(); } catch {}
  };
  setTimeout(tick, 10000);
  setInterval(tick, UPDATE_CHECK_INTERVAL).unref();
}
startUpdateChecks();

// ── Network binding ──────────────────────────────────────────────────────────
// A Meowtrix server hands whoever can reach it a real shell on the host, so by
// default we bind to loopback only (127.0.0.1) — reachable from the host itself
// (e.g. via an SSH tunnel) but invisible to the rest of the network. Opt in to
// LAN/remote exposure with `--network`/`-n` (binds 0.0.0.0) or a specific
// address via `--host <addr>` or the HOST env var.
function resolveHost() {
  const argv = process.argv.slice(2);
  if (argv.includes('--network') || argv.includes('-n')) return '0.0.0.0';
  const hostFlag = argv.indexOf('--host');
  if (hostFlag !== -1 && argv[hostFlag + 1]) return argv[hostFlag + 1];
  return process.env.HOST || '127.0.0.1';
}

const PORT = process.env.PORT || 9123;
const HOST = resolveHost();
const isLoopback = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
server.listen(PORT, HOST, () => {
  console.log(`Meowtrix running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (isLoopback) {
    console.log('🔒 Bound to localhost only — not reachable from the network.');
    console.log('   Tunnel in with:  ssh -L ' + PORT + ':localhost:' + PORT + ' <user>@<host>');
    console.log('   Expose on the network with:  meowtrix --network   (or HOST=0.0.0.0)');
  } else {
    console.log('⚠️  Reachable over the network — anyone who can connect gets a shell on this host.');
    console.log('   Only do this on a trusted network or behind authentication.');
  }
});

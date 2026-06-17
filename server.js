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

// ── Settings persistence ─────────────────────────────────────────────────────
const SETTINGS_FILE = path.join(os.homedir(), '.meowtrix', 'settings.json');
const DEFAULT_SETTINGS = {
  theme: 'dark',
  termFontSize: 13,
  termFontFamily: 'Cascadia Code, JetBrains Mono, Menlo, Monaco, monospace',
  termScrollback: 10000,
  shell: process.env.SHELL || '/bin/bash',
  browserHomepage: 'https://google.com',
};

function readSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
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

// ── Proxy: fetch server-side, strip X-Frame-Options / CSP frame directives ──
const STRIP_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
]);

app.get('/proxy', (req, res) => {
  const target = req.query.url;
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
      return res.redirect(`/proxy?url=${encodeURIComponent(next)}`);
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
          return `${attr}=${q}/proxy?url=${encodeURIComponent(abs)}${q}`;
        });
        res.send(body);
      });
    } else {
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', err => res.status(502).send(`Proxy error: ${err.message}`));
});

// ── PTY / WebSocket ──────────────────────────────────────────────────────────
const ptys = new Map();

wss.on('connection', (ws) => {
  const wsPtys = new Set();

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'pty:create': {
        const id = msg.id || uuidv4();
        const shell = readSettings().shell || process.env.SHELL || (os.platform() === 'win32' ? 'cmd.exe' : 'bash');
        const ptyEnv = { ...process.env };
        delete ptyEnv.npm_config_prefix;
        const ptyProc = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols: msg.cols || 80,
          rows: msg.rows || 24,
          cwd: process.env.HOME || process.cwd(),
          env: ptyEnv,
        });
        ptys.set(id, ptyProc);
        wsPtys.add(id);
        ptyProc.onData(data => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'pty:data', id, data }));
        });
        ptyProc.onExit(() => {
          ptys.delete(id); wsPtys.delete(id);
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'pty:exit', id }));
        });
        ws.send(JSON.stringify({ type: 'pty:created', id }));
        break;
      }
      case 'pty:input': { const p = ptys.get(msg.id); if (p) p.write(msg.data); break; }
      case 'pty:resize': { const p = ptys.get(msg.id); if (p) p.resize(msg.cols, msg.rows); break; }
      case 'pty:destroy': {
        const p = ptys.get(msg.id);
        if (p) { p.kill(); ptys.delete(msg.id); wsPtys.delete(msg.id); }
        break;
      }
    }
  });

  ws.on('close', () => {
    wsPtys.forEach(id => { const p = ptys.get(id); if (p) { p.kill(); ptys.delete(id); } });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Meowtrix running at http://0.0.0.0:${PORT}`);
});

#!/usr/bin/env node

// Zero-dependency static server for the overlay call-out animation review site.
// Usage: node serve.js [--port 8124] [--open]   (or PORT=8124 node serve.js)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const SITE_DIR = path.resolve(__dirname, '../site');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const args = process.argv.slice(2);
const portArg = args.findIndex(a => a === '-p' || a === '--port');
let port = parseInt(portArg >= 0 ? args[portArg + 1] : process.env.PORT || '8124', 10);

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(SITE_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(SITE_DIR + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  fs.createReadStream(filePath).pipe(res);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${port} is in use, trying ${port + 1}...`);
    port += 1;
    server.listen(port, '127.0.0.1');
  } else {
    throw err;
  }
});

server.on('listening', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log('\n======================================================');
  console.log('🐾 Meowtrix Overlay Call-out Animation Review');
  console.log(`🌐 Local URL:  ${url}`);
  console.log(`📁 Directory:  ${SITE_DIR}`);
  console.log('======================================================\n');
  console.log('Press Ctrl+C to stop the server.\n');

  if (args.includes('--open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${opener} ${url}`);
  }
});

server.listen(port, '127.0.0.1');

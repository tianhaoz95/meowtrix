#!/usr/bin/env node

// Standalone Zero-Dependency Static File Server for Meowtrix Style Redesign
const http = require('http');
const fs = require('fs');
const path = require('path');

const SITE_DIR = path.resolve(__dirname, '../site');
const DEFAULT_PORT = parseInt(process.env.PORT || '8420', 10);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function parseArgs() {
  const args = process.argv.slice(2);
  let port = DEFAULT_PORT;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-p' || args[i] === '--port') && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    }
  }
  return { port };
}

function startServer(initialPort) {
  let port = initialPort;

  const server = http.createServer((req, res) => {
    // Basic CORS & security headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    let filePath = path.join(SITE_DIR, safePath);

    fs.stat(filePath, (err, stats) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found: ' + reqPath);
        return;
      }

      if (stats.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      fs.readFile(filePath, (readErr, content) => {
        if (readErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('500 Internal Server Error');
          return;
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      });
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying ${port + 1}...`);
      port++;
      server.listen(port);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log('\n======================================================');
    console.log('🐾 Meowtrix Style Redesign Visualizer is Live!');
    console.log('======================================================');
    console.log(`\n  Local URL:   http://localhost:${port}`);
    console.log(`  Network URL: http://127.0.0.1:${port}`);
    console.log(`  Directory:   ${SITE_DIR}\n`);
    console.log('Features:');
    console.log('  • 50 Modern Candidate Designs (Light & Dark Only)');
    console.log('  • Zero 3D Skeuomorphism & Flat Clean Surfaces');
    console.log('  • Interactive Tiling Panes, Live Terminal & Code Editor');
    console.log('  • Side-by-Side Split Comparison Tool');
    console.log('  • 5 Flat SVG Logo Options & Flat Vector Icons');
    console.log('  • One-click CSS Generator for style.css');
    console.log('\nPress Ctrl+C to stop the server.\n');
  });
}

const { port } = parseArgs();
startServer(port);

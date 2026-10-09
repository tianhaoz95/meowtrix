// ==============================================================================
// codesign-service.js — CoDesign: living-spec review loop
// ==============================================================================
// An agent writes an HTML design spec to `<project>/.codesign/spec.html` with its
// ordinary file tools. A CoDesign tab renders it (sandboxed), the human drops
// comment pins on it, then either sends the comments back or signs off. The
// agent learns the outcome by running `mtx review`, which long-polls
// `/api/codesign/wait` here.
//
// Everything durable lives in the project, not in memory:
//   .codesign/spec.html    the spec (written by the agent)
//   .codesign/review.json  revision counter, comments, and the latest decision
// so a server restart (or committing .codesign/ to git) loses nothing. Only the
// set of currently-blocked `mtx review` callers is in-memory.
//
// Revisions: every time spec.html's content changes, the revision bumps and the
// previous decision is cleared — a decision always refers to one revision.
//
// Security: the spec is agent-written HTML (often pulling CDN scripts), and the
// Meowtrix origin can write files and drive PTYs. So the spec is served with a
// `Content-Security-Policy: sandbox` header (and the tab's iframe is sandboxed
// without allow-same-origin): it runs in an opaque origin and can't read the
// Meowtrix APIs. The inspector/annotator is injected into the page and talks to
// the tab via postMessage instead of reaching into the iframe's DOM.
// ==============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const SPEC_DIRNAME = '.codesign';
const SPEC_FILE = 'spec.html';
const REVIEW_FILE = 'review.json';
const INSPECTOR_PATH = path.join(__dirname, 'public', 'codesign-inspector.js');
const WAIT_MAX_SECONDS = 120;

// Directive list shared by the response header and the tab's iframe attribute.
// Deliberately no allow-same-origin: that would hand the page the Meowtrix origin.
const SANDBOX_FLAGS = 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
};

// ── Paths & persistence ─────────────────────────────────────────────────────

// Project dirs arrive from the client / CLI; require absolute and normalize so
// one project always maps to one key.
function normDir(dir) {
  if (typeof dir !== 'string' || !dir.trim()) return null;
  const d = path.resolve(dir.trim());
  return path.isAbsolute(d) ? d : null;
}

const codesignDir = (dir) => path.join(dir, SPEC_DIRNAME);
const specPath = (dir) => path.join(codesignDir(dir), SPEC_FILE);
const reviewPath = (dir) => path.join(codesignDir(dir), REVIEW_FILE);

// The spec's URL embeds the project dir (base64url) so relative asset URLs in
// the spec (e.g. `assets/logo.svg`) resolve to files beside it in .codesign/.
const encodeDir = (dir) => Buffer.from(dir, 'utf8').toString('base64url');
const decodeDir = (token) => { try { return normDir(Buffer.from(token, 'base64url').toString('utf8')); } catch { return null; } };

function emptyReview() {
  return { revision: 0, specHash: null, status: 'drafting', decision: null, nextComment: 1, comments: [], history: [] };
}

function readReview(dir) {
  try {
    const r = JSON.parse(fs.readFileSync(reviewPath(dir), 'utf8'));
    return { ...emptyReview(), ...r, comments: Array.isArray(r.comments) ? r.comments : [], history: Array.isArray(r.history) ? r.history : [] };
  } catch {
    return emptyReview();
  }
}

function writeReview(dir, review) {
  fs.mkdirSync(codesignDir(dir), { recursive: true });
  const tmp = reviewPath(dir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(review, null, 2));
  fs.renameSync(tmp, reviewPath(dir));
}

function readSpec(dir) {
  try { return fs.readFileSync(specPath(dir)); } catch { return null; }
}

// Reconcile review.json with the spec on disk: a content change starts a new
// revision and clears the old decision. Called on every access (and by the file
// watcher) so edits made while the server was down are still picked up.
function syncRevision(dir) {
  const review = readReview(dir);
  const buf = readSpec(dir);
  if (!buf) return { review, exists: false };
  const hash = crypto.createHash('sha1').update(buf).digest('hex');
  if (hash !== review.specHash) {
    review.specHash = hash;
    review.revision += 1;
    review.decision = null;
    review.status = 'in-review';
    review.history.push({ revision: review.revision, at: new Date().toISOString() });
    if (review.history.length > 200) review.history = review.history.slice(-200);
    writeReview(dir, review);
    return { review, exists: true, changed: true };
  }
  return { review, exists: true };
}

// ── Comment selector-path formatting for the agent ──────────────────────────

function formatComment(c) {
  const lines = [`[${c.id}] ${c.comment.trim().replace(/\n/g, '\n      ')}`];
  if (c.selector) lines.push(`      element: ${c.selector}${c.tag ? `  <${c.tag}>` : ''}`);
  if (c.text) lines.push(`      text:    "${c.text}"`);
  if (c.device) lines.push(`      viewed:  ${c.device}${c.viewportW ? ` (${c.viewportW}px wide)` : ''}`);
  return lines.join('\n');
}

function decisionText(dir, review) {
  const spec = path.join(SPEC_DIRNAME, SPEC_FILE);
  const d = review.decision;
  if (d.type === 'approved') {
    const note = d.note ? `\nReviewer note: ${d.note}` : '';
    const open = review.comments.filter(c => c.status === 'open' && c.sent);
    const tail = open.length ? `\n\n(${open.length} earlier comment(s) remain unresolved; run \`mtx feedback\` to see them.)` : '';
    return `APPROVED — revision ${review.revision} of ${spec} in ${dir} was signed off.${note}${tail}\n`;
  }
  const items = review.comments.filter(c => d.commentIds.includes(c.id));
  const note = d.note ? `Reviewer note: ${d.note}\n\n` : '';
  return `CHANGES REQUESTED on revision ${review.revision} of ${spec} in ${dir} — ${items.length} comment(s):\n\n` +
    note +
    items.map(formatComment).join('\n\n') +
    `\n\nNext: edit ${spec} to address these, run \`mtx resolve <id>...\` for each one handled, then \`mtx review\` again.\n`;
}

// ── Service ──────────────────────────────────────────────────────────────────

function mountCodesignRoutes(app, { broadcast }) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false })); // the sh-based `mtx` posts forms

  // Per-dir in-memory state: blocked `mtx review` callers and the file watcher.
  const projects = new Map(); // dir -> { waiters: Set<fn>, watching: bool }

  function project(dir) {
    let p = projects.get(dir);
    if (!p) { p = { waiters: new Set(), watching: false }; projects.set(dir, p); }
    if (!p.watching) {
      p.watching = true;
      // watchFile (stat polling) rather than fs.watch: it works before the
      // file/dir exists and survives editors that replace the file on save.
      fs.watchFile(specPath(dir), { interval: 600 }, () => {
        const r = syncRevision(dir);
        if (r.changed || !r.exists) notify(dir);
      });
    }
    return p;
  }

  function notify(dir) {
    broadcast({ type: 'codesign:update', dir });
  }

  function statePayload(dir) {
    const { review, exists } = syncRevision(dir);
    const p = project(dir);
    let mtime = null;
    try { mtime = fs.statSync(specPath(dir)).mtimeMs; } catch {}
    return {
      dir,
      exists,
      specPath: specPath(dir),
      specUrl: `/codesign-spec/${encodeDir(dir)}/${SPEC_FILE}`,
      sandbox: SANDBOX_FLAGS,
      revision: review.revision,
      status: review.status,
      decision: review.decision,
      comments: review.comments,
      history: review.history.slice(-20),
      agentWaiting: p.waiters.size > 0,
      mtime,
    };
  }

  // Wake blocked `mtx review` callers if a decision is pending for them.
  function flushWaiters(dir) {
    const p = project(dir);
    for (const w of [...p.waiters]) w();
  }

  function dirFrom(req) {
    return normDir(req.query.dir ?? req.body?.dir);
  }

  function withDir(handler) {
    return (req, res) => {
      const dir = dirFrom(req);
      if (!dir) return res.status(400).json({ error: 'dir (absolute path) required' });
      try { handler(dir, req, res); }
      catch (e) { res.status(500).json({ error: e.message }); }
    };
  }

  router.get('/state', withDir((dir, req, res) => res.json(statePayload(dir))));

  // Ask the active browser session to show a CoDesign tab for `dir` (opening one
  // if none is open). Used by `mtx spec` / `mtx review`, which usually run inside
  // an agent's tool subprocess where OSC sequences never reach the terminal.
  router.post('/open', withDir((dir, req, res) => {
    project(dir);
    broadcast({ type: 'codesign:open', dir });
    res.json({ ok: true, dir, exists: !!readSpec(dir) });
  }));

  // Add a comment pin. Comments start unsent; "Send feedback" delivers them.
  router.post('/comments', withDir((dir, req, res) => {
    const b = req.body || {};
    const text = typeof b.comment === 'string' ? b.comment.trim() : '';
    if (!text) return res.status(400).json({ error: 'comment required' });
    const { review } = syncRevision(dir);
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
    const num = (v) => (Number.isFinite(+v) ? +v : null);
    const c = {
      id: 'c' + review.nextComment++,
      comment: text.slice(0, 4000),
      selector: str(b.selector, 500),
      tag: str(b.tag, 40),
      text: str(b.text, 200),
      ox: num(b.ox), oy: num(b.oy),   // offset within the element, 0–1
      x: num(b.x), y: num(b.y),       // document coords, fallback anchor
      device: str(b.device, 20),
      viewportW: num(b.viewportW),
      revision: review.revision,
      status: 'open',
      sent: false,
      createdAt: new Date().toISOString(),
    };
    review.comments.push(c);
    writeReview(dir, review);
    notify(dir);
    res.json({ ok: true, comment: c });
  }));

  router.patch('/comments/:id', withDir((dir, req, res) => {
    const { review } = syncRevision(dir);
    const c = review.comments.find(x => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'no such comment' });
    if (typeof req.body?.comment === 'string' && req.body.comment.trim()) c.comment = req.body.comment.trim().slice(0, 4000);
    writeReview(dir, review);
    notify(dir);
    res.json({ ok: true, comment: c });
  }));

  router.delete('/comments/:id', withDir((dir, req, res) => {
    const { review } = syncRevision(dir);
    const before = review.comments.length;
    review.comments = review.comments.filter(x => x.id !== req.params.id);
    if (review.comments.length === before) return res.status(404).json({ error: 'no such comment' });
    writeReview(dir, review);
    notify(dir);
    res.json({ ok: true });
  }));

  // Resolve or reopen comments. Used by the tab and by `mtx resolve`.
  router.post('/resolve', withDir((dir, req, res) => {
    let ids = req.body?.ids;
    if (typeof ids === 'string') ids = ids.split(/[\s,]+/);
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
    const reopen = req.body?.reopen === true || req.body?.reopen === 'true' || req.body?.reopen === '1';
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 2000) : null;
    const { review } = syncRevision(dir);
    const done = [], missing = [];
    for (const id of ids.filter(Boolean)) {
      const c = review.comments.find(x => x.id === id);
      if (!c) { missing.push(id); continue; }
      if (reopen) { c.status = 'open'; delete c.resolvedAt; delete c.resolution; }
      else { c.status = 'resolved'; c.resolvedAt = new Date().toISOString(); if (note) c.resolution = note; }
      done.push(id);
    }
    writeReview(dir, review);
    notify(dir);
    if (req.body?.format === 'text') {
      const verb = reopen ? 'reopened' : 'resolved';
      return res.type('text/plain').send(
        (done.length ? `${verb} ${done.join(' ')}\n` : '') +
        (missing.length ? `no such comment: ${missing.join(' ')}\n` : ''));
    }
    res.json({ ok: true, updated: done, missing });
  }));

  // The reviewer's decision on the current revision: request changes (sends all
  // unsent comments) or approve. Wakes any blocked `mtx review`.
  router.post('/decision', withDir((dir, req, res) => {
    const type = req.body?.type;
    if (type !== 'approved' && type !== 'changes') return res.status(400).json({ error: 'type must be approved|changes' });
    const { review, exists } = syncRevision(dir);
    if (!exists) return res.status(409).json({ error: 'no spec to review yet' });
    const unsent = review.comments.filter(c => c.status === 'open' && !c.sent);
    if (type === 'changes' && !unsent.length) return res.status(400).json({ error: 'no unsent comments to send' });
    unsent.forEach(c => { c.sent = true; c.sentAt = new Date().toISOString(); });
    review.decision = {
      type,
      revision: review.revision,
      commentIds: unsent.map(c => c.id),
      note: typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 2000) : null,
      at: new Date().toISOString(),
      delivered: false,
    };
    review.status = type === 'approved' ? 'approved' : 'changes-requested';
    writeReview(dir, review);
    notify(dir);
    flushWaiters(dir);
    res.json({ ok: true, decision: review.decision });
  }));

  // Non-blocking comment listing for the agent (`mtx feedback`).
  router.get('/feedback', withDir((dir, req, res) => {
    const { review, exists } = syncRevision(dir);
    const all = req.query.all === '1';
    const items = review.comments.filter(c => c.sent && (all || c.status === 'open'));
    if (req.query.format !== 'text') return res.json({ revision: review.revision, status: review.status, comments: items });
    res.type('text/plain');
    if (!exists) return res.send(`No spec yet at ${specPath(dir)}.\n`);
    if (!items.length) return res.send(`No ${all ? '' : 'open '}comments on ${SPEC_DIRNAME}/${SPEC_FILE} (revision ${review.revision}, status: ${review.status}).\n`);
    res.send(`${items.length} ${all ? '' : 'open '}comment(s) on ${SPEC_DIRNAME}/${SPEC_FILE} (revision ${review.revision}, status: ${review.status}):\n\n` +
      items.map(c => formatComment(c) + (c.status === 'resolved' ? '\n      (resolved)' : '')).join('\n\n') + '\n');
  }));

  // Long-poll for the reviewer's decision on the current revision. Returns
  // immediately if one is waiting (an approval always is; a change request only
  // until it's been delivered once), else holds up to `timeout` seconds.
  // Response header X-Codesign-Event: approved | changes | timeout | missing.
  router.get('/wait', withDir((dir, req, res) => {
    const timeout = Math.max(1, Math.min(WAIT_MAX_SECONDS, parseInt(req.query.timeout, 10) || 50));
    const asText = req.query.format === 'text';
    const p = project(dir);
    let finished = false;

    const reply = (event, body) => {
      res.setHeader('X-Codesign-Event', event);
      if (asText) res.type('text/plain').send(body.text);
      else res.json({ event, ...body });
    };

    const tryDeliver = () => {
      const { review, exists } = syncRevision(dir);
      if (!exists) {
        reply('missing', { text: `No spec at ${specPath(dir)}. Write the design there first.\n` });
        return true;
      }
      const d = review.decision;
      if (!d || d.revision !== review.revision) return false;
      if (d.type === 'changes' && d.delivered) return false;
      if (!d.delivered) { d.delivered = true; writeReview(dir, review); }
      const comments = review.comments.filter(c => d.commentIds.includes(c.id));
      reply(d.type, { text: decisionText(dir, review), revision: review.revision, decision: d, comments });
      return true;
    };

    if (tryDeliver()) return;

    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      p.waiters.delete(waiter);
      notify(dir); // agentWaiting changed
    };
    const waiter = () => {
      if (finished) return;
      if (tryDeliver()) done();
    };
    const timer = setTimeout(() => {
      if (finished) return;
      done();
      const { review } = syncRevision(dir);
      reply('timeout', { text: `No decision yet on revision ${review.revision} (status: ${review.status}).\n`, revision: review.revision });
    }, timeout * 1000);
    req.on('close', done);
    p.waiters.add(waiter);
    notify(dir);
  }));

  app.use('/api/codesign', router);

  // Serve the spec (and sibling assets under .codesign/) sandboxed. The HTML
  // gets the inspector injected so the tab can annotate it over postMessage.
  app.get(/^\/codesign-spec\/([A-Za-z0-9_-]+)\/(.*)$/, (req, res) => {
    const dir = decodeDir(req.params[0]);
    if (!dir) return res.status(400).send('bad project');
    const root = codesignDir(dir);
    const rel = req.params[1] || SPEC_FILE;
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) return res.status(403).send('forbidden');
    if (path.basename(file) === REVIEW_FILE) return res.status(404).send('not found');

    res.setHeader('Content-Security-Policy', `sandbox ${SANDBOX_FLAGS}`);
    res.setHeader('Cache-Control', 'no-store');
    // The sandboxed page has an opaque origin; let it load its own assets
    // (module scripts, fonts and fetch() need CORS).
    res.setHeader('Access-Control-Allow-Origin', '*');

    let buf;
    try { buf = fs.readFileSync(file); }
    catch {
      if (rel !== SPEC_FILE) return res.status(404).send('not found');
      buf = Buffer.from('<!doctype html><title>No spec yet</title>');
    }
    const ext = path.extname(file).toLowerCase();
    res.type(MIME[ext] || 'application/octet-stream');
    if (rel !== SPEC_FILE) return res.send(buf);

    let inspector = '';
    try { inspector = fs.readFileSync(INSPECTOR_PATH, 'utf8'); } catch {}
    const tag = `<script data-codesign-inspector>${inspector.replace(/<\/script/gi, '<\\/script')}</script>`;
    let html = buf.toString('utf8');
    // Inject as early as possible so the inspector's listeners precede the
    // page's own; it defers DOM work until the document is ready.
    if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, m => m + tag);
    else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, m => m + tag);
    else html = tag + html;
    res.send(html);
  });

  return { SANDBOX_FLAGS };
}

module.exports = { mountCodesignRoutes };

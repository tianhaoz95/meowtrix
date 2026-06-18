// ── Serverless demo mode ─────────────────────────────────────────────────────
// Loaded FIRST (before ws.js) so window.DEMO_MODE is set before ws.js decides
// whether to open a real WebSocket. When active, there is no Node server:
//   • PTYs are replaced by an in-browser JavaScript REPL (demoBackend below),
//     speaking the exact same pty:*/session:* message shapes ws.js expects.
//   • /api/settings and /api/session are served from localStorage via a fetch
//     shim, so the rest of the app (app.js, settings.js) is untouched.
//
// Activated by the `?demo` query param (see demo.sh, which serves public/
// statically and opens the page with it).
window.DEMO_MODE = /[?&]demo\b/.test(location.search);

if (window.DEMO_MODE) {
  // ── localStorage-backed REST shim ──────────────────────────────────────────
  const DEFAULT_SETTINGS = {
    theme: 'dark',
    termFontSize: 13,
    termFontFamily: 'Cascadia Code, JetBrains Mono, Menlo, Monaco, monospace',
    termScrollback: 10000,
    shell: '/bin/bash (demo: in-browser JS REPL)',
    browserHomepage: '',
  };
  const lsGet = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const json = (data) => new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });

  function demoApi(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    const path = url.split('?')[0];
    if (path === '/api/settings') {
      if (method === 'POST') {
        const merged = { ...DEFAULT_SETTINGS, ...lsGet('demo.settings', {}), ...body };
        lsSet('demo.settings', merged);
        return Promise.resolve(json(merged));
      }
      return Promise.resolve(json({ ...DEFAULT_SETTINGS, ...lsGet('demo.settings', {}) }));
    }
    if (path === '/api/settings/reset') {
      lsSet('demo.settings', {});
      return Promise.resolve(json({ ...DEFAULT_SETTINGS }));
    }
    if (path === '/api/session') {
      if (method === 'POST') { lsSet('demo.session', body); return Promise.resolve(json({ ok: true })); }
      return Promise.resolve(json(lsGet('demo.session', null)));
    }
    return Promise.resolve(new Response('null', { status: 404 }));
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) =>
    (typeof url === 'string' && url.startsWith('/api/')) ? demoApi(url, opts) : realFetch(url, opts);

  // beforeunload uses sendBeacon to flush the final layout — persist it locally.
  const realBeacon = navigator.sendBeacon?.bind(navigator);
  navigator.sendBeacon = (url, data) => {
    if (typeof url === 'string' && url === '/api/session') {
      // Blob body → read synchronously isn't possible; sendBeacon is fire-and-
      // forget, but saveSessionState already persisted on the debounced path, so
      // dropping the beacon here is fine. Swallow it to avoid a doomed request.
      return true;
    }
    return realBeacon ? realBeacon(url, data) : false;
  };

  // ── In-browser JS REPL backend ─────────────────────────────────────────────
  // Plays the role of the PTY server for ws.js: send() receives the client's
  // pty:*/session:* messages, and we emit pty:data/pty:exit/session:state back
  // through the dispatch callback ws.js hands us in connect().
  window.demoBackend = (() => {
    let dispatch = () => {};
    let activeTabId = null;
    const sessions = new Map(); // ptyId -> REPL instance
    let currentOut = null;       // where console.* during eval is routed

    const emit = (msg) => queueMicrotask(() => dispatch(msg));

    // Mirror console output into the REPL that is currently evaluating.
    ['log', 'info', 'warn', 'error', 'debug'].forEach((m) => {
      const orig = console[m].bind(console);
      console[m] = (...args) => {
        orig(...args);
        if (currentOut) currentOut(args.map(inspect).join(' '));
      };
    });

    const C = { prompt: '\x1b[36m', err: '\x1b[31m', dim: '\x1b[90m', reset: '\x1b[0m' };

    function inspect(v, depth = 0, seen = new Set()) {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      const t = typeof v;
      if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
      if (t === 'string') return depth === 0 ? v : JSON.stringify(v);
      if (t === 'symbol') return v.toString();
      if (t === 'function') return `\x1b[35m[Function: ${v.name || 'anonymous'}]${C.reset}`;
      if (v instanceof Error) return `${v.name}: ${v.message}`;
      if (depth > 2) return Array.isArray(v) ? '[Array]' : '[Object]';
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
      try {
        if (Array.isArray(v)) return '[ ' + v.map((x) => inspect(x, depth + 1, seen)).join(', ') + ' ]';
        if (v instanceof Map) return `Map(${v.size}) { ` + [...v].map(([k, val]) => `${inspect(k, depth + 1, seen)} => ${inspect(val, depth + 1, seen)}`).join(', ') + ' }';
        if (v instanceof Set) return `Set(${v.size}) { ` + [...v].map((x) => inspect(x, depth + 1, seen)).join(', ') + ' }';
        const entries = Object.entries(v).map(([k, val]) => `${k}: ${inspect(val, depth + 1, seen)}`);
        return entries.length ? '{ ' + entries.join(', ') + ' }' : '{}';
      } catch { return String(v); }
      finally { seen.delete(v); }
    }

    // A single REPL session bound to one ptyId. Implements its own line editor
    // (echo, cursor, history) since there is no PTY doing cooked-mode for us.
    function makeRepl(id) {
      let line = '', cursor = 0;
      const history = [];
      let histIdx = 0;
      const write = (s) => emit({ type: 'pty:data', id, data: s });
      const writeln = (s) => write(s + '\r\n');
      const prompt = () => write(`${C.prompt}js>${C.reset} `);

      function banner() {
        writeln(`${C.dim}┌─────────────────────────────────────────────┐${C.reset}`);
        writeln(`${C.dim}│${C.reset}  🐾 Meowtrix demo — in-browser JavaScript REPL ${C.dim}│${C.reset}`);
        writeln(`${C.dim}└─────────────────────────────────────────────┘${C.reset}`);
        writeln(`${C.dim}No server, no shell — your input is eval()'d in the page.${C.reset}`);
        writeln(`${C.dim}Try:  1 + 1   ·   [1,2,3].map(x => x*2)   ·   await fetch(...)${C.reset}`);
        writeln(`${C.dim}Globals (x = 1) persist; up/down for history; Ctrl-C cancels.${C.reset}`);
        write('\r\n');
        prompt();
      }

      function redrawTail(removed) {
        // Re-render from the cursor to end of line after an insert/delete.
        const tail = line.slice(cursor);
        write(tail + (removed ? ' ' : ''));
        const back = tail.length + (removed ? 1 : 0);
        if (back) write('\x1b[D'.repeat(back));
      }

      function setLine(str) {
        if (cursor) write('\x1b[D'.repeat(cursor)); // to input start
        write('\x1b[K');                              // clear to end of line
        line = str; cursor = str.length;
        write(str);
      }

      function evaluate(code) {
        let result, threw = false;
        currentOut = (s) => writeln(s);
        try { result = (0, eval)(code); } catch (e) { threw = true; result = e; }
        currentOut = null;
        if (threw) { writeln(`${C.err}${result instanceof Error ? result.name + ': ' + result.message : inspect(result)}${C.reset}`); prompt(); return; }
        if (result instanceof Promise) {
          write(`${C.dim}<pending>${C.reset}\r\n`);
          result.then(
            (v) => { writeln(inspect(v)); prompt(); },
            (e) => { writeln(`${C.err}${e instanceof Error ? e.name + ': ' + e.message : inspect(e)}${C.reset}`); prompt(); },
          );
          return;
        }
        if (result !== undefined) writeln(inspect(result));
        prompt();
      }

      function submit() {
        write('\r\n');
        const code = line;
        line = ''; cursor = 0;
        if (code.trim()) { history.push(code); histIdx = history.length; evaluate(code); }
        else prompt();
      }

      function input(data) {
        let i = 0;
        while (i < data.length) {
          const c = data[i];
          if (c === '\x1b') {
            const seq = data.substr(i, 3);
            if (seq === '\x1b[A') { if (histIdx > 0) setLine(history[--histIdx]); i += 3; continue; }
            if (seq === '\x1b[B') { if (histIdx < history.length - 1) setLine(history[++histIdx]); else { histIdx = history.length; setLine(''); } i += 3; continue; }
            if (seq === '\x1b[C') { if (cursor < line.length) { write('\x1b[C'); cursor++; } i += 3; continue; }
            if (seq === '\x1b[D') { if (cursor > 0) { write('\x1b[D'); cursor--; } i += 3; continue; }
            i++; continue; // ignore other escape sequences
          }
          if (c === '\r' || c === '\n') { submit(); i++; continue; }
          if (c === '\x7f' || c === '\b') { // backspace
            if (cursor > 0) { line = line.slice(0, cursor - 1) + line.slice(cursor); cursor--; write('\b'); redrawTail(true); }
            i++; continue;
          }
          if (c === '\x03') { write('^C\r\n'); line = ''; cursor = 0; prompt(); i++; continue; } // Ctrl-C
          if (c === '\x0c') { write('\x1b[2J\x1b[H'); prompt(); write(line); cursor = line.length; i++; continue; } // Ctrl-L
          if (c < ' ') { i++; continue; } // ignore other control chars (incl. Tab)
          line = line.slice(0, cursor) + c + line.slice(cursor); cursor++;
          write(c); redrawTail(false);
          i++;
        }
      }

      return { input, banner };
    }

    function send(obj) {
      switch (obj.type) {
        case 'pty:create': {
          // Always start fresh: demo REPLs have no persistent backing process,
          // and any global state (x = 1) already lives on window across reloads.
          const repl = makeRepl(obj.id);
          sessions.set(obj.id, repl);
          repl.banner();
          break;
        }
        case 'pty:input': sessions.get(obj.id)?.input(obj.data); break;
        case 'pty:resize': break; // REPL doesn't care about geometry
        case 'pty:destroy': sessions.delete(obj.id); break;
        case 'session:claim': activeTabId = obj.tabId; emit({ type: 'session:state', activeTabId }); break;
        case 'session:sync': emit({ type: 'session:state', activeTabId }); break;
      }
    }

    return { connect: (onMessage) => { dispatch = onMessage; }, send };
  })();
}

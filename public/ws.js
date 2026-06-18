// ── WebSocket / PTY connection ──────────────────────────────────────────────
let ws = null;
let wsReady = false;
const ptyCallbacks = new Map(); // ptyId -> Terminal instance
const pendingPtys = []; // queued pty:create calls before WS is open

// Shared inbound-message dispatch — used by both the real WebSocket and the
// serverless demo backend (demo.js), which speaks the identical message shapes.
function handleWsMessage(msg) {
  if (msg.type === 'pty:data') {
    const term = ptyCallbacks.get(msg.id);
    if (term) term.write(msg.data);
  } else if (msg.type === 'pty:exit') {
    const term = ptyCallbacks.get(msg.id);
    if (term) term.write('\r\n\x1b[31m[process exited]\x1b[0m\r\n');
  } else if (msg.type === 'session:state') {
    if (typeof onSessionState === 'function') onSessionState(msg.activeTabId);
  }
}

function _onConnected() {
  wsReady = true;
  // Flush queued creates (e.g. after reconnect)
  while (pendingPtys.length) {
    const args = pendingPtys.shift();
    _sendCreate(...args);
  }
  if (typeof onWsConnected === 'function') onWsConnected();
}

function connectWs() {
  if (window.DEMO_MODE) {
    // Serverless demo: no WebSocket. demo.js stands in as the PTY server.
    demoBackend.connect(handleWsMessage);
    _onConnected();
    return;
  }

  ws = new WebSocket(`ws://${location.host}`);

  ws.addEventListener('open', _onConnected);

  ws.addEventListener('message', (e) => handleWsMessage(JSON.parse(e.data)));

  ws.addEventListener('close', () => {
    wsReady = false;
    // Reconnect after 1s
    setTimeout(connectWs, 1000);
  });
}

connectWs();

function wsSend(obj) {
  if (window.DEMO_MODE) {
    demoBackend.send(obj);
  } else if (wsReady) {
    ws.send(JSON.stringify(obj));
  }
}

function _sendCreate(id, cols, rows) {
  wsSend({ type: 'pty:create', id, cols, rows });
}

function createPty(id, term, cols, rows) {
  ptyCallbacks.set(id, term);
  if (wsReady) {
    _sendCreate(id, cols, rows);
  } else {
    pendingPtys.push([id, cols, rows]);
  }
}

function destroyPty(id) {
  ptyCallbacks.delete(id);
  wsSend({ type: 'pty:destroy', id });
}

// Called when this tab (re)takes the active session: re-grab every PTY stream.
// Reset each terminal first so the server's replayed scrollback paints cleanly
// instead of stacking on top of stale/frozen content.
function reconnectAllPtys() {
  ptyCallbacks.forEach((term, id) => {
    term.reset();
    if (wsReady) {
      _sendCreate(id, term.cols, term.rows);
    } else {
      pendingPtys.push([id, term.cols, term.rows]);
    }
  });
}

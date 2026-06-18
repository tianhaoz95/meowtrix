// ── WebSocket / PTY connection ──────────────────────────────────────────────
let ws = null;
let wsReady = false;
const ptyCallbacks = new Map(); // ptyId -> Terminal instance
const pendingPtys = []; // queued pty:create calls before WS is open

function connectWs() {
  ws = new WebSocket(`ws://${location.host}`);

  ws.addEventListener('open', () => {
    wsReady = true;
    // Flush queued creates (e.g. after reconnect)
    while (pendingPtys.length) {
      const args = pendingPtys.shift();
      _sendCreate(...args);
    }
    if (typeof onWsConnected === 'function') onWsConnected();
  });

  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'pty:data') {
      const term = ptyCallbacks.get(msg.id);
      if (term) term.write(msg.data);
    } else if (msg.type === 'pty:exit') {
      const term = ptyCallbacks.get(msg.id);
      if (term) term.write('\r\n\x1b[31m[process exited]\x1b[0m\r\n');
    } else if (msg.type === 'session:state') {
      if (typeof onSessionState === 'function') onSessionState(msg.activeTabId);
    }
  });

  ws.addEventListener('close', () => {
    wsReady = false;
    // Reconnect after 1s
    setTimeout(connectWs, 1000);
  });
}

connectWs();

function wsSend(obj) {
  if (wsReady) {
    ws.send(JSON.stringify(obj));
  }
}

function _sendCreate(id, cols, rows) {
  ws.send(JSON.stringify({ type: 'pty:create', id, cols, rows }));
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

// ── WebSocket / PTY connection ──────────────────────────────────────────────
let ws = null;
let wsReady = false;
const ptyCallbacks = new Map(); // ptyId -> Terminal instance
const pendingPtys = []; // queued pty:create calls before WS is open
const pendingRestoreFit = new Set(); // ptyIds whose next pty:data is the replay buffer

// Shared inbound-message dispatch — used by both the real WebSocket and the
// serverless demo backend (demo.js), which speaks the identical message shapes.
function handleWsMessage(msg) {
  if (msg.type === 'pty:data') {
    const term = ptyCallbacks.get(msg.id);
    if (term) {
      if (pendingRestoreFit.has(msg.id)) {
        // This is the replayed buffer (the terminal was just snapped to the
        // PTY's generation width by pty:created). Re-fit to the real pane only
        // after the buffer has finished rendering, so the reflow is clean.
        pendingRestoreFit.delete(msg.id);
        term.write(msg.data, () => { if (typeof onReplayDone === 'function') onReplayDone(msg.id); });
      } else {
        term.write(msg.data);
      }
    }
  } else if (msg.type === 'pty:created') {
    // On reconnect the server reports the PTY's current grid size before the
    // buffer; match it so the replay renders at the width that produced it.
    if (msg.cols && msg.rows) {
      if (typeof onPtyRestore === 'function') onPtyRestore(msg.id, msg.cols, msg.rows);
      pendingRestoreFit.add(msg.id);
    }
  } else if (msg.type === 'pty:exit') {
    const term = ptyCallbacks.get(msg.id);
    if (term) term.write('\r\n\x1b[31m[process exited]\x1b[0m\r\n');
  } else if (msg.type === 'session:state') {
    if (typeof onSessionState === 'function') onSessionState(msg.activeTabId);
  } else if (msg.type === 'schedule:state') {
    if (typeof onScheduleState === 'function') onScheduleState(msg.schedules);
  } else if (msg.type === 'schedule:fired') {
    if (typeof onScheduleFired === 'function') onScheduleFired(msg.ptyId);
  } else if (msg.type === 'update:state') {
    if (typeof onUpdateState === 'function') onUpdateState(msg.info);
  } else if (msg.type === 'ports:state') {
    if (typeof onPortsState === 'function') onPortsState(msg.ports);
  } else if (msg.type === 'ports:new') {
    if (typeof onPortsNew === 'function') onPortsNew(msg.ports);
  } else if (msg.type === 'fs:change') {
    if (typeof onFsChange === 'function') onFsChange(msg.path, msg.eventType, msg.filename);
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

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

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

function _sendCreate(id, cols, rows, cwd, inheritFromPtyId) {
  wsSend({ type: 'pty:create', id, cols, rows, cwd, inheritFromPtyId });
}

function createPty(id, term, cols, rows, cwd, inheritFromPtyId) {
  ptyCallbacks.set(id, term);
  if (wsReady) {
    _sendCreate(id, cols, rows, cwd, inheritFromPtyId);
  } else {
    pendingPtys.push([id, cols, rows, cwd, inheritFromPtyId]);
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

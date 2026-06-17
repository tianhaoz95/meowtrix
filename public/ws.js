// ── WebSocket / PTY connection ──────────────────────────────────────────────
const ws = new WebSocket(`ws://${location.host}`);
const ptyCallbacks = new Map(); // ptyId -> Terminal instance

ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'pty:data') {
    const term = ptyCallbacks.get(msg.id);
    if (term) term.write(msg.data);
  } else if (msg.type === 'pty:exit') {
    const term = ptyCallbacks.get(msg.id);
    if (term) term.write('\r\n\x1b[31m[process exited]\x1b[0m\r\n');
  }
});

function wsSend(obj) { ws.send(JSON.stringify(obj)); }

function createPty(id, term, cols, rows) {
  ptyCallbacks.set(id, term);
  wsSend({ type: 'pty:create', id, cols, rows });
}

function destroyPty(id) {
  ptyCallbacks.delete(id);
  wsSend({ type: 'pty:destroy', id });
}

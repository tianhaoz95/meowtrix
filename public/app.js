// ── Single-session enforcement (server-coordinated) ──────────────────────────
// The server tracks which client is the "active" session and tells everyone
// else to show the inactive overlay. Coordinating this server-side (instead of
// via BroadcastChannel/localStorage) means it works across different browsers
// and devices — not just tabs in one browser. The newest client to claim wins;
// the others drop to the overlay until they press "Move session here".
const myTabId = Math.random().toString(36).slice(2);
let isActiveSession = false;  // are we the active session right now?
let hasClaimed = false;       // have we sent our first claim yet?
let bootstrapped = false;     // workspace built and ready to claim?
let streamsLost = false;      // another session took over our PTY streams

// Serialize current workspace state for transfer
function captureWorkspaceState() {
  function serializeEl(el) {
    if (el.classList.contains('pane')) {
      const pane = paneRegistry.get(el);
      if (!pane) return null;
      return {
        type: 'pane',
        activeTabId: pane.activeTab?.id,
        tabs: pane.tabs.map(t => ({
          id: t.id,
          type: t.type,
          ptyId: t.ptyId || null,
          browserUrl: t.type === 'browser' ? t.currentUrl : null,
          label: t.label?.textContent || null,
        })),
      };
    }
    if (el.classList.contains('split-container')) {
      const dir = el.classList.contains('vertical') ? 'vertical' : 'horizontal';
      const panes = [...el.children].filter(c => !c.classList.contains('split-divider'));
      return { type: 'split', dir, children: panes.map(serializeEl).filter(Boolean) };
    }
    return null;
  }
  const workspace = document.getElementById('workspace');
  const root = workspace.children[0];
  return root ? serializeEl(root) : null;
}

// Rebuild workspace from serialized state
function restoreWorkspaceState(state) {
  const workspace = document.getElementById('workspace');
  workspace.innerHTML = '';
  paneRegistry.clear();

  function buildEl(node) {
    if (node.type === 'pane') {
      const pane = createPane();
      node.tabs.forEach(tabState => {
        const tab = addTab(pane, tabState.type, tabState.id, tabState.ptyId, tabState.browserUrl);
        if (tabState.label && tab.label) tab.label.textContent = tabState.label;
      });
      if (node.activeTabId) activateTab(pane, node.activeTabId);
      return pane.el;
    }
    if (node.type === 'split') {
      const container = document.createElement('div');
      container.className = `split-container ${node.dir}`;
      const divider = document.createElement('div');
      divider.className = 'split-divider';
      const children = node.children.map(buildEl);
      container.appendChild(children[0]);
      container.appendChild(divider);
      container.appendChild(children[1]);
      children[0].style.flex = '1';
      children[1].style.flex = '1';
      makeDraggable(divider, container, node.dir);
      return container;
    }
  }

  if (state) {
    workspace.appendChild(buildEl(state));
    const panes = getAllPanes();
    if (panes.length) setActivePane(panes[0]);
  }
}

let workspaceReady = false;

// Save workspace state to server (debounced)
let _saveTimer = null;
function saveSessionState() {
  if (!workspaceReady) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    const state = captureWorkspaceState();
    if (state) fetch('/api/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
  }, 300);
}

function fitAllTerminals() {
  const fit = () => getAllPanes().forEach(p => p.tabs.forEach(t => { if (t.fitAddon) t.fitAddon.fit(); }));
  requestAnimationFrame(() => { fit(); setTimeout(fit, 150); });
  // Re-fit once the terminal web font has loaded: fitting with fallback-font
  // metrics picks the wrong row count and clips the bottom line.
  if (document.fonts?.ready) document.fonts.ready.then(fit);
}

// Build the workspace from the server-saved session (or a fresh one), then
// claim the active session. Runs once per page load.
async function bootstrapSession() {
  try {
    const saved = await fetch('/api/session').then(r => r.json());
    if (saved) restoreWorkspaceState(saved);
    else initWorkspace();
  } catch {
    initWorkspace();
  }
  workspaceReady = true;
  bootstrapped = true;
  fitAllTerminals();
  // Newest client wins: claim as soon as the socket is up. If the WS isn't open
  // yet, onWsConnected() will claim for us once it connects.
  if (wsReady) claimActiveSession();
}

// Tell the server we want to be the active session (also used by the takeover
// button). The server replies with a session:state broadcast → onSessionState.
function claimActiveSession() {
  hasClaimed = true;
  wsSend({ type: 'session:claim', tabId: myTabId });
}

// Called by ws.js each time the socket (re)connects.
function onWsConnected() {
  if (!bootstrapped) return;            // bootstrapSession() will claim
  if (!hasClaimed) { claimActiveSession(); return; }
  if (isActiveSession) {
    // We reconnected and still believe we're active: the server dropped our PTY
    // listeners on disconnect, so re-claim and re-grab the streams.
    streamsLost = true;
    claimActiveSession();
  } else {
    // Inactive tab reconnecting: just resync, don't steal the session.
    wsSend({ type: 'session:sync', tabId: myTabId });
  }
}

// Called by ws.js when a session:state message arrives.
function onSessionState(activeTabId) {
  const active = activeTabId === myTabId;
  isActiveSession = active;
  document.getElementById('inactive-overlay').hidden = active;
  if (active) {
    // If our streams were taken over while we were idle, pull them back.
    if (streamsLost && workspaceReady) { reconnectAllPtys(); }
    streamsLost = false;
  } else {
    // An active session elsewhere now owns the live PTY streams.
    streamsLost = true;
  }
}

function initSession() {
  document.getElementById('btn-takeover').addEventListener('click', claimActiveSession);
  bootstrapSession();
}

let activePicker = null;

function showTabTypePicker(e, pane) {
  if (activePicker) { activePicker.remove(); activePicker = null; }

  const picker = document.createElement('div');
  picker.className = 'tab-type-picker';

  [['⬛  Terminal', 'terminal'], ['🌐  Browser', 'browser']].forEach(([text, type]) => {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.addEventListener('click', () => { addTab(pane, type); picker.remove(); activePicker = null; });
    picker.appendChild(btn);
  });

  picker.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
  picker.style.top = (e.clientY + 6) + 'px';
  document.body.appendChild(picker);
  activePicker = picker;

  setTimeout(() => {
    document.addEventListener('click', () => { picker.remove(); activePicker = null; }, { once: true });
  });
}

// Exposed globally so settings.js can call it
function applyTheme(theme) {
  const themeBtn = document.getElementById('btn-theme');
  document.documentElement.classList.toggle('light', theme === 'light');
  if (themeBtn) themeBtn.textContent = theme === 'light' ? '🌙' : '☀';
  localStorage.setItem('theme', theme);
  const sel = document.getElementById('s-theme');
  if (sel) sel.value = theme;
  const newTheme = getTermTheme();
  getAllPanes().forEach(p => p.tabs.forEach(t => {
    if (t.term) t.term.options.theme = newTheme;
  }));
}

// Run a Cmd/Ctrl app shortcut by its key. Shared by the keyboard handler and
// the mobile key bar's Cmd modifier. Returns true if the key was handled.
function runAppShortcut(key) {
  switch (key) {
    case '\\': if (activePane) splitPane(activePane, 'vertical'); return true;
    case '-':  if (activePane) splitPane(activePane, 'horizontal'); return true;
    case 't':  if (activePane) showTabTypePicker({ clientX: 60, clientY: 40 }, activePane); return true;
    case 'w':  if (activePane?.activeTab) closeTab(activePane, activePane.activeTab.id); return true;
    default:   return false;
  }
}

function initWorkspace() {
  const workspace = document.getElementById('workspace');
  const initialPane = createPane();
  workspace.appendChild(initialPane.el);
  setActivePane(initialPane);
  addTab(initialPane, 'terminal');
}

document.addEventListener('DOMContentLoaded', () => {
  // Apply saved theme immediately (server settings loaded async in settings.js)
  applyTheme(localStorage.getItem('theme') || 'dark');

  document.getElementById('btn-theme').addEventListener('click', async () => {
    const next = document.documentElement.classList.contains('light') ? 'dark' : 'light';
    applyTheme(next);
    await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: next }),
    });
  });

  // ── Toolbar ──
  document.getElementById('btn-split-v').addEventListener('click', () => {
    if (activePane) splitPane(activePane, 'vertical');
  });
  document.getElementById('btn-split-h').addEventListener('click', () => {
    if (activePane) splitPane(activePane, 'horizontal');
  });
  document.getElementById('btn-close-pane').addEventListener('click', () => {
    if (!activePane || getAllPanes().length <= 1) return;
    const pane = activePane;
    [...pane.tabs].forEach(t => closeTab(pane, t.id));
    collapseEmptyPane(pane);
    saveSessionState();
  });

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (runAppShortcut(e.key)) e.preventDefault();
  });

  // Double-click / double-tap anywhere → autocomplete (Tab) in active terminal.
  // Send the Tab straight to the PTY (same message xterm's onData emits) so the
  // shell sees a real Tab keypress — bypassing xterm's word-selection on
  // double-click and any bracketed-paste wrapping that paste() would add.
  // Don't fire autocomplete when double-tapping UI controls (buttons, the key
  // bar, tab strip, browser chrome) — only over actual terminal/content area.
  function autocompleteAllowed(e) {
    return !e.target?.closest?.('button, input, select, #mobile-keybar, #toolbar, .pane-tabs, .browser-bar');
  }
  function triggerAutocomplete() {
    const tab = activePane?.activeTab;
    if (tab?.type !== 'terminal' || !tab.ptyId) return;
    wsSend({ type: 'pty:input', id: tab.ptyId, data: '\t' });
  }

  document.addEventListener('dblclick', (e) => { if (autocompleteAllowed(e)) triggerAutocomplete(); });

  // Touch double-tap: browsers don't reliably synthesize `dblclick` for taps
  // (and often suppress it pending zoom gestures), so detect it ourselves.
  let lastTap = 0, lastTapX = 0, lastTapY = 0;
  document.addEventListener('touchend', (e) => {
    if (e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    const now = Date.now();
    const near = Math.abs(t.clientX - lastTapX) < 30 && Math.abs(t.clientY - lastTapY) < 30;
    if (now - lastTap < 300 && near && autocompleteAllowed(e)) {
      // Suppress the synthetic dblclick some browsers fire so we tab once, not twice.
      e.preventDefault();
      lastTap = 0;
      triggerAutocomplete();
    } else {
      lastTap = now; lastTapX = t.clientX; lastTapY = t.clientY;
    }
  }, { passive: false });

  initSession();

  window.addEventListener('beforeunload', () => {
    if (workspaceReady) {
      const state = captureWorkspaceState();
      if (state) navigator.sendBeacon('/api/session', new Blob([JSON.stringify(state)], { type: 'application/json' }));
    }
    // The server notices our WS closing and hands the active session off.
  });
});

// ── Single-session enforcement ───────────────────────────────────────────────
const SESSION_KEY = 'meowtrix_session_owner';
const HEARTBEAT_MS = 1000;
const DEAD_MS = 3000;
const myTabId = Math.random().toString(36).slice(2);
let sessionChannel = null;
let heartbeatTimer = null;
let isOwner = false;

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

function claimSession(state) {
  isOwner = true;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ id: myTabId, ts: Date.now() }));
  sessionChannel.postMessage({ type: 'claimed', id: myTabId });
  document.getElementById('inactive-overlay').hidden = true;

  const startHeartbeat = () => {
    heartbeatTimer = setInterval(() => {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ id: myTabId, ts: Date.now() }));
    }, HEARTBEAT_MS);
  };

  if (state) {
    restoreWorkspaceState(state);
    workspaceReady = true;
    fitAllTerminals();
    startHeartbeat();
  } else {
    fetch('/api/session').then(r => r.json()).then(saved => {
      if (saved) restoreWorkspaceState(saved);
      else initWorkspace();
      workspaceReady = true;
      fitAllTerminals();
    }).catch(() => { initWorkspace(); workspaceReady = true; })
      .finally(startHeartbeat);
  }
}

function releaseSession() {
  isOwner = false;
  clearInterval(heartbeatTimer);
  localStorage.removeItem(SESSION_KEY);
}

function initSession() {
  sessionChannel = new BroadcastChannel('meowtrix_session');

  sessionChannel.addEventListener('message', (e) => {
    if (e.data.type === 'claimed' && e.data.id !== myTabId) {
      if (isOwner) releaseSession();
      document.getElementById('inactive-overlay').hidden = false;
    }
    // Owner responds to state request with current workspace
    if (e.data.type === 'request_state' && isOwner) {
      sessionChannel.postMessage({ type: 'state_response', state: captureWorkspaceState() });
    }
    // Takeover tab receives state and proceeds
    if (e.data.type === 'state_response' && !isOwner) {
      claimSession(e.data.state);
    }
  });

  document.getElementById('btn-takeover').addEventListener('click', () => {
    // Ask current owner for its state, then claim in the response handler
    sessionChannel.postMessage({ type: 'request_state' });
    // Fallback: if no response in 500ms, claim without state
    setTimeout(() => { if (!isOwner) claimSession(null); }, 500);
  });

  const stored = (() => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
  })();
  const ownerAlive = stored && (Date.now() - stored.ts) < DEAD_MS;

  if (ownerAlive) {
    document.getElementById('inactive-overlay').hidden = false;
  } else {
    claimSession(null);
  }
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
    const paneEl = activePane.el;
    const parent = paneEl.parentElement;
    [...activePane.tabs].forEach(t => closeTab(activePane, t.id));
    paneRegistry.delete(paneEl);
    if (parent.classList.contains('split-container')) {
      const sibling = [...parent.children].find(c => c !== paneEl && !c.classList.contains('split-divider'));
      sibling.style.flex = '';
      parent.parentElement.replaceChild(sibling, parent);
      const remaining = getAllPanes();
      if (remaining.length) setActivePane(remaining[0]);
      else activePane = null;
    }
    saveSessionState();
  });

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === '\\') { e.preventDefault(); if (activePane) splitPane(activePane, 'vertical'); }
    if (e.key === '-')  { e.preventDefault(); if (activePane) splitPane(activePane, 'horizontal'); }
    if (e.key === 't')  { e.preventDefault(); if (activePane) showTabTypePicker({ clientX: 60, clientY: 40 }, activePane); }
    if (e.key === 'w')  { e.preventDefault(); if (activePane?.activeTab) closeTab(activePane, activePane.activeTab.id); }
  });

  // Double-click / double-tap anywhere → autocomplete (Tab) in active terminal
  document.addEventListener('dblclick', () => {
    if (activePane?.activeTab?.term) activePane.activeTab.term.input('\t');
  });

  initSession();

  window.addEventListener('beforeunload', () => {
    if (workspaceReady) {
      const state = captureWorkspaceState();
      if (state) navigator.sendBeacon('/api/session', new Blob([JSON.stringify(state)], { type: 'application/json' }));
    }
    if (isOwner) releaseSession();
  });
});

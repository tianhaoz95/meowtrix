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
let everActive = false;       // have we ever been the active session?

// Serialize current workspace state for transfer
function captureWorkspaceState() {
  function serializeEl(el) {
    let node;
    if (el.classList.contains('pane')) {
      const pane = paneRegistry.get(el);
      if (!pane) return null;
      node = {
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
    } else if (el.classList.contains('split-container')) {
      const dir = el.classList.contains('vertical') ? 'vertical' : 'horizontal';
      const panes = [...el.children].filter(c => !c.classList.contains('split-divider'));
      node = { type: 'split', dir, children: panes.map(serializeEl).filter(Boolean) };
    } else {
      return null;
    }
    // Persist the flex ratio so restored layouts keep their proportions.
    node.flex = el.style.flex || '';
    return node;
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
    let el;
    if (node.type === 'pane') {
      const pane = createPane();
      node.tabs.forEach(tabState => {
        const tab = addTab(pane, tabState.type, tabState.id, tabState.ptyId, tabState.browserUrl);
        if (tabState.label && tab.label) tab.label.textContent = tabState.label;
      });
      if (node.activeTabId) activateTab(pane, node.activeTabId);
      el = pane.el;
    } else if (node.type === 'split') {
      const container = document.createElement('div');
      container.className = `split-container ${node.dir}`;
      // Flat: any number of children, with a draggable divider between each.
      node.children.forEach((childNode, i) => {
        if (i > 0) {
          const divider = document.createElement('div');
          divider.className = 'split-divider';
          container.appendChild(divider);
          makeDraggable(divider, container, node.dir);
        }
        container.appendChild(buildEl(childNode));
      });
      el = container;
    } else {
      return null;
    }
    el.style.flex = node.flex || '1 1 0';
    return el;
  }

  if (state) {
    workspace.appendChild(buildEl(state));
    const panes = getAllPanes();
    if (panes.length) setActivePane(panes[0]);
  }
}

let workspaceReady = false;

// Save workspace state to server (debounced). Only the active session may write
// — an inactive tab holds a stale layout and must never clobber the server with
// it (otherwise e.g. its unload beacon would resurrect panes the active tab
// already closed).
let _saveTimer = null;
function _postSessionState() {
  _saveTimer = null;
  const state = captureWorkspaceState();
  if (state) fetch('/api/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
}
function saveSessionState() {
  if (!workspaceReady || !isActiveSession) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_postSessionState, 300);
}
// Push any pending save immediately (e.g. right before handing off the active
// session) so the next tab resyncs against the very latest layout.
function flushSessionState() {
  if (!_saveTimer) return;
  clearTimeout(_saveTimer);
  _postSessionState();
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
  // The server may have reported pending schedules before the tabs existed.
  if (typeof reconcileSchedules === 'function') reconcileSchedules();
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

// Re-fetch the server's saved session and rebuild the workspace from it. Used
// when we reactivate after being idle: the session that was active meanwhile may
// have changed the layout (split/closed panes, added/moved tabs), so our DOM is
// stale. Rebuilding also re-creates the terminals, which reconnects their PTYs.
async function resyncWorkspace() {
  try {
    const saved = await fetch('/api/session').then(r => r.json());
    if (saved) restoreWorkspaceState(saved);
  } catch {}
  fitAllTerminals();
  // Re-apply schedule lock overlays to the freshly rebuilt tabs.
  if (typeof reconcileSchedules === 'function') reconcileSchedules();
}

// Called by ws.js when a session:state message arrives.
function onSessionState(activeTabId) {
  const active = activeTabId === myTabId;
  const was = isActiveSession;
  isActiveSession = active;
  document.getElementById('inactive-overlay').hidden = active;
  if (active) {
    if (everActive && !was && workspaceReady) {
      // Idle → active: rebuild from the server so the layout matches what the
      // previously-active session left behind.
      resyncWorkspace();
    } else if (everActive && was && streamsLost && workspaceReady) {
      // Reconnected while still active (e.g. a network blip): layout is
      // unchanged, just re-grab the live PTY streams.
      reconnectAllPtys();
    }
    everActive = true;
    streamsLost = false;
  } else {
    // Handing off: push our final layout now so the new active tab resyncs
    // against it, then mark our PTY streams as owned elsewhere.
    flushSessionState();
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
    btn.addEventListener('click', () => { addTab(pane, type); saveSessionState(); picker.remove(); activePicker = null; });
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

// Single source of truth for available themes — drives both the settings
// dropdown (settings.js) and the cycling toolbar button below. Each `id`
// matches a `html[data-theme="…"]` block in style.css (except 'dark', which
// is the :root default). `icon` shows on the toolbar button for the theme.
const THEMES = [
  { id: 'dark',   label: 'Midnight', icon: '🌙' },
  { id: 'light',  label: 'Daylight', icon: '☀️' },
  { id: 'ocean',  label: 'Ocean',    icon: '🌊' },
  { id: 'matrix', label: 'Matrix',   icon: '🟢' },
  { id: 'ember',  label: 'Ember',    icon: '🔥' },
  { id: 'sakura', label: 'Sakura',   icon: '🌸' },
  { id: 'bubblegum',  label: 'Bubblegum',  icon: '🍬' },
  { id: 'catppuccin', label: 'Catppuccin', icon: '🐱' },
  { id: 'cappuccino', label: 'Cappuccino', icon: '☕' },
  { id: 'synthwave',  label: 'Synthwave',  icon: '🌆' },
];

// Exposed globally so settings.js can call it
function applyTheme(theme) {
  const meta = THEMES.find(t => t.id === theme) || THEMES[0];
  document.documentElement.dataset.theme = meta.id;
  const themeBtn = document.getElementById('btn-theme');
  if (themeBtn) {
    themeBtn.textContent = meta.icon;
    themeBtn.title = `Theme: ${meta.label} — click to cycle`;
  }
  localStorage.setItem('theme', meta.id);
  const sel = document.getElementById('s-theme');
  if (sel) sel.value = meta.id;
  // Terminal colors are derived from the active theme's CSS variables, so
  // every theme themes its terminals for free.
  const newTheme = getTermTheme();
  getAllPanes().forEach(p => p.tabs.forEach(t => {
    if (t.term) t.term.options.theme = newTheme;
  }));
}

// Apply a theme and persist it to the host. Shared by the toolbar cycle button,
// the settings dropdown, and the command palette's "Theme: …" entries.
function setTheme(id) {
  applyTheme(id);
  fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme: id }),
  });
}

// Close the active pane (after closing all its tabs). Shared by the toolbar's
// Close button and the command palette. No-op if it's the only pane left.
function closeActivePane() {
  if (!activePane || getAllPanes().length <= 1) return;
  const pane = activePane;
  [...pane.tabs].forEach(t => closeTab(pane, t.id));
  collapseEmptyPane(pane);
  saveSessionState();
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

// ── File transfer (client ↔ host) ────────────────────────────────────────────
// Brief status toast, reused for upload progress and errors.
let _toastTimer = null;
function showToast(msg) {
  let el = document.getElementById('mtx-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mtx-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
}

// Download a host file to the browser. Called from the OSC 5379 handler
// (pane.js) when the user runs `mtx <file>` in a terminal.
function triggerDownload(filePath) {
  if (!filePath) return;
  const a = document.createElement('a');
  a.href = '/api/download?path=' + encodeURIComponent(filePath);
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Upload the chosen files to ~/meowtrix on the host, one request per file.
async function uploadFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  showToast(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`);
  let ok = 0;
  for (const file of files) {
    try {
      const res = await fetch('/api/upload?name=' + encodeURIComponent(file.name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      if (res.ok) ok++;
    } catch {}
  }
  showToast(ok === files.length
    ? `Uploaded ${ok} file${ok > 1 ? 's' : ''} to ~/meowtrix`
    : `Uploaded ${ok}/${files.length} to ~/meowtrix — some failed`);
}

function initWorkspace() {
  const workspace = document.getElementById('workspace');
  const initialPane = createPane();
  workspace.appendChild(initialPane.el);
  setActivePane(initialPane);
  addTab(initialPane, 'terminal');
}

// Log whether Chrome's on-device model (Gemini Nano via the Prompt API) is usable.
async function checkOnDeviceModel() {
  if (!('LanguageModel' in self)) {
    console.log('[on-device model] Prompt API not available in this browser.');
    return;
  }
  try {
    const availability = await LanguageModel.availability();
    // 'unavailable' | 'downloadable' | 'downloading' | 'available'
    console.log('[on-device model] availability:', availability);
  } catch (err) {
    console.log('[on-device model] availability check failed:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkOnDeviceModel();

  // Apply saved theme immediately (server settings loaded async in settings.js)
  applyTheme(localStorage.getItem('theme') || 'dark');

  document.getElementById('btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || 'dark';
    const idx = THEMES.findIndex(t => t.id === cur);
    setTheme(THEMES[(idx + 1) % THEMES.length].id);
  });

  // ── Toolbar ──
  document.getElementById('btn-split-v').addEventListener('click', () => {
    if (activePane) splitPane(activePane, 'vertical');
  });
  document.getElementById('btn-split-h').addEventListener('click', () => {
    if (activePane) splitPane(activePane, 'horizontal');
  });
  document.getElementById('btn-broadcast').addEventListener('click', () => {
    setBroadcastInput(!broadcastInput);
  });
  const uploadInput = document.getElementById('upload-input');
  document.getElementById('btn-upload').addEventListener('click', () => uploadInput.click());
  uploadInput.addEventListener('change', () => {
    uploadFiles(uploadInput.files);
    uploadInput.value = ''; // allow re-selecting the same file
  });
  document.getElementById('btn-close-pane').addEventListener('click', closeActivePane);

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
    // Only the active session persists on unload — an inactive tab's state is
    // stale and would overwrite the real layout.
    if (workspaceReady && isActiveSession) {
      const state = captureWorkspaceState();
      if (state) navigator.sendBeacon('/api/session', new Blob([JSON.stringify(state)], { type: 'application/json' }));
    }
    // The server notices our WS closing and hands the active session off.
  });
});

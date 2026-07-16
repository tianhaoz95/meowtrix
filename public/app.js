// ── Single-session enforcement (server-coordinated) ──────────────────────────
// The server tracks which client is the "active" session and tells everyone
// else to show the inactive overlay. Coordinating this server-side (instead of
// via BroadcastChannel/localStorage) means it works across different browsers
// and devices — not just tabs in one browser. The newest client to claim wins;
// the others drop to the overlay until they press "Move session here".
const myTabId = Math.random().toString(36).slice(2);

// Are we the Meowtrix app shell running *embedded* inside another page's iframe?
// In normal use the app UI is always top-level — browser panes only ever frame
// external/proxied content, never index.html itself. So `top !== self` means a
// Meowtrix instance was opened inside another Meowtrix's browser pane. That pane
// loads it through the host's `/proxy`, and the proxy can't rewrite WebSocket
// targets, so the embedded page's control socket (ws.js uses `location.host`)
// connects back to the *host* server — the same one the outer page is on. If the
// embedded shell also claimed the active session, the host server would see two
// clients each grabbing its single session lock and stealing it back and forth:
// the "two instances own the same session" deadlock. So an embedded shell opts
// out of session coordination entirely — it never claims and never shows the
// inactive overlay, acting as a passive co-viewer that can't fight for control.
const isEmbedded = (() => { try { return window.top !== window.self; } catch { return true; } })();

let isActiveSession = false;  // are we the active session right now?
let hasClaimed = false;       // have we sent our first claim yet?
let bootstrapped = false;     // workspace built and ready to claim?
let streamsLost = false;      // another session took over our PTY streams
let everActive = false;       // have we ever been the active session?

// Workspaces state variables
let currentWorkspaces = [
  { name: "Workspace 1", layout: null },
  { name: "Workspace 2", layout: null },
  { name: "Workspace 3", layout: null },
  { name: "Workspace 4", layout: null }
];
let activeWorkspaceIndex = 0;

function ensureWorkspaceViews() {
  const workspace = document.getElementById('workspace');
  if (!workspace) return;
  if (workspace.querySelector('.workspace-view')) return; // already created
  
  workspace.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const view = document.createElement('div');
    view.className = 'workspace-view inactive';
    view.setAttribute('data-index', i);
    workspace.appendChild(view);
  }
}

function deactivateWorkspace(index) {
  const viewEl = document.querySelector(`.workspace-view[data-index="${index}"]`);
  if (!viewEl) return;
  
  const panes = [];
  function walk(el) {
    if (el.classList?.contains('pane')) {
      const p = paneRegistry.get(el);
      if (p) panes.push(p);
    }
    for (const child of el.children) walk(child);
  }
  walk(viewEl);

  panes.forEach(pane => {
    pane.tabs.forEach(tab => {
      if (tab.ptyId) {
        ptyCallbacks.delete(tab.ptyId);
      }
      if (tab.term) {
        try { tab.term.dispose(); } catch (e) {}
      }
      if (tab.disposeTerminal) {
        try { tab.disposeTerminal(); } catch (e) {}
      }
      if (tab.disposeEditor) {
        try { tab.disposeEditor(); } catch (e) {}
      }
    });
    paneRegistry.delete(pane.el);
  });
  viewEl.innerHTML = '';
}

function deactivateAllWorkspaces() {
  for (let i = 0; i < 4; i++) {
    deactivateWorkspace(i);
  }
}

function deactivateCurrentWorkspace() {
  deactivateWorkspace(activeWorkspaceIndex);
}

function updateWorkspaceUI() {
  document.querySelectorAll('.logo-letter').forEach(el => {
    const idx = parseInt(el.getAttribute('data-index'), 10);
    el.classList.toggle('active', idx === activeWorkspaceIndex);
  });
  const badge = document.getElementById('workspace-badge');
  if (badge) {
    badge.textContent = currentWorkspaces[activeWorkspaceIndex].name;
  }
  if (typeof updateUiMode === 'function') {
    updateUiMode();
  }
}

function switchWorkspace(index, opts = {}) {
  if (index < 0 || index > 3) return;
  if (index === activeWorkspaceIndex) return;

  // Direction for the enter animation (slide from the side we're moving toward).
  // Callers that wrap around (prev/next buttons, swipe gestures) can pass an
  // explicit direction so the slide follows travel direction rather than numeric
  // index order — e.g. swiping from Workspace 1 back to 4 should slide as "prev".
  const goingNext = opts.direction ? (opts.direction === 'next') : (index > activeWorkspaceIndex);

  // Flush any pending save for the current workspace first
  flushSessionState();

  // Save the current layout into memory
  currentWorkspaces[activeWorkspaceIndex].layout = captureWorkspaceState();

  // Hide the current workspace view container
  ensureWorkspaceViews();
  const currentView = document.querySelector(`.workspace-view[data-index="${activeWorkspaceIndex}"]`);
  if (currentView) {
    currentView.classList.remove('active');
    currentView.classList.add('inactive');
  }

  // Switch index
  activeWorkspaceIndex = index;

  // Show the new workspace view container, initializing it if empty
  const nextView = document.querySelector(`.workspace-view[data-index="${activeWorkspaceIndex}"]`);
  if (nextView) {
    nextView.classList.remove('inactive');
    nextView.classList.add('active');

    if (nextView.children.length === 0) {
      const nextLayout = currentWorkspaces[activeWorkspaceIndex].layout;
      if (nextLayout) {
        restoreWorkspaceState(nextLayout, nextView);
      } else {
        initWorkspace(activeWorkspaceIndex);
      }
    } else {
      // Find the first pane or the active pane in this container and make it active
      const nextPanes = [];
      function walk(el) {
        if (el.classList?.contains('pane')) { const p = paneRegistry.get(el); if (p) nextPanes.push(p); }
        for (const child of el.children) walk(child);
      }
      walk(nextView);
      if (nextPanes.length) {
        const alreadyActive = nextPanes.find(p => p.el.classList.contains('active'));
        setActivePane(alreadyActive || nextPanes[0]);
      }
    }
  }

  // Update UI and fit terminals
  updateWorkspaceUI();
  fitAllTerminals();

  // Play the directional enter animation on the freshly-rebuilt workspace.
  const workspaceEl = document.getElementById('workspace');
  if (workspaceEl) {
    workspaceEl.classList.remove('ws-enter-next', 'ws-enter-prev');
    void workspaceEl.offsetWidth; // force reflow so the animation restarts
    workspaceEl.classList.add(goingNext ? 'ws-enter-next' : 'ws-enter-prev');
  }

  // Save the new state immediately
  _postSessionState();
}

// Serialize current workspace state for transfer
function captureWorkspaceState(index = activeWorkspaceIndex) {
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
          browserConsoleOpen: t.type === 'browser' ? !!t.consoleOpen : null,
          editorDir: t.type === 'editor' ? t.editorDir : (t.type === 'terminal' ? t.terminalDir : null),
          sshHost: t.type === 'terminal' ? (t.sshHost || null) : null,
          editorSidebarWidth: t.type === 'editor' ? t.editorSidebarWidth : null,
          editorSidebarCollapsed: t.type === 'editor' ? !!t.editorSidebarCollapsed : null,
          editorExpandedDirs: t.type === 'editor' ? Array.from(t.editorExpandedDirs || []) : null,
          label: t.label?.textContent || null,
          isCustomLabel: !!t.isCustomLabel,
          zoomLevel: t.zoomLevel || 1.0,
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
  ensureWorkspaceViews();
  const container = document.querySelector(`.workspace-view[data-index="${index}"]`);
  if (!container) return null;
  const root = container.children[0];
  return root ? serializeEl(root) : null;
}

// Rebuild workspace from serialized state
function restoreWorkspaceState(state, container) {
  if (typeof maximizedPane !== 'undefined') {
    maximizedPane = null;
    document.body.classList.remove('has-maximized-pane');
  }
  ensureWorkspaceViews();
  if (!container) {
    container = document.querySelector(`.workspace-view[data-index="${activeWorkspaceIndex}"]`);
  }
  if (!container) return;

  const idx = parseInt(container.getAttribute('data-index'), 10);
  if (!isNaN(idx)) {
    deactivateWorkspace(idx);
  } else {
    container.innerHTML = '';
  }

  function buildEl(node) {
    let el;
    if (node.type === 'pane') {
      const pane = createPane();
      node.tabs.forEach(tabState => {
        const tab = addTab(pane, tabState.type, tabState.id, tabState.ptyId, tabState.browserUrl, tabState.editorDir, tabState.editorSidebarWidth, tabState.editorSidebarCollapsed, tabState.browserConsoleOpen, tabState.editorExpandedDirs, tabState.zoomLevel, tabState.sshHost);
        if (tabState.label && tab.label) tab.label.textContent = tabState.label;
        if (tabState.isCustomLabel) tab.isCustomLabel = true;
      });
      if (node.activeTabId) activateTab(pane, node.activeTabId);
      el = pane.el;
    } else if (node.type === 'split') {
      const containerSplit = document.createElement('div');
      containerSplit.className = `split-container ${node.dir}`;
      // Flat: any number of children, with a draggable divider between each.
      node.children.forEach((childNode, i) => {
        if (i > 0) {
          const divider = document.createElement('div');
          divider.className = 'split-divider';
          containerSplit.appendChild(divider);
          makeDraggable(divider, containerSplit, node.dir);
        }
        containerSplit.appendChild(buildEl(childNode));
      });
      el = containerSplit;
    } else {
      return null;
    }
    el.style.flex = node.flex || '1 1 0';
    return el;
  }

  if (state) {
    container.appendChild(buildEl(state));
    if (container.classList.contains('active')) {
      const panes = [];
      function walk(el) {
        if (el.classList?.contains('pane')) { const p = paneRegistry.get(el); if (p) panes.push(p); }
        for (const child of el.children) walk(child);
      }
      walk(container);
      if (panes.length) setActivePane(panes[0]);
    }
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
  for (let i = 0; i < 4; i++) {
    const container = document.querySelector(`.workspace-view[data-index="${i}"]`);
    if (container && container.children.length > 0) {
      currentWorkspaces[i].layout = captureWorkspaceState(i);
    }
  }
  const state = {
    activeWorkspaceIndex,
    workspaces: currentWorkspaces.map(ws => ({
      name: ws.name,
      layout: ws.layout
    }))
  };
  fetch('/api/session', {
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
  const fit = () => getAllPanes().forEach(p => {
    const t = p.activeTab;
    if (t && t.type === 'terminal' && t.fitAddon && t.viewEl && t.viewEl.classList.contains('active')) {
      try { t.fitAddon.fit(); } catch {}
    }
  });
  requestAnimationFrame(() => { fit(); setTimeout(fit, 150); });
  // Re-fit once the terminal web font has loaded: fitting with fallback-font
  // metrics picks the wrong row count and clips the bottom line.
  if (document.fonts?.ready) document.fonts.ready.then(fit);
}

// Build the workspace from the server-saved session (or a fresh one), then
// claim the active session. Runs once per page load.
async function bootstrapSession() {
  try {
    ensureWorkspaceViews();
    const saved = await fetch('/api/session').then(r => r.json());
    if (saved) {
      if (saved.workspaces && Array.isArray(saved.workspaces)) {
        currentWorkspaces = saved.workspaces.map(ws => ({
          name: ws.name,
          layout: ws.layout
        }));
        activeWorkspaceIndex = typeof saved.activeWorkspaceIndex === 'number' ? saved.activeWorkspaceIndex : 0;
      } else {
        // Upgrade old session format
        currentWorkspaces = [
          { name: "Workspace 1", layout: saved },
          { name: "Workspace 2", layout: null },
          { name: "Workspace 3", layout: null },
          { name: "Workspace 4", layout: null }
        ];
        activeWorkspaceIndex = 0;
      }

      // Update workspace active/inactive class states
      for (let i = 0; i < 4; i++) {
        const container = document.querySelector(`.workspace-view[data-index="${i}"]`);
        if (container) {
          if (i === activeWorkspaceIndex) {
            container.classList.remove('inactive');
            container.classList.add('active');
          } else {
            container.classList.remove('active');
            container.classList.add('inactive');
          }
        }
      }

      const activeLayout = currentWorkspaces[activeWorkspaceIndex].layout;
      if (activeLayout) {
        restoreWorkspaceState(activeLayout);
      } else {
        initWorkspace();
      }
    } else {
      initWorkspace();
    }
  } catch {
    initWorkspace();
  }
  workspaceReady = true;
  bootstrapped = true;
  updateWorkspaceUI();
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
  // An embedded shell never contends for the session (see `isEmbedded`).
  if (isEmbedded) return;
  hasClaimed = true;
  wsSend({ type: 'session:claim', tabId: myTabId });
}

// Called by ws.js each time the socket (re)connects.
function onWsConnected() {
  if (!bootstrapped) return;            // bootstrapSession() will claim
  if (typeof rewatchAllEditors === 'function') {
    rewatchAllEditors();
  }
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
    if (saved) {
      deactivateAllWorkspaces();
      if (saved.workspaces && Array.isArray(saved.workspaces)) {
        currentWorkspaces = saved.workspaces.map(ws => ({
          name: ws.name,
          layout: ws.layout
        }));
        activeWorkspaceIndex = typeof saved.activeWorkspaceIndex === 'number' ? saved.activeWorkspaceIndex : 0;
      } else {
        currentWorkspaces = [
          { name: "Workspace 1", layout: saved },
          { name: "Workspace 2", layout: null },
          { name: "Workspace 3", layout: null },
          { name: "Workspace 4", layout: null }
        ];
        activeWorkspaceIndex = 0;
      }

      // Update workspace active/inactive class states
      for (let i = 0; i < 4; i++) {
        const container = document.querySelector(`.workspace-view[data-index="${i}"]`);
        if (container) {
          if (i === activeWorkspaceIndex) {
            container.classList.remove('inactive');
            container.classList.add('active');
          } else {
            container.classList.remove('active');
            container.classList.add('inactive');
          }
        }
      }

      const activeLayout = currentWorkspaces[activeWorkspaceIndex].layout;
      if (activeLayout) {
        restoreWorkspaceState(activeLayout);
      } else {
        initWorkspace();
      }
    }
  } catch {}
  updateWorkspaceUI();
  fitAllTerminals();
  // Re-apply schedule lock overlays to the freshly rebuilt tabs.
  if (typeof reconcileSchedules === 'function') reconcileSchedules();
}

// Called by ws.js when a session:state message arrives.
function onSessionState(activeTabId) {
  // Embedded shells stay out of the lock: never flip to the inactive overlay and
  // never mark ourselves active (so we also never write the host's session.json
  // with our unrelated layout). We just keep rendering whatever our socket sees.
  if (isEmbedded) return;
  const active = activeTabId === myTabId;
  const was = isActiveSession;
  isActiveSession = active;
  document.getElementById('inactive-overlay').hidden = active;
  document.body.classList.toggle('session-inactive', !active);
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

  // Tracks a second-level submenu (the SSH host list) so it can be torn down
  // alongside the main picker and re-opened cleanly.
  let submenu = null;
  const closeSubmenu = () => { if (submenu) { submenu.remove(); submenu = null; } };
  const closeAll = () => { closeSubmenu(); picker.remove(); activePicker = null; };

  [['⬛  Terminal', 'terminal'], ['🔗  SSH', 'ssh'], ['🌐  Browser', 'browser'], ['📝  Code editor', 'editor']].forEach(([text, type]) => {
    const btn = document.createElement('button');
    btn.textContent = type === 'ssh' ? text + '  ›' : text;
    if (type === 'ssh') {
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); openSshSubmenu(btn); });
    } else {
      btn.addEventListener('mouseenter', closeSubmenu);
      btn.addEventListener('click', async () => {
        closeAll();
        if (type === 'editor') {
          const dir = await promptForFolder();
          if (!dir) return;
          addTab(pane, 'editor', undefined, undefined, undefined, dir);
        } else {
          addTab(pane, type);
        }
        saveSessionState();
      });
    }
    picker.appendChild(btn);
  });

  // Build the SSH host submenu from ~/.ssh/config. The host list is fetched on
  // demand; a connected host opens a terminal tab whose PTY runs `ssh <host>`.
  async function openSshSubmenu(anchorBtn) {
    closeSubmenu();
    submenu = document.createElement('div');
    submenu.className = 'tab-type-picker tab-type-submenu';
    submenu.innerHTML = '<button disabled class="tab-type-loading">Loading hosts…</button>';
    const rect = anchorBtn.getBoundingClientRect();
    submenu.style.left = Math.min(rect.right + 2, window.innerWidth - 200) + 'px';
    submenu.style.top = rect.top + 'px';
    document.body.appendChild(submenu);

    let hosts = [];
    try {
      const res = await fetch('/api/ssh/hosts');
      hosts = (await res.json()).hosts || [];
    } catch {}
    if (!submenu) return; // torn down while loading
    submenu.innerHTML = '';
    if (!hosts.length) {
      const empty = document.createElement('button');
      empty.disabled = true;
      empty.className = 'tab-type-loading';
      empty.textContent = 'No hosts in ~/.ssh/config';
      submenu.appendChild(empty);
    }
    hosts.forEach(host => {
      const hb = document.createElement('button');
      hb.textContent = '🔗  ' + host;
      hb.addEventListener('click', () => {
        closeAll();
        addTab(pane, 'terminal', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, host);
        saveSessionState();
      });
      submenu.appendChild(hb);
    });

    // Always offer an entry to add a host: opens ~/.ssh/config (creating it if
    // needed) in a code-editor tab so the user can append a new Host block.
    const addBtn = document.createElement('button');
    addBtn.className = 'tab-type-add-host';
    addBtn.textContent = '➕  Add new host…';
    addBtn.addEventListener('click', async () => {
      closeAll();
      let info;
      try {
        const res = await fetch('/api/ssh/ensure-config', { method: 'POST' });
        info = await res.json();
        if (!res.ok) throw new Error(info.error);
      } catch { return; }
      const tab = addTab(pane, 'editor', undefined, undefined, undefined, info.dir);
      if (tab && typeof tab.openFile === 'function') tab.openFile(info.path);
      saveSessionState();
    });
    submenu.appendChild(addBtn);
  }

  picker.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
  picker.style.top = (e.clientY + 6) + 'px';
  document.body.appendChild(picker);
  activePicker = picker;

  // Dismiss on an outside click. Clicks inside either menu are ignored (so
  // opening the SSH submenu or selecting a host doesn't tear down the picker
  // first); the listener re-arms itself in that case.
  function onDocClick(ev) {
    if (picker.contains(ev.target) || (submenu && submenu.contains(ev.target))) {
      document.addEventListener('click', onDocClick, { once: true });
      return;
    }
    closeAll();
  }
  setTimeout(() => document.addEventListener('click', onDocClick, { once: true }));
}

// Single source of truth for available themes — drives both the settings
// dropdown (settings.js) and the cycling toolbar button below. Each `id`
// matches a `html[data-theme="…"]` block in style.css (except 'dark', which
// is the :root default). `icon` shows on the toolbar button for the theme.
const THEMES = [
  { id: 'auto',   label: 'Auto (System)', icon: '🌓' },
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
  
  let resolvedId = meta.id;
  if (resolvedId === 'auto') {
    resolvedId = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  document.documentElement.dataset.theme = resolvedId;
  const themeBtn = document.getElementById('btn-theme');
  if (themeBtn) {
    const iconEl = themeBtn.querySelector('.btn-icon');
    if (iconEl) {
      iconEl.textContent = meta.icon;
    } else {
      themeBtn.textContent = meta.icon;
    }
    themeBtn.title = `Theme: ${meta.label} — click to cycle`;
  }
  localStorage.setItem('theme', meta.id);
  const sel = document.getElementById('s-theme');
  if (sel) sel.value = meta.id;
  const newTheme = getTermTheme();
  getAllPanesAllWorkspaces().forEach(p => p.tabs.forEach(t => {
    if (t.term) t.term.options.theme = newTheme;
    if (typeof t.updateTheme === 'function') t.updateTheme();
  }));
}

// Listen for system theme changes if set to auto
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (localStorage.getItem('theme') === 'auto' || !localStorage.getItem('theme')) {
    applyTheme('auto');
  }
});

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
function runAppShortcut(key, e) {
  switch (key) {
    case '\\': if (activePane) splitPane(activePane, 'vertical'); return true;
    case '-':  if (activePane) splitPane(activePane, 'horizontal'); return true;
    case 't':  if (activePane) showTabTypePicker({ clientX: 60, clientY: 40 }, activePane); return true;
    case 'f': {
      const tab = activePane?.activeTab;
      if (tab && tab.type === 'terminal') {
        showTerminalSearch(tab);
        return true;
      }
      return false;
    }
    case 'w':  if (activePane?.activeTab) closeTab(activePane, activePane.activeTab.id); return true;
    // Cmd/Ctrl+Shift+W closes the whole pane (vs Cmd/Ctrl+W which closes a tab).
    case 'W':  closeActivePane(); return true;
    // Cmd/Ctrl+Shift+U → upload file(s). Plain Cmd/Ctrl+U falls through (default).
    case 'U':  document.getElementById('upload-input')?.click(); return true;
    // Cmd/Ctrl+Shift+S → schedule an Enter key press.
    case 'S':  if (typeof openScheduleDialog === 'function') openScheduleDialog(); return true;
    // Cmd/Ctrl+Shift+F → toggle fullscreen.
    case 'F':  toggleFullscreen(); return true;
    // Cmd/Ctrl+, → open settings (the conventional "preferences" shortcut).
    case ',':  if (typeof openSettings === 'function') openSettings(); return true;
    case 'b':
    case 'B': {
      // Toggle broadcast input.
      // On macOS, Cmd+B (with or without Shift) toggles it.
      // On non-macOS, Ctrl+Shift+B toggles it (to avoid conflicting with terminal Ctrl+B).
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
      if (!e) { // Triggered from mobile sticky Cmd, no event object.
        setBroadcastInput(!broadcastInput);
        return true;
      }
      const isCmdB = isMac && e.metaKey && !e.ctrlKey;
      const isCtrlShiftB = !isMac && e.ctrlKey && e.shiftKey;
      if (isCmdB || isCtrlShiftB) {
        setBroadcastInput(!broadcastInput);
        return true;
      }
      return false;
    }
    default:   return false;
  }
}

// ── File transfer (client ↔ host) ────────────────────────────────────────────
// Brief status toast, reused for upload progress and errors.
let _toastTimer = null;
let _toastClickHandler = null;
function showToast(msg, onClick) {
  let el = document.getElementById('mtx-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mtx-toast';
    el.addEventListener('click', () => {
      if (_toastClickHandler) {
        _toastClickHandler();
        el.classList.remove('visible');
      }
    });
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');

  if (onClick) {
    el.style.cursor = 'pointer';
    _toastClickHandler = onClick;
  } else {
    el.style.cursor = 'default';
    _toastClickHandler = null;
  }

  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove('visible');
    _toastClickHandler = null;
  }, onClick ? 6000 : 3200);
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

// Prompt for a project folder (absolute path) to open in a code-editor tab.
// Resolves to the entered path, or null if cancelled. Offers filesystem-backed
// directory autocomplete (via /api/fs/list) as you type. Styled like the
// schedule dialog / tab-type picker.
function promptForFolder() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'folder-prompt-overlay';
    const box = document.createElement('div');
    box.className = 'folder-prompt';
    box.innerHTML = '<div class="folder-prompt-title">Open folder</div>';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'folder-prompt-input';
    input.placeholder = '/path/to/project';
    input.spellcheck = false;
    input.autocomplete = 'off';

    const list = document.createElement('div');
    list.className = 'folder-prompt-list';
    list.hidden = true;

    const row = document.createElement('div');
    row.className = 'folder-prompt-actions';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    const open = document.createElement('button');
    open.textContent = 'Open';
    open.className = 'primary';
    row.append(cancel, open);
    box.append(input, list, row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = (val) => { overlay.remove(); resolve(val); };
    const submit = () => { const v = input.value.trim(); if (v) close(v); };

    // ── Directory autocomplete ────────────────────────────────────────────────
    let items = [];        // [{ name, full }]
    let activeIdx = -1;
    let reqSeq = 0;        // guards against out-of-order fetch responses

    const hideList = () => { list.hidden = true; items = []; activeIdx = -1; };

    const renderList = () => {
      list.innerHTML = '';
      if (!items.length) { hideList(); return; }
      items.forEach((it, i) => {
        const el = document.createElement('div');
        el.className = 'folder-prompt-suggestion' + (i === activeIdx ? ' active' : '');
        el.textContent = it.name;
        el.addEventListener('mousedown', (e) => { e.preventDefault(); drillInto(it.full); });
        list.appendChild(el);
        if (i === activeIdx) el.scrollIntoView({ block: 'nearest' });
      });
      list.hidden = false;
    };

    const refresh = async () => {
      const val = input.value;
      const slash = val.lastIndexOf('/');
      if (slash < 0) { hideList(); return; }     // need an absolute parent to list
      const parent = val.slice(0, slash + 1);    // always ends with '/'
      const partial = val.slice(slash + 1).toLowerCase();
      const seq = ++reqSeq;
      try {
        const res = await fetch('/api/fs/list?path=' + encodeURIComponent(parent));
        const data = await res.json();
        if (seq !== reqSeq) return;              // a newer request superseded this one
        if (!res.ok) { hideList(); return; }
        items = data.entries
          .filter(e => e.type === 'dir' && e.name.toLowerCase().startsWith(partial))
          .slice(0, 60)
          .map(e => ({ name: e.name, full: parent + e.name }));
        activeIdx = -1;
        renderList();
      } catch { if (seq === reqSeq) hideList(); }
    };

    // Fill the input with a directory and list its children so typing can continue.
    const drillInto = (full) => { input.value = full + '/'; input.focus(); refresh(); };

    let debounce;
    input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(refresh, 110); });

    cancel.addEventListener('click', () => close(null));
    open.addEventListener('click', submit);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && !list.hidden) {
        e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); renderList();
      } else if (e.key === 'ArrowUp' && !list.hidden) {
        e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); renderList();
      } else if (e.key === 'Tab' && items.length) {
        e.preventDefault(); drillInto(items[activeIdx >= 0 ? activeIdx : 0].full);
      } else if (e.key === 'Enter') {
        if (activeIdx >= 0 && !list.hidden) { e.preventDefault(); drillInto(items[activeIdx].full); }
        else submit();
      } else if (e.key === 'Escape') {
        if (!list.hidden) hideList(); else close(null);
      }
    });

    // Default the field to the home directory so suggestions appear immediately.
    fetch('/api/fs/home').then(r => r.json()).then(({ home }) => {
      if (home && !input.value) { input.value = home + '/'; refresh(); }
    }).catch(() => {});
    setTimeout(() => input.focus(), 0);
  });
}

// Open a code-editor tab rooted at `dir` in the active pane. Called from the OSC
// 5380 handler (pane.js) when the user runs `mtx code <dir>` in a terminal.
function triggerOpenEditor(dir) {
  if (!dir) return;
  const pane = activePane || getAllPanes()[0];
  if (!pane) return;
  setActivePane(pane);
  addTab(pane, 'editor', undefined, undefined, undefined, dir);
  saveSessionState();
}

// Upload the chosen files to ~/meowtrix on the host, one request per file.
// Upload the chosen files to ~/meowtrix (or active workspace folder) on the host, one request per file.
async function uploadFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;

  let activeDir = null;
  const pane = (typeof activePane !== 'undefined') ? activePane : null;
  if (pane && pane.activeTab && pane.activeTab.type === 'editor') {
    activeDir = pane.activeTab.editorDir;
  }
  const dirName = activeDir ? (activeDir.split(/[/\\]/).pop() || activeDir) : '~/meowtrix';

  showToast(`Uploading ${files.length} file${files.length > 1 ? 's' : ''} to ${dirName}…`);
  let ok = 0;
  for (const file of files) {
    try {
      let url = '/api/upload?name=' + encodeURIComponent(file.name);
      if (activeDir) {
        url += '&dir=' + encodeURIComponent(activeDir);
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      if (res.ok) ok++;
    } catch {}
  }
  showToast(ok === files.length
    ? `Uploaded ${ok} file${ok > 1 ? 's' : ''} to ${dirName}`
    : `Uploaded ${ok}/${files.length} to ${dirName} — some failed`);
  
  if (activeDir && pane && pane.activeTab && pane.activeTab.viewEl) {
    const activeEditorRefreshBtn = pane.activeTab.viewEl.querySelector('.editor-sidebar-refresh');
    if (activeEditorRefreshBtn) {
      activeEditorRefreshBtn.click();
    }
  }
}

function initWorkspace(index = activeWorkspaceIndex) {
  if (typeof maximizedPane !== 'undefined' && index === activeWorkspaceIndex) {
    maximizedPane = null;
    document.body.classList.remove('has-maximized-pane');
  }
  ensureWorkspaceViews();
  const container = document.querySelector(`.workspace-view[data-index="${index}"]`);
  if (!container) return;

  deactivateWorkspace(index);

  if (index === activeWorkspaceIndex) {
    container.classList.remove('inactive');
    container.classList.add('active');
  } else {
    container.classList.remove('active');
    container.classList.add('inactive');
  }

  const initialPane = createPane();
  container.appendChild(initialPane.el);
  if (index === activeWorkspaceIndex) {
    setActivePane(initialPane);
  }
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

// Toggle full screen mode across different browsers
function toggleFullscreen() {
  const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!isFS) {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen mode: ${err.message} (${err.name})`);
      });
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkOnDeviceModel();

  // Apply saved theme immediately (server settings loaded async in settings.js)
  applyTheme(localStorage.getItem('theme') || 'auto');

  // ── Toolbar ──
  // Hover tooltips (styled data-kbd chip; see style.css) that spell out each
  // button's action + keyboard shortcut, platform-aware (⌘ on macOS, Ctrl
  // elsewhere). Keep in sync with runAppShortcut / the keydown handler below.
  const isMacUI = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const modKey = isMacUI ? '⌘' : 'Ctrl';
  const broadcastKbd = isMacUI ? '⌘+B' : 'Ctrl+Shift+B';
  const setBtnTip = (id, t) => {
    const el = document.getElementById(id);
    if (el) { el.dataset.kbd = t; el.removeAttribute('title'); }
  };
  setBtnTip('btn-prev-workspace', `Previous workspace (${modKey}+Left)`);
  setBtnTip('btn-next-workspace', `Next workspace (${modKey}+Right)`);
  setBtnTip('btn-split-v', `Split vertically — side by side (${modKey}+\\)`);
  setBtnTip('btn-split-h', `Split horizontally — top / bottom (${modKey}+-)`);
  setBtnTip('btn-close-pane', `Close active pane (${modKey}+Shift+W)`);
  setBtnTip('btn-broadcast', `Broadcast input to all visible terminals (${broadcastKbd})`);
  setBtnTip('btn-upload', `Upload file(s) to host — ~/meowtrix (${modKey}+Shift+U)`);
  setBtnTip('btn-schedule', `Schedule an Enter press — for when your quota resets (${modKey}+Shift+S)`);
  setBtnTip('btn-zoom-out', `Zoom out active tab (${modKey}+Shift+-)`);
  setBtnTip('btn-zoom-reset', `Reset zoom (${modKey}+Shift+0)`);
  setBtnTip('btn-zoom-in', `Zoom in active tab (${modKey}+Shift+=)`);
  setBtnTip('btn-settings', `Settings (${modKey}+,)`);
  setBtnTip('btn-fullscreen', `Enter fullscreen (${modKey}+Shift+F)`);
  setBtnTip('btn-ports', 'Active local servers');

  document.getElementById('btn-split-v').addEventListener('click', () => {
    if (activePane) splitPane(activePane, 'vertical');
  });
  document.getElementById('btn-split-h').addEventListener('click', () => {
    if (activePane) splitPane(activePane, 'horizontal');
  });
  const btnBroadcast = document.getElementById('btn-broadcast');
  if (btnBroadcast) {
    btnBroadcast.addEventListener('click', () => {
      setBroadcastInput(!broadcastInput);
    });
    // Tooltip set above via setBtnTip (data-kbd chip).
  }
  const uploadInput = document.getElementById('upload-input');
  document.getElementById('btn-upload').addEventListener('click', () => uploadInput.click());
  uploadInput.addEventListener('change', () => {
    uploadFiles(uploadInput.files);
    uploadInput.value = ''; // allow re-selecting the same file
  });
  document.getElementById('btn-close-pane').addEventListener('click', closeActivePane);

  // ── Zoom Controls ──
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    if (typeof zoomActiveTab === 'function') zoomActiveTab(0.1);
  });
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    if (typeof zoomActiveTab === 'function') zoomActiveTab(-0.1);
  });
  document.getElementById('btn-zoom-reset')?.addEventListener('click', () => {
    if (typeof resetActiveTabZoom === 'function') resetActiveTabZoom();
  });

  // ── Fullscreen ──
  const btnFullscreen = document.getElementById('btn-fullscreen');
  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', toggleFullscreen);

    const updateFullscreenUI = () => {
      const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
      const icon = btnFullscreen.querySelector('.btn-icon');
      const text = btnFullscreen.querySelector('.btn-text');
      
      const ENTER_FS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display: block;"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>`;
      const EXIT_FS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display: block;"><path d="M4 14h6v6m10-6h-6v6M4 10h6V4m10 6h-6V4"></path></svg>`;
      
      if (icon) icon.innerHTML = isFS ? EXIT_FS_SVG : ENTER_FS_SVG;
      if (text) text.textContent = isFS ? 'Exit Full' : 'Fullscreen';
      btnFullscreen.dataset.kbd = (isFS ? 'Exit fullscreen' : 'Enter fullscreen') + ` (${modKey}+Shift+F)`;
      btnFullscreen.removeAttribute('title');
      
      if (isFS) {
        btnFullscreen.classList.add('active');
      } else {
        btnFullscreen.classList.remove('active');
      }
    };

    document.addEventListener('fullscreenchange', updateFullscreenUI);
    document.addEventListener('webkitfullscreenchange', updateFullscreenUI);
  }

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', (e) => {
    // Check for workspace cycle shortcuts:
    // Mac: Command + Left/Right Arrow
    // Windows/Linux: Control + Left/Right Arrow
    const isPrevKey = e.key === 'ArrowLeft';
    const isNextKey = e.key === 'ArrowRight';
    if (isPrevKey || isNextKey) {
      const isMacCmd = isMacUI && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      const isWinLinuxCtrl = !isMacUI && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
      if (isMacCmd || isWinLinuxCtrl) {
        e.preventDefault();
        e.stopPropagation();
        if (isPrevKey) {
          switchWorkspace((activeWorkspaceIndex - 1 + 4) % 4, { direction: 'prev' });
        } else {
          switchWorkspace((activeWorkspaceIndex + 1) % 4, { direction: 'next' });
        }
        return;
      }
    }

    // Check for workspace direct selection shortcuts (Ctrl+Alt or Cmd+Alt + 1/2/3/4)
    const isAltCmd = (e.ctrlKey || e.metaKey) && e.altKey;
    if (isAltCmd) {
      if (['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        switchWorkspace(parseInt(e.key, 10) - 1);
        return;
      }
    }

    // Zoom shortcuts: Ctrl+Shift+= or Cmd+Shift+= (Zoom In), Ctrl+Shift+- or Cmd+Shift+- (Zoom Out), Ctrl+Shift+0 or Cmd+Shift+0 (Reset)
    const isZoomModifier = (e.ctrlKey || e.metaKey) && e.shiftKey;
    if (isZoomModifier) {
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof zoomActiveTab === 'function') zoomActiveTab(0.1);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof zoomActiveTab === 'function') zoomActiveTab(-0.1);
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof resetActiveTabZoom === 'function') resetActiveTabZoom();
        return;
      }
    }

    if (!(e.metaKey || e.ctrlKey)) return;
    if (runAppShortcut(e.key, e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true); // Use capture phase so terminal doesn't swallow

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

  const btnPorts = document.getElementById('btn-ports');
  if (btnPorts) {
    btnPorts.addEventListener('click', togglePortsPopover);
  }

  // ── Workspaces ──
  const btnPrevWS = document.getElementById('btn-prev-workspace');
  if (btnPrevWS) {
    btnPrevWS.addEventListener('click', () => {
      switchWorkspace((activeWorkspaceIndex - 1 + 4) % 4, { direction: 'prev' });
    });
  }
  const btnNextWS = document.getElementById('btn-next-workspace');
  if (btnNextWS) {
    btnNextWS.addEventListener('click', () => {
      switchWorkspace((activeWorkspaceIndex + 1) % 4, { direction: 'next' });
    });
  }
  const focusTriggerPrev = document.getElementById('focus-trigger-prev-ws');
  if (focusTriggerPrev) {
    focusTriggerPrev.addEventListener('focus', () => {
      switchWorkspace((activeWorkspaceIndex - 1 + 4) % 4, { direction: 'prev' });
      requestAnimationFrame(() => {
        if (document.activeElement === focusTriggerPrev) {
          focusTriggerPrev.blur();
        }
      });
    });
  }
  const focusTriggerNext = document.getElementById('focus-trigger-next-ws');
  if (focusTriggerNext) {
    focusTriggerNext.addEventListener('focus', () => {
      switchWorkspace((activeWorkspaceIndex + 1) % 4, { direction: 'next' });
      requestAnimationFrame(() => {
        if (document.activeElement === focusTriggerNext) {
          focusTriggerNext.blur();
        }
      });
    });
  }
  document.querySelectorAll('.logo-letter').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.getAttribute('data-index'), 10);
      switchWorkspace(idx);
    });
  });
  const wsBadge = document.getElementById('workspace-badge');
  if (wsBadge) {
    wsBadge.addEventListener('click', () => {
      if (typeof openPalette === 'function') {
        openPalette();
        paletteMode = 'renameWorkspace';
        paletteInput.placeholder = 'Enter new workspace name…';
        paletteInput.value = currentWorkspaces[activeWorkspaceIndex].name;
        paletteInput.focus();
        paletteInput.select();
        if (typeof renderRenameWorkspaceHint === 'function') renderRenameWorkspaceHint();
      }
    });
  }

  initSession();

  window.addEventListener('beforeunload', () => {
    // Only the active session persists on unload — an inactive tab's state is
    // stale and would overwrite the real layout.
    if (workspaceReady && isActiveSession) {
      for (let i = 0; i < 4; i++) {
        const container = document.querySelector(`.workspace-view[data-index="${i}"]`);
        if (container && container.children.length > 0) {
          currentWorkspaces[i].layout = captureWorkspaceState(i);
        }
      }
      const state = {
        activeWorkspaceIndex,
        workspaces: currentWorkspaces.map(ws => ({
          name: ws.name,
          layout: ws.layout
        }))
      };
      navigator.sendBeacon('/api/session', new Blob([JSON.stringify(state)], { type: 'application/json' }));
    }
    // The server notices our WS closing and hands the active session off.
  });
});

// ── Port Monitor Client Logic ────────────────────────────────────────────────
let activePorts = [];

function onPortsState(ports) {
  activePorts = ports || [];
  const btn = document.getElementById('btn-ports');
  const countSpan = document.getElementById('ports-count');
  if (btn && countSpan) {
    countSpan.textContent = activePorts.length;
    if (activePorts.length > 0) {
      btn.removeAttribute('hidden');
    } else {
      btn.setAttribute('hidden', '');
      const popover = document.querySelector('.ports-popover');
      if (popover) popover.remove();
    }
  }
}

function onPortsNew(ports) {
  ports.forEach(p => {
    const localServerIp = (typeof getSettings === 'function' ? getSettings().localServerIp : null) || '127.0.0.1';
    const targetUrl = `http://${localServerIp}:${p.port}`;
    const cmdStr = p.command ? ` (${p.command})` : '';
    showToast(`🚀 New server started on port ${p.port}${cmdStr}. Click to open.`, () => {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    });
  });
}

function togglePortsPopover() {
  const btn = document.getElementById('btn-ports');
  if (!btn) return;
  
  const existing = document.querySelector('.ports-popover');
  if (existing) {
    existing.remove();
    document.removeEventListener('click', onPortsDocClick, true);
    return;
  }
  
  const popover = document.createElement('div');
  popover.className = 'ports-popover';
  
  let html = `<div class="ports-popover-header">Active Servers (${activePorts.length})</div>`;
  if (activePorts.length === 0) {
    html += `<div style="padding: 12px; font-size: 12px; color: var(--text3); text-align: center;">No active servers found</div>`;
  } else {
    activePorts.forEach(p => {
      const localServerIp = (typeof getSettings === 'function' ? getSettings().localServerIp : null) || '127.0.0.1';
      const targetUrl = `http://${localServerIp}:${p.port}`;
      const desc = p.command ? `${p.command} (PID: ${p.pid})` : `Port ${p.port}`;
      html += `
        <div class="ports-popover-item" data-url="${targetUrl}">
          <div class="ports-popover-info">
            <span class="ports-popover-port">:${p.port}</span>
            <span class="ports-popover-desc">${desc}</span>
          </div>
          <span class="ports-popover-action">Open</span>
        </div>
      `;
    });
  }
  
  popover.innerHTML = html;
  document.body.appendChild(popover);
  
  const rect = btn.getBoundingClientRect();
  popover.style.top = `${rect.bottom + 6}px`;
  const popoverWidth = 280;
  let left = rect.left + (rect.width - popoverWidth) / 2;
  if (left + popoverWidth > window.innerWidth) {
    left = window.innerWidth - popoverWidth - 10;
  }
  popover.style.left = `${Math.max(10, left)}px`;
  
  popover.addEventListener('click', (e) => {
    const item = e.target.closest('.ports-popover-item');
    if (item) {
      const url = item.getAttribute('data-url');
      window.open(url, '_blank', 'noopener,noreferrer');
      popover.remove();
      document.removeEventListener('click', onPortsDocClick, true);
    }
  });
  
  setTimeout(() => {
    document.addEventListener('click', onPortsDocClick, true);
  }, 0);
}

function onPortsDocClick(e) {
  const popover = document.querySelector('.ports-popover');
  const btn = document.getElementById('btn-ports');
  if (popover && !popover.contains(e.target) && (!btn || !btn.contains(e.target))) {
    popover.remove();
    document.removeEventListener('click', onPortsDocClick, true);
  }
}

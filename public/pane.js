let activePane = null;
let tabCounter = 0;
const paneRegistry = new Map();

// ── Broadcast input ──────────────────────────────────────────────────────────
// When on, keystrokes from any terminal are mirrored to every *visible* terminal
// (the active tab of each pane), like iTerm2 broadcast / tmux synchronize-panes.
let broadcastInput = false;

function visibleTerminalTabs() {
  return getAllPanes()
    .map(p => p.activeTab)
    .filter(t => t && t.type === 'terminal' && t.ptyId);
}

function setBroadcastInput(on) {
  broadcastInput = on;
  document.body.classList.toggle('broadcasting', on);
  const btn = document.getElementById('btn-broadcast');
  if (btn) { btn.classList.toggle('active', on); btn.setAttribute('aria-pressed', String(on)); }
}

// Send terminal input to its own PTY, or fan out to all visible terminals when
// broadcast is enabled.
function sendTerminalInput(ptyId, data) {
  const targets = broadcastInput ? visibleTerminalTabs() : null;
  if (targets && targets.length > 1) {
    targets.forEach(t => wsSend({ type: 'pty:input', id: t.ptyId, data }));
  } else {
    wsSend({ type: 'pty:input', id: ptyId, data });
  }
}

function uid() { return 'id-' + (++tabCounter) + '-' + Math.random().toString(36).slice(2, 7); }

function paneOfTab(tabEl) {
  const paneEl = tabEl.closest('.pane');
  return paneEl ? paneRegistry.get(paneEl) : null;
}

// ── Tab drag-and-drop ────────────────────────────────────────────────────────
let dragState = null;        // { tab, srcPane }
let dropIndicator = null;    // shared insertion marker, moved between tab bars

function clearDropIndicator() { dropIndicator?.remove(); }

// ── Touch tab dragging ───────────────────────────────────────────────────────
// HTML5 drag events never fire for touch input, so reproduce the same reorder/
// move behaviour with Pointer Events. Reuses computeDropRef / moveTab / the
// shared dropIndicator so touch and mouse dragging stay in lockstep.
let touchDrag = null;            // { tab, pointerId, startX, startY, active }
let suppressTabClickUntil = 0;   // ignore the click synthesized after a drag

function paneUnderPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const paneEl = el?.closest?.('.pane');
  return paneEl ? paneRegistry.get(paneEl) : null;
}

function onTabPointerDown(e, tab) {
  // Mouse/pen keep using native HTML5 DnD; only hijack touch.
  if (e.pointerType !== 'touch') return;
  if (e.target.closest('.tab-close')) return; // let close taps through
  touchDrag = { tab, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, active: false };
}

function onTouchDragMove(e) {
  if (!touchDrag || e.pointerId !== touchDrag.pointerId) return;
  if (!touchDrag.active) {
    if (Math.hypot(e.clientX - touchDrag.startX, e.clientY - touchDrag.startY) < 8) return;
    touchDrag.active = true;
    dragState = { tab: touchDrag.tab, srcPane: paneOfTab(touchDrag.tab.tabEl) };
    touchDrag.tab.tabEl.classList.add('dragging');
    document.body.classList.add('dragging-tab');
  }
  e.preventDefault(); // suppress scrolling once we're dragging
  const pane = paneUnderPoint(e.clientX, e.clientY);
  if (pane) {
    if (!dropIndicator) { dropIndicator = document.createElement('div'); dropIndicator.className = 'tab-drop-indicator'; }
    pane.tabBar.insertBefore(dropIndicator, computeDropRef(pane, e));
  } else clearDropIndicator();
}

function endTouchDrag(e, drop) {
  if (!touchDrag || e.pointerId !== touchDrag.pointerId) return;
  const { tab, active } = touchDrag;
  touchDrag = null;
  if (!active) return; // it was a tap → let the click handler activate the tab
  tab.tabEl.classList.remove('dragging');
  document.body.classList.remove('dragging-tab');
  const pane = drop ? paneUnderPoint(e.clientX, e.clientY) : null;
  clearDropIndicator();
  if (pane && dragState) moveTab(dragState.srcPane, tab.id, pane, computeDropRef(pane, e));
  dragState = null;
  suppressTabClickUntil = Date.now() + 400;
}

document.addEventListener('pointermove', onTouchDragMove, { passive: false });
document.addEventListener('pointerup', (e) => endTouchDrag(e, true));
document.addEventListener('pointercancel', (e) => endTouchDrag(e, false));

// Element in `pane`'s tab bar to insert before (a .tab or the .tab-add button).
function computeDropRef(pane, e) {
  const addBtn = pane.tabBar.querySelector('.tab-add');
  // Pointer below the tab bar (over the pane body) → drop at the end.
  if (e.clientY > pane.tabBar.getBoundingClientRect().bottom) return addBtn;
  const tabEls = [...pane.tabBar.querySelectorAll('.tab')];
  for (const el of tabEls) {
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left + r.width / 2) return el;
  }
  return addBtn;
}

function onPaneDragOver(e, pane) {
  if (!dragState) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (!dropIndicator) {
    dropIndicator = document.createElement('div');
    dropIndicator.className = 'tab-drop-indicator';
  }
  pane.tabBar.insertBefore(dropIndicator, computeDropRef(pane, e));
}

function onPaneDrop(e, pane) {
  if (!dragState) return;
  e.preventDefault();
  clearDropIndicator();
  const ref = computeDropRef(pane, e);
  moveTab(dragState.srcPane, dragState.tab.id, pane, ref);
}

// Move a tab to `destPane`, inserting its tab element before `refEl`.
function moveTab(srcPane, tabId, destPane, refEl) {
  const idx = srcPane.tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;
  const tab = srcPane.tabs[idx];

  // Dropping onto its own current slot → nothing to do.
  if (srcPane === destPane && (refEl === tab.tabEl || refEl === tab.tabEl.nextSibling)) return;

  srcPane.tabs.splice(idx, 1);
  destPane.tabBar.insertBefore(tab.tabEl, refEl);
  if (tab.viewEl.parentElement !== destPane.contentEl) destPane.contentEl.appendChild(tab.viewEl);

  // Mirror the resulting tab-bar order into the model.
  const order = [...destPane.tabBar.querySelectorAll('.tab')];
  destPane.tabs.splice(order.indexOf(tab.tabEl), 0, tab);

  if (srcPane !== destPane) {
    if (srcPane.tabs.length) activateTab(srcPane, srcPane.tabs[Math.max(0, idx - 1)].id);
    else { srcPane.activeTab = null; collapseEmptyPane(srcPane); }
  }
  setActivePane(destPane);
  activateTab(destPane, tabId);
  // Reparenting can drop the xterm's rendered rows; refit + repaint.
  if (tab.type === 'terminal' && tab.term) {
    requestAnimationFrame(() => { tab.fitAddon?.fit(); tab.term.refresh(0, tab.term.rows - 1); });
  }
  saveSessionState();
}

// Remove an emptied pane and collapse its split, keeping at least one pane.
function collapseEmptyPane(pane) {
  if (getAllPanes().length <= 1) return;
  const paneEl = pane.el;
  const parent = paneEl.parentElement;
  paneRegistry.delete(paneEl);
  if (parent.classList.contains('split-container')) {
    const panes = [...parent.children].filter(c => !c.classList.contains('split-divider'));
    if (panes.length > 2) {
      // Flat container with 3+ children: drop just this pane and one adjacent
      // divider, then redistribute the rest equally.
      const divider = paneEl.nextElementSibling?.classList.contains('split-divider')
        ? paneEl.nextElementSibling
        : paneEl.previousElementSibling;
      paneEl.remove();
      divider?.remove();
      equalizeChildren(parent);
    } else {
      // Only one child would remain: collapse the container and promote the
      // surviving sibling into the container's slot (inheriting its flex).
      const sibling = panes.find(c => c !== paneEl);
      sibling.style.flex = parent.style.flex || '1 1 0';
      parent.parentElement.replaceChild(sibling, parent);
    }
  } else {
    paneEl.remove();
  }
  if (activePane === pane) {
    const remaining = getAllPanes();
    activePane = null;
    if (remaining.length) setActivePane(remaining[0]);
  }
}

// Derive the xterm theme from the active theme's CSS variables so every
// theme (current and future) colors its terminals without extra wiring.
function getTermTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
  const bg = v('--term-bg', '#0a0a0e');
  return {
    background: bg,
    foreground: v('--term-fg', '#ededf2'),
    cursor: v('--accent', '#8b5cf6'),
    cursorAccent: bg,
    selectionBackground: v('--accent2', 'rgba(139,92,246,0.3)'),
  };
}

function createPane() {
  const el = document.createElement('div');
  el.className = 'pane';

  const tabBar = document.createElement('div');
  tabBar.className = 'pane-tabs';
  el.appendChild(tabBar);

  const contentEl = document.createElement('div');
  contentEl.className = 'pane-content';
  el.appendChild(contentEl);

  const addBtn = document.createElement('span');
  addBtn.className = 'tab-add';
  addBtn.textContent = '+';
  addBtn.title = 'New tab';
  tabBar.appendChild(addBtn);

  const pane = { type: 'pane', el, tabBar, contentEl, tabs: [], activeTab: null };
  paneRegistry.set(el, pane);

  addBtn.addEventListener('click', (e) => { e.stopPropagation(); showTabTypePicker(e, pane); });
  el.addEventListener('mousedown', () => setActivePane(pane));

  // Tab drag-and-drop drop zone (reorder within / move across panes).
  el.addEventListener('dragover', (e) => onPaneDragOver(e, pane));
  el.addEventListener('drop', (e) => onPaneDrop(e, pane));
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) clearDropIndicator(); });

  return pane;
}

function setActivePane(pane) {
  if (activePane) activePane.el.classList.remove('active');
  activePane = pane;
  pane.el.classList.add('active');
}

function addTab(pane, type, existingId, existingPtyId, existingUrl) {
  const id = existingId || uid();

  const viewEl = document.createElement('div');
  viewEl.className = 'pane-view';
  viewEl.dataset.tabId = id;
  pane.contentEl.appendChild(viewEl);

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  const icon = document.createElement('span');
  icon.className = 'tab-icon';
  icon.textContent = type === 'terminal' ? '⬛' : '🌐';
  const label = document.createElement('span');
  label.textContent = type === 'terminal' ? 'Terminal' : 'Browser';
  const closeBtn = document.createElement('span');
  closeBtn.className = 'tab-close';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close tab';
  // Handlers resolve the pane from the DOM at event time, so they keep working
  // after the tab is dragged into a different pane.
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); const p = paneOfTab(tabEl); if (p) closeTab(p, id); });
  tabEl.append(icon, label, closeBtn);
  tabEl.addEventListener('click', () => {
    if (Date.now() < suppressTabClickUntil) return; // ignore click synthesized after a touch drag
    const p = paneOfTab(tabEl); if (p) activateTab(p, id);
  });
  tabEl.addEventListener('pointerdown', (e) => onTabPointerDown(e, tab));
  tabEl.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); const p = paneOfTab(tabEl); if (p) closeTab(p, id); } });
  pane.tabBar.insertBefore(tabEl, pane.tabBar.lastChild);

  const tab = { id, type, tabEl, viewEl, label, term: null, fitAddon: null, ptyId: null, currentUrl: null };
  pane.tabs.push(tab);

  tabEl.draggable = true;
  tabEl.addEventListener('dragstart', (e) => {
    dragState = { tab, srcPane: paneOfTab(tabEl) };
    tabEl.classList.add('dragging');
    document.body.classList.add('dragging-tab');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch {}
  });
  tabEl.addEventListener('dragend', () => {
    tabEl.classList.remove('dragging');
    document.body.classList.remove('dragging-tab');
    clearDropIndicator();
    dragState = null;
  });

  if (type === 'terminal') initTerminalTab(tab, existingPtyId);
  else initBrowserTab(tab, viewEl, label, existingUrl);

  activateTab(pane, id);
  return tab;
}

function activateTab(pane, id) {
  pane.tabs.forEach(t => {
    t.tabEl.classList.toggle('active', t.id === id);
    t.viewEl.classList.toggle('active', t.id === id);
  });
  pane.activeTab = pane.tabs.find(t => t.id === id);
  if (pane.activeTab?.type === 'terminal' && pane.activeTab.fitAddon) {
    requestAnimationFrame(() => { pane.activeTab.fitAddon.fit(); pane.activeTab.term?.focus(); });
  }
}

function closeTab(pane, id) {
  const idx = pane.tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = pane.tabs[idx];
  if (typeof teardownSchedule === 'function') teardownSchedule(tab); // stop any pending Enter timer
  if (tab.ptyId) destroyPty(tab.ptyId);
  if (tab.term) tab.term.dispose();
  tab.viewEl.remove();
  tab.tabEl.remove();
  pane.tabs.splice(idx, 1);
  if (pane.tabs.length) activateTab(pane, pane.tabs[Math.max(0, idx - 1)].id);
  saveSessionState();
}

function initTerminalTab(tab, existingPtyId) {
  tab.viewEl.classList.add('terminal-view');
  const s = getSettings();
  const term = new Terminal({
    theme: getTermTheme(),
    fontSize: s.termFontSize || 13,
    fontFamily: s.termFontFamily || '"Cascadia Code", "JetBrains Mono", Menlo, Monaco, monospace',
    cursorBlink: true,
    scrollback: s.termScrollback || 10000,
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(tab.viewEl);
  tab.term = term;
  tab.fitAddon = fitAddon;

  const ptyId = existingPtyId || uid();
  tab.ptyId = ptyId;

  const initPty = () => { fitAddon.fit(); createPty(ptyId, term, term.cols, term.rows); };
  // Small rAF delay ensures the terminal is sized before createPty
  requestAnimationFrame(initPty);
  // Web fonts load async; fitting with fallback metrics clips the bottom row,
  // so re-fit (which resizes the PTY too) once the real font is ready.
  if (document.fonts?.ready) document.fonts.ready.then(() => {
    if (tab.viewEl.classList.contains('active')) fitAddon.fit();
  });

  // The `mtx` command prints OSC 5379 with an absolute path; intercept it here
  // and trigger a browser download instead of rendering it. Returning true
  // marks the sequence handled so xterm consumes it (nothing is displayed).
  term.parser.registerOscHandler(5379, (filePath) => {
    if (typeof triggerDownload === 'function') triggerDownload(filePath);
    return true;
  });

  term.onData(data => {
    // A scheduled tab is locked: swallow input until its Enter fires or is
    // cancelled, so stray keystrokes can't disturb the queued command.
    if (tab.schedule) return;
    // Apply any armed mobile sticky modifiers (Ctrl/Alt/Cmd) to typed input.
    const out = (typeof applyStickyMods === 'function') ? applyStickyMods(data) : data;
    if (out) sendTerminalInput(ptyId, out);
  });
  term.onResize(({ cols, rows }) => wsSend({ type: 'pty:resize', id: ptyId, cols, rows }));
  term.onTitleChange(title => { if (title) tab.label.textContent = title; });

  const ro = new ResizeObserver(() => { if (tab.viewEl.classList.contains('active')) fitAddon.fit(); });
  ro.observe(tab.viewEl);
}

function initBrowserTab(tab, viewEl, label, initialUrl) {
  viewEl.classList.add('browser-view');

  const bar = document.createElement('div');
  bar.className = 'browser-bar';

  const backBtn = document.createElement('button');   backBtn.textContent = '←'; backBtn.title = 'Back';
  const fwdBtn = document.createElement('button');    fwdBtn.textContent = '→'; fwdBtn.title = 'Forward';
  const reloadBtn = document.createElement('button'); reloadBtn.textContent = '↺'; reloadBtn.title = 'Reload';
  const extBtn = document.createElement('button');    extBtn.textContent = '↗'; extBtn.title = 'Open in new window';

  const urlInput = document.createElement('input');
  urlInput.className = 'browser-url';
  urlInput.type = 'text';
  urlInput.placeholder = 'Enter URL…';
  urlInput.spellcheck = false;

  bar.append(backBtn, fwdBtn, reloadBtn, extBtn, urlInput);

  const loadingBar = document.createElement('div');
  loadingBar.className = 'browser-loading';

  const frame = document.createElement('iframe');
  frame.className = 'browser-frame';
  frame.sandbox = 'allow-scripts allow-forms allow-popups allow-modals allow-same-origin';

  // Local start page shown when no URL is loaded (new tabs).
  const startEl = document.createElement('div');
  startEl.className = 'browser-start';
  startEl.innerHTML = `
    <div class="browser-start-card">
      <div class="browser-start-icon">🌐</div>
      <h2>Browser</h2>
      <p>Type a URL in the address bar above, then press <kbd>Enter</kbd>.</p>
      <ul>
        ${window.DEMO_MODE
          ? `<li>Demo mode: pages load directly (no server proxy), so only sites that allow embedding will appear.</li>
             <li>Many sites (Google, GitHub, sign-in pages) block embedding and show blank — use <strong>↗</strong> to open them in a real window.</li>`
          : `<li>Pages are fetched through a built-in proxy so they can be embedded here.</li>
             <li>Some sites (Google, sign-in pages, heavily bot-protected sites) can’t be embedded — use <strong>↗</strong> to open them in a real window.</li>`}
      </ul>
    </div>`;

  // Demo mode has no server proxy: load URLs straight into the iframe. This only
  // works for sites that permit embedding (no X-Frame-Options / CSP frame
  // blocking) — the hint below sets expectations.
  let hintEl = null;
  if (window.DEMO_MODE) {
    hintEl = document.createElement('div');
    hintEl.className = 'browser-hint';
    hintEl.textContent = 'Demo: some sites block embedding and show blank — use ↗ to open in a new window.';
  }

  viewEl.append(bar, ...(hintEl ? [hintEl] : []), loadingBar, frame, startEl);

  const navigate = (url) => {
    url = url.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    startEl.classList.remove('visible');
    frame.style.display = '';
    tab.currentUrl = url;
    // Serverless demo embeds directly; otherwise route through the proxy.
    frame.src = window.DEMO_MODE ? url : '/proxy/' + encodeURIComponent(url);
    if (hintEl) hintEl.classList.add('visible');
    urlInput.value = url;
    try { label.textContent = new URL(url).hostname.replace('www.', ''); }
    catch { label.textContent = 'Browser'; }
    loadingBar.classList.add('active');
  };

  // Reset to the instructions start page (no site loaded).
  const showStart = () => {
    tab.currentUrl = null;
    frame.removeAttribute('src');
    frame.style.display = 'none';
    startEl.classList.add('visible');
    if (hintEl) hintEl.classList.remove('visible');
    loadingBar.classList.remove('active');
    urlInput.value = '';
    label.textContent = 'New Tab';
  };

  frame.addEventListener('load', () => loadingBar.classList.remove('active'));

  const homepage = (getSettings().browserHomepage || '').trim();
  if (initialUrl) navigate(initialUrl);
  else if (homepage) navigate(homepage);
  else showStart();

  urlInput.addEventListener('focus', () => urlInput.select());
  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { navigate(urlInput.value); urlInput.blur(); }
    if (e.key === 'Escape') { urlInput.value = tab.currentUrl || ''; urlInput.blur(); }
  });
  backBtn.addEventListener('click', () => { try { frame.contentWindow.history.back(); } catch {} });
  fwdBtn.addEventListener('click', () => { try { frame.contentWindow.history.forward(); } catch {} });
  reloadBtn.addEventListener('click', () => { if (tab.currentUrl) navigate(tab.currentUrl); });
  extBtn.addEventListener('click', () => { if (tab.currentUrl) window.open(tab.currentUrl, '_blank'); });
}

// Find a live terminal tab by its PTY id (used by reconnect restore + schedules).
function tabByPtyId(ptyId) {
  if (!ptyId) return null;
  for (const pane of getAllPanes()) {
    const t = pane.tabs.find(t => t.type === 'terminal' && t.ptyId === ptyId);
    if (t) return t;
  }
  return null;
}

// Called from ws.js when the server reports a reconnecting PTY's generation grid
// size (just before replaying its buffer). Snap the xterm to that size so the
// buffer renders exactly as it was produced — otherwise zsh's PROMPT_EOL_MARK
// strands a `%` at the start of every prompt line.
function onPtyRestore(ptyId, cols, rows) {
  const tab = tabByPtyId(ptyId);
  if (tab?.term && cols && rows) { try { tab.term.resize(cols, rows); } catch {} }
}

// Called once the replayed buffer has finished rendering: re-fit the visible
// terminal to its actual pane, which reflows the (correctly rendered) content.
function onReplayDone(ptyId) {
  const tab = tabByPtyId(ptyId);
  if (tab?.fitAddon && tab.viewEl.classList.contains('active')) {
    requestAnimationFrame(() => { try { tab.fitAddon.fit(); } catch {} });
  }
}

function getAllPanes() {
  const results = [];
  function walk(el) {
    if (el.classList?.contains('pane')) { const p = paneRegistry.get(el); if (p) results.push(p); }
    for (const child of el.children) walk(child);
  }
  walk(document.getElementById('workspace'));
  return results;
}

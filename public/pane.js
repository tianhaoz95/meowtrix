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

function addTab(pane, type, existingId, existingPtyId, existingUrl, existingDir, existingEditorWidth, existingEditorCollapsed, existingBrowserConsoleOpen) {
  const id = existingId || uid();

  const viewEl = document.createElement('div');
  viewEl.className = 'pane-view';
  viewEl.dataset.tabId = id;
  pane.contentEl.appendChild(viewEl);

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  const icon = document.createElement('span');
  icon.className = 'tab-icon';
  icon.textContent = type === 'terminal' ? '⬛' : type === 'editor' ? '📝' : '🌐';
  const label = document.createElement('span');
  label.textContent = type === 'terminal' ? 'Terminal' : type === 'editor' ? 'Editor' : 'Browser';
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

  const tab = {
    id,
    type,
    tabEl,
    viewEl,
    label,
    term: null,
    fitAddon: null,
    ptyId: null,
    currentUrl: null,
    editorDir: null,
    editorSidebarWidth: existingEditorWidth || null,
    editorSidebarCollapsed: !!existingEditorCollapsed,
    consoleOpen: !!existingBrowserConsoleOpen,
    isCustomLabel: false
  };
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
  else if (type === 'editor') initEditorTab(tab, viewEl, existingDir);
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
    requestAnimationFrame(() => {
      if (pane.activeTab?.type === 'terminal' && pane.activeTab.fitAddon) {
        pane.activeTab.fitAddon.fit();
        pane.activeTab.term?.focus();
        if (typeof refreshMobileScrollbar === 'function') refreshMobileScrollbar(pane.activeTab);
      }
    });
  }
  if (pane.activeTab?.onActivate) requestAnimationFrame(() => pane.activeTab.onActivate());
}

function closeTab(pane, id) {
  const idx = pane.tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = pane.tabs[idx];
  if (typeof teardownSchedule === 'function') teardownSchedule(tab); // stop any pending Enter timer
  if (tab.ptyId) destroyPty(tab.ptyId);
  if (tab.term) tab.term.dispose();
  if (tab.disposeTerminal) tab.disposeTerminal();
  if (tab.disposeEditor) tab.disposeEditor();
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

  if (window.WebLinksAddon) {
    const webLinksAddon = new window.WebLinksAddon.WebLinksAddon((event, uri) => {
      event.preventDefault();
      event.stopPropagation();
      
      // Check if it's a 0.0.0.0 link to automatically open with selected host IP
      let checkUri = uri;
      if (!/^https?:\/\//i.test(checkUri)) {
        checkUri = 'http://' + checkUri;
      }
      let parsed = null;
      try {
        parsed = new URL(checkUri);
      } catch (e) {}

      if (parsed && parsed.hostname === '0.0.0.0') {
        const selectedIp = (typeof getSettings === 'function' ? getSettings().localServerIp : null) || '127.0.0.1';
        parsed.hostname = selectedIp;
        const newUri = parsed.toString();
        window.open(newUri, '_blank', 'noopener,noreferrer');
        return;
      }

      // Close any existing link menus
      const existingMenu = document.querySelector('.term-link-menu');
      if (existingMenu) {
        existingMenu.remove();
      }

      // Create the menu element
      const menuEl = document.createElement('div');
      menuEl.className = 'term-link-menu';
      
      menuEl.innerHTML = `
        <div class="term-link-menu-header">Link Options</div>
        <div class="term-link-menu-url" title="${uri}">${uri}</div>
        <div class="term-link-menu-item" data-action="new-tab">
          <span class="term-link-menu-item-icon">🌐</span>
          <span>Open in browser tab</span>
        </div>
        <div class="term-link-menu-item" data-action="app-tab">
          <span class="term-link-menu-item-icon">🐾</span>
          <span>Open in Meowtrix tab</span>
        </div>
        <div class="term-link-menu-item" data-action="copy">
          <span class="term-link-menu-item-icon">📋</span>
          <span>Copy URL</span>
        </div>
      `;

      // Position the menu
      menuEl.style.position = 'fixed';
      document.body.appendChild(menuEl);

      const menuWidth = 240;
      const menuHeight = 150;
      let left = event.clientX;
      let top = event.clientY;

      if (left + menuWidth > window.innerWidth) {
        left = window.innerWidth - menuWidth - 10;
      }
      if (top + menuHeight > window.innerHeight) {
        top = window.innerHeight - menuHeight - 10;
      }
      left = Math.max(10, left);
      top = Math.max(10, top);

      menuEl.style.left = `${left}px`;
      menuEl.style.top = `${top}px`;

      const closeMenu = () => {
        menuEl.remove();
        document.removeEventListener('mousedown', onDocClick, true);
        document.removeEventListener('touchstart', onDocClick, true);
      };

      const onDocClick = (e) => {
        if (!menuEl.contains(e.target)) {
          closeMenu();
        }
      };

      // Add click handlers for menu items
      menuEl.addEventListener('click', (e) => {
        const item = e.target.closest('.term-link-menu-item');
        if (!item) return;

        const action = item.getAttribute('data-action');
        if (action === 'new-tab') {
          window.open(uri, '_blank', 'noopener,noreferrer');
          closeMenu();
        } else if (action === 'app-tab') {
          const pane = paneOfTab(tab.tabEl);
          if (pane) {
            addTab(pane, 'browser', null, null, uri);
            if (typeof saveSessionState === 'function') saveSessionState();
          }
          closeMenu();
        } else if (action === 'copy') {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(uri).then(() => {
              item.innerHTML = '<span class="term-link-menu-item-icon">✓</span><span>Copied!</span>';
              item.style.color = '#10b981'; // Green accent
              setTimeout(closeMenu, 600);
            }).catch(() => fallbackCopy(item));
          } else {
            fallbackCopy(item);
          }
        }
      });

      const fallbackCopy = (item) => {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = uri;
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          textarea.remove();
          item.innerHTML = '<span class="term-link-menu-item-icon">✓</span><span>Copied!</span>';
          item.style.color = '#10b981';
          setTimeout(closeMenu, 600);
        } catch (err) {
          console.error('Failed to copy', err);
          closeMenu();
        }
      };

      setTimeout(() => {
        document.addEventListener('mousedown', onDocClick, true);
        document.addEventListener('touchstart', onDocClick, true);
      }, 0);
    });
    term.loadAddon(webLinksAddon);
  }

  term.open(tab.viewEl);
  tab.term = term;
  tab.fitAddon = fitAddon;

  const ptyId = existingPtyId || uid();
  tab.ptyId = ptyId;

  const initPty = () => {
    fitAddon.fit();
    createPty(ptyId, term, term.cols, term.rows);
    if (typeof refreshMobileScrollbar === 'function') refreshMobileScrollbar(tab);
  };
  // Small rAF delay ensures the terminal is sized before createPty
  requestAnimationFrame(initPty);
  // Web fonts load async; fitting with fallback metrics clips the bottom row,
  // so re-fit (which resizes the PTY too) once the real font is ready.
  if (document.fonts?.ready) document.fonts.ready.then(() => {
    if (tab.viewEl.classList.contains('active')) {
      fitAddon.fit();
      if (typeof refreshMobileScrollbar === 'function') refreshMobileScrollbar(tab);
    }
  });

  // The `mtx` command prints OSC 5379 with an absolute path; intercept it here
  // and trigger a browser download instead of rendering it. Returning true
  // marks the sequence handled so xterm consumes it (nothing is displayed).
  term.parser.registerOscHandler(5379, (filePath) => {
    if (typeof triggerDownload === 'function') triggerDownload(filePath);
    return true;
  });

  // `mtx code <dir>` prints OSC 5380 with an absolute directory; open an editor
  // tab rooted there instead of rendering the sequence.
  term.parser.registerOscHandler(5380, (dir) => {
    if (typeof triggerOpenEditor === 'function') triggerOpenEditor(dir);
    return true;
  });

  term.attachCustomKeyEventHandler(e => {
    if (tab.acActive) {
      if (e.key === 'ArrowUp' && e.type === 'keydown') {
        e.preventDefault();
        e.stopPropagation();
        moveAutocompleteSelection(tab, -1);
        return false;
      }
      if (e.key === 'ArrowDown' && e.type === 'keydown') {
        e.preventDefault();
        e.stopPropagation();
        moveAutocompleteSelection(tab, 1);
        return false;
      }
      if (e.key === 'Enter' && e.type === 'keydown') {
        e.preventDefault();
        e.stopPropagation();
        selectAutocompleteItem(tab, true);
        return false;
      }
      if (e.key === 'Tab' && e.type === 'keydown') {
        e.preventDefault();
        e.stopPropagation();
        selectAutocompleteItem(tab, false);
        return false;
      }
      if (e.key === 'Escape' && e.type === 'keydown') {
        e.preventDefault();
        e.stopPropagation();
        closeAutocomplete(tab);
        return false;
      }
    }
    return true;
  });

  term.textarea?.addEventListener('blur', () => {
    setTimeout(() => {
      if (tab.acActive) closeAutocomplete(tab);
    }, 150);
  });

  term.onData(data => {
    // A scheduled tab is locked: swallow input until its Enter fires or is
    // cancelled, so stray keystrokes can't disturb the queued command.
    if (tab.schedule) return;

    if (data === '@' && !tab.acActive) {
      startAutocomplete(tab);
    } else if (tab.acActive) {
      handleAutocompleteData(tab, data);
    }

    // Apply any armed mobile sticky modifiers (Ctrl/Alt/Cmd) to typed input.
    const out = (typeof applyStickyMods === 'function') ? applyStickyMods(data) : data;
    if (out) sendTerminalInput(ptyId, out);
  });
  term.onResize(({ cols, rows }) => wsSend({ type: 'pty:resize', id: ptyId, cols, rows }));
  term.onTitleChange(title => { if (title && !tab.isCustomLabel) tab.label.textContent = title; });

  const ro = new ResizeObserver(() => {
    if (tab.viewEl.classList.contains('active')) {
      fitAddon.fit();
      if (typeof refreshMobileScrollbar === 'function') refreshMobileScrollbar(tab);
    }
  });
  ro.observe(tab.viewEl);
  tab.disposeTerminal = () => {
    ro.disconnect();
    if (tab.mobileScrollDis) { tab.mobileScrollDis.dispose(); tab.mobileScrollDis = null; }
    if (tab.mobileLfDis) { tab.mobileLfDis.dispose(); tab.mobileLfDis = null; }
    if (tab.mobileResizeDis) { tab.mobileResizeDis.dispose(); tab.mobileResizeDis = null; }
    if (tab.acActive) closeAutocomplete(tab);
  };
}

function initBrowserTab(tab, viewEl, label, initialUrl) {
  viewEl.classList.add('browser-view');

  const bar = document.createElement('div');
  bar.className = 'browser-bar';

  const backBtn = document.createElement('button');   backBtn.textContent = '←'; backBtn.title = 'Back';
  const fwdBtn = document.createElement('button');    fwdBtn.textContent = '→'; fwdBtn.title = 'Forward';
  const reloadBtn = document.createElement('button'); reloadBtn.textContent = '↺'; reloadBtn.title = 'Reload';
  const extBtn = document.createElement('button');    extBtn.textContent = '↗'; extBtn.title = 'Open in new window';
  const consoleBtn = document.createElement('button');
  consoleBtn.className = 'browser-console-toggle';
  consoleBtn.textContent = 'Console';
  consoleBtn.title = 'Toggle Developer Console';

  const urlInput = document.createElement('input');
  urlInput.className = 'browser-url';
  urlInput.type = 'text';
  urlInput.placeholder = 'Enter URL…';
  urlInput.spellcheck = false;

  bar.append(backBtn, fwdBtn, reloadBtn, extBtn, consoleBtn, urlInput);

  const loadingBar = document.createElement('div');
  loadingBar.className = 'browser-loading';

  const frame = document.createElement('iframe');
  frame.className = 'browser-frame';
  frame.sandbox = 'allow-scripts allow-forms allow-popups allow-modals allow-same-origin';

  // Console Panel layout
  const consolePanel = document.createElement('div');
  consolePanel.className = 'browser-console-panel';
  consolePanel.style.height = '180px';
  consolePanel.style.display = tab.consoleOpen ? 'flex' : 'none';

  const consoleResizer = document.createElement('div');
  consoleResizer.className = 'browser-console-resizer';

  const consoleHeader = document.createElement('div');
  consoleHeader.className = 'browser-console-header';

  const consoleTitle = document.createElement('div');
  consoleTitle.className = 'browser-console-title';
  consoleTitle.innerHTML = '<span>Console</span><span class="console-indicator"></span>';

  const consoleControls = document.createElement('div');
  consoleControls.className = 'browser-console-controls';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'console-clear-btn';
  clearBtn.innerHTML = '🗑️ Clear';
  clearBtn.title = 'Clear Console';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'console-close-btn';
  closeBtn.innerHTML = '✕';
  closeBtn.title = 'Close Console';

  consoleControls.append(clearBtn, closeBtn);
  consoleHeader.append(consoleTitle, consoleControls);

  const consoleLogs = document.createElement('div');
  consoleLogs.className = 'browser-console-logs';

  consolePanel.append(consoleResizer, consoleHeader, consoleLogs);

  // Resize handler
  let startY = 0;
  let startHeight = 0;
  
  const onPointerMove = (e) => {
    const deltaY = startY - e.clientY;
    const newHeight = Math.max(50, Math.min(window.innerHeight * 0.7, startHeight + deltaY));
    consolePanel.style.height = `${newHeight}px`;
  };
  
  const onPointerUp = () => {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.body.classList.remove('resizing-console');
  };

  consoleResizer.addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    startHeight = consolePanel.offsetHeight;
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.body.classList.add('resizing-console');
  });

  // Toggle Console
  if (tab.consoleOpen) {
    consoleBtn.classList.add('active');
  }

  const toggleConsole = () => {
    tab.consoleOpen = !tab.consoleOpen;
    consolePanel.style.display = tab.consoleOpen ? 'flex' : 'none';
    consoleBtn.classList.toggle('active', tab.consoleOpen);
    if (typeof saveSessionState === 'function') {
      saveSessionState();
    }
  };
  consoleBtn.addEventListener('click', toggleConsole);
  clearBtn.addEventListener('click', () => { consoleLogs.innerHTML = ''; });
  closeBtn.addEventListener('click', toggleConsole);

  tab.addConsoleLog = (level, args) => {
    const logItem = document.createElement('div');
    logItem.className = `console-log-item console-log-${level}`;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'console-log-time';
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    timeSpan.textContent = `[${timeStr}]`;

    const msgSpan = document.createElement('span');
    msgSpan.className = 'console-log-message';
    
    const formattedArgs = args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        const pre = document.createElement('pre');
        pre.className = 'console-log-object';
        pre.textContent = formatLogArg(arg);
        return pre;
      } else {
        const text = document.createElement('span');
        text.textContent = String(arg) + ' ';
        return text;
      }
    });
    
    msgSpan.append(...formattedArgs);
    logItem.append(timeSpan, msgSpan);
    consoleLogs.appendChild(logItem);
    
    const isAtBottom = consoleLogs.scrollHeight - consoleLogs.clientHeight - consoleLogs.scrollTop < 30;
    if (isAtBottom || consoleLogs.childNodes.length === 1) {
      consoleLogs.scrollTop = consoleLogs.scrollHeight;
    }
  };

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

  viewEl.append(bar, ...(hintEl ? [hintEl] : []), loadingBar, frame, startEl, consolePanel);

  const navigate = (url) => {
    url = url.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    startEl.classList.remove('visible');
    frame.style.display = '';
    tab.currentUrl = url;
    
    const toProxyUrl = (targetUrl) => {
      try {
        const parsed = new URL(targetUrl);
        const proto = parsed.protocol.replace(':', '');
        const pathAndQuery = parsed.pathname + parsed.search + parsed.hash;
        return `/proxy/${proto}/${parsed.host}${pathAndQuery}`;
      } catch (e) {
        return '/proxy/' + encodeURIComponent(targetUrl);
      }
    };
    
    // Serverless demo embeds directly; otherwise route through the proxy.
    frame.src = window.DEMO_MODE ? url : toProxyUrl(url);
    if (hintEl) hintEl.classList.add('visible');
    urlInput.value = url;
    if (!tab.isCustomLabel) {
      try { label.textContent = new URL(url).hostname.replace('www.', ''); }
      catch { label.textContent = 'Browser'; }
    }
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
    if (!tab.isCustomLabel) {
      label.textContent = 'New Tab';
    }
  };

  frame.addEventListener('load', () => {
    loadingBar.classList.remove('active');
    try {
      if (tab.openerWindow) {
        try {
          Object.defineProperty(frame.contentWindow, 'opener', {
            value: tab.openerWindow,
            configurable: true,
            writable: true
          });
        } catch (err) {}
      }
      syncThemeToIframe(frame);
      interceptLinksAndPopups(frame, tab);
      interceptConsole(frame, tab);
    } catch (e) {}
  });

  tab.updateTheme = () => {
    try {
      syncThemeToIframe(frame);
    } catch (e) {}
  };

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

function syncThemeToIframe(frame) {
  try {
    const doc = frame.contentDocument || frame.contentWindow?.document;
    if (!doc) return;
    const currentTheme = document.documentElement.dataset.theme || 'dark';
    const isDark = currentTheme !== 'light';

    // 1. Sync data-theme attribute
    doc.documentElement.setAttribute('data-theme', currentTheme);

    // 2. Set color-scheme style on documentElement
    doc.documentElement.style.colorScheme = isDark ? 'dark' : 'light';

    // 3. Inject overrides stylesheet if not present
    let styleEl = doc.getElementById('mtx-theme-overrides');
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = 'mtx-theme-overrides';
      doc.head.appendChild(styleEl);
    }
    styleEl.textContent = `
      html {
        color-scheme: ${isDark ? 'dark' : 'light'} !important;
      }
    `;

    // 4. Trigger the custom listener if registered in proxy window
    if (typeof frame.contentWindow.__mtx_update_theme === 'function') {
      frame.contentWindow.__mtx_update_theme(currentTheme);
    }
  } catch (e) {
    // Gracefully handle cross-origin restrictions
    console.debug('Cannot sync theme to iframe due to cross-origin restriction:', e);
  }
}

function extractOriginalUrl(url) {
  if (!url) return url;
  
  // Handle structured proxy URLs: /proxy/(http|https)/hostname/path
  const structRegex = /\/proxy\/(https?)\/([^/]+)\/?(.*)$/;
  const sMatch = url.match(structRegex);
  if (sMatch) {
    const protocol = sMatch[1];
    const host = sMatch[2];
    const rest = sMatch[3] || '';
    return `${protocol}://${host}/${rest}`;
  }
  
  // Handle absolute or relative proxied URLs: /proxy/<encoded>
  const proxyRegex = /\/proxy\/(.+)$/;
  const match = url.match(proxyRegex);
  if (match) {
    try {
      if (!match[1].startsWith('http/') && !match[1].startsWith('https/')) {
        return decodeURIComponent(match[1]);
      }
    } catch (e) {}
  }
  
  // Handle legacy/query-based proxied URLs: /proxy?url=<encoded>
  const queryRegex = /\/proxy\?url=([^&]+)/;
  const qMatch = url.match(queryRegex);
  if (qMatch) {
    try {
      return decodeURIComponent(qMatch[1]);
    } catch (e) {}
  }
  
  return url;
}

function interceptLinksAndPopups(frame, tab) {
  try {
    const win = frame.contentWindow;
    const doc = frame.contentDocument || win?.document;
    if (!doc || !win) return;

    // 1. Override window.open inside the iframe.
    // Everything (including OAuth / Firebase Auth Emulator popups) opens as an
    // in-app browser tab through the proxy, rather than a native client-browser
    // window. The new tab's `opener` is wired back to this app iframe so popup
    // auth flows can relay their result home (see the auth-handler shim injected
    // by the proxy in server.js).
    win.open = function(url, target, features) {
      const pane = paneOfTab(tab.tabEl);
      if (pane) {
        let resolvedUrl = url || 'about:blank';
        // First extract original target URL if it's already proxied
        resolvedUrl = extractOriginalUrl(resolvedUrl);
        // Resolve relative paths against the target site's base
        if (resolvedUrl && !/^https?:\/\//i.test(resolvedUrl) && resolvedUrl !== 'about:blank') {
          try {
            const base = extractOriginalUrl(win.location.href);
            resolvedUrl = new URL(resolvedUrl, base).href;
          } catch (e) {}
        }
        const newTab = addTab(pane, 'browser', null, null, resolvedUrl);
        newTab.openerWindow = win;
        activateTab(pane, newTab.id);
        if (typeof saveSessionState === 'function') {
          saveSessionState();
        }
        const newIframe = newTab.viewEl.querySelector('iframe');
        if (newIframe && newIframe.contentWindow) {
          try {
            Object.defineProperty(newIframe.contentWindow, 'opener', {
              value: win,
              configurable: true,
              writable: true
            });
          } catch (e) {}
        }
        return newIframe ? newIframe.contentWindow : null;
      }
      return null;
    };

    // 2. Intercept click events on links with target="_blank"
    doc.addEventListener('click', (e) => {
      const anchor = e.target.closest('a');
      if (anchor) {
        const target = anchor.getAttribute('target');
        
        if (target === '_blank' || target === '_new' || e.ctrlKey || e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          
          // Use anchor.href which is already resolved to an absolute URL by the browser,
          // then extract the original unproxied target URL.
          const resolvedUrl = extractOriginalUrl(anchor.href);
          
          const pane = paneOfTab(tab.tabEl);
          if (pane && resolvedUrl) {
            const newTab = addTab(pane, 'browser', null, null, resolvedUrl);
            activateTab(pane, newTab.id);
            if (typeof saveSessionState === 'function') {
              saveSessionState();
            }
          }
        }
      }
    }, true);

    // 3. Intercept form submissions targeting _blank or _new
    doc.addEventListener('submit', (e) => {
      const form = e.target;
      const target = form.getAttribute('target');
      if (target === '_blank' || target === '_new') {
        e.preventDefault();
        e.stopPropagation();
        
        const pane = paneOfTab(tab.tabEl);
        if (pane) {
          const action = form.getAttribute('action') || '';
          let resolvedUrl = extractOriginalUrl(action);
          if (resolvedUrl && !/^https?:\/\//i.test(resolvedUrl)) {
            try {
              const base = extractOriginalUrl(win.location.href);
              resolvedUrl = new URL(resolvedUrl, base).href;
            } catch (err) {}
          }
          
          if (form.method.toLowerCase() === 'get') {
            const formData = new FormData(form);
            const params = new URLSearchParams(formData);
            const separator = resolvedUrl.includes('?') ? '&' : '?';
            resolvedUrl = resolvedUrl + separator + params.toString();
            
            const newTab = addTab(pane, 'browser', null, null, resolvedUrl);
            activateTab(pane, newTab.id);
            if (typeof saveSessionState === 'function') {
              saveSessionState();
            }
          } else {
            const newTab = addTab(pane, 'browser', null, null, 'about:blank');
            activateTab(pane, newTab.id);
            
            const newIframe = newTab.viewEl.querySelector('iframe');
            if (newIframe) {
              const uniqueName = 'mtx-form-target-' + Math.random().toString(36).substr(2, 9);
              newIframe.name = uniqueName;
              
              const originalTarget = form.getAttribute('target');
              form.setAttribute('target', uniqueName);
              form.submit();
              
              if (originalTarget) {
                form.setAttribute('target', originalTarget);
              } else {
                form.removeAttribute('target');
              }
            }
          }
        }
      }
    }, true);
  } catch (e) {
    console.debug('Cannot intercept links/popups due to cross-origin restriction:', e);
  }
}

// ── Browser Console Helpers & Log Interceptor ──
function formatLogArg(arg) {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'object') {
    if (arg.__isError) {
      return `${arg.name || 'Error'}: ${arg.message || ''}\n${arg.stack || ''}`;
    }
    if (arg.__isElement) {
      return `<${arg.tagName}${arg.id ? ' id="' + arg.id + '"' : ''}${arg.className ? ' class="' + arg.className + '"' : ''}>`;
    }
    try {
      return JSON.stringify(arg, null, 2);
    } catch (e) {
      return String(arg);
    }
  }
  return String(arg);
}

window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'mtx:console') {
    const matchedTab = findTabByFrameWindow(e.source);
    if (matchedTab) {
      matchedTab.addConsoleLog(e.data.level, e.data.args);
    }
  }
});

function findTabByFrameWindow(sourceWindow) {
  for (const pane of getAllPanes()) {
    for (const tab of pane.tabs) {
      if (tab.type === 'browser') {
        const frame = tab.viewEl.querySelector('iframe');
        if (frame && frame.contentWindow === sourceWindow) {
          return tab;
        }
      }
    }
  }
  return null;
}

function interceptConsole(frame, tab) {
  try {
    const win = frame.contentWindow;
    if (!win || win.__mtx_console_intercepted) return;
    win.__mtx_console_intercepted = true;

    const logLevels = ['log', 'info', 'warn', 'error', 'debug'];
    
    function serializeConsoleArg(arg) {
      if (arg === null) return null;
      if (arg === undefined) return undefined;
      
      const ElementClass = win ? win.Element : Element;
      const ErrorClass = win ? win.Error : Error;

      if (arg instanceof ElementClass) {
        return {
          __isElement: true,
          tagName: arg.tagName.toLowerCase(),
          id: arg.id || '',
          className: arg.className || ''
        };
      }

      if (arg instanceof ErrorClass) {
        return {
          __isError: true,
          name: arg.name,
          message: arg.message,
          stack: arg.stack
        };
      }

      if (typeof arg === 'function') {
        return '[Function: ' + (arg.name || 'anonymous') + ']';
      }

      if (typeof arg === 'symbol') {
        return arg.toString();
      }

      if (typeof arg === 'object') {
        try {
          const seen = new Set();
          function clone(val) {
            if (val === null || typeof val !== 'object') return val;
            if (val instanceof ElementClass) return serializeConsoleArg(val);
            if (val instanceof ErrorClass) return serializeConsoleArg(val);
            if (seen.has(val)) return '[Circular]';
            seen.add(val);
            if (Array.isArray(val)) {
              return val.map(item => clone(item));
            }
            const res = {};
            for (const key in val) {
              if (Object.prototype.hasOwnProperty.call(val, key)) {
                res[key] = clone(val[key]);
              }
            }
            return res;
          }
          return clone(arg);
        } catch (e) {
          return String(arg);
        }
      }

      return arg;
    }

    logLevels.forEach(level => {
      const original = win.console[level];
      win.console[level] = function(...args) {
        if (original) {
          try {
            original.apply(win.console, args);
          } catch (e) {}
        }
        try {
          const processedArgs = args.map(arg => serializeConsoleArg(arg));
          tab.addConsoleLog(level, processedArgs);
        } catch (err) {}
      };
    });

    win.addEventListener('error', function(event) {
      try {
        tab.addConsoleLog('error', [event.message + ' at ' + (event.filename || 'unknown') + ':' + (event.lineno || 0) + ':' + (event.colno || 0)]);
      } catch (err) {}
    });

    win.addEventListener('unhandledrejection', function(event) {
      try {
        let reasonMsg = event.reason;
        if (event.reason && event.reason.message) {
          reasonMsg = event.reason.message;
        } else if (typeof event.reason === 'object') {
          reasonMsg = JSON.stringify(event.reason);
        }
        tab.addConsoleLog('error', ['Unhandled Promise Rejection: ' + reasonMsg]);
      } catch (err) {}
    });
  } catch (e) {
    console.debug('Cannot intercept console due to cross-origin restriction:', e);
  }
}

// ── Terminal Autocomplete ───────────────────────────────────────────────────

function startAutocomplete(tab) {
  tab.acActive = true;
  tab.acQuery = '';
  tab.acFiltered = [];
  tab.acIndex = 0;
  
  if (!tab.acEl) {
    tab.acEl = document.createElement('div');
    tab.acEl.className = 'term-autocomplete';
    const parentEl = tab.term?.element || tab.viewEl;
    if (parentEl) parentEl.appendChild(tab.acEl);
  }
  
  positionAutocomplete(tab);
  filterAutocomplete(tab);
}

function positionAutocomplete(tab) {
  if (!tab.acEl || !tab.term) return;
  const term = tab.term;
  
  // Safe buffer dimensions extraction
  const cursorX = (term.buffer && term.buffer.active) ? term.buffer.active.cursorX : 0;
  const cursorY = (term.buffer && term.buffer.active) ? term.buffer.active.cursorY : 0;
  
  const charWidth = term._core?._renderService?.dimensions?.actualCellWidth || 8.5;
  const charHeight = term._core?._renderService?.dimensions?.actualCellHeight || 18;
  
  const termPaddingLeft = 10;
  const termPaddingTop = 5;
  
  let left = termPaddingLeft + (cursorX * charWidth);
  let top = termPaddingTop + ((cursorY + 1) * charHeight);
  
  const parentEl = term.element || tab.viewEl;
  const termWidth = parentEl ? parentEl.clientWidth : 800;
  const termHeight = parentEl ? parentEl.clientHeight : 600;
  const dropdownWidth = 240;
  const dropdownHeight = 180;
  
  if (left + dropdownWidth > termWidth) {
    left = Math.max(10, termWidth - dropdownWidth - 20);
  }
  if (top + dropdownHeight > termHeight) {
    top = termPaddingTop + ((cursorY - 1) * charHeight) - dropdownHeight;
  }
  
  tab.acEl.style.left = `${left}px`;
  tab.acEl.style.top = `${top}px`;
}

function filterAutocomplete(tab) {
  const s = typeof getSettings === 'function' ? getSettings() : {};
  const cmds = (s.savedCommands && typeof s.savedCommands === 'object') ? s.savedCommands : {};
  const query = (tab.acQuery || '').toLowerCase();
  
  const filtered = Object.entries(cmds)
    .filter(([id]) => id.toLowerCase().includes(query))
    .map(([id, cmd]) => ({ id, cmd }));
    
  tab.acFiltered = filtered;
  tab.acIndex = Math.min(tab.acIndex, Math.max(0, filtered.length - 1));
  
  renderAutocomplete(tab);
}

function renderAutocomplete(tab) {
  if (!tab.acEl) return;
  tab.acEl.innerHTML = '';
  
  if (!tab.acFiltered || tab.acFiltered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'term-autocomplete-empty';
    empty.textContent = 'No matching commands';
    tab.acEl.appendChild(empty);
    return;
  }
  
  tab.acFiltered.forEach((item, index) => {
    const itemEl = document.createElement('div');
    itemEl.className = 'term-autocomplete-item' + (index === tab.acIndex ? ' active' : '');
    
    const idEl = document.createElement('div');
    idEl.className = 'term-autocomplete-id';
    idEl.textContent = '@' + item.id;
    
    const cmdEl = document.createElement('div');
    cmdEl.className = 'term-autocomplete-cmd';
    cmdEl.textContent = item.cmd;
    
    itemEl.appendChild(idEl);
    itemEl.appendChild(cmdEl);
    
    itemEl.addEventListener('mouseenter', () => {
      tab.acIndex = index;
      Array.from(tab.acEl.children).forEach((child, idx) => {
        child.classList.toggle('active', idx === tab.acIndex);
      });
    });
    
    itemEl.addEventListener('click', (e) => {
      e.stopPropagation();
      selectAutocompleteItem(tab);
    });
    
    tab.acEl.appendChild(itemEl);
  });
  
  const activeChild = tab.acEl.children[tab.acIndex];
  if (activeChild) {
    activeChild.scrollIntoView({ block: 'nearest' });
  }
}

function moveAutocompleteSelection(tab, dir) {
  if (!tab.acActive || !tab.acFiltered || tab.acFiltered.length === 0) return;
  tab.acIndex = (tab.acIndex + dir + tab.acFiltered.length) % tab.acFiltered.length;
  
  Array.from(tab.acEl.children).forEach((child, idx) => {
    child.classList.toggle('active', idx === tab.acIndex);
  });
  
  const activeChild = tab.acEl.children[tab.acIndex];
  if (activeChild) {
    activeChild.scrollIntoView({ block: 'nearest' });
  }
}

function selectAutocompleteItem(tab, execute = false) {
  if (!tab.acActive || !tab.acFiltered || tab.acFiltered.length === 0) {
    closeAutocomplete(tab);
    return;
  }
  const item = tab.acFiltered[tab.acIndex];
  if (!item) {
    closeAutocomplete(tab);
    return;
  }
  const cmd = item.cmd;
  
  const eraseCount = (tab.acQuery || '').length + 1;
  const backspaces = '\x7f'.repeat(eraseCount);
  
  sendTerminalInput(tab.ptyId, backspaces + cmd + (execute ? '\r' : ''));
  closeAutocomplete(tab);
}

function closeAutocomplete(tab) {
  tab.acActive = false;
  tab.acQuery = '';
  tab.acFiltered = [];
  tab.acIndex = 0;
  if (tab.acEl) {
    tab.acEl.remove();
    tab.acEl = null;
  }
}

function handleAutocompleteData(tab, data) {
  if (data === '\x7f' || data === '\b') {
    if (tab.acQuery && tab.acQuery.length > 0) {
      tab.acQuery = tab.acQuery.slice(0, -1);
      filterAutocomplete(tab);
    } else {
      closeAutocomplete(tab);
    }
    return;
  }
  if (data.length === 1 && /^[a-zA-Z0-9\-_]$/.test(data)) {
    tab.acQuery += data;
    filterAutocomplete(tab);
    return;
  }
  closeAutocomplete(tab);
}

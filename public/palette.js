// ── Command palette ──────────────────────────────────────────────────────────
// A fuzzy launcher for every workspace action, opened with ⌘K (macOS) or
// Ctrl/⌘+Shift+P (those avoid the readline bindings Ctrl+K / Ctrl+P would
// otherwise eat in a terminal). Commands are plain objects rebuilt on each open
// via buildCommands() so dynamic labels (broadcast on/off, the theme list) stay
// current. Actions reuse the same shared functions the toolbar uses.

let paletteEl = null;     // root overlay element (built lazily)
let paletteInput = null;  // search box
let paletteList = null;   // results container
let paletteCommands = []; // commands matching the current query
let paletteIndex = 0;     // highlighted result
let paletteMode = 'command'; // 'command' or 'rename'

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// Move the active tab within its pane (dir +1 next / -1 previous), wrapping.
function cycleTab(dir) {
  const pane = activePane;
  if (!pane || pane.tabs.length < 2) return;
  const i = pane.tabs.findIndex(t => t === pane.activeTab);
  const next = pane.tabs[(i + dir + pane.tabs.length) % pane.tabs.length];
  activateTab(pane, next.id);
}

// Move focus to the next/previous pane in document order, wrapping.
function cyclePane(dir) {
  const panes = getAllPanes();
  if (panes.length < 2) return;
  const i = panes.indexOf(activePane);
  const next = panes[(i + dir + panes.length) % panes.length];
  setActivePane(next);
  next.activeTab?.term?.focus();
}

// The full command set, rebuilt each time the palette opens.
function buildCommands() {
  const cmds = [
    { icon: '◧', title: 'Split pane vertically',   hint: '⌘\\', run: () => activePane && splitPane(activePane, 'vertical') },
    { icon: '⬓', title: 'Split pane horizontally', hint: '⌘-', run: () => activePane && splitPane(activePane, 'horizontal') },
    { icon: '⬛', title: 'New terminal tab', keywords: 'shell add', run: () => { if (activePane) { addTab(activePane, 'terminal'); saveSessionState(); } } },
    { icon: '🌐', title: 'New browser tab', keywords: 'web add', run: () => { if (activePane) { addTab(activePane, 'browser'); saveSessionState(); } } },
    { icon: '📝', title: 'New code editor tab', keywords: 'edit code vscode monaco add', run: async () => { if (!activePane) return; const dir = await promptForFolder(); if (dir) { addTab(activePane, 'editor', undefined, undefined, undefined, dir); saveSessionState(); } } },
    { icon: '✕', title: 'Close current tab', hint: '⌘W', run: () => { if (activePane?.activeTab) closeTab(activePane, activePane.activeTab.id); } },
    { icon: '✏️', title: 'Rename current tab', keywords: 'title name label retitle rename', keepOpen: true, run: () => {
      if (!activePane?.activeTab) return;
      paletteMode = 'rename';
      paletteInput.placeholder = 'Enter new tab name…';
      paletteInput.value = activePane.activeTab.label.textContent;
      paletteInput.focus();
      paletteInput.select();
      renderRenameHint();
    } },
    { icon: '🗑', title: 'Close current pane', keywords: 'remove', run: closeActivePane },
    { icon: '▸', title: 'Next tab', keywords: 'switch cycle', run: () => cycleTab(1) },
    { icon: '◂', title: 'Previous tab', keywords: 'switch cycle', run: () => cycleTab(-1) },
    { icon: '⬚', title: 'Focus next pane', keywords: 'switch cycle', run: () => cyclePane(1) },
    { icon: '📡', title: broadcastInput ? 'Turn off broadcast input' : 'Broadcast input to all terminals', hint: isMac ? '⌘B' : 'Ctrl+Shift+B', keywords: 'sync', run: () => setBroadcastInput(!broadcastInput) },
    { icon: '📤', title: 'Upload file to host', keywords: 'send transfer', run: () => document.getElementById('upload-input')?.click() },
    { icon: '⏰', title: 'Schedule Enter key press', keywords: 'delay timer alarm quota wait later defer', run: () => openScheduleDialog() },
    { icon: '⚙', title: 'Open settings', keywords: 'preferences config', run: () => openSettings() },
    { icon: '⤢', title: (typeof maximizedPane !== 'undefined' && maximizedPane) ? 'Restore layout' : 'Maximize active tab', keywords: 'maximize pane tab window scale focus zoom center hide splits', run: () => { if (activePane) toggleMaximizePane(activePane); } },
    { icon: '⛶', title: (document.fullscreenElement || document.webkitFullscreenElement) ? 'Exit fullscreen' : 'Enter fullscreen', keywords: 'fullscreen maximize zoom window screen', run: () => toggleFullscreen() },
    { icon: '💬', title: 'Submit feedback', keywords: 'feedback support bug issue feature request report github', run: () => window.open('https://github.com/tianhaoz95/meowtrix/issues/new', '_blank') },
    { icon: '⬇', title: 'Check for updates', keywords: 'upgrade version git pull', run: () => { if (typeof checkForUpdateNow === 'function') checkForUpdateNow(); } },
    { icon: '🔥', title: (typeof isComboFxEnabled === 'function' && isComboFxEnabled()) ? 'Turn off keystroke combo FX' : 'Turn on keystroke combo FX',
      keywords: 'streak effect particles fire visual', run: () => {
        const on = !(typeof isComboFxEnabled === 'function' && isComboFxEnabled());
        if (typeof setComboFxEnabled === 'function') setComboFxEnabled(on);
        if (typeof saveSetting === 'function') saveSetting('comboFx', on);
        const cb = document.getElementById('s-combo-fx'); if (cb) cb.checked = on;
      } },
  ];
  // Only offer the apply action when the server has reported an update.
  if (typeof updateAvailable === 'function' && updateAvailable()) {
    cmds.push({ icon: '🚀', title: 'Update & restart Meowtrix', keywords: 'upgrade version git pull install',
      run: () => { if (typeof applyUpdateNow === 'function') applyUpdateNow(); } });
  }
  // One entry per theme.
  THEMES.forEach(t => cmds.push({
    icon: t.icon, title: `Theme: ${t.label}`, keywords: 'color appearance', run: () => setTheme(t.id),
  }));

  // Workspaces navigation and renaming commands
  cmds.push({ icon: '◀', title: 'Previous workspace', hint: 'Ctrl+Alt+[', keywords: 'workspace prev backward swap switch', run: () => {
    if (typeof switchWorkspace === 'function') switchWorkspace((activeWorkspaceIndex - 1 + 4) % 4);
  } });
  cmds.push({ icon: '▶', title: 'Next workspace', hint: 'Ctrl+Alt+]', keywords: 'workspace next forward swap switch', run: () => {
    if (typeof switchWorkspace === 'function') switchWorkspace((activeWorkspaceIndex + 1) % 4);
  } });
  cmds.push({ icon: '✏️', title: 'Rename current workspace', keywords: 'workspace title name label retitle rename', keepOpen: true, run: () => {
    paletteMode = 'renameWorkspace';
    paletteInput.placeholder = 'Enter new workspace name…';
    paletteInput.value = currentWorkspaces[activeWorkspaceIndex].name;
    paletteInput.focus();
    paletteInput.select();
    renderRenameWorkspaceHint();
  } });

  if (typeof currentWorkspaces !== 'undefined') {
    currentWorkspaces.forEach((ws, idx) => {
      cmds.push({
        icon: '🐾',
        title: `Switch to ${ws.name}`,
        hint: `Ctrl+Alt+${idx + 1}`,
        keywords: `workspace switch select jump ${ws.name}`,
        run: () => {
          if (typeof switchWorkspace === 'function') switchWorkspace(idx);
        }
      });
    });
  }

  return cmds;
}

// Case-insensitive subsequence match — every char of the query must appear in
// order in the haystack. Returns false (no match) or a rough score where
// earlier / more contiguous matches rank higher.
function fuzzyScore(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase(), t = text.toLowerCase();
  let qi = 0, score = 0, lastIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += (ti === lastIdx + 1) ? 3 : 1; // reward contiguous runs
      if (ti < 4) score += 2;                // reward early matches
      lastIdx = ti;
      qi++;
    }
  }
  return qi === q.length ? score : 0;
}

function renderResults() {
  paletteList.innerHTML = '';
  if (!paletteCommands.length) {
    const empty = document.createElement('div');
    empty.className = 'palette-empty';
    empty.textContent = 'No matching commands';
    paletteList.appendChild(empty);
    return;
  }
  paletteCommands.forEach((cmd, i) => {
    const row = document.createElement('div');
    row.className = 'palette-item' + (i === paletteIndex ? ' active' : '');
    row.innerHTML = `<span class="palette-ico">${cmd.icon || '›'}</span><span class="palette-title"></span>`;
    row.querySelector('.palette-title').textContent = cmd.title;
    if (cmd.hint) {
      const hint = document.createElement('span');
      hint.className = 'palette-hint';
      hint.textContent = cmd.hint;
      row.appendChild(hint);
    }
    row.addEventListener('mousemove', () => { if (paletteIndex !== i) { paletteIndex = i; updateActive(); } });
    row.addEventListener('click', () => runCommand(i));
    paletteList.appendChild(row);
  });
}

function updateActive() {
  [...paletteList.children].forEach((el, i) => el.classList.toggle('active', i === paletteIndex));
  paletteList.children[paletteIndex]?.scrollIntoView({ block: 'nearest' });
}

function renderRenameHint() {
  paletteList.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'palette-item active';
  row.innerHTML = `<span class="palette-ico">✏️</span><span class="palette-title"></span>`;
  const val = paletteInput.value.trim();
  row.querySelector('.palette-title').textContent = val ? `Rename tab to "${val}"` : 'Clear tab name (reset to default)';
  
  const hint = document.createElement('span');
  hint.className = 'palette-hint';
  hint.textContent = 'Enter to save · Esc to cancel';
  row.appendChild(hint);
  
  paletteCommands = [{
    run: () => {
      const activeTab = activePane?.activeTab;
      if (activeTab) {
        const newName = paletteInput.value.trim();
        if (newName) {
          activeTab.label.textContent = newName;
          activeTab.isCustomLabel = true;
        } else {
          activeTab.isCustomLabel = false;
          if (activeTab.type === 'terminal') {
            activeTab.label.textContent = activeTab.term?.title || 'Terminal';
          } else if (activeTab.type === 'editor') {
            activeTab.label.textContent = activeTab.editorDir ? basename(activeTab.editorDir) : 'Editor';
          } else if (activeTab.type === 'browser') {
            if (activeTab.currentUrl) {
              try { activeTab.label.textContent = new URL(activeTab.currentUrl).hostname.replace('www.', ''); }
              catch { activeTab.label.textContent = 'Browser'; }
            } else {
              activeTab.label.textContent = 'New Tab';
            }
          }
        }
        if (typeof saveSessionState === 'function') saveSessionState();
      }
    }
  }];
  paletteIndex = 0;
  paletteList.appendChild(row);
}

function renderRenameWorkspaceHint() {
  paletteList.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'palette-item active';
  row.innerHTML = `<span class="palette-ico">✏️</span><span class="palette-title"></span>`;
  const val = paletteInput.value.trim();
  row.querySelector('.palette-title').textContent = val ? `Rename workspace to "${val}"` : `Clear workspace name (reset to Workspace ${activeWorkspaceIndex + 1})`;
  
  const hint = document.createElement('span');
  hint.className = 'palette-hint';
  hint.textContent = 'Enter to save · Esc to cancel';
  row.appendChild(hint);
  
  paletteCommands = [{
    run: () => {
      const newName = paletteInput.value.trim();
      currentWorkspaces[activeWorkspaceIndex].name = newName || `Workspace ${activeWorkspaceIndex + 1}`;
      if (typeof updateWorkspaceUI === 'function') updateWorkspaceUI();
      if (typeof saveSessionState === 'function') saveSessionState();
    }
  }];
  paletteIndex = 0;
  paletteList.appendChild(row);
}

function filterCommands() {
  if (paletteMode === 'rename') {
    renderRenameHint();
    return;
  }
  if (paletteMode === 'renameWorkspace') {
    renderRenameWorkspaceHint();
    return;
  }
  const all = buildCommands();
  const q = paletteInput.value.trim();
  paletteCommands = all
    .map(cmd => ({ cmd, score: fuzzyScore(q, cmd.title + ' ' + (cmd.keywords || '')) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.cmd);
  paletteIndex = 0;
  renderResults();
}

function buildPalette() {
  paletteEl = document.createElement('div');
  paletteEl.id = 'palette-overlay';
  paletteEl.hidden = true;
  paletteEl.innerHTML = `
    <div id="palette">
      <input id="palette-input" type="text" placeholder="Type a command…" autocomplete="off" spellcheck="false">
      <div id="palette-list"></div>
    </div>`;
  document.body.appendChild(paletteEl);
  paletteInput = paletteEl.querySelector('#palette-input');
  paletteList = paletteEl.querySelector('#palette-list');

  paletteEl.addEventListener('mousedown', (e) => { if (e.target === paletteEl) closePalette(); });
  paletteInput.addEventListener('input', filterCommands);
  paletteInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = Math.min(paletteIndex + 1, paletteCommands.length - 1); updateActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = Math.max(paletteIndex - 1, 0); updateActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); runCommand(paletteIndex); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
}

function openPalette() {
  // Don't open over the inactive-session overlay — its actions wouldn't apply.
  if (typeof isActiveSession !== 'undefined' && !isActiveSession) return;
  if (!paletteEl) buildPalette();
  paletteMode = 'command';
  paletteInput.placeholder = 'Type a command…';
  paletteEl.hidden = false;
  paletteInput.value = '';
  filterCommands();
  paletteInput.focus();
}

function closePalette() {
  if (!paletteEl || paletteEl.hidden) return;
  paletteEl.hidden = true;
  activePane?.activeTab?.term?.focus();
}

function runCommand(i) {
  const cmd = paletteCommands[i];
  if (cmd && cmd.keepOpen) {
    try { cmd.run(); } catch (err) { console.error('Command failed:', err); }
  } else {
    closePalette();
    if (cmd) try { cmd.run(); } catch (err) { console.error('Command failed:', err); }
  }
}

// Wire up the toolbar button and its hover tooltip (showing the platform's open
// shortcut: ⌘K on macOS, Ctrl+Shift+P elsewhere). The tooltip is a styled CSS
// chip driven by data-kbd — snappier and clearer than the native title.
const paletteShortcut = isMac ? '⌘K' : 'Ctrl+Shift+P';
const paletteBtn = document.getElementById('btn-palette');
if (paletteBtn) {
  paletteBtn.dataset.kbd = `Command palette · ${paletteShortcut}`;
  paletteBtn.addEventListener('click', openPalette);
}

// Global open shortcut. Capture phase + stopPropagation so xterm doesn't also
// see the keystroke. ⌘K on macOS; ⌘/Ctrl+Shift+P everywhere.
document.addEventListener('keydown', (e) => {
  const cmdK = e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === 'k' || e.key === 'K');
  const shiftP = (e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'p' || e.key === 'P');
  if (cmdK || shiftP) {
    e.preventDefault();
    e.stopPropagation();
    if (paletteEl && !paletteEl.hidden) closePalette(); else openPalette();
  }
}, true);

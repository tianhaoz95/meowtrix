// editor.js — the code-editor tab: a self-built file tree alongside Monaco (the
// VS Code editor), loaded lazily from CDN. Backed by the host file-system API
// (/api/fs/list|read|write in server.js). Editor tabs have no PTY; their content
// lives on disk and is re-fetched on reconnect (see captureWorkspaceState).
//
// Created via the tab-type picker (which prompts for a folder), the command
// palette, or `mtx code <dir>` in a terminal (OSC 5380 → triggerOpenEditor).

const MONACO_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min';

// Lazily load + configure Monaco exactly once. Resolves to the global `monaco`.
let _monacoPromise = null;
function ensureMonaco() {
  if (_monacoPromise) return _monacoPromise;
  _monacoPromise = new Promise((resolve, reject) => {
    // Web workers must be same-origin, so point Monaco at a blob shim that
    // re-imports the real worker from the CDN (the standard CDN-Monaco pattern).
    self.MonacoEnvironment = {
      getWorkerUrl() {
        const src = `self.MonacoEnvironment={baseUrl:'${MONACO_BASE}/'};` +
                    `importScripts('${MONACO_BASE}/vs/base/worker/workerMain.js');`;
        return URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      },
    };
    require.config({ paths: { vs: `${MONACO_BASE}/vs` } });
    require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
  });
  return _monacoPromise;
}

// Light vs dark to match the app theme (non-'light' themes are all dark variants).
function monacoTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'vs' : 'vs-dark';
}

function basename(p) {
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}

function initEditorTab(tab, viewEl, dir) {
  viewEl.classList.add('editor-view');
  tab.editorDir = dir || '';
  if (dir && tab.label) tab.label.textContent = basename(dir);

  // ── DOM scaffold ───────────────────────────────────────────────────────────
  const sidebar = document.createElement('div');
  sidebar.className = 'editor-sidebar';
  if (tab.editorSidebarWidth) sidebar.style.width = tab.editorSidebarWidth + 'px';
  const sideHeader = document.createElement('div');
  sideHeader.className = 'editor-sidebar-header';
  const sideHeaderIcon = document.createElement('span');
  sideHeaderIcon.className = 'editor-sidebar-icon';
  sideHeaderIcon.textContent = '📂';
  const sideHeaderName = document.createElement('span');
  sideHeaderName.className = 'editor-sidebar-name';
  sideHeaderName.textContent = dir ? basename(dir) : 'No folder';
  sideHeader.append(sideHeaderIcon, sideHeaderName);
  sideHeader.title = dir || '';
  const treeEl = document.createElement('div');
  treeEl.className = 'editor-tree';
  sidebar.append(sideHeader, treeEl);

  // Drag handle between the tree and the editor.
  const resizer = document.createElement('div');
  resizer.className = 'editor-resizer';

  const main = document.createElement('div');
  main.className = 'editor-main';
  const fileTabs = document.createElement('div');
  fileTabs.className = 'editor-filetabs';
  const monacoHost = document.createElement('div');
  monacoHost.className = 'editor-monaco';
  const placeholder = document.createElement('div');
  placeholder.className = 'editor-placeholder';
  placeholder.textContent = 'Select a file to start editing';
  monacoHost.appendChild(placeholder);
  main.append(fileTabs, monacoHost);

  viewEl.append(sidebar, resizer, main);

  // ── State ──────────────────────────────────────────────────────────────────
  let editor = null;
  const open = new Map();      // path -> { model, viewState, dirty, tabEl, dotEl }
  const treeRows = new Map();  // file path -> tree row element (for selection highlight)
  let activePath = null;

  // ── Sidebar resize ──────────────────────────────────────────────────────────
  let dragging = false;
  resizer.addEventListener('pointerdown', (e) => {
    dragging = true;
    resizer.classList.add('dragging');
    resizer.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  resizer.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const rect = viewEl.getBoundingClientRect();
    const w = Math.max(140, Math.min(e.clientX - rect.left, rect.width - 220));
    sidebar.style.width = w + 'px';
    tab.editorSidebarWidth = Math.round(w);
    editor?.layout();
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    try { resizer.releasePointerCapture(e.pointerId); } catch {}
    editor?.layout();
    if (typeof saveSessionState === 'function') saveSessionState();
  };
  resizer.addEventListener('pointerup', endDrag);
  resizer.addEventListener('pointercancel', endDrag);

  function toast(msg) { if (typeof showToast === 'function') showToast(msg); }

  // ── File tabs ─────────────────────────────────────────────────────────────
  function setActive(p) {
    if (activePath && open.has(activePath)) {
      open.get(activePath).viewState = editor.saveViewState();
    }
    activePath = p;
    open.forEach((st, path) => st.tabEl.classList.toggle('active', path === p));
    treeRows.forEach((row, path) => row.classList.toggle('selected', path === p));
    const st = open.get(p);
    placeholder.style.display = st ? 'none' : '';
    if (!st) { editor?.setModel(null); return; }
    editor.setModel(st.model);
    if (st.viewState) editor.restoreViewState(st.viewState);
    editor.focus();
  }

  function closeFile(p) {
    const st = open.get(p);
    if (!st) return;
    st.tabEl.remove();
    st.model.dispose();
    open.delete(p);
    if (activePath === p) {
      const next = [...open.keys()].pop() || null;
      activePath = null;
      setActive(next);
    }
  }

  function markDirty(p, dirty) {
    const st = open.get(p);
    if (!st || st.dirty === dirty) return;
    st.dirty = dirty;
    st.dotEl.classList.toggle('dirty', dirty);
  }

  async function saveActive() {
    if (!activePath) return;
    const st = open.get(activePath);
    if (!st || !st.dirty) return;
    try {
      const res = await fetch('/api/fs/write?path=' + encodeURIComponent(activePath), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: st.model.getValue(),
      });
      if (res.ok) { markDirty(activePath, false); toast('Saved ' + basename(activePath)); }
      else toast('Save failed: ' + basename(activePath));
    } catch { toast('Save failed: ' + basename(activePath)); }
  }

  async function openFile(filePath) {
    if (open.has(filePath)) { setActive(filePath); return; }
    let data;
    try {
      const res = await fetch('/api/fs/read?path=' + encodeURIComponent(filePath));
      data = await res.json();
      if (!res.ok) { toast(data.error || 'Could not open file'); return; }
    } catch { toast('Could not open file'); return; }

    const monaco = await ensureMonaco();
    if (!editor) {
      placeholder.style.display = 'none';
      editor = monaco.editor.create(monacoHost, {
        theme: monacoTheme(),
        automaticLayout: false,
        fontSize: 13,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
      });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveActive());
    }
    // Model URI carries the filename so Monaco auto-detects the language.
    const model = monaco.editor.createModel(data.content, undefined, monaco.Uri.file(filePath));
    model.onDidChangeContent(() => markDirty(filePath, true));

    const tabEl = document.createElement('div');
    tabEl.className = 'editor-filetab';
    const dotEl = document.createElement('span');
    dotEl.className = 'editor-filetab-dot';
    const nameEl = document.createElement('span');
    nameEl.textContent = basename(filePath);
    const closeEl = document.createElement('span');
    closeEl.className = 'editor-filetab-close';
    closeEl.textContent = '✕';
    tabEl.append(dotEl, nameEl, closeEl);
    tabEl.title = filePath;
    tabEl.addEventListener('click', () => setActive(filePath));
    closeEl.addEventListener('click', (e) => { e.stopPropagation(); closeFile(filePath); });
    fileTabs.appendChild(tabEl);

    open.set(filePath, { model, viewState: null, dirty: false, tabEl, dotEl });
    setActive(filePath);
  }

  // ── File tree (lazy-expanding) ──────────────────────────────────────────────
  function join(base, name) { return base.replace(/\/+$/, '') + '/' + name; }

  async function renderDir(dirPath, containerEl, depth) {
    let data;
    try {
      const res = await fetch('/api/fs/list?path=' + encodeURIComponent(dirPath));
      data = await res.json();
      if (!res.ok) { containerEl.textContent = data.error || 'Cannot read'; return; }
    } catch { containerEl.textContent = 'Cannot read'; return; }

    for (const entry of data.entries) {
      const full = join(dirPath, entry.name);
      const row = document.createElement('div');
      row.className = 'editor-tree-row ' + (entry.type === 'dir' ? 'is-dir' : 'is-file');
      row.style.paddingLeft = (depth * 14 + 6) + 'px';
      const chevron = document.createElement('span');
      chevron.className = 'editor-tree-chevron';
      chevron.textContent = entry.type === 'dir' ? '▸' : '';
      const name = document.createElement('span');
      name.className = 'editor-tree-name';
      name.textContent = entry.name;
      row.append(chevron, name);
      containerEl.appendChild(row);

      if (entry.type === 'dir') {
        const childWrap = document.createElement('div');
        childWrap.hidden = true;
        let loaded = false;
        containerEl.appendChild(childWrap);
        row.addEventListener('click', async () => {
          const show = childWrap.hidden;
          childWrap.hidden = !show;
          chevron.classList.toggle('open', show);
          if (show && !loaded) { loaded = true; await renderDir(full, childWrap, depth + 1); }
        });
      } else {
        treeRows.set(full, row);
        row.addEventListener('click', () => openFile(full));
      }
    }
  }

  if (dir) renderDir(dir, treeEl, 0);
  else treeEl.textContent = '';

  // Lay out Monaco when the pane becomes visible or is resized (mirrors the
  // terminal's fit-on-resize). onActivate is invoked by activateTab in pane.js.
  const relayout = () => { if (editor && viewEl.classList.contains('active')) editor.layout(); };
  tab.onActivate = relayout;
  new ResizeObserver(relayout).observe(viewEl);

  tab.disposeEditor = () => { editor?.dispose(); open.forEach(st => st.model.dispose()); };
}

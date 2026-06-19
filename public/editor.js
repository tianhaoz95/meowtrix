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

  // View switcher: Explorer (file tree) vs Source Control (git). The git button
  // is only shown once we confirm the folder is a repo.
  const sideTabs = document.createElement('div');
  sideTabs.className = 'editor-sidetabs';
  const filesBtn = document.createElement('button');
  filesBtn.className = 'editor-sidetab active';
  filesBtn.textContent = '🗂 Files';
  const gitBtn = document.createElement('button');
  gitBtn.className = 'editor-sidetab';
  gitBtn.textContent = '⎇ Git';
  gitBtn.hidden = true;
  sideTabs.append(filesBtn, gitBtn);

  const treeEl = document.createElement('div');
  treeEl.className = 'editor-tree';
  const gitEl = document.createElement('div');
  gitEl.className = 'editor-git';
  gitEl.hidden = true;
  sidebar.append(sideHeader, sideTabs, treeEl, gitEl);

  // Drag handle between the tree and the editor.
  const resizer = document.createElement('div');
  resizer.className = 'editor-resizer';

  const main = document.createElement('div');
  main.className = 'editor-main';
  const fileTabs = document.createElement('div');
  fileTabs.className = 'editor-filetabs';
  // Always-visible toggle to collapse/expand the file tree (stays leftmost; file
  // tabs are appended after it).
  const sidebarToggle = document.createElement('button');
  sidebarToggle.className = 'editor-sidebar-toggle';
  sidebarToggle.title = 'Toggle file tree';
  sidebarToggle.textContent = '◧';
  fileTabs.appendChild(sidebarToggle);
  const body = document.createElement('div');
  body.className = 'editor-body';
  const monacoHost = document.createElement('div');
  monacoHost.className = 'editor-monaco';
  const placeholder = document.createElement('div');
  placeholder.className = 'editor-placeholder';
  placeholder.textContent = 'Select a file to start editing';
  monacoHost.appendChild(placeholder);

  // Diff overlay (git Source Control): a Monaco diff editor shown on top of the
  // normal editor when reviewing a changed file.
  const diffWrap = document.createElement('div');
  diffWrap.className = 'editor-diff';
  diffWrap.hidden = true;
  const diffHeader = document.createElement('div');
  diffHeader.className = 'editor-diff-header';
  const diffTitle = document.createElement('span');
  diffTitle.className = 'editor-diff-title';
  const diffClose = document.createElement('button');
  diffClose.className = 'editor-diff-close';
  diffClose.textContent = '✕';
  diffClose.title = 'Close diff';
  diffHeader.append(diffTitle, diffClose);
  const diffHost = document.createElement('div');
  diffHost.className = 'editor-diff-host';
  diffWrap.append(diffHeader, diffHost);

  body.append(monacoHost, diffWrap);
  main.append(fileTabs, body);

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

  // ── Sidebar collapse ─────────────────────────────────────────────────────────
  function applyCollapsed(collapsed) {
    viewEl.classList.toggle('sidebar-collapsed', collapsed);
    sidebarToggle.classList.toggle('active', collapsed);
    editor?.layout();
  }
  if (tab.editorSidebarCollapsed) applyCollapsed(true);
  sidebarToggle.addEventListener('click', () => {
    tab.editorSidebarCollapsed = !tab.editorSidebarCollapsed;
    applyCollapsed(tab.editorSidebarCollapsed);
    if (typeof saveSessionState === 'function') saveSessionState();
  });

  function toast(msg) { if (typeof showToast === 'function') showToast(msg); }

  // ── Sidebar view switch (Explorer / Source Control) ──────────────────────────
  function showView(which) {
    const git = which === 'git';
    filesBtn.classList.toggle('active', !git);
    gitBtn.classList.toggle('active', git);
    treeEl.hidden = git;
    gitEl.hidden = !git;
    if (git) refreshGit();
  }
  filesBtn.addEventListener('click', () => showView('files'));
  gitBtn.addEventListener('click', () => showView('git'));

  // ── Git diff overlay ─────────────────────────────────────────────────────────
  let diffEditor = null, diffModels = null, diffCurrent = null;
  function langFromPath(monaco, p) {
    const ext = '.' + p.split('.').pop().toLowerCase();
    for (const l of monaco.languages.getLanguages()) if ((l.extensions || []).includes(ext)) return l.id;
    return 'plaintext';
  }
  function closeDiff() {
    if (diffWrap.hidden) return;
    diffWrap.hidden = true;
    diffCurrent = null;
  }
  async function openDiff(absPath, staged) {
    let data;
    try {
      const res = await fetch(`/api/git/filediff?root=${encodeURIComponent(dir)}` +
        `&path=${encodeURIComponent(absPath)}&staged=${staged ? 1 : 0}`);
      data = await res.json();
      if (!res.ok) { toast(data.error || 'Cannot diff'); return; }
    } catch { toast('Cannot diff'); return; }
    if (data.binary) { toast('Binary file — no diff'); return; }
    const monaco = await ensureMonaco();
    if (!diffEditor) {
      diffEditor = monaco.editor.createDiffEditor(diffHost, {
        theme: monacoTheme(), readOnly: true, automaticLayout: false,
        renderSideBySide: true, fontSize: 13, scrollBeyondLastLine: false,
      });
    }
    if (diffModels) { diffModels.original.dispose(); diffModels.modified.dispose(); }
    const lang = langFromPath(monaco, absPath);
    diffModels = {
      original: monaco.editor.createModel(data.original, lang),
      modified: monaco.editor.createModel(data.modified, lang),
    };
    diffEditor.setModel(diffModels);
    diffCurrent = { path: absPath, staged };
    diffTitle.textContent = basename(absPath) + (staged ? '  (staged)' : '');
    diffTitle.title = absPath;
    diffWrap.hidden = false;
    requestAnimationFrame(() => diffEditor.layout());
  }
  diffClose.addEventListener('click', closeDiff);

  // ── Git panel (Source Control) ───────────────────────────────────────────────
  function iconBtn(label, title, onClick) {
    const b = document.createElement('button');
    b.className = 'editor-git-iconbtn';
    b.textContent = label; b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }
  async function gitAction(url, bodyObj) {
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) { toast(data.error || data.output || 'Git action failed'); return false; }
      return data;
    } catch { toast('Git action failed'); return false; }
  }
  async function refreshGit() {
    gitEl.innerHTML = '<div class="editor-git-empty">Loading…</div>';
    let s;
    try {
      const res = await fetch('/api/git/status?root=' + encodeURIComponent(dir));
      s = await res.json();
    } catch { gitEl.innerHTML = '<div class="editor-git-empty">Git unavailable</div>'; return; }
    if (!s.isRepo) { gitEl.innerHTML = '<div class="editor-git-empty">Not a git repository</div>'; return; }
    renderGit(s);
  }
  const STATUS_WORD = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied', U: 'Untracked', '!': 'Ignored' };
  function gitSection(title, files, isStaged) {
    const sec = document.createElement('div'); sec.className = 'editor-git-section';
    const head = document.createElement('div'); head.className = 'editor-git-sectionhead';
    const t = document.createElement('span'); t.className = 'editor-git-sectiontitle'; t.textContent = title;
    const count = document.createElement('span'); count.className = 'editor-git-count'; count.textContent = files.length;
    const all = iconBtn(isStaged ? '−' : '+', isStaged ? 'Unstage all' : 'Stage all', async () => {
      const url = isStaged ? '/api/git/unstage' : '/api/git/stage';
      if (await gitAction(url, { root: dir, all: true })) refreshGit();
    });
    all.classList.add('editor-git-sectionaction');
    head.append(t, count, all);
    sec.append(head);
    files.forEach(f => sec.append(gitFileRow(f, isStaged)));
    return sec;
  }
  function gitFileRow(f, isStaged) {
    const abs = join(dir, f.path);
    const code = isStaged ? f.x : (f.x === '?' ? 'U' : f.y);
    const row = document.createElement('div'); row.className = 'editor-git-file';
    if (diffCurrent && diffCurrent.path === abs && diffCurrent.staged === isStaged) row.classList.add('selected');

    const slash = f.path.lastIndexOf('/');
    const name = document.createElement('span'); name.className = 'editor-git-filename';
    const base = document.createElement('span'); base.className = 'editor-git-filebase';
    base.textContent = slash >= 0 ? f.path.slice(slash + 1) : f.path;
    name.appendChild(base);
    if (slash >= 0) {
      const folder = document.createElement('span'); folder.className = 'editor-git-filedir';
      folder.textContent = f.path.slice(0, slash);
      name.appendChild(folder);
    }
    name.title = f.path;

    const acts = document.createElement('span'); acts.className = 'editor-git-fileacts';
    if (isStaged) {
      acts.append(iconBtn('−', 'Unstage', async (e) => {
        e.stopPropagation();
        if (await gitAction('/api/git/unstage', { root: dir, paths: [abs] })) refreshGit();
      }));
    } else {
      const untracked = f.x === '?';
      acts.append(iconBtn('↺', 'Discard', async (e) => {
        e.stopPropagation();
        if (!confirm(`Discard changes to ${f.path}?`)) return;
        if (await gitAction('/api/git/discard', { root: dir, path: abs, untracked })) {
          if (diffCurrent && diffCurrent.path === abs) closeDiff();
          refreshGit();
        }
      }));
      acts.append(iconBtn('+', 'Stage', async (e) => {
        e.stopPropagation();
        if (await gitAction('/api/git/stage', { root: dir, paths: [abs] })) refreshGit();
      }));
    }

    const badge = document.createElement('span');
    badge.className = 'editor-git-badge st-' + code; badge.textContent = code;
    badge.title = STATUS_WORD[code] || code;

    row.append(name, acts, badge);
    row.addEventListener('click', () => openDiff(abs, isStaged));
    return row;
  }
  function renderGit(s) {
    gitEl.innerHTML = '';
    const branchBar = document.createElement('div'); branchBar.className = 'editor-git-branch';
    const bicon = document.createElement('span'); bicon.className = 'editor-git-branchicon'; bicon.textContent = '⎇';
    const bname = document.createElement('span'); bname.className = 'editor-git-branchname';
    bname.textContent = s.branch || '(detached)'; bname.title = s.branch || '';
    branchBar.append(bicon, bname);
    if (s.ahead || s.behind) {
      const sync = document.createElement('span'); sync.className = 'editor-git-syncinfo';
      sync.textContent = (s.behind ? '↓' + s.behind : '') + (s.ahead ? ' ↑' + s.ahead : '');
      branchBar.append(sync);
    }
    const acts = document.createElement('span'); acts.className = 'editor-git-branchactions';
    acts.append(
      iconBtn('↻', 'Refresh', refreshGit),
      iconBtn('↓', 'Pull', async () => { if (await gitAction('/api/git/pull', { root: dir })) { toast('Pulled'); refreshGit(); } }),
      iconBtn('↑', 'Push', async () => { if (await gitAction('/api/git/push', { root: dir })) { toast('Pushed'); refreshGit(); } }),
    );
    branchBar.append(acts);
    gitEl.append(branchBar);

    const staged = s.files.filter(f => f.x !== ' ' && f.x !== '?');
    const changes = s.files.filter(f => f.y !== ' ' || f.x === '?');

    const commitBox = document.createElement('div'); commitBox.className = 'editor-git-commit';
    const msg = document.createElement('textarea');
    msg.className = 'editor-git-msg'; msg.placeholder = 'Message (Cmd/Ctrl+Enter to commit)'; msg.rows = 2;
    const commitBtn = document.createElement('button');
    commitBtn.className = 'editor-git-commitbtn';
    commitBtn.textContent = staged.length ? `✓ Commit ${staged.length} file${staged.length > 1 ? 's' : ''}` : '✓ Commit';
    commitBtn.disabled = !staged.length;
    const doCommit = async () => {
      if (!staged.length) { toast('Nothing staged to commit'); return; }
      if (!msg.value.trim()) { toast('Enter a commit message'); msg.focus(); return; }
      const r = await gitAction('/api/git/commit', { root: dir, message: msg.value });
      if (r) { toast('Committed'); msg.value = ''; closeDiff(); refreshGit(); }
    };
    commitBtn.addEventListener('click', doCommit);
    msg.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doCommit(); } });
    commitBox.append(msg, commitBtn);
    gitEl.append(commitBox);

    if (staged.length) gitEl.append(gitSection('Staged Changes', staged, true));
    if (changes.length) gitEl.append(gitSection('Changes', changes, false));
    if (!staged.length && !changes.length) {
      const clean = document.createElement('div'); clean.className = 'editor-git-empty';
      clean.innerHTML = '<div class="editor-git-empty-icon">✓</div>No changes — working tree clean';
      gitEl.append(clean);
    }
  }

  // ── File tabs ─────────────────────────────────────────────────────────────
  function setActive(p) {
    closeDiff(); // viewing/opening a normal file leaves the git diff overlay
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

  // Reveal the Source Control view once we confirm the folder is a git repo.
  if (dir) {
    fetch('/api/git/status?root=' + encodeURIComponent(dir))
      .then(r => r.json()).then(s => { if (s.isRepo) gitBtn.hidden = false; })
      .catch(() => {});
  }

  // Lay out Monaco when the pane becomes visible or is resized (mirrors the
  // terminal's fit-on-resize). onActivate is invoked by activateTab in pane.js.
  const relayout = () => {
    if (!viewEl.classList.contains('active')) return;
    if (editor) editor.layout();
    if (diffEditor && !diffWrap.hidden) diffEditor.layout();
  };
  tab.onActivate = relayout;
  new ResizeObserver(relayout).observe(viewEl);

  tab.disposeEditor = () => {
    editor?.dispose();
    diffEditor?.dispose();
    if (diffModels) { diffModels.original.dispose(); diffModels.modified.dispose(); }
    open.forEach(st => st.model.dispose());
  };
}

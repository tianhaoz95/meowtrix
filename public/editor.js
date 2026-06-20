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

let _markedPromise = null;
function ensureMarked() {
  if (_markedPromise) return _markedPromise;
  _markedPromise = new Promise((resolve, reject) => {
    const oldDefine = window.define;
    if (typeof window.define === 'function') {
      window.define = undefined;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/marked/lib/marked.umd.js';
    script.onload = () => {
      if (oldDefine) window.define = oldDefine;
      resolve(window.marked);
    };
    script.onerror = (err) => {
      if (oldDefine) window.define = oldDefine;
      reject(err);
    };
    document.head.appendChild(script);
  });
  return _markedPromise;
}

function isMarkdownFile(filePath) {
  if (!filePath) return false;
  const ext = filePath.split('.').pop().toLowerCase();
  return ext === 'md' || ext === 'markdown';
}

function isHtmlFile(filePath) {
  if (!filePath) return false;
  const ext = filePath.split('.').pop().toLowerCase();
  return ext === 'html' || ext === 'htm';
}

function isPreviewableFile(filePath) {
  return isMarkdownFile(filePath) || isHtmlFile(filePath);
}

async function checkAICapabilities() {
  try {
    // 1. Check for LanguageModel constructor in self/window
    if (typeof LanguageModel !== 'undefined') {
      console.log('🐾 [Meowtrix AI Check] Found global LanguageModel');
      if (typeof LanguageModel.availability === 'function') {
        const availability = await LanguageModel.availability();
        console.log('🐾 [Meowtrix AI Check] LanguageModel availability:', availability);
        if (availability === 'available' || availability === 'readily' || availability === 'downloadable' || availability === 'downloading') {
          return LanguageModel;
        }
      } else if (typeof LanguageModel.capabilities === 'function') {
        const capabilities = await LanguageModel.capabilities();
        console.log('🐾 [Meowtrix AI Check] LanguageModel capabilities:', capabilities);
        const av = capabilities && capabilities.available;
        if (av === 'readily' || av === 'available' || av === 'after-download' || av === true) {
          return LanguageModel;
        }
      } else if (typeof LanguageModel.create === 'function') {
        return LanguageModel;
      }
    }

    // 2. Fallback to standard ai.languageModel
    const aiObj = window.ai || (typeof ai !== 'undefined' ? ai : null);
    console.log('🐾 [Meowtrix AI Check] aiObj:', aiObj);
    if (aiObj) {
      const modelAPI = aiObj.languageModel || aiObj.assistant;
      console.log('🐾 [Meowtrix AI Check] modelAPI:', modelAPI);
      if (modelAPI) {
        if (typeof modelAPI.capabilities === 'function') {
          const capabilities = await modelAPI.capabilities();
          console.log('🐾 [Meowtrix AI Check] capabilities:', capabilities);
          const av = capabilities && capabilities.available;
          if (av === 'readily' || av === 'available' || av === 'after-download' || av === true) {
            return modelAPI;
          }
        } else if (typeof modelAPI.create === 'function') {
          console.log('🐾 [Meowtrix AI Check] capabilities() not found, fallback to create()');
          return modelAPI;
        }
      }
    }
  } catch (e) {
    console.warn('🐾 [Meowtrix AI Check] check failed:', e);
  }
  return null;
}

async function countTokens(modelOrSession, text) {
  if (!text) return 0;
  try {
    if (modelOrSession && typeof modelOrSession.countTokens === 'function') {
      const res = await modelOrSession.countTokens(text);
      const count = (res && typeof res === 'object') ? (res.count || res.totalTokens) : res;
      if (typeof count === 'number') return count;
    }
  } catch (e) {
    console.warn('🐾 [Meowtrix AI Check] countTokens error:', e);
  }
  // Fallback estimation: ~4 characters per token
  return Math.max(1, Math.round(text.length / 4));
}



// Light vs dark to match the app theme (non-'light' themes are all dark variants).
function monacoTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'vs' : 'vs-dark';
}

function basename(p) {
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}

function getFileSvg(color, symbolHtml) {
  return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 1.5C3 0.67 3.67 0 4.5 0H9.5L13 3.5V14.5C13 15.33 12.33 16 11.5 16H4.5C3.67 16 3 15.33 3 14.5V1.5Z" fill="${color}" fill-opacity="0.08"/>
    <path d="M3 1.5C3 0.67 3.67 0 4.5 0H9.5L13 3.5V14.5C13 15.33 12.33 16 11.5 16H4.5C3.67 16 3 15.33 3 14.5V1.5Z" stroke="${color}" stroke-width="1.2" stroke-opacity="0.8" stroke-linejoin="round" stroke-linecap="round" fill="none"/>
    <path d="M9.5 0V3.5H13L9.5 0Z" fill="${color}" fill-opacity="0.8"/>
    ${symbolHtml}
  </svg>`;
}

function getFileIconSvg(filename, type, isOpen = false) {
  if (type === 'dir') {
    if (isOpen) {
      return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.2a1.5 1.5 0 0 1 1 .4L8.9 3.5H13A1.5 1.5 0 0 1 14.5 5v8.5a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5V3z" fill="#ffca28"/>
        <path d="M1.5 6h13l-1.2 7.2a1.5 1.5 0 0 1-1.5 1.3H4.2a1.5 1.5 0 0 1-1.5-1.3L1.5 6z" fill="#ffb300"/>
      </svg>`;
    } else {
      return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.2a1.5 1.5 0 0 1 1 .4L8.9 3.5H13A1.5 1.5 0 0 1 14.5 5v8.5a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5V3z" fill="#ffca28"/>
        <path d="M1.5 5.5h13V13a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5V5.5z" fill="#ffa000"/>
      </svg>`;
    }
  }

  const ext = filename.split('.').pop().toLowerCase();
  
  if (filename === 'package.json') {
    return getFileSvg('#cb3837', `<text x="8" y="11.5" font-family="'Inter', sans-serif" font-size="4.2" font-weight="900" fill="#cb3837" text-anchor="middle">npm</text>`);
  }
  if (filename === 'package-lock.json') {
    return getFileSvg('#cb3837', `<text x="8" y="11.5" font-family="'Inter', sans-serif" font-size="4.2" font-weight="900" fill="#cb3837" text-anchor="middle">lock</text>`);
  }
  if (filename.startsWith('.git') || filename === 'LICENSE') {
    return getFileSvg('#f05032', `
      <circle cx="6" cy="11.5" r="0.8" fill="#f05032"/>
      <circle cx="10" cy="7.5" r="0.8" fill="#f05032"/>
      <path d="M6 11.5V8a1.5 1.5 0 0 1 1.5-1.5h1" stroke="#f05032" stroke-width="0.8" fill="none"/>
      <path d="M6 12.5v-6" stroke="#f05032" stroke-width="0.8" fill="none"/>
      <circle cx="6" cy="5" r="0.8" fill="#f05032"/>
    `);
  }
  if (filename === 'dockerfile' || filename === 'docker-compose.yml') {
    return getFileSvg('#2496ed', `<text x="8" y="11" font-family="'Inter', sans-serif" font-size="5" font-weight="800" fill="#2496ed" text-anchor="middle">DK</text>`);
  }

  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return getFileSvg('#f1c40f', `<text x="8" y="11" font-family="'Inter', sans-serif" font-size="5.5" font-weight="800" fill="#f1c40f" text-anchor="middle">JS</text>`);
    case 'ts':
      return getFileSvg('#007acc', `<text x="8" y="11" font-family="'Inter', sans-serif" font-size="5.5" font-weight="800" fill="#007acc" text-anchor="middle">TS</text>`);
    case 'tsx':
    case 'jsx':
      return getFileSvg('#00d8ff', `
        <g stroke="#00d8ff" stroke-width="0.6" fill="none">
          <ellipse cx="8" cy="9.5" rx="4" ry="1.5" transform="rotate(30, 8, 9.5)"/>
          <ellipse cx="8" cy="9.5" rx="4" ry="1.5" transform="rotate(90, 8, 9.5)"/>
          <ellipse cx="8" cy="9.5" rx="4" ry="1.5" transform="rotate(150, 8, 9.5)"/>
          <circle cx="8" cy="9.5" r="0.6" fill="#00d8ff"/>
        </g>
      `);
    case 'html':
    case 'htm':
      return getFileSvg('#e44d26', `<text x="8" y="11" font-family="'Inter', sans-serif" font-size="4.5" font-weight="800" fill="#e44d26" text-anchor="middle">&lt;&gt;</text>`);
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return getFileSvg('#264de4', `<text x="8" y="11" font-family="'Inter', sans-serif" font-size="5.5" font-weight="800" fill="#264de4" text-anchor="middle">#</text>`);
    case 'json':
      return getFileSvg('#ea80fc', `<text x="8" y="11" font-family="'Inter', sans-serif" font-size="5" font-weight="800" fill="#ea80fc" text-anchor="middle">{}</text>`);
    case 'md':
    case 'markdown':
      return getFileSvg('#0083c9', `<text x="8" y="11" font-family="'Inter', sans-serif" font-size="4.5" font-weight="800" fill="#0083c9" text-anchor="middle">MD</text>`);
    case 'py':
    case 'pyc':
      return getFileSvg('#306998', `<text x="8" y="11" font-family="'Inter', sans-serif" font-size="5" font-weight="800" fill="#306998" text-anchor="middle">PY</text>`);
    case 'go':
      return getFileSvg('#00add8', `<text x="8" y="11" font-family="'Inter', sans-serif" font-size="5" font-weight="900" fill="#00add8" text-anchor="middle">GO</text>`);
    case 'rs':
      return getFileSvg('#cea475', `<text x="8" y="11" font-family="'Inter', sans-serif" font-size="5" font-weight="800" fill="#cea475" text-anchor="middle">RS</text>`);
    case 'sh':
    case 'bash':
    case 'zsh':
      return getFileSvg('#41b883', `<text x="8" y="11" font-family="'Inter', sans-serif" font-size="4.5" font-weight="800" fill="#41b883" text-anchor="middle">&gt;_</text>`);
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
      return getFileSvg('#a55eea', `
        <rect x="5.5" y="7" width="5" height="4" rx="0.5" stroke="#a55eea" stroke-width="0.6" fill="none"/>
        <circle cx="7" cy="8.2" r="0.5" fill="#a55eea"/>
        <path d="M6 10.5l1.2-1.2 0.8 0.8 1.2-1.6 0.8 1.2" stroke="#a55eea" stroke-width="0.6" fill="none" stroke-linejoin="round"/>
      `);
    case 'txt':
    case 'log':
    case 'conf':
    case 'ini':
    case 'yml':
    case 'yaml':
      return getFileSvg('var(--text3)', `
        <line x1="5.5" y1="7" x2="10.5" y2="7" stroke="currentColor" stroke-width="0.7" opacity="0.6"/>
        <line x1="5.5" y1="9" x2="10.5" y2="9" stroke="currentColor" stroke-width="0.7" opacity="0.6"/>
        <line x1="5.5" y1="11" x2="8.5" y2="11" stroke="currentColor" stroke-width="0.7" opacity="0.6"/>
      `);
    default:
      return getFileSvg('currentColor', `
        <line x1="5.5" y1="7" x2="10.5" y2="7" stroke="currentColor" stroke-width="0.7" opacity="0.4"/>
        <line x1="5.5" y1="9" x2="10.5" y2="9" stroke="currentColor" stroke-width="0.7" opacity="0.4"/>
      `);
  }
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
  
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'editor-sidebar-refresh';
  refreshBtn.textContent = '↻';
  refreshBtn.title = 'Refresh file tree';
  refreshBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    refreshFiles();
  });

  sideHeader.append(sideHeaderIcon, sideHeaderName, refreshBtn);
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

  let diffSideBySide = true;
  const diffToggleMode = document.createElement('button');
  diffToggleMode.className = 'editor-diff-togglemode';
  diffToggleMode.textContent = '◫ Split';
  diffToggleMode.title = 'Toggle Split vs Unified diff view';
  diffToggleMode.addEventListener('click', () => {
    diffSideBySide = !diffSideBySide;
    diffToggleMode.textContent = diffSideBySide ? '◫ Split' : '▤ Unified';
    if (diffEditor) {
      diffEditor.updateOptions({ renderSideBySide: diffSideBySide });
    }
  });

  const diffClose = document.createElement('button');
  diffClose.className = 'editor-diff-close';
  diffClose.textContent = '✕';
  diffClose.title = 'Close diff';
  diffHeader.append(diffTitle, diffToggleMode, diffClose);
  const diffHost = document.createElement('div');
  diffHost.className = 'editor-diff-host';
  diffWrap.append(diffHeader, diffHost);

  const markdownPreviewHost = document.createElement('div');
  markdownPreviewHost.className = 'editor-markdown-preview';
  markdownPreviewHost.hidden = true;

  const markdownToggleWrap = document.createElement('div');
  markdownToggleWrap.className = 'editor-markdown-toggle-wrap';
  markdownToggleWrap.hidden = true;

  const btnEdit = document.createElement('button');
  btnEdit.className = 'editor-markdown-btn active';
  btnEdit.textContent = 'Edit';
  btnEdit.addEventListener('click', () => togglePreviewMode(false));

  const btnPreview = document.createElement('button');
  btnPreview.className = 'editor-markdown-btn';
  btnPreview.textContent = 'Preview';
  btnPreview.addEventListener('click', () => togglePreviewMode(true));

  markdownToggleWrap.append(btnEdit, btnPreview);

  body.append(monacoHost, markdownPreviewHost, diffWrap, markdownToggleWrap);
  main.append(fileTabs, body);

  viewEl.append(sidebar, resizer, main);

  viewEl.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveActive();
    }
  });

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
    if (isPreviewableFile(activePath)) {
      markdownToggleWrap.hidden = false;
    }
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
        renderSideBySide: diffSideBySide, fontSize: 13, scrollBeyondLastLine: false,
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
    markdownToggleWrap.hidden = true;
    requestAnimationFrame(() => diffEditor.layout());
  }
  diffClose.addEventListener('click', closeDiff);

  async function openCommitDiff(absPath, commitHash) {
    let data;
    try {
      const res = await fetch(`/api/git/filediff?root=${encodeURIComponent(dir)}` +
        `&path=${encodeURIComponent(absPath)}&hash=${commitHash}`);
      data = await res.json();
      if (!res.ok) { toast(data.error || 'Cannot diff'); return; }
    } catch { toast('Cannot diff'); return; }
    if (data.binary) { toast('Binary file — no diff'); return; }
    const monaco = await ensureMonaco();
    if (!diffEditor) {
      diffEditor = monaco.editor.createDiffEditor(diffHost, {
        theme: monacoTheme(), readOnly: true, automaticLayout: false,
        renderSideBySide: diffSideBySide, fontSize: 13, scrollBeyondLastLine: false,
      });
    }
    if (diffModels) { diffModels.original.dispose(); diffModels.modified.dispose(); }
    const lang = langFromPath(monaco, absPath);
    diffModels = {
      original: monaco.editor.createModel(data.original, lang),
      modified: monaco.editor.createModel(data.modified, lang),
    };
    diffEditor.setModel(diffModels);
    diffCurrent = { path: absPath, staged: false };
    diffTitle.textContent = basename(absPath) + `  @ ${commitHash.slice(0, 7)}`;
    diffTitle.title = absPath;
    diffWrap.hidden = false;
    markdownToggleWrap.hidden = true;
    requestAnimationFrame(() => diffEditor.layout());
  }

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
    let s, logData;
    try {
      const [resStatus, resLog] = await Promise.all([
        fetch('/api/git/status?root=' + encodeURIComponent(dir)),
        fetch('/api/git/log?root=' + encodeURIComponent(dir))
      ]);
      s = await resStatus.json();
      logData = await resLog.json();
    } catch {
      gitEl.innerHTML = '<div class="editor-git-empty">Git unavailable</div>';
      return;
    }
    if (!s.isRepo) {
      gitEl.innerHTML = '<div class="editor-git-empty">Not a git repository</div>';
      return;
    }
    renderGit(s, logData);
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
  function gitHistorySection(logData) {
    const sec = document.createElement('div'); sec.className = 'editor-git-section';
    const head = document.createElement('div'); head.className = 'editor-git-sectionhead';
    const t = document.createElement('span'); t.className = 'editor-git-sectiontitle'; t.textContent = 'Commit History';
    head.append(t);
    sec.append(head);

    const container = document.createElement('div');
    container.className = 'editor-git-history-container';

    if (!logData || !logData.ok || !logData.stdout.trim()) {
      const empty = document.createElement('div');
      empty.className = 'editor-git-empty';
      empty.textContent = 'No commits found';
      sec.append(empty);
      return sec;
    }

    const lines = logData.stdout.split('\n').filter(line => line.trim());
    lines.forEach(line => {
      const wrapper = document.createElement('div');
      wrapper.className = 'git-log-row-wrapper';

      const row = document.createElement('div');
      row.className = 'git-log-row';

      let escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      escaped = escaped.replace(/(&lt;[^&]+&gt;)$/, '<span class="git-log-author">$1</span>');
      escaped = escaped.replace(/(\([^)]+\))\s+(<span class="git-log-author">)/, '<span class="git-log-date">$1</span> $2');
      escaped = escaped.replace(/(\((HEAD\s*-&gt;\s*[^)]+|tag:\s*[^)]+|[^)]+)\))/, '<span class="git-log-refs">$1</span>');
      escaped = escaped.replace(/\b([0-9a-f]{7})\b\s+-/, '<span class="git-log-hash">$1</span> -');

      row.innerHTML = escaped;

      const hashMatch = line.match(/\b([0-9a-f]{7})\b/);
      if (hashMatch) {
        const hash = hashMatch[1];
        row.classList.add('is-commit');

        const details = document.createElement('div');
        details.className = 'git-commit-details';
        details.style.display = 'none';

        let loaded = false;

        row.addEventListener('click', async () => {
          if (details.style.display === 'block') {
            details.style.display = 'none';
            row.classList.remove('expanded');
          } else {
            // Close other expanded commits
            container.querySelectorAll('.git-commit-details').forEach(el => el.style.display = 'none');
            container.querySelectorAll('.git-log-row').forEach(el => el.classList.remove('expanded'));

            details.style.display = 'block';
            row.classList.add('expanded');

            if (!loaded) {
              details.innerHTML = '<div class="editor-git-empty" style="padding: 10px;">Loading changes…</div>';
              try {
                const res = await fetch(`/api/git/commitfiles?root=${encodeURIComponent(dir)}&hash=${hash}`);
                const data = await res.json();
                if (data.ok && data.files.length) {
                  details.innerHTML = '';
                  data.files.forEach(f => {
                    const fileRow = document.createElement('div');
                    fileRow.className = 'git-commit-file-row';

                    const badge = document.createElement('span');
                    const statusLetter = f.status[0];
                    badge.className = 'editor-git-badge st-' + statusLetter;
                    badge.textContent = statusLetter;
                    badge.title = STATUS_WORD[statusLetter] || statusLetter;

                    const pathSpan = document.createElement('span');
                    pathSpan.className = 'git-commit-file-path';
                    pathSpan.textContent = f.path;

                    fileRow.append(badge, pathSpan);
                    fileRow.addEventListener('click', (e) => {
                      e.stopPropagation();
                      openCommitDiff(f.path, hash);
                    });

                    details.append(fileRow);
                  });
                  loaded = true;
                } else {
                  details.textContent = 'No file changes found';
                }
              } catch (err) {
                details.textContent = 'Error loading file changes';
              }
            }
          }
        });

        wrapper.append(row, details);
      } else {
        wrapper.append(row);
      }

      container.append(wrapper);
    });

    sec.append(container);
    return sec;
  }

  function renderGit(s, logData) {
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
    
    const refreshBtn = iconBtn('↻', 'Refresh', async () => {
      refreshBtn.classList.add('loading', 'anim-spin');
      refreshBtn.disabled = true;
      await refreshGit();
      refreshBtn.classList.remove('loading', 'anim-spin');
      refreshBtn.disabled = false;
    });

    const pullBtn = iconBtn('↓', 'Pull', async () => {
      pullBtn.classList.add('loading', 'anim-slide-down');
      pullBtn.disabled = true;
      if (await gitAction('/api/git/pull', { root: dir })) {
        toast('Pulled');
        await refreshGit();
      }
      pullBtn.classList.remove('loading', 'anim-slide-down');
      pullBtn.disabled = false;
    });

    const pushBtn = iconBtn('↑', 'Push', async () => {
      pushBtn.classList.add('loading', 'anim-slide-up');
      pushBtn.disabled = true;
      if (await gitAction('/api/git/push', { root: dir })) {
        toast('Pushed');
        await refreshGit();
      }
      pushBtn.classList.remove('loading', 'anim-slide-up');
      pushBtn.disabled = false;
    });

    acts.append(refreshBtn, pullBtn, pushBtn);
    branchBar.append(acts);
    gitEl.append(branchBar);

    const staged = s.files.filter(f => f.x !== ' ' && f.x !== '?');
    const changes = s.files.filter(f => f.y !== ' ' || f.x === '?');

    const commitBox = document.createElement('div'); commitBox.className = 'editor-git-commit';
    const msg = document.createElement('textarea');
    msg.className = 'editor-git-msg'; msg.placeholder = 'Message (Cmd/Ctrl+Enter to commit)'; msg.rows = 2;

    const tokenStatus = document.createElement('div');
    tokenStatus.className = 'editor-git-token-status';
    tokenStatus.innerHTML = `
      <div class="git-token-stat input-stat">
        <span class="git-token-label">Sent:</span>
        <span class="git-token-val">0</span> tokens
      </div>
      <div class="git-token-stat output-stat">
        <span class="git-token-label">Gen:</span>
        <span class="git-token-val">0</span> tokens
      </div>
    `;

    msg.addEventListener('input', () => {
      tokenStatus.classList.remove('active');
    });

    const btnRow = document.createElement('div');
    btnRow.className = 'editor-git-commit-btns';

    const commitBtn = document.createElement('button');
    commitBtn.className = 'editor-git-commitbtn';
    commitBtn.textContent = staged.length ? `✓ Commit ${staged.length} file${staged.length > 1 ? 's' : ''}` : '✓ Commit';
    commitBtn.disabled = !staged.length;
    const doCommit = async () => {
      if (!staged.length) { toast('Nothing staged to commit'); return; }
      if (!msg.value.trim()) { toast('Enter a commit message'); msg.focus(); return; }
      const r = await gitAction('/api/git/commit', { root: dir, message: msg.value });
      if (r) {
        toast('Committed');
        msg.value = '';
        tokenStatus.classList.remove('active');
        closeDiff();
        refreshGit();
      }
    };
    commitBtn.addEventListener('click', doCommit);
    msg.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doCommit(); } });

    const aiBtn = document.createElement('button');
    aiBtn.className = 'editor-git-aibtn';
    aiBtn.innerHTML = '✨ Generate';
    aiBtn.title = 'Generate commit message using Chrome on-device AI';
    aiBtn.style.display = 'none';

    checkAICapabilities().then(modelAPI => {
      if (modelAPI) {
        aiBtn.style.display = 'inline-flex';
        aiBtn.addEventListener('click', async () => {
          if (!staged.length) {
            toast('Stage some changes first to generate a message');
            return;
          }
          aiBtn.disabled = true;
          aiBtn.innerHTML = '✨ Gen…';
          msg.classList.add('generating');

          // Reset status
          tokenStatus.classList.remove('active');
          tokenStatus.querySelector('.input-stat .git-token-val').textContent = '0';
          tokenStatus.querySelector('.output-stat .git-token-val').textContent = '0';
          tokenStatus.querySelector('.output-stat').classList.remove('generating');

          try {
            const res = await fetch('/api/git/diff?root=' + encodeURIComponent(dir));
            const data = await res.json();
            if (!data.ok || !data.stdout.trim()) {
              toast('No changes found or could not get diff');
              return;
            }
            
            let diffText = data.stdout;
            if (diffText.length > 8000) {
              diffText = diffText.slice(0, 8000) + '\n... [diff truncated for length]';
            }

            const promptText = "Generate a commit message for the following diff:\n\n" + diffText;

            // Calculate input tokens using our robust countTokens helper
            const inputTokens = await countTokens(modelAPI, promptText);

            tokenStatus.querySelector('.input-stat .git-token-val').textContent = inputTokens;
            tokenStatus.classList.add('active');
            tokenStatus.querySelector('.output-stat').classList.add('generating');

            const session = await modelAPI.create({
              systemPrompt: "You are a Git commit message generator. You write concise, clear, and conventional commit messages based on the provided diff. Only respond with the commit message itself, nothing else. No markdown formatting (like code blocks). Keep the summary line under 72 characters, followed by a blank line and brief bullet points for details if there are multiple files."
            });

            let genText = '';
            if (typeof session.promptStreaming === 'function') {
              const stream = session.promptStreaming(promptText);
              msg.value = '';
              for await (const chunk of stream) {
                const trimmedChunk = chunk.trim();
                if (trimmedChunk.startsWith(genText)) {
                  genText = trimmedChunk;
                } else {
                  genText += chunk;
                }
                msg.value = genText;
                
                // Track generated tokens in real time
                const tokenCount = await countTokens(session, genText);
                tokenStatus.querySelector('.output-stat .git-token-val').textContent = tokenCount;
              }
            } else {
              genText = await session.prompt(promptText);
              msg.value = genText.trim();
              const tokenCount = await countTokens(session, genText);
              tokenStatus.querySelector('.output-stat .git-token-val').textContent = tokenCount;
            }

            session.destroy?.();
            tokenStatus.querySelector('.output-stat').classList.remove('generating');

            if (!genText) {
              toast('AI returned empty message');
            }
          } catch (err) {
            console.error(err);
            toast('Failed to generate: ' + err.message);
          } finally {
            aiBtn.disabled = false;
            aiBtn.innerHTML = '✨ Generate';
            msg.classList.remove('generating');
          }
        });
      }
    });

    btnRow.append(commitBtn, aiBtn);
    commitBox.append(msg, tokenStatus, btnRow);
    gitEl.append(commitBox);

    if (staged.length) gitEl.append(gitSection('Staged Changes', staged, true));
    if (changes.length) gitEl.append(gitSection('Changes', changes, false));
    if (!staged.length && !changes.length) {
      const clean = document.createElement('div'); clean.className = 'editor-git-empty';
      clean.innerHTML = '<div class="editor-git-empty-icon">✓</div>No changes — working tree clean';
      gitEl.append(clean);
    }

    if (logData && logData.ok && logData.stdout.trim()) {
      gitEl.append(gitHistorySection(logData));
    }
  }

  // ── File tabs ─────────────────────────────────────────────────────────────
  async function renderMarkdownContent(st) {
    markdownPreviewHost.innerHTML = '<div class="editor-markdown-loading">Rendering preview…</div>';
    try {
      const marked = await ensureMarked();
      const content = st.model.getValue();
      const parseFn = marked.parse || marked;
      const html = parseFn(content);
      markdownPreviewHost.innerHTML = html;
      markdownPreviewHost.querySelectorAll('a').forEach(a => {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      });
      markdownPreviewHost.querySelectorAll('pre').forEach(pre => {
        pre.style.position = 'relative';
        const copyBtn = document.createElement('button');
        copyBtn.className = 'editor-markdown-copy-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.title = 'Copy code';
        copyBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const codeEl = pre.querySelector('code');
          const text = codeEl ? codeEl.textContent : pre.textContent;
          try {
            await navigator.clipboard.writeText(text);
            copyBtn.textContent = 'Copied!';
            copyBtn.classList.add('copied');
            setTimeout(() => {
              copyBtn.textContent = 'Copy';
              copyBtn.classList.remove('copied');
            }, 2000);
          } catch (err) {
            toast('Failed to copy');
          }
        });
        pre.appendChild(copyBtn);
      });
    } catch (err) {
      markdownPreviewHost.innerHTML = `<div class="editor-markdown-error">Failed to render Markdown: ${err.message}</div>`;
    }
  }

  function renderHtmlContent(st) {
    markdownPreviewHost.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.className = 'editor-html-iframe';
    iframe.srcdoc = st.model.getValue();
    markdownPreviewHost.appendChild(iframe);
  }

  function togglePreviewMode(previewMode) {
    if (!activePath) return;
    const st = open.get(activePath);
    if (!st) return;
    st.previewActive = previewMode;

    if (previewMode && editor) {
      st.viewState = editor.saveViewState();
    }

    setActive(activePath);
  }

  function setActive(p) {
    closeDiff(); // viewing/opening a normal file leaves the git diff overlay
    if (activePath && open.has(activePath)) {
      const oldSt = open.get(activePath);
      if (editor && oldSt && !oldSt.previewActive) {
        oldSt.viewState = editor.saveViewState();
      }
    }
    activePath = p;
    open.forEach((st, path) => st.tabEl.classList.toggle('active', path === p));
    treeRows.forEach((row, path) => row.classList.toggle('selected', path === p));
    
    const st = open.get(p);
    
    // Determine if markdown or HTML is active
    const isPreviewable = isPreviewableFile(p);
    if (isPreviewable && st) {
      markdownToggleWrap.hidden = false;
      btnEdit.classList.toggle('active', !st.previewActive);
      btnPreview.classList.toggle('active', st.previewActive);
    } else {
      markdownToggleWrap.hidden = true;
    }

    placeholder.style.display = st ? 'none' : '';
    if (!st) {
      editor?.setModel(null);
      markdownPreviewHost.hidden = true;
      return;
    }

    if (isPreviewable && st.previewActive) {
      monacoHost.hidden = true;
      markdownPreviewHost.hidden = false;
      if (isMarkdownFile(p)) {
        markdownPreviewHost.classList.remove('is-html');
        renderMarkdownContent(st);
      } else if (isHtmlFile(p)) {
        markdownPreviewHost.classList.add('is-html');
        renderHtmlContent(st);
      }
    } else {
      monacoHost.hidden = false;
      markdownPreviewHost.hidden = true;
      markdownPreviewHost.classList.remove('is-html');
      editor?.setModel(st.model);
      if (st.viewState) editor?.restoreViewState(st.viewState);
      if (editor) editor.focus();
    }
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

    open.set(filePath, { model, viewState: null, dirty: false, tabEl, dotEl, previewActive: false });
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
      
      const icon = document.createElement('span');
      icon.className = 'editor-tree-icon';
      icon.innerHTML = getFileIconSvg(entry.name, entry.type);
      
      const name = document.createElement('span');
      name.className = 'editor-tree-name';
      name.textContent = entry.name;
      row.append(icon, name);
      containerEl.appendChild(row);

      if (entry.type === 'dir') {
        const childWrap = document.createElement('div');
        childWrap.hidden = true;
        let loaded = false;
        containerEl.appendChild(childWrap);
        row.addEventListener('click', async () => {
          const show = childWrap.hidden;
          childWrap.hidden = !show;
          icon.innerHTML = getFileIconSvg(entry.name, entry.type, show);
          if (show && !loaded) { loaded = true; await renderDir(full, childWrap, depth + 1); }
        });
      } else {
        treeRows.set(full, row);
        if (full === activePath) row.classList.add('selected');
        row.addEventListener('click', () => openFile(full));
      }
    }
  }

  const refreshFiles = () => {
    treeEl.innerHTML = '';
    treeRows.clear();
    if (dir) renderDir(dir, treeEl, 0);
  };

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
  const ro = new ResizeObserver(relayout);
  ro.observe(viewEl);

  tab.updateTheme = () => {
    if (editor) editor.updateOptions({ theme: monacoTheme() });
    if (diffEditor) diffEditor.updateOptions({ theme: monacoTheme() });
  };

  tab.disposeEditor = () => {
    ro.disconnect();
    editor?.dispose();
    diffEditor?.dispose();
    if (diffModels) { diffModels.original.dispose(); diffModels.modified.dispose(); }
    open.forEach(st => st.model.dispose());
  };
}

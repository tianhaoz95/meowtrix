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

function showPrompt(title, placeholder, defaultValue = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'folder-prompt-overlay';
    const box = document.createElement('div');
    box.className = 'folder-prompt';
    
    const titleEl = document.createElement('div');
    titleEl.className = 'folder-prompt-title';
    titleEl.textContent = title;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'folder-prompt-input';
    input.placeholder = placeholder;
    input.value = defaultValue;
    input.spellcheck = false;
    input.autocomplete = 'off';

    const row = document.createElement('div');
    row.className = 'folder-prompt-actions';
    
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    
    const ok = document.createElement('button');
    ok.textContent = 'OK';
    ok.className = 'primary';
    
    row.append(cancel, ok);
    box.append(titleEl, input, row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    input.focus();
    if (defaultValue) {
      input.setSelectionRange(0, defaultValue.length);
    }

    const close = (val) => {
      overlay.remove();
      resolve(val);
    };

    cancel.onclick = () => close(null);
    ok.onclick = () => {
      const val = input.value.trim();
      close(val || null);
    };

    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = input.value.trim();
        close(val || null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      }
    };
    
    overlay.onclick = (e) => {
      if (e.target === overlay) close(null);
    };
  });
}

function showConfirm(title, message, okText = 'OK', cancelText = 'Cancel') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'folder-prompt-overlay';
    const box = document.createElement('div');
    box.className = 'folder-prompt';
    
    const titleEl = document.createElement('div');
    titleEl.className = 'folder-prompt-title';
    titleEl.textContent = title;

    const messageEl = document.createElement('div');
    messageEl.style.fontSize = '13px';
    messageEl.style.color = 'var(--text2)';
    messageEl.style.marginBottom = '16px';
    messageEl.style.lineHeight = '1.4';
    messageEl.textContent = message;

    const row = document.createElement('div');
    row.className = 'folder-prompt-actions';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = cancelText;
    
    const okBtn = document.createElement('button');
    okBtn.textContent = okText;
    okBtn.className = 'primary';
    
    row.append(cancelBtn, okBtn);
    box.append(titleEl, messageEl, row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    okBtn.focus();

    const cleanupAndResolve = (val) => {
      window.removeEventListener('keydown', handleKeyDown);
      overlay.remove();
      resolve(val);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        cleanupAndResolve(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cleanupAndResolve(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    cancelBtn.onclick = () => cleanupAndResolve(false);
    okBtn.onclick = () => cleanupAndResolve(true);
    
    overlay.onclick = (e) => {
      if (e.target === overlay) cleanupAndResolve(false);
    };
  });
}

function initEditorTab(tab, viewEl, dir) {
  viewEl.classList.add('editor-view');
  tab.editorDir = dir || '';
  if (dir && tab.label && !tab.isCustomLabel) tab.label.textContent = basename(dir);

  if (!tab.editorExpandedDirs) {
    tab.editorExpandedDirs = new Set();
  }

  if (dir) {
    wsSend({ type: 'fs:watch', path: dir });
  }

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

  const newFileBtn = document.createElement('button');
  newFileBtn.className = 'editor-sidebar-refresh';
  newFileBtn.innerHTML = '📄+';
  newFileBtn.title = 'New file in root';
  newFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    createInDir(dir, 'file');
  });

  const newFolderBtn = document.createElement('button');
  newFolderBtn.className = 'editor-sidebar-refresh';
  newFolderBtn.innerHTML = '📁+';
  newFolderBtn.title = 'New folder in root';
  newFolderBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    createInDir(dir, 'dir');
  });
  
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'editor-sidebar-refresh';
  refreshBtn.textContent = '↻';
  refreshBtn.title = 'Refresh file tree';
  refreshBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    refreshFiles();
  });

  sideHeader.append(sideHeaderIcon, sideHeaderName, newFileBtn, newFolderBtn, refreshBtn);
  sideHeader.title = dir || '';

  // View switcher: Explorer (file tree), Git (Source Control), and Search.
  const sideTabs = document.createElement('div');
  sideTabs.className = 'editor-sidetabs';
  const filesBtn = document.createElement('button');
  filesBtn.className = 'editor-sidetab active';
  filesBtn.textContent = '🗂 Files';
  const gitBtn = document.createElement('button');
  gitBtn.className = 'editor-sidetab';
  gitBtn.textContent = '⎇ Git';
  gitBtn.hidden = true;
  const searchBtn = document.createElement('button');
  searchBtn.className = 'editor-sidetab';
  searchBtn.textContent = '🔍 Search';
  sideTabs.append(filesBtn, gitBtn, searchBtn);

  const treeEl = document.createElement('div');
  treeEl.className = 'editor-tree';
  const gitEl = document.createElement('div');
  gitEl.className = 'editor-git';
  gitEl.hidden = true;
  const searchEl = document.createElement('div');
  searchEl.className = 'editor-search';
  searchEl.hidden = true;
  searchEl.innerHTML = `
    <div class="editor-search-box">
      <input type="text" class="editor-search-input" placeholder="Search in files...">
      <button class="editor-search-submit">Search</button>
    </div>
    <div class="editor-search-results"></div>
  `;
  sidebar.append(sideHeader, sideTabs, treeEl, gitEl, searchEl);

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

  // ── Sidebar view switch (Explorer / Source Control / Search) ──────────────────
  function showView(which) {
    const git = which === 'git';
    const search = which === 'search';
    const files = which === 'files';
    filesBtn.classList.toggle('active', files);
    gitBtn.classList.toggle('active', git);
    searchBtn.classList.toggle('active', search);
    treeEl.hidden = !files;
    gitEl.hidden = !git;
    searchEl.hidden = !search;
    if (git) refreshGit();
    if (search) searchEl.querySelector('.editor-search-input')?.focus();
  }
  filesBtn.addEventListener('click', () => showView('files'));
  gitBtn.addEventListener('click', () => showView('git'));
  searchBtn.addEventListener('click', () => showView('search'));

  // ── CRUD Helpers ─────────────────────────────────────────────────────────────
  async function createInDir(parentPath, type) {
    const label = type === 'dir' ? 'folder' : 'file';
    const name = await showPrompt(`New ${type === 'dir' ? 'Folder' : 'File'}`, `Enter new ${label} name...`);
    if (!name || !name.trim()) return;
    try {
      const res = await fetch('/api/fs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: parentPath, name: name.trim(), type })
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || `Failed to create ${label}`);
      } else {
        toast(`Created ${label} ${name}`);
        refreshFiles();
        if (type === 'file') {
          openFile(data.path);
        }
      }
    } catch (err) {
      toast(`Failed to create ${label}`);
    }
  }

  async function renameItem(itemPath) {
    const oldName = basename(itemPath);
    const newName = await showPrompt(`Rename ${oldName}`, `Enter new name...`, oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    
    // Construct new path
    const lastSlash = itemPath.lastIndexOf('/');
    const parentDir = lastSlash >= 0 ? itemPath.slice(0, lastSlash) : '';
    const newPath = parentDir ? join(parentDir, newName.trim()) : newName.trim();
    
    try {
      const res = await fetch('/api/fs/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: itemPath, newPath })
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Failed to rename');
      } else {
        toast(`Renamed to ${newName}`);
        if (open.has(itemPath)) {
          const st = open.get(itemPath);
          open.delete(itemPath);
          
          st.tabEl.title = newPath;
          const labelEl = st.tabEl.querySelector('span:not(.editor-filetab-dot):not(.editor-filetab-close)');
          if (labelEl) labelEl.textContent = newName.trim();
          
          st.tabEl.onclick = () => setActive(newPath);
          const closeEl = st.tabEl.querySelector('.editor-filetab-close');
          if (closeEl) {
            closeEl.onclick = (e) => { e.stopPropagation(); closeFile(newPath); };
          }
          
          open.set(newPath, st);
          
          if (activePath === itemPath) {
            activePath = newPath;
          }
        }
        refreshFiles();
      }
    } catch (err) {
      toast('Failed to rename');
    }
  }

  async function deleteItem(itemPath) {
    const name = basename(itemPath);
    if (!await showConfirm('Delete', `Are you sure you want to delete ${name}?`)) return;
    try {
      const res = await fetch('/api/fs/delete?path=' + encodeURIComponent(itemPath), {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Failed to delete');
      } else {
        toast(`Deleted ${name}`);
        if (open.has(itemPath)) {
          closeFile(itemPath);
        }
        refreshFiles();
      }
    } catch (err) {
      toast('Failed to delete');
    }
  }

  function downloadFile(itemPath) {
    const a = document.createElement('a');
    a.href = '/api/download?path=' + encodeURIComponent(itemPath);
    a.download = basename(itemPath);
    a.click();
  }

  // ── Search Helpers (grep) ───────────────────────────────────────────────────
  const searchInput = searchEl.querySelector('.editor-search-input');
  const searchSubmit = searchEl.querySelector('.editor-search-submit');
  const searchResults = searchEl.querySelector('.editor-search-results');

  async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) {
      searchResults.innerHTML = '<div class="editor-git-empty">Enter a search query</div>';
      return;
    }
    searchResults.innerHTML = '<div class="editor-git-empty">Searching...</div>';
    try {
      const res = await fetch(`/api/fs/search?root=${encodeURIComponent(dir)}&query=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) {
        searchResults.innerHTML = `<div class="editor-git-empty">Search failed: ${data.error || 'unknown error'}</div>`;
        return;
      }
      renderSearchResults(data.matches);
    } catch (err) {
      searchResults.innerHTML = '<div class="editor-git-empty">Search failed</div>';
    }
  }

  function renderSearchResults(matches) {
    searchResults.innerHTML = '';
    if (!matches || matches.length === 0) {
      searchResults.innerHTML = '<div class="editor-git-empty">No results found</div>';
      return;
    }

    const grouped = {};
    matches.forEach(m => {
      if (!grouped[m.relPath]) grouped[m.relPath] = [];
      grouped[m.relPath].push(m);
    });

    Object.entries(grouped).forEach(([relPath, fileMatches]) => {
      const fileGroup = document.createElement('div');
      fileGroup.className = 'editor-search-file-group';

      const fileHeader = document.createElement('div');
      fileHeader.className = 'editor-search-file-header';
      fileHeader.textContent = relPath;
      fileGroup.appendChild(fileHeader);

      fileMatches.forEach(m => {
        const item = document.createElement('div');
        item.className = 'editor-search-item';
        
        const lineNo = document.createElement('span');
        lineNo.className = 'editor-search-lineno';
        lineNo.textContent = m.line + ':';
        
        const snippet = document.createElement('span');
        snippet.className = 'editor-search-snippet';
        snippet.textContent = m.content;

        item.append(lineNo, snippet);
        item.addEventListener('click', () => {
          openFile(m.path, m.line);
        });
        fileGroup.appendChild(item);
      });

      searchResults.appendChild(fileGroup);
    });
  }

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
  });
  searchSubmit.addEventListener('click', performSearch);

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
        renderSideBySide: diffSideBySide, fontSize: Math.round(13 * (tab.zoomLevel || 1.0)), scrollBeyondLastLine: false,
        minimap: { enabled: (typeof getSettings === 'function' ? getSettings().editorMinimap : true) !== false },
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
        renderSideBySide: diffSideBySide, fontSize: Math.round(13 * (tab.zoomLevel || 1.0)), scrollBeyondLastLine: false,
        minimap: { enabled: (typeof getSettings === 'function' ? getSettings().editorMinimap : true) !== false },
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
        if (!await showConfirm('Discard Changes', `Discard changes to ${f.path}?`)) return;
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
    const bnameTrigger = document.createElement('button');
    bnameTrigger.className = 'editor-git-branchname';
    bnameTrigger.textContent = s.branch ? `✓ ${s.branch}` : '(detached)';
    bnameTrigger.title = 'Switch Branch';

    const dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'editor-git-branch-menu';
    dropdownMenu.hidden = true;

    bnameTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const show = dropdownMenu.hidden;
      document.querySelectorAll('.editor-git-branch-menu').forEach(m => m.hidden = true);
      dropdownMenu.hidden = !show;
      if (show) {
        dropdownMenu.innerHTML = '<div class="editor-git-branch-menu-item">Loading...</div>';
        fetch('/api/git/branches?root=' + encodeURIComponent(dir))
          .then(res => res.json())
          .then(data => {
            if (!data.ok) {
              dropdownMenu.innerHTML = '<div class="editor-git-branch-menu-item">Failed to load</div>';
              return;
            }
            const lines = data.stdout.split('\n').map(l => l.trim()).filter(Boolean);
            const branches = lines.map(l => l.replace(/^\*\s+/, ''));
            
            dropdownMenu.innerHTML = '';
            branches.forEach(b => {
              const item = document.createElement('div');
              item.className = 'editor-git-branch-menu-item';
              if (b === s.branch) item.classList.add('active');
              item.textContent = b === s.branch ? `✓ ${b}` : b;
              item.addEventListener('click', async (itemEvent) => {
                itemEvent.stopPropagation();
                dropdownMenu.hidden = true;
                if (b !== s.branch) {
                  toast(`Checking out ${b}...`);
                  try {
                    const cRes = await fetch('/api/git/checkout', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ root: dir, branch: b })
                    });
                    const cData = await cRes.json();
                    if (cData.ok) {
                      toast(`Switched to ${b}`);
                      refreshGit();
                    } else {
                      toast(cData.error || cData.output || 'Failed to checkout branch');
                    }
                  } catch (err) {
                    toast('Failed to checkout branch');
                  }
                }
              });
              dropdownMenu.appendChild(item);
            });

            const divider = document.createElement('div');
            divider.className = 'editor-git-branch-menu-divider';
            dropdownMenu.appendChild(divider);

            const createItem = document.createElement('div');
            createItem.className = 'editor-git-branch-menu-item';
            createItem.textContent = '+ Create branch...';
            createItem.addEventListener('click', async (createEvent) => {
              createEvent.stopPropagation();
              dropdownMenu.hidden = true;
              const newBranch = await showPrompt('Create Branch', 'Enter new branch name...');
              if (!newBranch || !newBranch.trim()) return;
              toast(`Creating branch ${newBranch.trim()}...`);
              try {
                const cRes = await fetch('/api/git/create-branch', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ root: dir, branch: newBranch.trim() })
                });
                const cData = await cRes.json();
                if (cData.ok) {
                  toast(`Switched to new branch ${newBranch.trim()}`);
                  refreshGit();
                } else {
                  toast(cData.error || cData.output || 'Failed to create branch');
                }
              } catch (err) {
                toast('Failed to create branch');
              }
            });
            dropdownMenu.appendChild(createItem);
          })
          .catch(() => {
            dropdownMenu.innerHTML = '<div class="editor-git-branch-menu-item">Failed to load</div>';
          });
      }
    });

    const closeMenu = (e) => {
      if (!bnameTrigger.contains(e.target) && !dropdownMenu.contains(e.target)) {
        dropdownMenu.hidden = true;
      }
    };
    document.addEventListener('click', closeMenu);
    
    const oldDispose = tab.disposeEditor;
    tab.disposeEditor = () => {
      document.removeEventListener('click', closeMenu);
      if (typeof oldDispose === 'function') oldDispose();
    };

    branchBar.append(bicon, bnameTrigger, dropdownMenu);
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

  function setActive(p, line = null) {
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
      if (line !== null && editor) {
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
      }
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

  async function openFile(filePath, line = null) {
    if (open.has(filePath)) { setActive(filePath, line); return; }
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
        fontSize: Math.round(13 * (tab.zoomLevel || 1.0)),
        minimap: { enabled: (typeof getSettings === 'function' ? getSettings().editorMinimap : true) !== false },
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
    setActive(filePath, line);
  }

  // ── File tree (lazy-expanding) ──────────────────────────────────────────────
  function join(base, name) { return base.replace(/\/+$/, '') + '/' + name; }

  function closeContextMenu() {
    const menu = document.getElementById('editor-context-menu');
    if (menu) {
      menu.style.display = 'none';
    }
    document.querySelectorAll('.editor-tree-row.context-menu-active').forEach(el => {
      el.classList.remove('context-menu-active');
    });
  }

  function showContextMenu(e, rowEl, itemPath, itemType) {
    closeContextMenu();
    rowEl.classList.add('context-menu-active');

    let menu = document.getElementById('editor-context-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'editor-context-menu';
      menu.className = 'editor-context-menu';
      document.body.appendChild(menu);
    }

    menu.innerHTML = '';
    menu.style.display = 'block';

    let relPath = itemPath;
    if (dir && itemPath.startsWith(dir)) {
      relPath = itemPath.substring(dir.length);
      if (relPath.startsWith('/')) {
        relPath = relPath.substring(1);
      }
      if (relPath === '') {
        relPath = '.';
      }
    }

    const items = [];

    if (itemType === 'dir') {
      items.push({
        label: 'New File...',
        icon: '📄+',
        onClick: () => createInDir(itemPath, 'file')
      });
      items.push({
        label: 'New Folder...',
        icon: '📁+',
        onClick: () => createInDir(itemPath, 'dir')
      });
      items.push({ type: 'divider' });
      items.push({
        label: 'Rename...',
        icon: '✏️',
        onClick: () => renameItem(itemPath)
      });
      items.push({
        label: 'Delete',
        icon: '🗑️',
        onClick: () => deleteItem(itemPath)
      });
      items.push({ type: 'divider' });
      items.push({
        label: 'Open in Terminal',
        icon: '⬛',
        onClick: () => {
          if (typeof activePane !== 'undefined' && activePane) {
            addTab(activePane, 'terminal', undefined, undefined, undefined, itemPath);
            if (typeof saveSessionState === 'function') saveSessionState();
          }
        }
      });
      items.push({
        label: 'Open in Editor',
        icon: '📝',
        onClick: () => {
          if (typeof activePane !== 'undefined' && activePane) {
            addTab(activePane, 'editor', undefined, undefined, undefined, itemPath);
            if (typeof saveSessionState === 'function') saveSessionState();
          }
        }
      });
      items.push({ type: 'divider' });
      items.push({
        label: 'Copy Relative Path',
        icon: '🔗',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(relPath);
            toast('Copied relative path to clipboard');
          } catch (err) {
            toast('Failed to copy path');
          }
        }
      });
      items.push({
        label: 'Copy Absolute Path',
        icon: '📋',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(itemPath);
            toast('Copied absolute path to clipboard');
          } catch (err) {
            toast('Failed to copy path');
          }
        }
      });
    } else {
      items.push({
        label: 'Open File',
        icon: '📖',
        onClick: () => openFile(itemPath)
      });
      items.push({
        label: 'Download File',
        icon: '📥',
        onClick: () => downloadFile(itemPath)
      });
      items.push({ type: 'divider' });
      const lastSlash = itemPath.lastIndexOf('/');
      const parentPath = lastSlash >= 0 ? itemPath.slice(0, lastSlash) : itemPath;
      items.push({
        label: 'New File...',
        icon: '📄+',
        onClick: () => createInDir(parentPath, 'file')
      });
      items.push({
        label: 'New Folder...',
        icon: '📁+',
        onClick: () => createInDir(parentPath, 'dir')
      });
      items.push({ type: 'divider' });
      items.push({
        label: 'Rename...',
        icon: '✏️',
        onClick: () => renameItem(itemPath)
      });
      items.push({
        label: 'Delete',
        icon: '🗑️',
        onClick: () => deleteItem(itemPath)
      });
      items.push({ type: 'divider' });
      items.push({
        label: 'Copy Relative Path',
        icon: '🔗',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(relPath);
            toast('Copied relative path to clipboard');
          } catch (err) {
            toast('Failed to copy path');
          }
        }
      });
      items.push({
        label: 'Copy Absolute Path',
        icon: '📋',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(itemPath);
            toast('Copied absolute path to clipboard');
          } catch (err) {
            toast('Failed to copy path');
          }
        }
      });
    }

    items.forEach(item => {
      if (item.type === 'divider') {
        const div = document.createElement('div');
        div.className = 'editor-context-menu-divider';
        menu.appendChild(div);
      } else {
        const btn = document.createElement('div');
        btn.className = 'editor-context-menu-item';
        
        const iconSpan = document.createElement('span');
        iconSpan.className = 'editor-context-menu-item-icon';
        iconSpan.textContent = item.icon || '';
        
        const labelSpan = document.createElement('span');
        labelSpan.className = 'editor-context-menu-item-label';
        labelSpan.textContent = item.label;
        
        btn.append(iconSpan, labelSpan);
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeContextMenu();
          item.onClick();
        });
        menu.appendChild(btn);
      }
    });

    const menuWidth = 180;
    const menuHeight = items.length * 28;
    let left = e.clientX;
    let top = e.clientY;
    if (left + menuWidth > window.innerWidth) {
      left = window.innerWidth - menuWidth - 10;
    }
    if (top + menuHeight > window.innerHeight) {
      top = window.innerHeight - menuHeight - 10;
    }
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  const onDocumentClick = () => closeContextMenu();
  const onDocumentContextMenu = () => closeContextMenu();
  const onDocumentScroll = () => closeContextMenu();

  document.addEventListener('click', onDocumentClick);
  document.addEventListener('contextmenu', onDocumentContextMenu);
  document.addEventListener('scroll', onDocumentScroll, { capture: true, passive: true });

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
      
      // Inline actions on hover
      const actions = document.createElement('div');
      actions.className = 'editor-tree-row-actions';

      if (entry.type === 'dir') {
        const addFile = document.createElement('button');
        addFile.className = 'editor-tree-row-action';
        addFile.innerHTML = '📄+';
        addFile.title = 'New File';
        addFile.addEventListener('click', (e) => {
          e.stopPropagation();
          createInDir(full, 'file');
        });

        const addFolder = document.createElement('button');
        addFolder.className = 'editor-tree-row-action';
        addFolder.innerHTML = '📁+';
        addFolder.title = 'New Folder';
        addFolder.addEventListener('click', (e) => {
          e.stopPropagation();
          createInDir(full, 'dir');
        });

        actions.append(addFile, addFolder);
      } else {
        const download = document.createElement('button');
        download.className = 'editor-tree-row-action';
        download.innerHTML = '📥';
        download.title = 'Download File';
        download.addEventListener('click', (e) => {
          e.stopPropagation();
          downloadFile(full);
        });
        actions.append(download);
      }

      const renameBtn = document.createElement('button');
      renameBtn.className = 'editor-tree-row-action';
      renameBtn.innerHTML = '✏️';
      renameBtn.title = 'Rename';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renameItem(full);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'editor-tree-row-action';
      deleteBtn.innerHTML = '🗑️';
      deleteBtn.title = 'Delete';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteItem(full);
      });

      actions.append(renameBtn, deleteBtn);
      row.append(icon, name, actions);
      containerEl.appendChild(row);

      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e, row, full, entry.type);
      });

      if (entry.type === 'dir') {
        const childWrap = document.createElement('div');
        childWrap.hidden = !tab.editorExpandedDirs.has(full);
        let loaded = false;
        containerEl.appendChild(childWrap);

        if (tab.editorExpandedDirs.has(full)) {
          loaded = true;
          icon.innerHTML = getFileIconSvg(entry.name, entry.type, true);
          renderDir(full, childWrap, depth + 1);
        }

        row.addEventListener('click', async () => {
          const show = childWrap.hidden;
          childWrap.hidden = !show;
          icon.innerHTML = getFileIconSvg(entry.name, entry.type, show);
          if (show) {
            tab.editorExpandedDirs.add(full);
            if (typeof saveSessionState === 'function') saveSessionState();
            if (!loaded) { loaded = true; await renderDir(full, childWrap, depth + 1); }
          } else {
            tab.editorExpandedDirs.delete(full);
            if (typeof saveSessionState === 'function') saveSessionState();
          }
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

  tab.updateMinimap = () => {
    const isMinimapEnabled = (typeof getSettings === 'function' ? getSettings().editorMinimap : true) !== false;
    if (editor) editor.updateOptions({ minimap: { enabled: isMinimapEnabled } });
    if (diffEditor) diffEditor.updateOptions({ minimap: { enabled: isMinimapEnabled } });
  };

  let changeTimeout = null;
  const changedFiles = new Set();

  async function reloadActiveFile() {
    if (!activePath) return;
    const st = open.get(activePath);
    if (!st || st.dirty) return;
    try {
      const res = await fetch('/api/fs/read?path=' + encodeURIComponent(activePath));
      const data = await res.json();
      if (res.ok && data && typeof data.content === 'string') {
        const currentVal = st.model.getValue();
        if (currentVal !== data.content) {
          const state = editor ? editor.saveViewState() : null;
          st.model.setValue(data.content);
          if (state && editor) editor.restoreViewState(state);
          markDirty(activePath, false);
          if (st.previewActive) {
            if (isMarkdownFile(activePath)) renderMarkdownContent(st);
            else if (isHtmlFile(activePath)) renderHtmlContent(st);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to auto-reload changed file:', e);
    }
  }

  tab.handleFsChange = (eventType, filename) => {
    if (changeTimeout) clearTimeout(changeTimeout);
    if (filename) changedFiles.add(filename);
    changeTimeout = setTimeout(() => {
      refreshFiles();
      if (!gitEl.hidden && !gitBtn.hidden) {
        refreshGit();
      }
      if (activePath && !open.get(activePath)?.dirty) {
        const activeRel = activePath.startsWith(dir) 
          ? activePath.slice(dir.length).replace(/^\/+/, '')
          : null;
        let activeChanged = false;
        for (const f of changedFiles) {
          const normalizedF = f.replace(/\\/g, '/');
          if (activeRel && (normalizedF === activeRel || activeRel.endsWith('/' + normalizedF))) {
            activeChanged = true;
            break;
          }
        }
        if (activeChanged) {
          reloadActiveFile();
        }
      }
      changedFiles.clear();
    }, 300);
  };

  tab.zoom = (zoomLevel) => {
    tab.zoomLevel = zoomLevel;
    const fs = Math.round(13 * zoomLevel);
    if (editor) {
      editor.updateOptions({ fontSize: fs });
    }
    if (diffEditor) {
      diffEditor.updateOptions({ fontSize: fs });
    }
    if (markdownPreviewHost) {
      markdownPreviewHost.style.zoom = zoomLevel;
    }
  };
  if (tab.zoomLevel) {
    tab.zoom(tab.zoomLevel);
  }

  tab.disposeEditor = () => {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('contextmenu', onDocumentContextMenu);
    document.removeEventListener('scroll', onDocumentScroll, { capture: true });
    closeContextMenu();
    ro.disconnect();
    editor?.dispose();
    diffEditor?.dispose();
    if (diffModels) { diffModels.original.dispose(); diffModels.modified.dispose(); }
    open.forEach(st => st.model.dispose());
    if (dir) {
      wsSend({ type: 'fs:unwatch', path: dir });
    }
  };
}

function rewatchAllEditors() {
  if (typeof getAllPanes !== 'function') return;
  for (const pane of getAllPanes()) {
    for (const tab of pane.tabs) {
      if (tab.type === 'editor' && tab.editorDir) {
        wsSend({ type: 'fs:watch', path: tab.editorDir });
      }
    }
  }
}
window.rewatchAllEditors = rewatchAllEditors;

function onFsChange(watchPath, eventType, filename) {
  if (typeof getAllPanes !== 'function') return;
  for (const pane of getAllPanes()) {
    for (const tab of pane.tabs) {
      if (tab.type === 'editor' && tab.editorDir === watchPath) {
        if (typeof tab.handleFsChange === 'function') {
          tab.handleFsChange(eventType, filename);
        }
      }
    }
  }
}
window.onFsChange = onFsChange;

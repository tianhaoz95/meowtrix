let activePane = null;
let tabCounter = 0;
const paneRegistry = new Map();

function uid() { return 'id-' + (++tabCounter) + '-' + Math.random().toString(36).slice(2, 7); }

function getTermTheme() {
  return document.documentElement.classList.contains('light')
    ? { background: '#ffffff', foreground: '#1a1a1a', cursor: '#7c3aed', selectionBackground: 'rgba(124,58,237,0.2)', cursorAccent: '#fff' }
    : { background: '#000000', foreground: '#e0e0e0', cursor: '#8b5cf6', selectionBackground: 'rgba(139,92,246,0.3)', cursorAccent: '#000' };
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
  return pane;
}

function setActivePane(pane) {
  if (activePane) activePane.el.classList.remove('active');
  activePane = pane;
  pane.el.classList.add('active');
}

function addTab(pane, type) {
  const id = uid();

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
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeTab(pane, id); });
  tabEl.append(icon, label, closeBtn);
  tabEl.addEventListener('click', () => activateTab(pane, id));
  tabEl.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(pane, id); } });
  pane.tabBar.insertBefore(tabEl, pane.tabBar.lastChild);

  const tab = { id, type, tabEl, viewEl, label, term: null, fitAddon: null, ptyId: null };
  pane.tabs.push(tab);

  if (type === 'terminal') initTerminalTab(tab);
  else initBrowserTab(tab, viewEl, label);

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
  if (tab.ptyId) destroyPty(tab.ptyId);
  if (tab.term) tab.term.dispose();
  tab.viewEl.remove();
  tab.tabEl.remove();
  pane.tabs.splice(idx, 1);
  if (pane.tabs.length) activateTab(pane, pane.tabs[Math.max(0, idx - 1)].id);
}

function initTerminalTab(tab) {
  tab.viewEl.classList.add('terminal-view');
  const term = new Terminal({
    theme: getTermTheme(),
    fontSize: 13,
    fontFamily: '"Cascadia Code", "JetBrains Mono", Menlo, Monaco, monospace',
    cursorBlink: true,
    scrollback: 10000,
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(tab.viewEl);
  tab.term = term;
  tab.fitAddon = fitAddon;

  const ptyId = uid();
  tab.ptyId = ptyId;

  const initPty = () => { fitAddon.fit(); createPty(ptyId, term, term.cols, term.rows); };
  if (ws.readyState === WebSocket.OPEN) initPty();
  else ws.addEventListener('open', initPty, { once: true });

  term.onData(data => wsSend({ type: 'pty:input', id: ptyId, data }));
  term.onResize(({ cols, rows }) => wsSend({ type: 'pty:resize', id: ptyId, cols, rows }));
  term.onTitleChange(title => { if (title) tab.label.textContent = title; });

  const ro = new ResizeObserver(() => { if (tab.viewEl.classList.contains('active')) fitAddon.fit(); });
  ro.observe(tab.viewEl);
}

function initBrowserTab(tab, viewEl, label) {
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
  urlInput.placeholder = 'Search or enter URL…';
  urlInput.spellcheck = false;

  bar.append(backBtn, fwdBtn, reloadBtn, extBtn, urlInput);

  const loadingBar = document.createElement('div');
  loadingBar.className = 'browser-loading';

  const frame = document.createElement('iframe');
  frame.className = 'browser-frame';
  frame.sandbox = 'allow-scripts allow-forms allow-popups allow-modals allow-same-origin';

  viewEl.append(bar, loadingBar, frame);

  let currentUrl = 'https://google.com';

  const navigate = (url) => {
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = /^[\w-]+(\.\w+)+(\/|$)/.test(url)
        ? 'https://' + url
        : 'https://www.google.com/search?q=' + encodeURIComponent(url);
    }
    currentUrl = url;
    frame.src = '/proxy?url=' + encodeURIComponent(url);
    urlInput.value = url;
    try { label.textContent = new URL(url).hostname.replace('www.', ''); }
    catch { label.textContent = 'Browser'; }
    loadingBar.classList.add('active');
  };

  frame.addEventListener('load', () => loadingBar.classList.remove('active'));
  navigate(currentUrl);

  urlInput.addEventListener('focus', () => urlInput.select());
  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { navigate(urlInput.value); urlInput.blur(); }
    if (e.key === 'Escape') { urlInput.value = currentUrl; urlInput.blur(); }
  });
  backBtn.addEventListener('click', () => { try { frame.contentWindow.history.back(); } catch {} });
  fwdBtn.addEventListener('click', () => { try { frame.contentWindow.history.forward(); } catch {} });
  reloadBtn.addEventListener('click', () => navigate(currentUrl));
  extBtn.addEventListener('click', () => window.open(currentUrl, '_blank'));
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

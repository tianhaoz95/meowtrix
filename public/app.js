let activePicker = null;

function showTabTypePicker(e, pane) {
  if (activePicker) { activePicker.remove(); activePicker = null; }

  const picker = document.createElement('div');
  picker.className = 'tab-type-picker';

  [['⬛  Terminal', 'terminal'], ['🌐  Browser', 'browser']].forEach(([text, type]) => {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.addEventListener('click', () => { addTab(pane, type); picker.remove(); activePicker = null; });
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

document.addEventListener('DOMContentLoaded', () => {
  const workspace = document.getElementById('workspace');

  // ── Theme ──
  const themeBtn = document.getElementById('btn-theme');
  const savedTheme = localStorage.getItem('theme') || 'dark';

  const applyTheme = (theme) => {
    document.documentElement.classList.toggle('light', theme === 'light');
    themeBtn.textContent = theme === 'light' ? '🌙' : '☀';
    localStorage.setItem('theme', theme);
    // Re-theme all open terminals
    const newTheme = getTermTheme();
    getAllPanes().forEach(p => p.tabs.forEach(t => {
      if (t.term) t.term.options.theme = newTheme;
    }));
  };

  applyTheme(savedTheme);
  themeBtn.addEventListener('click', () => {
    applyTheme(document.documentElement.classList.contains('light') ? 'dark' : 'light');
  });

  // ── Initial pane ──
  const initialPane = createPane();
  workspace.appendChild(initialPane.el);
  setActivePane(initialPane);
  addTab(initialPane, 'terminal');

  // ── Toolbar ──
  document.getElementById('btn-split-v').addEventListener('click', () => {
    if (activePane) splitPane(activePane, 'vertical');
  });
  document.getElementById('btn-split-h').addEventListener('click', () => {
    if (activePane) splitPane(activePane, 'horizontal');
  });
  document.getElementById('btn-close-pane').addEventListener('click', () => {
    if (!activePane || getAllPanes().length <= 1) return;
    const paneEl = activePane.el;
    const parent = paneEl.parentElement;
    [...activePane.tabs].forEach(t => closeTab(activePane, t.id));
    paneRegistry.delete(paneEl);
    if (parent.classList.contains('split-container')) {
      const sibling = [...parent.children].find(c => c !== paneEl && !c.classList.contains('split-divider'));
      sibling.style.flex = '';
      parent.parentElement.replaceChild(sibling, parent);
      const remaining = getAllPanes();
      if (remaining.length) setActivePane(remaining[0]);
      else activePane = null;
    }
  });

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === '\\') { e.preventDefault(); if (activePane) splitPane(activePane, 'vertical'); }
    if (e.key === '-')  { e.preventDefault(); if (activePane) splitPane(activePane, 'horizontal'); }
    if (e.key === 't')  { e.preventDefault(); if (activePane) showTabTypePicker({ clientX: 60, clientY: 40 }, activePane); }
    if (e.key === 'w')  { e.preventDefault(); if (activePane?.activeTab) closeTab(activePane, activePane.activeTab.id); }
  });
});

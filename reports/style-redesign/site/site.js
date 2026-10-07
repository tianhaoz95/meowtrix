// Meowtrix Redesign Site Interactive Controller

let currentDesignId = 'linear-slate';
let currentMode = 'dark'; // 'light' or 'dark' (Only 2 themes!)
let currentLogoId = 'origami-cat';
let favorites = JSON.parse(localStorage.getItem('mtx_redesign_favorites') || '["linear-slate"]');
let candidateNotes = JSON.parse(localStorage.getItem('mtx_redesign_notes') || '{}');

document.addEventListener('DOMContentLoaded', () => {
  initCandidateSelector();
  initNav();
  initModeToggle();
  initMockupInteractivity();
  initGallery();
  initSplitView();
  initLogosAndIcons();
  initExport();

  // Load initial candidate
  loadDesign(currentDesignId, currentMode);
});

// ── 1. Candidate Loading ──────────────────────────────
function getDesign(id) {
  return CANDIDATE_DESIGNS.find(d => d.id === id) || CANDIDATE_DESIGNS[0];
}

function loadDesign(id, mode) {
  currentDesignId = id;
  currentMode = mode;
  const design = getDesign(id);
  const vars = design[mode];

  // Apply CSS variables to mockup container
  const mockupEl = document.getElementById('mockup-app');
  if (mockupEl) {
    for (const [key, value] of Object.entries(vars)) {
      mockupEl.style.setProperty(key, value);
    }
  }

  // Update Mockup Header Info
  document.getElementById('mockup-title').textContent = design.name;
  document.getElementById('mockup-tagline').textContent = design.tagline;
  document.getElementById('mockup-category').textContent = design.category;

  // Update candidate select dropdown
  const selectEl = document.getElementById('candidate-select');
  if (selectEl) selectEl.value = id;

  // Update in-mockup theme label & buttons
  const themeLabel = document.getElementById('mtx-theme-label');
  if (themeLabel) {
    themeLabel.textContent = mode === 'dark' ? '🌙 Dark' : '☀️ Light';
  }

  const sDarkBtn = document.getElementById('setting-dark-btn');
  const sLightBtn = document.getElementById('setting-light-btn');
  if (sDarkBtn && sLightBtn) {
    sDarkBtn.classList.toggle('active', mode === 'dark');
    sLightBtn.classList.toggle('active', mode === 'light');
  }

  // Update Favorite button
  updateStarButton();

  // Update Note Input
  const noteInput = document.getElementById('candidate-note-input');
  if (noteInput) {
    noteInput.value = candidateNotes[id] || '';
  }

  // Render Token Chips in bottom inspector
  renderTokenChips(vars);

  // Update Logo
  updateMockupLogo();

  // Update Export View Code
  updateExportCode();
}

function renderTokenChips(vars) {
  const container = document.getElementById('token-chips');
  if (!container) return;
  const keyTokens = ['--bg', '--surface-1', '--border', '--text-primary', '--accent'];
  container.innerHTML = keyTokens.map(key => {
    const val = vars[key];
    return `
      <div class="token-chip" title="${key}: ${val}">
        <span class="token-swatch" style="background: ${val};"></span>
        <span>${key.replace('--', '')}: ${val}</span>
      </div>
    `;
  }).join('');
}

// ── 2. Header & Nav ──────────────────────────────────
function initCandidateSelector() {
  const select = document.getElementById('candidate-select');
  if (!select) return;

  select.innerHTML = CANDIDATE_DESIGNS.map(d => `
    <option value="${d.id}">${d.name} (${d.category})</option>
  `).join('');

  select.addEventListener('change', (e) => {
    loadDesign(e.target.value, currentMode);
  });
}

function initNav() {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const viewId = `view-${btn.dataset.view}`;
      document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
      const activePanel = document.getElementById(viewId);
      if (activePanel) activePanel.classList.add('active');

      if (btn.dataset.view === 'split') updateSplitView();
      if (btn.dataset.view === 'export') updateExportCode();
    });
  });
}

function initModeToggle() {
  const lightBtn = document.getElementById('btn-mode-light');
  const darkBtn = document.getElementById('btn-mode-dark');

  const setGlobalMode = (mode) => {
    currentMode = mode;
    document.body.setAttribute('data-theme-mode', mode);
    lightBtn.classList.toggle('active', mode === 'light');
    darkBtn.classList.toggle('active', mode === 'dark');
    loadDesign(currentDesignId, mode);
  };

  lightBtn.addEventListener('click', () => setGlobalMode('light'));
  darkBtn.addEventListener('click', () => setGlobalMode('dark'));
}

// ── 3. Mockup Interactivity ──────────────────────────
function initMockupInteractivity() {
  // Logo Switcher
  const logoSelect = document.getElementById('select-mockup-logo');
  if (logoSelect) {
    logoSelect.addEventListener('change', (e) => {
      currentLogoId = e.target.value;
      updateMockupLogo();
    });
  }

  // Workspaces switcher
  const wsPills = document.querySelectorAll('.mtx-ws-pill');
  wsPills.forEach(pill => {
    pill.addEventListener('click', () => {
      wsPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
    });
  });

  // Toggle Sidebar
  const sidebarToggleBtn = document.getElementById('mockup-toggle-sidebar');
  const sidebarEl = document.getElementById('mtx-sidebar');
  if (sidebarToggleBtn && sidebarEl) {
    sidebarToggleBtn.addEventListener('click', () => {
      sidebarEl.classList.toggle('collapsed');
    });
  }

  // In-app theme toggle button (Light / Dark only!)
  const inAppToggle = document.getElementById('mtx-theme-toggle-btn');
  if (inAppToggle) {
    inAppToggle.addEventListener('click', () => {
      const nextMode = currentMode === 'dark' ? 'light' : 'dark';
      document.getElementById(nextMode === 'light' ? 'btn-mode-light' : 'btn-mode-dark').click();
    });
  }

  // Settings Drawer Toggle
  const settingsBtn = document.getElementById('mockup-btn-settings');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const drawer = document.getElementById('mtx-settings-panel');

  if (settingsBtn && drawer) {
    settingsBtn.addEventListener('click', () => drawer.classList.add('open'));
  }
  if (closeSettingsBtn && drawer) {
    closeSettingsBtn.addEventListener('click', () => drawer.classList.remove('open'));
  }

  // Settings drawer mode buttons
  const sDarkBtn = document.getElementById('setting-dark-btn');
  const sLightBtn = document.getElementById('setting-light-btn');
  if (sDarkBtn) sDarkBtn.addEventListener('click', () => document.getElementById('btn-mode-dark').click());
  if (sLightBtn) sLightBtn.addEventListener('click', () => document.getElementById('btn-mode-light').click());

  // Star / Favorite
  const starBtn = document.getElementById('btn-quick-star');
  if (starBtn) {
    starBtn.addEventListener('click', () => {
      toggleFavorite(currentDesignId);
      updateStarButton();
    });
  }

  // Copy CSS
  const copyBtn = document.getElementById('btn-quick-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => copyActiveDesignCSS());
  }

  // Save Note
  const saveNoteBtn = document.getElementById('save-note-btn');
  const noteInput = document.getElementById('candidate-note-input');
  if (saveNoteBtn && noteInput) {
    saveNoteBtn.addEventListener('click', () => {
      candidateNotes[currentDesignId] = noteInput.value;
      localStorage.setItem('mtx_redesign_notes', JSON.stringify(candidateNotes));
      saveNoteBtn.textContent = 'Saved! ✓';
      setTimeout(() => saveNoteBtn.textContent = 'Save Note', 1500);
    });
  }
}

function updateMockupLogo() {
  const logoObj = LOGO_CANDIDATES.find(l => l.id === currentLogoId) || LOGO_CANDIDATES[0];
  const container = document.getElementById('mtx-logo-svg');
  if (container) {
    container.innerHTML = logoObj.svg;
  }
}

function updateStarButton() {
  const starBtn = document.getElementById('btn-quick-star');
  if (!starBtn) return;
  const isFav = favorites.includes(currentDesignId);
  starBtn.classList.toggle('active-star', isFav);
  starBtn.textContent = isFav ? '★ Favorited' : '☆ Favorite';
}

function toggleFavorite(id) {
  if (favorites.includes(id)) {
    favorites = favorites.filter(f => f !== id);
  } else {
    favorites.push(id);
  }
  localStorage.setItem('mtx_redesign_favorites', JSON.stringify(favorites));
  renderFavoritesList();
}

// ── 4. Gallery View ──────────────────────────────────
function initGallery() {
  const grid = document.getElementById('candidates-grid');
  if (!grid) return;

  const renderCards = (filter = 'all') => {
    const list = filter === 'all' 
      ? CANDIDATE_DESIGNS 
      : CANDIDATE_DESIGNS.filter(d => d.category === filter);

    grid.innerHTML = list.map(d => {
      const isStarred = favorites.includes(d.id);
      const vars = d[currentMode];
      return `
        <div class="candidate-card" data-id="${d.id}">
          <div class="card-preview-mini" style="background: ${vars['--bg']}; color: ${vars['--text-primary']};">
            <div class="mini-toolbar" style="background: ${vars['--surface-1']}; border-bottom: 1px solid ${vars['--border']};">
              <div class="mini-logo-dots">
                <span class="mini-dot" style="background: ${vars['--accent']};"></span>
                <span style="font-size: 10px; font-weight: 600;">meowtrix</span>
              </div>
              <span style="font-size: 9px; opacity: 0.7;">${currentMode.toUpperCase()}</span>
            </div>
            <div class="mini-grid">
              <div class="mini-pane" style="background: ${vars['--term-bg']}; border-color: ${vars['--border']}; color: ${vars['--term-fg']};">
                <span>➜ ~/meowtrix</span>
                <span style="color: ${vars['--accent']};">● active</span>
              </div>
              <div class="mini-pane" style="background: ${vars['--surface-2']}; border-color: ${vars['--border']};">
                <span>app.js</span>
                <span style="opacity: 0.5;">Ln 12</span>
              </div>
            </div>
          </div>
          <div class="card-body">
            <div class="card-header-row">
              <span class="card-category">${d.category}</span>
              <button class="card-star-btn ${isStarred ? 'starred' : ''}" data-id="${d.id}" title="Favorite">
                ${isStarred ? '★' : '☆'}
              </button>
            </div>
            <div class="card-title">${d.name}</div>
            <div class="card-desc">${d.description}</div>
            <div class="card-palette-row">
              <span class="card-color-pip" style="background: ${vars['--bg']};" title="Background"></span>
              <span class="card-color-pip" style="background: ${vars['--surface-1']};" title="Surface"></span>
              <span class="card-color-pip" style="background: ${vars['--border']};" title="Border"></span>
              <span class="card-color-pip" style="background: ${vars['--accent']};" title="Accent"></span>
              <span class="card-color-pip" style="background: ${vars['--text-primary']};" title="Text"></span>
            </div>
          </div>
          <div class="card-footer">
            <span style="font-size: 11px; color: var(--site-text-dim);">${d.accentColor}</span>
            <button class="btn-card-apply" data-id="${d.id}">Test Drive →</button>
          </div>
        </div>
      `;
    }).join('');

    // Wire clicks
    grid.querySelectorAll('.btn-card-apply').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        document.querySelector('.nav-btn[data-view="mockup"]').click();
        loadDesign(id, currentMode);
      });
    });

    grid.querySelectorAll('.card-star-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        toggleFavorite(id);
        renderCards(filter);
      });
    });
  };

  renderCards('all');

  // Filter Buttons
  const filterPills = document.querySelectorAll('.filter-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      renderCards(pill.dataset.filter);
    });
  });
}

// ── 5. Split View ────────────────────────────────────
function initSplitView() {
  const selectA = document.getElementById('split-select-a');
  const selectB = document.getElementById('split-select-b');
  const modeBtnA = document.getElementById('split-mode-a');
  const modeBtnB = document.getElementById('split-mode-b');

  if (!selectA || !selectB) return;

  const optionsHtml = CANDIDATE_DESIGNS.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
  selectA.innerHTML = optionsHtml;
  selectB.innerHTML = optionsHtml;

  selectA.value = 'linear-slate';
  selectB.value = 'vercel-mono';

  let splitModeA = 'dark';
  let splitModeB = 'light';

  modeBtnA.addEventListener('click', () => {
    splitModeA = splitModeA === 'dark' ? 'light' : 'dark';
    modeBtnA.textContent = splitModeA === 'dark' ? '🌙 Dark' : '☀️ Light';
    updateSplitView();
  });

  modeBtnB.addEventListener('click', () => {
    splitModeB = splitModeB === 'dark' ? 'light' : 'dark';
    modeBtnB.textContent = splitModeB === 'dark' ? '🌙 Dark' : '☀️ Light';
    updateSplitView();
  });

  selectA.addEventListener('change', updateSplitView);
  selectB.addEventListener('change', updateSplitView);
}

function updateSplitView() {
  const selectA = document.getElementById('split-select-a');
  const selectB = document.getElementById('split-select-b');
  const modeBtnA = document.getElementById('split-mode-a');
  const modeBtnB = document.getElementById('split-mode-b');

  if (!selectA || !selectB) return;

  const idA = selectA.value;
  const idB = selectB.value;
  const modeA = modeBtnA.textContent.includes('Dark') ? 'dark' : 'light';
  const modeB = modeBtnB.textContent.includes('Dark') ? 'dark' : 'light';

  const designA = getDesign(idA);
  const designB = getDesign(idB);

  document.getElementById('split-label-a').textContent = `${designA.name} (${modeA.toUpperCase()})`;
  document.getElementById('split-label-b').textContent = `${designB.name} (${modeB.toUpperCase()})`;

  renderSplitFrame('split-frame-a', designA, modeA);
  renderSplitFrame('split-frame-b', designB, modeB);
}

function renderSplitFrame(containerId, design, mode) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const vars = design[mode];
  const cssVarsString = Object.entries(vars).map(([k, v]) => `${k}:${v};`).join('');

  container.innerHTML = `
    <div style="${cssVarsString} height: 100%; display: flex; flex-direction: column; background: var(--bg); color: var(--text-primary); font-family: var(--site-font);">
      <div style="height: 38px; background: var(--surface-1); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 12px;">
        <span style="font-weight: 600; font-size: 13px; color: var(--accent);">🐾 meowtrix</span>
        <div style="display: flex; gap: 4px;">
          <span style="font-size: 11px; padding: 3px 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm);">Split V</span>
          <span style="font-size: 11px; padding: 3px 8px; background: var(--accent); color: #fff; border-radius: var(--radius-sm);">New Tab</span>
        </div>
      </div>
      <div style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border);">
        <div style="background: var(--term-bg); color: var(--term-fg); padding: 12px; font-family: var(--site-mono); font-size: 11px; line-height: 1.5;">
          <div style="color: var(--accent);">➜ meowtrix (main)</div>
          <div>npm start</div>
          <div style="color: #22c55e;">✔ Ready on port 9123</div>
        </div>
        <div style="background: var(--surface-1); padding: 12px; display: flex; flex-direction: column; gap: 8px;">
          <div style="font-size: 11px; font-weight: 600; color: var(--text-muted);">CODE EXPLORER</div>
          <div style="font-size: 11px; color: var(--text-primary); padding: 4px 6px; background: var(--accent-subtle); border-left: 2px solid var(--accent);">app.js (Active)</div>
          <div style="font-size: 11px; color: var(--text-secondary); padding: 4px 6px;">style.css</div>
        </div>
      </div>
    </div>
  `;
}

// ── 6. Logos & Icons View ────────────────────────────
function initLogosAndIcons() {
  const container = document.getElementById('new-logos-container');
  if (!container) return;

  container.innerHTML = LOGO_CANDIDATES.map(l => `
    <div class="new-logo-card">
      <div class="new-logo-preview">
        ${l.svg}
      </div>
      <div class="new-logo-title">${l.name}</div>
      <div class="new-logo-desc">${l.desc}</div>
    </div>
  `).join('');

  // Flat Icons Grid
  const iconsContainer = document.getElementById('icons-grid');
  if (!iconsContainer) return;

  const iconPairs = [
    { name: 'Split Vertical', legacy: '◧ Emoji', modern: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>' },
    { name: 'Split Horizontal', legacy: '⬒ Emoji', modern: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/></svg>' },
    { name: 'Zoom In / Out', legacy: '🔍+ Emoji', modern: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>' },
    { name: 'Theme Toggle', legacy: '🌙 Multi-emoji', modern: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>' },
    { name: 'File Explorer', legacy: '📁 Emoji', modern: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' },
    { name: 'Settings Gear', legacy: '⚙️ Emoji', modern: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' }
  ];

  iconsContainer.innerHTML = iconPairs.map(p => `
    <div class="icon-compare-card">
      <div class="icon-side">
        <span class="icon-label">OLD</span>
        <span style="font-size: 16px;">${p.legacy}</span>
      </div>
      <span style="color: var(--site-text-muted); font-size: 12px;">→</span>
      <div class="icon-side">
        <span class="icon-label">NEW FLAT</span>
        <span style="color: var(--site-accent);">${p.modern}</span>
      </div>
    </div>
  `).join('');
}

// ── 7. Export View ───────────────────────────────────
function initExport() {
  renderFavoritesList();

  const copyFullBtn = document.getElementById('btn-copy-full-css');
  if (copyFullBtn) {
    copyFullBtn.addEventListener('click', () => {
      const codeText = document.getElementById('export-code-block').textContent;
      navigator.clipboard.writeText(codeText).then(() => {
        copyFullBtn.textContent = 'Copied to Clipboard! ✓';
        setTimeout(() => copyFullBtn.textContent = 'Copy All CSS', 2000);
      });
    });
  }

  const downloadBtn = document.getElementById('download-report-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadSummaryReport);
  }
}

function renderFavoritesList() {
  const container = document.getElementById('favorites-list');
  if (!container) return;

  if (favorites.length === 0) {
    container.innerHTML = '<div style="font-size: 12px; color: var(--site-text-muted); padding: 10px;">No favorites selected yet. Star candidates to bookmark them here.</div>';
    return;
  }

  container.innerHTML = favorites.map(id => {
    const d = getDesign(id);
    const note = candidateNotes[id] ? `<div style="font-size: 11px; color: var(--site-text-dim); margin-top: 4px;">Note: ${candidateNotes[id]}</div>` : '';
    return `
      <div class="fav-item">
        <div>
          <strong>${d.name}</strong> <span style="font-size: 10px; color: var(--site-text-muted);">(${d.category})</span>
          ${note}
        </div>
        <button class="btn-tool" onclick="loadDesign('${d.id}', '${currentMode}'); document.querySelector('.nav-btn[data-view=\\'mockup\\']').click();">View</button>
      </div>
    `;
  }).join('');
}

function generateCSSBlock(design) {
  const formatVars = (vars) => {
    return Object.entries(vars)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');
  };

  return `/* ── ${design.name} Modern Redesign ──
   Category: ${design.category}
   Design Philosophy: ${design.description}
   Eliminates all 3D skeuomorphism, glossy gradients, and extra themes.
   Pure Light & Dark system.
*/

/* ── Dark Theme (Default) ── */
:root {
  color-scheme: dark;
${formatVars(design.dark)}
}

/* ── Light Theme ── */
html[data-theme="light"] {
  color-scheme: light;
${formatVars(design.light)}
}
`;
}

function updateExportCode() {
  const design = getDesign(currentDesignId);
  const codeEl = document.getElementById('export-code-block');
  const nameEl = document.getElementById('export-design-name');

  if (nameEl) nameEl.textContent = `${design.name} — style.css Variables`;
  if (codeEl) codeEl.textContent = generateCSSBlock(design);
}

function copyActiveDesignCSS() {
  const design = getDesign(currentDesignId);
  const css = generateCSSBlock(design);
  navigator.clipboard.writeText(css).then(() => {
    const btn = document.getElementById('btn-quick-copy');
    if (btn) {
      btn.textContent = 'Copied! ✓';
      setTimeout(() => btn.textContent = '📋 Copy CSS', 1500);
    }
  });
}

function downloadSummaryReport() {
  const report = {
    generatedAt: new Date().toISOString(),
    selectedDesign: getDesign(currentDesignId),
    favorites: favorites.map(id => ({
      id,
      name: getDesign(id).name,
      note: candidateNotes[id] || ''
    })),
    notes: candidateNotes
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'meowtrix-style-redesign-selection.json';
  a.click();
  URL.revokeObjectURL(url);
}

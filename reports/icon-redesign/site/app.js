// app.js — Interactive preview controller for Meowtrix Icon Redesign

document.addEventListener('DOMContentLoaded', () => {
  const candidates = window.ICON_CANDIDATES || [];
  const meta = window.INCONSISTENT_ICONS_METADATA || [];

  let activeCandidateId = localStorage.getItem('meowtrix_icon_candidate') || 'linear-precision';
  let activeTheme = localStorage.getItem('meowtrix_icon_theme') || 'slate';
  let activeSize = localStorage.getItem('meowtrix_icon_size') || '24';

  // DOM Elements
  const themeButtons = document.querySelectorAll('.theme-btn');
  const sizeButtons = document.querySelectorAll('.size-btn');
  const mockupSelect = document.getElementById('mockup-candidate-select');
  const winnerSelect = document.getElementById('winner-select');
  const auditTableBody = document.getElementById('audit-table-body');
  const candidatesGrid = document.getElementById('candidates-grid');
  const winnerDetails = document.getElementById('winner-details-preview');
  const codePatchPreview = document.getElementById('code-patch-preview');
  const btnApplySelection = document.getElementById('btn-apply-selection');
  const btnCopyPatch = document.getElementById('btn-copy-patch');

  // Initialize Themes
  function setTheme(t) {
    activeTheme = t;
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('meowtrix_icon_theme', t);
    themeButtons.forEach(b => b.classList.toggle('active', b.dataset.theme === t));
  }
  themeButtons.forEach(b => b.addEventListener('click', () => setTheme(b.dataset.theme)));
  setTheme(activeTheme);

  // Initialize Icon Size Scale
  function setSize(s) {
    activeSize = s;
    document.body.setAttribute('data-icon-size', s);
    localStorage.setItem('meowtrix_icon_size', s);
    sizeButtons.forEach(b => b.classList.toggle('active', b.dataset.size === s));
  }
  sizeButtons.forEach(b => b.addEventListener('click', () => setSize(b.dataset.size)));
  setSize(activeSize);

  // Populate Candidate Selectors
  candidates.forEach(c => {
    const opt1 = document.createElement('option');
    opt1.value = c.id;
    opt1.textContent = c.name;
    mockupSelect.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = c.id;
    opt2.textContent = c.name;
    winnerSelect.appendChild(opt2);
  });

  // Switch Active Candidate
  function selectCandidate(id) {
    activeCandidateId = id;
    localStorage.setItem('meowtrix_icon_candidate', id);
    mockupSelect.value = id;
    winnerSelect.value = id;

    updateMockup();
    renderAuditTable();
    updateCandidateCards();
    updateWinnerPreview();
  }

  mockupSelect.addEventListener('change', (e) => selectCandidate(e.target.value));
  winnerSelect.addEventListener('change', (e) => selectCandidate(e.target.value));

  // Update Live Mockup
  function updateMockup() {
    const c = candidates.find(item => item.id === activeCandidateId) || candidates[0];
    if (!c) return;

    // Slots in Mockup Toolbar & Tabs
    const slotGpuToolbar = document.getElementById('slot-gpu-toolbar');
    const slotTerminalTab = document.getElementById('slot-terminal-tab');
    const slotAgentTab = document.getElementById('slot-agent-tab');
    const slotEditorTab = document.getElementById('slot-editor-tab');
    const slotBrowserTab = document.getElementById('slot-browser-tab');
    const slotSshTab = document.getElementById('slot-ssh-tab');

    // Slots in Mockup Dropdown
    const slotTerminalMenu = document.getElementById('slot-terminal-menu');
    const slotSshMenu = document.getElementById('slot-ssh-menu');
    const slotAgentMenu = document.getElementById('slot-agent-menu');
    const slotBrowserMenu = document.getElementById('slot-browser-menu');
    const slotEditorMenu = document.getElementById('slot-editor-menu');

    if (slotGpuToolbar) slotGpuToolbar.innerHTML = c.icons.gpu;
    if (slotTerminalTab) slotTerminalTab.innerHTML = c.icons.terminal;
    if (slotAgentTab) slotAgentTab.innerHTML = c.icons.agent;
    if (slotEditorTab) slotEditorTab.innerHTML = c.icons.editor;
    if (slotBrowserTab) slotBrowserTab.innerHTML = c.icons.browser;
    if (slotSshTab) slotSshTab.innerHTML = c.icons.ssh;

    if (slotTerminalMenu) slotTerminalMenu.innerHTML = c.icons.terminal;
    if (slotSshMenu) slotSshMenu.innerHTML = c.icons.ssh;
    if (slotAgentMenu) slotAgentMenu.innerHTML = c.icons.agent;
    if (slotBrowserMenu) slotBrowserMenu.innerHTML = c.icons.browser;
    if (slotEditorMenu) slotEditorMenu.innerHTML = c.icons.editor;
  }

  // Render Inconsistent Icons Audit Table
  function renderAuditTable() {
    const c = candidates.find(item => item.id === activeCandidateId) || candidates[0];
    auditTableBody.innerHTML = '';

    meta.forEach(item => {
      const tr = document.createElement('tr');
      const iconSvg = c.icons[item.key] || '<svg></svg>';

      tr.innerHTML = `
        <td><strong>${item.label}</strong></td>
        <td>
          <div class="current-emoji-cell">
            <span class="emoji-large">${item.currentEmoji}</span>
            <div>
              <div style="font-weight:600; font-size:12px;">${item.currentLook}</div>
              <div style="color:var(--text-dim); font-size:11px;">Current representation</div>
            </div>
          </div>
        </td>
        <td><code>${item.location}</code></td>
        <td>
          <div class="active-preview-cell">
            <div class="preview-chip">${iconSvg}</div>
            <span style="font-size:12px; font-weight:500;">Vector SVG (${c.name.split(':')[0]})</span>
          </div>
        </td>
        <td>
          <span class="issue-tag">${item.issue}</span>
        </td>
      `;
      auditTableBody.appendChild(tr);
    });
  }

  // Render 10 Candidates Grid
  function renderCandidatesGrid() {
    candidatesGrid.innerHTML = '';

    candidates.forEach((cand, idx) => {
      const card = document.createElement('div');
      card.className = `candidate-card ${cand.id === activeCandidateId ? 'active-candidate' : ''}`;
      card.dataset.id = cand.id;

      const traitsHtml = (cand.traits || []).map(t => `<span class="trait-pill">${t}</span>`).join('');

      card.innerHTML = `
        <div class="card-top">
          <div class="cand-name">${cand.name}</div>
          <span class="cand-badge">${cand.badge || `Option #${idx + 1}`}</span>
        </div>
        <p class="cand-tagline">${cand.tagline}</p>
        <div class="cand-traits">${traitsHtml}</div>
        
        <div class="cand-icons-matrix">
          <div class="cand-icon-item" title="GPU Monitor">
            <div class="icon-wrapper">${cand.icons.gpu}</div>
            <span class="cand-icon-label">GPU</span>
          </div>
          <div class="cand-icon-item" title="Terminal Tab">
            <div class="icon-wrapper">${cand.icons.terminal}</div>
            <span class="cand-icon-label">Term</span>
          </div>
          <div class="cand-icon-item" title="AI Agent Tab">
            <div class="icon-wrapper">${cand.icons.agent}</div>
            <span class="cand-icon-label">Agent</span>
          </div>
          <div class="cand-icon-item" title="SSH Tab">
            <div class="icon-wrapper">${cand.icons.ssh}</div>
            <span class="cand-icon-label">SSH</span>
          </div>
          <div class="cand-icon-item" title="Browser Tab">
            <div class="icon-wrapper">${cand.icons.browser}</div>
            <span class="cand-icon-label">Web</span>
          </div>
          <div class="cand-icon-item" title="Code Editor Tab">
            <div class="icon-wrapper">${cand.icons.editor}</div>
            <span class="cand-icon-label">Code</span>
          </div>
          <div class="cand-icon-item" title="Task Plan">
            <div class="icon-wrapper">${cand.icons.plan}</div>
            <span class="cand-icon-label">Plan</span>
          </div>
          <div class="cand-icon-item" title="Diffs">
            <div class="icon-wrapper">${cand.icons.diff}</div>
            <span class="cand-icon-label">Diff</span>
          </div>
          <div class="cand-icon-item" title="Reasoning / Brain">
            <div class="icon-wrapper">${cand.icons.brain}</div>
            <span class="cand-icon-label">Brain</span>
          </div>
          <div class="cand-icon-item" title="Autonomous Mode">
            <div class="icon-wrapper">${cand.icons.mode}</div>
            <span class="cand-icon-label">Mode</span>
          </div>
        </div>

        <div class="card-actions">
          <button class="btn-card-select" data-id="${cand.id}">
            ${cand.id === activeCandidateId ? '✓ Active in Mockup' : 'Preview in Mockup'}
          </button>
          <button class="btn-card-copy" data-id="${cand.id}" title="Copy SVG JSON">
            Copy SVGs
          </button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (!e.target.closest('.btn-card-copy')) {
          selectCandidate(cand.id);
        }
      });

      const copyBtn = card.querySelector('.btn-card-copy');
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(JSON.stringify(cand.icons, null, 2)).then(() => {
          copyBtn.textContent = '✓ Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy SVGs'; }, 1800);
        });
      });

      candidatesGrid.appendChild(card);
    });
  }

  function updateCandidateCards() {
    document.querySelectorAll('.candidate-card').forEach(card => {
      const isActive = card.dataset.id === activeCandidateId;
      card.classList.toggle('active-candidate', isActive);
      const selBtn = card.querySelector('.btn-card-select');
      if (selBtn) {
        selBtn.textContent = isActive ? '✓ Active in Mockup' : 'Preview in Mockup';
      }
    });
  }

  // Update Winner Preview & Implementation Summary
  function updateWinnerPreview() {
    const c = candidates.find(item => item.id === activeCandidateId) || candidates[0];
    if (!c) return;

    winnerDetails.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
        <div>
          <h3 style="font-size:17px; font-weight:700;">${c.name}</h3>
          <p style="font-size:13px; color:var(--text-muted); margin-top:2px;">${c.description}</p>
        </div>
        <span class="cand-badge" style="font-size:12px;">Ready to Integrate</span>
      </div>
      <div style="font-size:12.5px; color:var(--text-muted);">
        <strong>Redesigns:</strong> GPU (🎮 ➔ SVG), Terminal (⬛ ➔ SVG), AI Agent (🤖 ➔ SVG), SSH (🔗 ➔ SVG), Browser (🌐 ➔ SVG), Editor (📝 ➔ SVG), Plan (📋 ➔ SVG), Diffs (📂 ➔ SVG), Brain (🧠 ➔ SVG), Mode (⚡ ➔ SVG).
      </div>
    `;

    const codeSnippet = `// Implementation Patch for ${c.name} (${c.id})

// 1. public/index.html — Toolbar GPU Button (#btn-gpu)
// Replace: <span class="btn-icon">🎮</span>
// With:
<span class="btn-icon">
  ${c.icons.gpu.trim()}
</span>

// 2. public/pane.js — Tab Bar Type Icons
// Replace emoji ternary: icon.textContent = sshHost ? '🔗' : type === 'terminal' ? '⬛' ...
// With dedicated SVG elements:
const ICONS = {
  gpu: \`${c.icons.gpu.trim()}\`,
  terminal: \`${c.icons.terminal.trim()}\`,
  agent: \`${c.icons.agent.trim()}\`,
  ssh: \`${c.icons.ssh.trim()}\`,
  browser: \`${c.icons.browser.trim()}\`,
  editor: \`${c.icons.editor.trim()}\`
};

// 3. public/app.js — New Tab Picker Modal
// Replace [['⬛  Terminal', 'terminal'], ['🔗  SSH', 'ssh'], ['🤖  AI Agent', 'agent']...]
// with clean SVG icon nodes matching the Linear Slate design system.
`;

    codePatchPreview.textContent = codeSnippet;
  }

  btnApplySelection.addEventListener('click', () => {
    const c = candidates.find(item => item.id === activeCandidateId);
    alert(`Selected: ${c.name}!\n\nSelection saved to localStorage ('${c.id}'). Implementation code is ready below.`);
  });

  btnCopyPatch.addEventListener('click', () => {
    navigator.clipboard.writeText(codePatchPreview.textContent).then(() => {
      btnCopyPatch.textContent = '✓ Copied to Clipboard!';
      setTimeout(() => { btnCopyPatch.textContent = 'Copy Implementation Summary'; }, 2000);
    });
  });

  // Initial Render
  renderCandidatesGrid();
  selectCandidate(activeCandidateId);
});

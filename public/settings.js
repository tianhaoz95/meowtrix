// ── Settings module ──────────────────────────────────────────────────────────
let currentSettings = {};

async function loadSettings() {
  const res = await fetch('/api/settings');
  currentSettings = await res.json();
  return currentSettings;
}

async function saveSetting(key, value) {
  currentSettings[key] = value;
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [key]: value }),
  });
}

function getSettings() { return currentSettings; }

// ── Apply settings live ──────────────────────────────────────────────────────
function applyTermSettings() {
  getAllPanes().forEach(p => p.tabs.forEach(t => {
    if (!t.term) return;
    t.term.options.fontSize = currentSettings.termFontSize;
    t.term.options.fontFamily = currentSettings.termFontFamily;
    t.term.options.scrollback = currentSettings.termScrollback;
    if (t.fitAddon) t.fitAddon.fit();
  }));
}

// ── Panel open/close ─────────────────────────────────────────────────────────
function openSettings() {
  document.getElementById('settings-panel').classList.add('open');
  document.getElementById('settings-overlay').classList.add('open');
}
function closeSettings() {
  document.getElementById('settings-panel').classList.remove('open');
  document.getElementById('settings-overlay').classList.remove('open');
}

// ── Populate + wire controls ─────────────────────────────────────────────────
function populateControls(s) {
  document.getElementById('s-theme').value = s.theme;
  document.getElementById('s-font-size').value = s.termFontSize;
  document.getElementById('s-font-size-val').textContent = s.termFontSize;
  // Select closest matching font option
  const fontSel = document.getElementById('s-font-family');
  const match = [...fontSel.options].find(o => s.termFontFamily.startsWith(o.value.split(',')[0]));
  if (match) fontSel.value = match.value;
  document.getElementById('s-scrollback').value = String(s.termScrollback);
  document.getElementById('s-shell').value = s.shell;
  document.getElementById('s-homepage').value = s.browserHomepage;
}

function wireControls() {
  const s = (id, key, transform) => {
    document.getElementById(id).addEventListener('change', async (e) => {
      const val = transform ? transform(e.target.value) : e.target.value;
      await saveSetting(key, val);
      onSettingChanged(key, val);
    });
  };

  // Theme also needs input event for immediate feel
  document.getElementById('s-theme').addEventListener('change', async (e) => {
    await saveSetting('theme', e.target.value);
    applyTheme(e.target.value);
  });

  document.getElementById('s-font-size').addEventListener('input', async (e) => {
    const val = Number(e.target.value);
    document.getElementById('s-font-size-val').textContent = val;
    await saveSetting('termFontSize', val);
    applyTermSettings();
  });

  s('s-font-family', 'termFontFamily');
  document.getElementById('s-font-family').addEventListener('change', () => applyTermSettings());

  s('s-scrollback', 'termScrollback', Number);
  document.getElementById('s-scrollback').addEventListener('change', () => applyTermSettings());

  s('s-shell', 'shell');
  s('s-homepage', 'browserHomepage');
}

function onSettingChanged(key) {
  if (['termFontSize', 'termFontFamily', 'termScrollback'].includes(key)) applyTermSettings();
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const s = await loadSettings();
  populateControls(s);
  wireControls();
  // Server is source of truth for theme
  applyTheme(s.theme);

  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', closeSettings);
});

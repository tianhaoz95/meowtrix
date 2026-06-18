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

// Paint the filled portion of a range slider to match its value.
function updateRangeFill(el) {
  const min = Number(el.min || 0), max = Number(el.max || 100);
  const pct = ((Number(el.value) - min) / (max - min)) * 100;
  el.style.backgroundSize = pct + '% 100%';
}

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
  const themeSel = document.getElementById('s-theme');
  // Build options once from the shared THEMES list (defined in app.js).
  if (!themeSel.dataset.built && typeof THEMES !== 'undefined') {
    themeSel.innerHTML = THEMES.map(t => `<option value="${t.id}">${t.icon} ${t.label}</option>`).join('');
    themeSel.dataset.built = '1';
  }
  themeSel.value = s.theme;
  const fontSize = document.getElementById('s-font-size');
  fontSize.value = s.termFontSize;
  document.getElementById('s-font-size-val').textContent = s.termFontSize;
  updateRangeFill(fontSize);
  // Select closest matching font option
  const fontSel = document.getElementById('s-font-family');
  const match = [...fontSel.options].find(o => s.termFontFamily.startsWith(o.value.split(',')[0]));
  if (match) fontSel.value = match.value;
  document.getElementById('s-scrollback').value = String(s.termScrollback);
  document.getElementById('s-shell').value = s.shell;
  document.getElementById('s-homepage').value = s.browserHomepage;
  document.getElementById('s-combo-fx').checked = s.comboFx !== false;
  document.getElementById('s-pet').checked = !!s.petEnabled;
  refreshPetAvailability();
}

// Enable/disable the pet toggle based on whether Chrome's on-device model is
// usable, and show setup instructions when it isn't.
async function refreshPetAvailability() {
  const toggle = document.getElementById('s-pet');
  const note = document.getElementById('s-pet-note');
  const availability = (typeof petModelAvailability === 'function')
    ? await petModelAvailability()
    : 'unavailable';

  if (availability === 'unavailable') {
    toggle.checked = false;
    toggle.disabled = true;
    note.hidden = false;
    note.innerHTML =
      'On-device model not available. The pet needs Chrome’s built-in AI ' +
      '(Gemini Nano). In Chrome 138+, enable <code>chrome://flags/' +
      '#prompt-api-for-gemini-nano</code> and <code>chrome://flags/' +
      '#optimization-guide-on-device-model</code> (set to “Enabled ' +
      'BypassPerfRequirement”), then restart Chrome.';
    // If it was on but the model vanished, make sure the pet is hidden.
    if (typeof setPetEnabled === 'function') setPetEnabled(false);
  } else {
    toggle.disabled = false;
    if (availability === 'downloadable' || availability === 'downloading') {
      note.hidden = false;
      note.textContent =
        'The model will download (~a few GB) the first time you chat with the pet.';
    } else {
      note.hidden = true;
      note.textContent = '';
    }
  }
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
    updateRangeFill(e.target);
    await saveSetting('termFontSize', val);
    applyTermSettings();
  });

  s('s-font-family', 'termFontFamily');
  document.getElementById('s-font-family').addEventListener('change', () => applyTermSettings());

  s('s-scrollback', 'termScrollback', Number);
  document.getElementById('s-scrollback').addEventListener('change', () => applyTermSettings());

  s('s-shell', 'shell');
  s('s-homepage', 'browserHomepage');

  document.getElementById('s-combo-fx').addEventListener('change', async (e) => {
    await saveSetting('comboFx', e.target.checked);
    if (typeof setComboFxEnabled === 'function') setComboFxEnabled(e.target.checked);
  });

  document.getElementById('s-pet').addEventListener('change', async (e) => {
    await saveSetting('petEnabled', e.target.checked);
    if (typeof setPetEnabled === 'function') setPetEnabled(e.target.checked);
  });
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
  document.getElementById('settings-reset').addEventListener('click', async () => {
    if (!confirm('Reset all settings to defaults?')) return;
    const res = await fetch('/api/settings/reset', { method: 'POST' });
    const s = await res.json();
    currentSettings = s;
    populateControls(s);
    applyTheme(s.theme);
    applyTermSettings();
    if (typeof setComboFxEnabled === 'function') setComboFxEnabled(s.comboFx);
    if (typeof setPetEnabled === 'function') setPetEnabled(!!s.petEnabled);
  });
});

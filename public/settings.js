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

// ── Top Menu Bar Clock ───────────────────────────────────────────────────────
let clockIntervalId = null;

function updateClock() {
  const clockEl = document.getElementById('toolbar-clock');
  if (!clockEl) return;
  const timeStr = new Date().toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
  const timeEl = clockEl.querySelector('.clock-time');
  if (timeEl) {
    timeEl.textContent = timeStr;
  } else {
    clockEl.textContent = timeStr;
  }
}

function startClock() {
  if (clockIntervalId) return;
  updateClock();
  clockIntervalId = setInterval(updateClock, 1000);
}

function stopClock() {
  if (clockIntervalId) {
    clearInterval(clockIntervalId);
    clockIntervalId = null;
  }
}

function initClockVisibility() {
  const showTime = currentSettings.showTimeInMenu !== false;
  const clockEl = document.getElementById('toolbar-clock');
  if (clockEl) {
    if (showTime) {
      clockEl.hidden = false;
      startClock();
    } else {
      clockEl.hidden = true;
      stopClock();
    }
  }
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
  if (typeof syncSettingsUpdateStatus === 'function') syncSettingsUpdateStatus();
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
  document.getElementById('s-ui-mode').value = s.uiMode || 'auto';
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
  document.getElementById('s-http-proxy').value = s.httpProxy || '';
  document.getElementById('s-https-proxy').value = s.httpsProxy || '';
  document.getElementById('s-combo-fx').checked = s.comboFx !== false;
  document.getElementById('s-mobile-scrollbar').checked = s.mobileScrollbar !== false;
  document.getElementById('s-show-time').checked = s.showTimeInMenu !== false;
  document.getElementById('s-auto-update').checked = s.autoUpdate !== false;

  const statusEl = document.getElementById('s-update-status');
  if (statusEl) {
    if (typeof syncSettingsUpdateStatus === 'function') {
      syncSettingsUpdateStatus();
    } else if (typeof latestUpdateInfo !== 'undefined' && latestUpdateInfo) {
      if (latestUpdateInfo.error) {
        statusEl.textContent = 'Error: ' + latestUpdateInfo.error;
        statusEl.title = latestUpdateInfo.error;
        statusEl.style.color = '#f87171';
      } else {
        statusEl.title = '';
        if (latestUpdateInfo.updateAvailable) {
          statusEl.textContent = 'Update available!';
          statusEl.style.color = 'var(--accent-hi)';
        } else {
          statusEl.textContent = 'Up to date';
          statusEl.style.color = 'var(--text3)';
        }
      }
    } else {
      statusEl.textContent = '';
      statusEl.title = '';
    }
  }

  document.getElementById('s-pet').checked = !!s.petEnabled;
  const faceSel = document.getElementById('s-pet-face');
  if (!faceSel.dataset.built && typeof PET_FACES !== 'undefined') {
    faceSel.innerHTML = PET_FACES.map(f => `<option value="${f.id}">${f.emoji} ${f.label}</option>`).join('');
    faceSel.dataset.built = '1';
  }
  faceSel.value = s.petFace || 'cat';
  document.getElementById('s-pet-stay').checked = !!s.petStay;
  const petSpeed = document.getElementById('s-pet-speed');
  petSpeed.value = s.petSpeed != null ? s.petSpeed : 3;
  petSpeed.disabled = !!s.petStay; // speed is moot when the pet stays put
  document.getElementById('s-pet-speed-val').textContent = petSpeed.value;
  updateRangeFill(petSpeed);
  refreshPetAvailability();
  populateSavedCommandsList();
}

function populateSavedCommandsList() {
  const listEl = document.getElementById('s-commands-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  const cmds = currentSettings.savedCommands || {};
  
  Object.entries(cmds).forEach(([id, cmd]) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; background:var(--bg3); padding:6px 10px; border-radius:8px; border:1px solid var(--border3); font-size:12px; gap:8px; margin-bottom: 2px;';
    
    const left = document.createElement('div');
    left.style.cssText = 'display:flex; flex-direction:column; gap:2px; min-width:0; flex:1;';
    
    const idEl = document.createElement('span');
    idEl.style.cssText = 'font-weight:700; color:var(--accent); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    idEl.textContent = '@' + id;
    
    const cmdEl = document.createElement('span');
    cmdEl.style.cssText = 'color:var(--text2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:monospace;';
    cmdEl.textContent = cmd;
    
    left.append(idEl, cmdEl);
    
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.style.cssText = 'background:none; border:none; color:var(--text3); cursor:pointer; padding:2px 6px; font-size:12px; border-radius:4px; font-weight:bold; transition: color 0.12s;';
    delBtn.addEventListener('mouseenter', () => delBtn.style.color = '#f87171');
    delBtn.addEventListener('mouseleave', () => delBtn.style.color = 'var(--text3)');
    delBtn.addEventListener('click', async () => {
      delete currentSettings.savedCommands[id];
      await saveSetting('savedCommands', currentSettings.savedCommands);
      populateSavedCommandsList();
    });
    
    row.append(left, delBtn);
    listEl.appendChild(row);
  });
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
  s('s-http-proxy', 'httpProxy');
  s('s-https-proxy', 'httpsProxy');
  s('s-ui-mode', 'uiMode');

  document.getElementById('s-combo-fx').addEventListener('change', async (e) => {
    await saveSetting('comboFx', e.target.checked);
    if (typeof setComboFxEnabled === 'function') setComboFxEnabled(e.target.checked);
  });

  document.getElementById('s-mobile-scrollbar').addEventListener('change', async (e) => {
    await saveSetting('mobileScrollbar', e.target.checked);
    if (typeof refreshAllMobileScrollbars === 'function') refreshAllMobileScrollbars();
  });

  document.getElementById('s-show-time').addEventListener('change', async (e) => {
    await saveSetting('showTimeInMenu', e.target.checked);
    initClockVisibility();
  });

  document.getElementById('s-auto-update').addEventListener('change', async (e) => {
    await saveSetting('autoUpdate', e.target.checked);
  });

  const btnCheckUpdate = document.getElementById('btn-check-update');
  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', async () => {
      const statusEl = document.getElementById('s-update-status');
      if (statusEl) {
        statusEl.textContent = 'Checking...';
        statusEl.style.color = 'var(--text3)';
      }
      btnCheckUpdate.disabled = true;
      try {
        const res = await fetch('/api/update/check');
        const info = await res.json();
        if (typeof onUpdateState === 'function') {
          onUpdateState(info);
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = 'Error';
          statusEl.title = err.message || String(err);
          statusEl.style.color = '#f87171';
        }
      } finally {
        btnCheckUpdate.disabled = false;
      }
    });
  }

  document.getElementById('s-pet').addEventListener('change', async (e) => {
    await saveSetting('petEnabled', e.target.checked);
    if (typeof setPetEnabled === 'function') setPetEnabled(e.target.checked);
  });

  document.getElementById('s-pet-face').addEventListener('change', async (e) => {
    await saveSetting('petFace', e.target.value);
    if (typeof setPetFace === 'function') setPetFace(e.target.value);
  });

  document.getElementById('s-pet-stay').addEventListener('change', async (e) => {
    document.getElementById('s-pet-speed').disabled = e.target.checked;
    if (typeof setPetStay === 'function') setPetStay(e.target.checked);
    await saveSetting('petStay', e.target.checked);
  });

  document.getElementById('s-pet-speed').addEventListener('input', async (e) => {
    const val = Number(e.target.value);
    document.getElementById('s-pet-speed-val').textContent = val;
    updateRangeFill(e.target);
    if (typeof setPetSpeed === 'function') setPetSpeed(val);
    await saveSetting('petSpeed', val);
  });

  const btnAdd = document.getElementById('btn-add-command');
  if (btnAdd) {
    btnAdd.addEventListener('click', async () => {
      const idInput = document.getElementById('s-command-id');
      const cmdInput = document.getElementById('s-command-cmd');
      const id = idInput.value.trim().replace(/^@/, '');
      const cmd = cmdInput.value.trim();
      if (!id || !cmd) return;
      
      if (!currentSettings.savedCommands) {
        currentSettings.savedCommands = {};
      }
      currentSettings.savedCommands[id] = cmd;
      await saveSetting('savedCommands', currentSettings.savedCommands);
      idInput.value = '';
      cmdInput.value = '';
      populateSavedCommandsList();
    });
  }
}

function onSettingChanged(key) {
  if (['termFontSize', 'termFontFamily', 'termScrollback'].includes(key)) applyTermSettings();
  if (key === 'uiMode') {
    if (typeof updateUiMode === 'function') updateUiMode();
  }
  if (key === 'mobileScrollbar') {
    if (typeof refreshAllMobileScrollbars === 'function') refreshAllMobileScrollbars();
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const s = await loadSettings();
  populateControls(s);
  wireControls();
  // Server is source of truth for theme
  applyTheme(s.theme);
  if (typeof updateUiMode === 'function') updateUiMode();
  initClockVisibility();

  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', closeSettings);
  document.getElementById('btn-feedback').addEventListener('click', () => {
    window.open('https://github.com/tianhaoz95/meowtrix/issues/new', '_blank');
  });
  document.getElementById('settings-reset').addEventListener('click', async () => {
    if (!confirm('Reset all settings to defaults?')) return;
    const res = await fetch('/api/settings/reset', { method: 'POST' });
    const s = await res.json();
    currentSettings = s;
    populateControls(s);
    applyTheme(s.theme);
    applyTermSettings();
    if (typeof updateUiMode === 'function') updateUiMode();
    if (typeof setComboFxEnabled === 'function') setComboFxEnabled(s.comboFx);
    if (typeof refreshAllMobileScrollbars === 'function') refreshAllMobileScrollbars();
    if (typeof setPetFace === 'function') setPetFace(s.petFace || 'cat');
    if (typeof setPetSpeed === 'function') setPetSpeed(s.petSpeed != null ? s.petSpeed : 3);
    if (typeof setPetStay === 'function') setPetStay(!!s.petStay);
    if (typeof setPetEnabled === 'function') setPetEnabled(!!s.petEnabled);
    initClockVisibility();
  });
});

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
  if (typeof updateUiMode === 'function') {
    updateUiMode();
  }
}

function applyMenuButtonMode(mode) {
  const m = mode || 'both';
  document.body.setAttribute('data-menu-button-mode', m);
  window.dispatchEvent(new Event('resize'));
}

function applyMenuButtonGroupsVisibility() {
  const settings = getSettings();
  const groups = {
    'grp-workspace': settings.showWorkspaceButtons !== false,
    'grp-pane': settings.showPaneButtons !== false,
    'grp-tools': settings.showToolButtons !== false,
    'grp-zoom': settings.showZoomButtons !== false,
    'grp-system': settings.showSystemButtons !== false,
  };
  
  for (const [id, visible] of Object.entries(groups)) {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = visible ? '' : 'none';
    }
  }
  window.dispatchEvent(new Event('resize'));
}

// ── Apply settings live ──────────────────────────────────────────────────────
function applyTermSettings() {
  getAllPanes().forEach(p => p.tabs.forEach(t => {
    if (!t.term) return;
    t.term.options.fontSize = Math.round((currentSettings.termFontSize || 13) * (t.zoomLevel || 1.0));
    t.term.options.fontFamily = currentSettings.termFontFamily;
    t.term.options.scrollback = currentSettings.termScrollback;
    if (t.fitAddon) t.fitAddon.fit();
  }));
}

function applyEditorSettings() {
  getAllPanes().forEach(p => p.tabs.forEach(t => {
    if (typeof t.updateMinimap === 'function') t.updateMinimap();
  }));
}

// ── Panel open/close ─────────────────────────────────────────────────────────
// ── Search settings ──────────────────────────────────────────────────────────
function getRowSearchText(item) {
  let texts = [];
  texts.push(item.textContent);
  
  item.querySelectorAll('input').forEach(input => {
    if (input.placeholder) texts.push(input.placeholder);
  });
  
  item.querySelectorAll('select option').forEach(opt => {
    texts.push(opt.textContent);
  });
  
  return texts.join(' ').toLowerCase();
}

function triggerSettingsSearch() {
  const searchInput = document.getElementById('settings-search');
  const clearBtn = document.getElementById('settings-search-clear');
  if (!searchInput) return;
  
  const query = searchInput.value.trim().toLowerCase();
  
  if (clearBtn) {
    clearBtn.hidden = !query;
  }
  
  const sections = document.querySelectorAll('.settings-section');
  
  if (!query) {
    sections.forEach(section => {
      if (section.dataset.prevOpen !== undefined) {
        section.open = section.dataset.prevOpen === 'true';
        delete section.dataset.prevOpen;
      }
      section.style.display = '';
      
      const items = section.querySelectorAll('.settings-row, #s-commands-list > div, #s-mobile-keys-list > div');
      items.forEach(item => {
        item.style.display = '';
      });
    });
    return;
  }
  
  sections.forEach(section => {
    if (section.dataset.prevOpen === undefined) {
      section.dataset.prevOpen = String(section.open);
    }
    
    const titleEl = section.querySelector('.settings-section-title');
    const titleText = titleEl ? titleEl.textContent.replace(/🐾|⚙/g, '').trim().toLowerCase() : '';
    const sectionTitleMatches = titleText.includes(query);
    
    const items = section.querySelectorAll('.settings-row, #s-commands-list > div, #s-mobile-keys-list > div');
    let hasMatchingItem = false;
    
    items.forEach(item => {
      if (sectionTitleMatches) {
        item.style.display = '';
        hasMatchingItem = true;
      } else {
        const itemText = getRowSearchText(item);
        if (itemText.includes(query)) {
          item.style.display = '';
          hasMatchingItem = true;
        } else {
          item.style.display = 'none';
        }
      }
    });
    
    if (sectionTitleMatches || hasMatchingItem) {
      section.style.display = '';
      section.open = true;
    } else {
      section.style.display = 'none';
    }
  });
}

function clearSettingsSearch() {
  const searchInput = document.getElementById('settings-search');
  if (searchInput) {
    searchInput.value = '';
    triggerSettingsSearch();
  }
}

// ── Panel open/close ─────────────────────────────────────────────────────────
function syncAboutVersion() {
  const el = document.getElementById('s-about-version');
  if (!el) return;
  const v = (typeof latestUpdateInfo !== 'undefined' && latestUpdateInfo && latestUpdateInfo.version) || '';
  el.textContent = v ? ('Version ' + v) : 'Version —';
}

function toggleSettingsInputs(enabled) {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;
  const elements = panel.querySelectorAll('input, select, textarea, button');
  elements.forEach(el => {
    if (el.id === 'settings-close' || el.id === 'settings-reset') return;
    if (enabled) {
      el.removeAttribute('disabled');
    } else {
      el.setAttribute('disabled', 'true');
    }
  });
}

function openSettings() {
  toggleSettingsInputs(true);
  document.getElementById('settings-panel').classList.add('open');
  document.getElementById('settings-overlay').classList.add('open');
  if (typeof syncSettingsUpdateStatus === 'function') syncSettingsUpdateStatus();
  syncAboutVersion();
  if (typeof refreshRestartAvailability === 'function') refreshRestartAvailability();
  const searchInput = document.getElementById('settings-search');
  if (searchInput) {
    setTimeout(() => searchInput.focus(), 150);
  }
}
function closeSettings() {
  document.getElementById('settings-panel').classList.remove('open');
  document.getElementById('settings-overlay').classList.remove('open');
  clearSettingsSearch();
  toggleSettingsInputs(false);
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
  document.getElementById('s-menu-button-mode').value = s.menuButtonMode || 'both';
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
  const localServerIpSel = document.getElementById('s-local-server-ip');
  if (localServerIpSel) {
    const val = s.localServerIp || '127.0.0.1';
    if (![...localServerIpSel.options].some(o => o.value === val)) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      localServerIpSel.appendChild(opt);
    }
    localServerIpSel.value = val;
  }
  document.getElementById('s-http-proxy').value = s.httpProxy || '';
  document.getElementById('s-https-proxy').value = s.httpsProxy || '';
  document.getElementById('s-combo-fx').checked = s.comboFx !== false;
  document.getElementById('s-mobile-scrollbar').checked = s.mobileScrollbar !== false;
  const sMobileAutocomplete = document.getElementById('s-mobile-keyboard-autocomplete');
  if (sMobileAutocomplete) {
    sMobileAutocomplete.checked = s.mobileKeyboardAutocomplete === true;
  }
  if (typeof syncMobileAutocompleteVisibility === 'function') syncMobileAutocompleteVisibility();
  document.getElementById('s-show-time').checked = s.showTimeInMenu !== false;
  document.getElementById('s-auto-update').checked = s.autoUpdate !== false;
  document.getElementById('s-editor-minimap').checked = s.editorMinimap !== false;
  
  const chkWorkspace = document.getElementById('s-menu-workspace');
  if (chkWorkspace) chkWorkspace.checked = s.showWorkspaceButtons !== false;
  const chkPane = document.getElementById('s-menu-pane');
  if (chkPane) chkPane.checked = s.showPaneButtons !== false;
  const chkTools = document.getElementById('s-menu-tools');
  if (chkTools) chkTools.checked = s.showToolButtons !== false;
  const chkZoom = document.getElementById('s-menu-zoom');
  if (chkZoom) chkZoom.checked = s.showZoomButtons !== false;
  const chkSystem = document.getElementById('s-menu-system');
  if (chkSystem) chkSystem.checked = s.showSystemButtons !== false;

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
  populateMobileKeysList();
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
    idEl.textContent = '!' + id;
    
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
  if (typeof triggerSettingsSearch === 'function') triggerSettingsSearch();
}

function populateMobileKeysList() {
  const listEl = document.getElementById('s-mobile-keys-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  
  const keys = currentSettings.mobileKeys || [...DEFAULT_MOBILE_KEYS];
  
  keys.forEach((key, idx) => {
    const row = document.createElement('div');
    row.className = 'mobile-key-config-row';
    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; background:var(--bg3); padding:6px 10px; border-radius:8px; border:1px solid var(--border3); font-size:12px; gap:8px; margin-bottom: 2px;';
    
    const left = document.createElement('div');
    left.style.cssText = 'display:flex; align-items:center; gap:8px; min-width:0; flex:1;';
    
    const labelEl = document.createElement('span');
    labelEl.style.cssText = 'font-weight:700; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    labelEl.textContent = key.label;
    
    const badge = document.createElement('span');
    let badgeBg = 'var(--bg4)';
    let badgeColor = 'var(--text2)';
    if (key.kind === 'send') {
      badgeBg = 'rgba(16, 185, 129, 0.12)';
      badgeColor = '#10b981';
    } else if (key.kind === 'mod') {
      badgeBg = 'rgba(245, 158, 11, 0.12)';
      badgeColor = '#f59e0b';
    } else if (key.kind === 'combo') {
      badgeBg = 'rgba(139, 92, 246, 0.12)';
      badgeColor = '#8b5cf6';
    } else if (key.kind === 'hide') {
      badgeBg = 'rgba(107, 114, 128, 0.12)';
      badgeColor = '#9ca3af';
    }
    badge.style.cssText = `font-size:10px; padding:2px 6px; border-radius:4px; font-weight:600; background:${badgeBg}; color:${badgeColor}; text-transform:uppercase;`;
    badge.textContent = key.kind;
    
    const payloadEl = document.createElement('span');
    payloadEl.style.cssText = 'color:var(--text3); font-family:monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width: 100px;';
    payloadEl.textContent = key.payload;
    
    left.append(labelEl, badge, payloadEl);
    
    const right = document.createElement('div');
    right.style.cssText = 'display:flex; align-items:center; gap:4px;';
    
    const upBtn = document.createElement('button');
    upBtn.textContent = '↑';
    upBtn.title = 'Move up';
    upBtn.style.cssText = 'background:none; border:none; color:var(--text3); cursor:pointer; padding:2px 4px; font-size:12px; font-weight:bold;';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', async () => {
      if (idx > 0) {
        const temp = keys[idx];
        keys[idx] = keys[idx - 1];
        keys[idx - 1] = temp;
        currentSettings.mobileKeys = keys;
        await saveSetting('mobileKeys', keys);
        populateMobileKeysList();
        if (typeof rebuildMobileKeyBar === 'function') rebuildMobileKeyBar();
      }
    });
    
    const downBtn = document.createElement('button');
    downBtn.textContent = '↓';
    downBtn.title = 'Move down';
    downBtn.style.cssText = 'background:none; border:none; color:var(--text3); cursor:pointer; padding:2px 4px; font-size:12px; font-weight:bold;';
    downBtn.disabled = idx === keys.length - 1;
    downBtn.addEventListener('click', async () => {
      if (idx < keys.length - 1) {
        const temp = keys[idx];
        keys[idx] = keys[idx + 1];
        keys[idx + 1] = temp;
        currentSettings.mobileKeys = keys;
        await saveSetting('mobileKeys', keys);
        populateMobileKeysList();
        if (typeof rebuildMobileKeyBar === 'function') rebuildMobileKeyBar();
      }
    });
    
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.title = 'Delete';
    delBtn.style.cssText = 'background:none; border:none; color:var(--text3); cursor:pointer; padding:2px 6px; font-size:12px; border-radius:4px; font-weight:bold; transition: color 0.12s;';
    delBtn.addEventListener('mouseenter', () => delBtn.style.color = '#f87171');
    delBtn.addEventListener('mouseleave', () => delBtn.style.color = 'var(--text3)');
    delBtn.addEventListener('click', async () => {
      keys.splice(idx, 1);
      currentSettings.mobileKeys = keys;
      await saveSetting('mobileKeys', keys);
      populateMobileKeysList();
      if (typeof rebuildMobileKeyBar === 'function') rebuildMobileKeyBar();
    });
    
    right.append(upBtn, downBtn, delBtn);
    row.append(left, right);
    listEl.appendChild(row);
  });
  if (typeof triggerSettingsSearch === 'function') triggerSettingsSearch();
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
  s('s-local-server-ip', 'localServerIp');
  s('s-http-proxy', 'httpProxy');
  s('s-https-proxy', 'httpsProxy');
  s('s-ui-mode', 'uiMode');
  s('s-menu-button-mode', 'menuButtonMode');

  document.getElementById('s-combo-fx').addEventListener('change', async (e) => {
    await saveSetting('comboFx', e.target.checked);
    if (typeof setComboFxEnabled === 'function') setComboFxEnabled(e.target.checked);
  });

  document.getElementById('s-mobile-scrollbar').addEventListener('change', async (e) => {
    await saveSetting('mobileScrollbar', e.target.checked);
    if (typeof refreshAllMobileScrollbars === 'function') refreshAllMobileScrollbars();
  });

  const sMobileAutocompleteBtn = document.getElementById('s-mobile-keyboard-autocomplete');
  if (sMobileAutocompleteBtn) {
    sMobileAutocompleteBtn.addEventListener('change', async (e) => {
      await saveSetting('mobileKeyboardAutocomplete', e.target.checked);
      if (typeof refreshAllMobileAutocompletes === 'function') refreshAllMobileAutocompletes();
    });
  }

  document.getElementById('s-show-time').addEventListener('change', async (e) => {
    await saveSetting('showTimeInMenu', e.target.checked);
    initClockVisibility();
  });

  document.getElementById('s-auto-update').addEventListener('change', async (e) => {
    await saveSetting('autoUpdate', e.target.checked);
  });

  document.getElementById('s-editor-minimap').addEventListener('change', async (e) => {
    await saveSetting('editorMinimap', e.target.checked);
    onSettingChanged('editorMinimap', e.target.checked);
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

  const btnRestartApp = document.getElementById('btn-restart-app');
  if (btnRestartApp) {
    btnRestartApp.addEventListener('click', () => {
      if (typeof restartAppNow === 'function') restartAppNow();
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
      const id = idInput.value.trim().replace(/^[!@]/, '');
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

  const btnAddMobileKey = document.getElementById('btn-add-mobile-key');
  if (btnAddMobileKey) {
    btnAddMobileKey.addEventListener('click', async () => {
      const labelInput = document.getElementById('s-mobile-key-label');
      const kindSelect = document.getElementById('s-mobile-key-kind');
      const payloadInput = document.getElementById('s-mobile-key-payload');
      
      const label = labelInput.value.trim();
      const kind = kindSelect.value;
      const payload = payloadInput.value.trim();
      
      if (!label) return;
      
      const keys = currentSettings.mobileKeys || [...DEFAULT_MOBILE_KEYS];
      keys.push({ label, kind, payload });
      currentSettings.mobileKeys = keys;
      
      await saveSetting('mobileKeys', keys);
      
      labelInput.value = '';
      payloadInput.value = '';
      
      populateMobileKeysList();
      if (typeof rebuildMobileKeyBar === 'function') rebuildMobileKeyBar();
    });
  }

  const btnResetMobileKeys = document.getElementById('btn-reset-mobile-keys');
  if (btnResetMobileKeys) {
    btnResetMobileKeys.addEventListener('click', async () => {
      if (!await showConfirm('Reset Mobile Keys', 'Reset mobile keys to defaults?')) return;
      currentSettings.mobileKeys = [...DEFAULT_MOBILE_KEYS];
      await saveSetting('mobileKeys', currentSettings.mobileKeys);
      populateMobileKeysList();
      if (typeof rebuildMobileKeyBar === 'function') rebuildMobileKeyBar();
    });
  }

  const wireCheckbox = (id, key) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', async (e) => {
        await saveSetting(key, e.target.checked);
        applyMenuButtonGroupsVisibility();
      });
    }
  };
  wireCheckbox('s-menu-workspace', 'showWorkspaceButtons');
  wireCheckbox('s-menu-pane', 'showPaneButtons');
  wireCheckbox('s-menu-tools', 'showToolButtons');
  wireCheckbox('s-menu-zoom', 'showZoomButtons');
  wireCheckbox('s-menu-system', 'showSystemButtons');
}

function onSettingChanged(key) {
  if (['termFontSize', 'termFontFamily', 'termScrollback'].includes(key)) applyTermSettings();
  if (key === 'uiMode') {
    if (typeof updateUiMode === 'function') updateUiMode();
  }
  if (key === 'menuButtonMode') {
    applyMenuButtonMode(currentSettings.menuButtonMode);
  }
  if (key === 'mobileScrollbar') {
    if (typeof refreshAllMobileScrollbars === 'function') refreshAllMobileScrollbars();
  }
  if (key === 'mobileKeyboardAutocomplete') {
    if (typeof refreshAllMobileAutocompletes === 'function') refreshAllMobileAutocompletes();
    if (typeof refreshMobileAutocompleteToggle === 'function') refreshMobileAutocompleteToggle();
  }
  if (key === 'mobileKeys') {
    if (typeof rebuildMobileKeyBar === 'function') rebuildMobileKeyBar();
  }
  if (key === 'editorMinimap') {
    applyEditorSettings();
  }
  if (['showWorkspaceButtons', 'showPaneButtons', 'showToolButtons', 'showZoomButtons', 'showSystemButtons'].includes(key)) {
    applyMenuButtonGroupsVisibility();
  }
}

let _networkIps = ['127.0.0.1'];
async function initNetworkInterfaces() {
  try {
    const res = await fetch('/api/network-interfaces');
    _networkIps = await res.json();
    const sel = document.getElementById('s-local-server-ip');
    if (sel) {
      sel.innerHTML = _networkIps.map(ip => `<option value="${ip}">${ip}</option>`).join('');
    }
  } catch (e) {
    console.error('Error fetching network interfaces:', e);
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await initNetworkInterfaces();
  const s = await loadSettings();
  populateControls(s);
  wireControls();
  toggleSettingsInputs(false);
  // Server is source of truth for theme
  applyTheme(s.theme);
  if (typeof updateUiMode === 'function') updateUiMode();
  initClockVisibility();
  if (typeof rebuildMobileKeyBar === 'function') rebuildMobileKeyBar();
  applyMenuButtonMode(s.menuButtonMode);
  applyMenuButtonGroupsVisibility();

  const searchInput = document.getElementById('settings-search');
  if (searchInput) {
    searchInput.addEventListener('input', triggerSettingsSearch);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (searchInput.value) {
          clearSettingsSearch();
          e.stopPropagation();
        } else {
          closeSettings();
        }
      }
    });
  }
  const clearBtn = document.getElementById('settings-search-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearSettingsSearch();
      searchInput.focus();
    });
  }

  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', closeSettings);
  document.getElementById('btn-feedback').addEventListener('click', () => {
    window.open('https://github.com/tianhaoz95/meowtrix/issues/new', '_blank');
  });
  document.getElementById('settings-reset').addEventListener('click', async () => {
    if (!await showConfirm('Reset Settings', 'Reset all settings to defaults?')) return;
    const res = await fetch('/api/settings/reset', { method: 'POST' });
    const s = await res.json();
    currentSettings = s;
    clearSettingsSearch();
    populateControls(s);
    applyTheme(s.theme);
    applyTermSettings();
    applyEditorSettings();
    if (typeof updateUiMode === 'function') updateUiMode();
    if (typeof setComboFxEnabled === 'function') setComboFxEnabled(s.comboFx);
    if (typeof refreshAllMobileScrollbars === 'function') refreshAllMobileScrollbars();
    if (typeof setPetFace === 'function') setPetFace(s.petFace || 'cat');
    if (typeof setPetSpeed === 'function') setPetSpeed(s.petSpeed != null ? s.petSpeed : 3);
    if (typeof setPetStay === 'function') setPetStay(!!s.petStay);
    if (typeof setPetEnabled === 'function') setPetEnabled(!!s.petEnabled);
    initClockVisibility();
    if (typeof rebuildMobileKeyBar === 'function') rebuildMobileKeyBar();
    applyMenuButtonMode(s.menuButtonMode);
    applyMenuButtonGroupsVisibility();
  });
});

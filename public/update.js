// ── Self-update notice ───────────────────────────────────────────────────────
// The server periodically checks whether the local git clone is behind its
// upstream (see server.js) and broadcasts update:state. We render a dismissible
// banner and expose an "Update & restart" action; the actual pull/restart
// happens server-side via POST /api/update/apply. Kept user-triggered (not
// automatic) because a restart kills every terminal session — the user picks the
// moment. This file is a stateless renderer of the server's reported state, like
// schedule.js: a refresh just re-receives update:state and re-draws the banner.

let latestUpdateInfo = null;
let _updateApplying = false;
let _updateDismissed = false; // hide the banner for this page load once dismissed
let _updateProgressText = '';
let _updateError = null;

function onUpdateState(info) {
  latestUpdateInfo = info;
  renderUpdateBanner();
  syncSettingsUpdateStatus();
}

function syncSettingsUpdateStatus() {
  const statusEl = document.getElementById('s-update-status');
  if (!statusEl) return;

  if (_updateApplying) {
    statusEl.textContent = _updateProgressText || 'Updating...';
    statusEl.style.color = 'var(--accent)';
    statusEl.title = _updateProgressText || '';
  } else if (_updateError) {
    statusEl.textContent = 'Error';
    statusEl.style.color = '#f87171';
    statusEl.title = 'Update failed: ' + _updateError;
  } else if (latestUpdateInfo) {
    if (latestUpdateInfo.error) {
      statusEl.textContent = 'Error';
      statusEl.title = latestUpdateInfo.error;
      statusEl.style.color = '#f87171';
    } else {
      statusEl.title = '';
      const hasLocal = latestUpdateInfo.hasLocalChanges || latestUpdateInfo.ahead > 0;
      if (latestUpdateInfo.updateAvailable) {
        statusEl.textContent = 'Update available!';
        statusEl.style.color = 'var(--accent-hi)';
        if (hasLocal) {
          statusEl.title = 'Local modifications or commits detected.';
        }
      } else {
        if (hasLocal) {
          statusEl.textContent = 'Up to date (modified)';
          statusEl.style.color = 'var(--text2)';
          statusEl.title = 'Local modifications or commits detected.';
        } else {
          statusEl.textContent = 'Up to date';
          statusEl.style.color = 'var(--text3)';
        }
      }
    }
  } else {
    statusEl.textContent = '';
    statusEl.title = '';
  }
}

function updateAvailable() {
  return !!(latestUpdateInfo && latestUpdateInfo.updateAvailable);
}

function renderUpdateBanner() {
  if (_updateDismissed && !_updateApplying && !_updateError) {
    const bar = document.getElementById('update-banner');
    if (bar) bar.remove();
    return;
  }

  if (!updateAvailable() && !_updateApplying && !_updateError) {
    const bar = document.getElementById('update-banner');
    if (bar) bar.remove();
    return;
  }

  let bar = document.getElementById('update-banner');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'update-banner';
    document.body.appendChild(bar);
  }

  if (_updateApplying) {
    bar.innerHTML = `
      <span class="update-banner-spinner"></span>
      <span id="update-banner-text"></span>
    `;
    bar.querySelector('#update-banner-text').textContent = _updateProgressText;
  } else if (_updateError) {
    bar.innerHTML = `
      <span id="update-banner-text" class="update-banner-error-text"></span>
      <button id="update-banner-apply">Retry</button>
      <button id="update-banner-dismiss" title="Dismiss">✕</button>
    `;
    bar.querySelector('#update-banner-text').textContent = `Update failed: ${_updateError}`;
    bar.querySelector('#update-banner-apply').addEventListener('click', applyUpdateNow);
    bar.querySelector('#update-banner-dismiss').addEventListener('click', () => {
      _updateError = null;
      _updateDismissed = true;
      bar.remove();
    });
  } else if (latestUpdateInfo && latestUpdateInfo.updateAvailable) {
    bar.innerHTML = `
      <span id="update-banner-text"></span>
      <button id="update-banner-apply">Update &amp; restart</button>
      <button id="update-banner-dismiss" title="Dismiss">✕</button>
    `;
    const n = latestUpdateInfo.behind;
    bar.querySelector('#update-banner-text').textContent =
      `A Meowtrix update is available (${n} commit${n === 1 ? '' : 's'} behind).`;
    bar.querySelector('#update-banner-apply').addEventListener('click', applyUpdateNow);
    bar.querySelector('#update-banner-dismiss').addEventListener('click', () => {
      _updateDismissed = true;
      bar.remove();
    });
  } else {
    bar.remove();
  }
}

// Pull + restart via the server. Confirms first because it ends running shells.
async function applyUpdateNow() {
  if (_updateApplying) return;
  if (!updateAvailable()) { showToast('Meowtrix is up to date.'); return; }
  
  let warningMessage = 'Update Meowtrix now? This restarts the server and ends all running terminal sessions.';
  if (latestUpdateInfo && (latestUpdateInfo.hasLocalChanges || latestUpdateInfo.ahead > 0)) {
    warningMessage = 'Update Meowtrix now? This restarts the server, ends terminal sessions, and will overwrite any local modifications to Meowtrix files.';
  }
  
  if (!await showConfirm('Update Meowtrix', warningMessage)) return;
  
  _updateApplying = true;
  _updateError = null;
  _updateProgressText = 'Updating Meowtrix (pulling latest code and checking dependencies)…';
  renderUpdateBanner();
  syncSettingsUpdateStatus();
  showToast('Updating Meowtrix…');
  
  try {
    const r = await fetch('/api/update/apply', { method: 'POST' }).then(res => res.json());
    if (!r.ok) {
      _updateError = r.output || 'unknown error';
      _updateApplying = false;
      renderUpdateBanner();
      syncSettingsUpdateStatus();
      showToast('Update failed: ' + _updateError);
      return;
    }
    if (r.restarting) {
      _updateProgressText = 'Updated — restarting server…';
      renderUpdateBanner();
      syncSettingsUpdateStatus();
      showToast('Updated — restarting server…');
      waitForServerAndReload();
    } else {
      _updateProgressText = 'Updated. Please restart the meowtrix server manually to apply.';
      _updateApplying = false;
      renderUpdateBanner();
      syncSettingsUpdateStatus();
      showToast('Updated. Restart the meowtrix server to apply.');
    }
  } catch (e) {
    _updateError = e.message;
    _updateApplying = false;
    renderUpdateBanner();
    syncSettingsUpdateStatus();
    showToast('Update failed: ' + _updateError);
  }
}

// Poll the (restarting) server until it answers, then reload the page.
function waitForServerAndReload() {
  let tries = 0;
  const ping = () => {
    fetch('/api/settings', { cache: 'no-store' })
      .then(res => { if (res.ok) location.reload(); else throw 0; })
      .catch(() => { if (++tries < 60) setTimeout(ping, 1000); });
  };
  setTimeout(ping, 1500);
}

// Manual re-check, exposed via the palette.
async function checkForUpdateNow() {
  showToast('Checking for updates…');
  try {
    const info = await fetch('/api/update/check').then(res => res.json());
    onUpdateState(info);
    if (info.error) showToast('Update check: ' + info.error);
    else if (!info.updateAvailable) showToast('Meowtrix is up to date.');
    // If an update is available the banner renders itself; no toast needed.
  } catch (e) {
    showToast('Update check failed: ' + e.message);
  }
}

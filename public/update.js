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

function onUpdateState(info) {
  latestUpdateInfo = info;
  renderUpdateBanner();

  const statusEl = document.getElementById('s-update-status');
  if (statusEl && info) {
    if (info.error) {
      statusEl.textContent = 'Error: ' + info.error;
      statusEl.title = info.error;
      statusEl.style.color = '#f87171';
    } else {
      statusEl.title = '';
      if (info.updateAvailable) {
        statusEl.textContent = 'Update available!';
        statusEl.style.color = 'var(--accent-hi)';
      } else {
        statusEl.textContent = 'Up to date';
        statusEl.style.color = 'var(--text3)';
      }
    }
  }
}

function updateAvailable() {
  return !!(latestUpdateInfo && latestUpdateInfo.updateAvailable);
}

function renderUpdateBanner() {
  let bar = document.getElementById('update-banner');
  if (!updateAvailable() || _updateDismissed) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'update-banner';
    bar.innerHTML =
      '<span id="update-banner-text"></span>' +
      '<button id="update-banner-apply">Update &amp; restart</button>' +
      '<button id="update-banner-dismiss" title="Dismiss">✕</button>';
    document.body.appendChild(bar);
    bar.querySelector('#update-banner-apply').addEventListener('click', applyUpdateNow);
    bar.querySelector('#update-banner-dismiss').addEventListener('click', () => {
      _updateDismissed = true;
      bar.remove();
    });
  }
  const n = latestUpdateInfo.behind;
  bar.querySelector('#update-banner-text').textContent =
    `A Meowtrix update is available (${n} commit${n === 1 ? '' : 's'} behind).`;
}

// Pull + restart via the server. Confirms first because it ends running shells.
async function applyUpdateNow() {
  if (_updateApplying) return;
  if (!updateAvailable()) { showToast('Meowtrix is up to date.'); return; }
  if (!confirm('Update Meowtrix now? This restarts the server and ends all running terminal sessions.')) return;
  _updateApplying = true;
  showToast('Updating Meowtrix…');
  try {
    const r = await fetch('/api/update/apply', { method: 'POST' }).then(res => res.json());
    if (!r.ok) {
      showToast('Update failed: ' + (r.output || 'unknown error'));
      _updateApplying = false;
      return;
    }
    if (r.restarting) {
      // The server exits and the supervisor relaunches it. The WS drops and
      // auto-reconnects (ws.js); we reload once the server answers again so the
      // freshly pulled frontend is what loads.
      showToast('Updated — restarting server…');
      waitForServerAndReload();
    } else {
      // Unsupervised install (bare `meowtrix` launcher): code is pulled but
      // nothing restarts us, so the user must do it.
      showToast('Updated. Restart the meowtrix server to apply.');
      _updateApplying = false;
    }
  } catch (e) {
    showToast('Update failed: ' + e.message);
    _updateApplying = false;
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

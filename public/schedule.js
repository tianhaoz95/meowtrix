// ── Scheduled Enter key press ────────────────────────────────────────────────
// Coding agents increasingly gate work behind a rolling usage quota (e.g. a
// 5-hour window). When you're out of quota you can still *type* the next command
// into the agent — you just can't run it yet. This lets you queue the Enter:
// type the command, schedule an Enter for when the quota resets, and go to bed.
//
// The timer lives on the *server*, next to the PTYs (see server.js), so it
// survives page refreshes, reconnects, and device handoffs. This file is just
// the UI: it sends schedule:create / schedule:cancel and renders whatever
// schedule state the server reports back (onScheduleState). A scheduled tab is
// locked behind a blurred overlay — its terminal stops accepting input via the
// `tab.schedule` guard in pane.js's onData — until the server fires it (writing
// `\r` to that PTY) or the user cancels.

// Server-reported schedules: ptyId -> fireAt (epoch ms). The single source of
// truth; the DOM overlays are reconciled to match it.
let scheduledByPty = new Map();

// ── Time formatting helpers ──────────────────────────────────────────────────
function schedFmtClock(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Clock time, prefixed with the weekday when it's not today (e.g. "Thu 3:30 AM").
function schedFmtWhen(d) {
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = schedFmtClock(d);
  return sameDay ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

// Coarse remaining-time label: "4h 59m" far out, "12m 30s" / "45s" near the end.
function schedFmtRemaining(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// ── Reconciliation ───────────────────────────────────────────────────────────
// (tabByPtyId lives in pane.js — shared with the PTY reconnect/restore logic.)

// Make the on-screen lock overlays match `scheduledByPty`. Called whenever the
// server's schedule state changes *and* after the workspace is (re)built, since
// on a refresh the state can arrive before the tabs exist.
function reconcileSchedules() {
  if (typeof getAllPanesAllWorkspaces !== 'function') return;
  for (const pane of getAllPanesAllWorkspaces()) {
    for (const tab of pane.tabs) {
      if (tab.type !== 'terminal') continue;
      const fireAt = tab.ptyId ? scheduledByPty.get(tab.ptyId) : undefined;
      if (fireAt) {
        if (!tab.schedule || tab.schedule.fireAt !== fireAt) renderSchedule(tab, fireAt);
      } else if (tab.schedule) {
        teardownSchedule(tab);
      }
    }
  }
}

// ── Per-tab overlay lifecycle ────────────────────────────────────────────────
// Remove the lock overlay and stop its countdown. Does NOT talk to the server —
// the server's state drives whether a schedule exists; this only mirrors it.
function teardownSchedule(tab) {
  const s = tab.schedule;
  if (!s) return;
  clearInterval(s.tickId);
  s.overlay?.remove();
  tab.viewEl.classList.remove('scheduled');
  tab.tabEl?.classList.remove('scheduled');
  tab.schedule = null;
}

// Build + show the blurred lock overlay for a tab scheduled to fire at `fireAt`
// (epoch ms). The countdown ticks locally off fireAt; the actual firing is the
// server's job.
function renderSchedule(tab, fireAt) {
  teardownSchedule(tab); // replace any stale overlay (e.g. fireAt changed)
  const when = new Date(fireAt);

  const overlay = document.createElement('div');
  overlay.className = 'schedule-overlay';
  overlay.innerHTML = `
    <div class="schedule-card">
      <div class="schedule-ico">⏰</div>
      <div class="schedule-title">Enter scheduled</div>
      <div class="schedule-when">Fires at <strong></strong></div>
      <div class="schedule-countdown"></div>
      <button class="schedule-cancel">Cancel</button>
    </div>`;
  overlay.querySelector('.schedule-when strong').textContent = schedFmtWhen(when);
  overlay.querySelector('.schedule-cancel').addEventListener('click', (e) => {
    e.stopPropagation();
    cancelSchedule(tab);
  });
  overlay.addEventListener('mousedown', (e) => e.preventDefault()); // don't focus the terminal beneath

  tab.viewEl.appendChild(overlay);
  tab.viewEl.classList.add('scheduled');
  tab.tabEl?.classList.add('scheduled');
  tab.term?.blur();

  const countdownEl = overlay.querySelector('.schedule-countdown');
  const tick = () => { countdownEl.textContent = 'in ' + schedFmtRemaining(fireAt - Date.now()); };
  tick();
  tab.schedule = { fireAt, overlay, tickId: setInterval(tick, 1000) };
}

// User pressed Cancel: tell the server to drop the schedule. We also tear down
// optimistically so the tab unlocks instantly; the server's schedule:state echo
// keeps everyone else in sync.
function cancelSchedule(tab) {
  if (tab.ptyId) wsSend({ type: 'schedule:cancel', ptyId: tab.ptyId });
  teardownSchedule(tab);
  tab.term?.focus();
}

// ── Server message handlers (called from ws.js) ──────────────────────────────
function onScheduleState(list) {
  scheduledByPty = new Map((list || []).map(s => [s.ptyId, s.fireAt]));
  reconcileSchedules();
}

function onScheduleFired(ptyId) {
  const tab = tabByPtyId(ptyId);
  const label = tab?.label?.textContent || 'terminal';
  if (tab && tab.id === activePane?.activeTab?.id) tab.term?.focus();
  if (typeof showToast === 'function') showToast(`⏰ Sent Enter to ${label}`);
}

// ── Scheduling dialog ────────────────────────────────────────────────────────
let schedDialogEl = null;
let schedTargetTab = null;  // tab captured when the dialog opened
let schedMode = 'in';       // 'in' (relative duration) | 'at' (clock time)

// Compute the target Date from the current dialog inputs, or null if invalid.
function schedComputeFireAt() {
  if (schedMode === 'in') {
    const h = +schedDialogEl.querySelector('#sched-hours').value || 0;
    const m = +schedDialogEl.querySelector('#sched-mins').value || 0;
    const total = h * 60 + m;
    if (total <= 0) return null;
    return new Date(Date.now() + total * 60000);
  }
  const v = schedDialogEl.querySelector('#sched-time').value; // "HH:MM"
  if (!v) return null;
  const [hh, mm] = v.split(':').map(Number);
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); // already past today → tomorrow
  return d;
}

function schedUpdatePreview() {
  const preview = schedDialogEl.querySelector('#sched-preview');
  const confirm = schedDialogEl.querySelector('#sched-confirm');
  const fireAt = schedComputeFireAt();
  if (!fireAt) {
    preview.textContent = 'Set a time to schedule.';
    confirm.disabled = true;
    return;
  }
  confirm.disabled = false;
  preview.innerHTML = `Enter will be sent at <strong>${schedFmtWhen(fireAt)}</strong> · ${schedFmtRemaining(fireAt - Date.now())} from now`;
}

function schedSetMode(mode) {
  schedMode = mode;
  schedDialogEl.querySelectorAll('.sched-tabs button').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  schedDialogEl.querySelectorAll('.sched-mode').forEach(p =>
    p.hidden = p.dataset.mode !== mode);
  schedUpdatePreview();
}

function buildScheduleDialog() {
  schedDialogEl = document.createElement('div');
  schedDialogEl.id = 'schedule-modal-overlay';
  schedDialogEl.hidden = true;
  schedDialogEl.innerHTML = `
    <div id="schedule-modal">
      <div class="sched-head"><span class="sched-head-ico">⏰</span>Schedule Enter key press</div>
      <p class="sched-desc">Queues an <kbd>Enter</kbd> for this terminal — handy for firing a command the moment your agent's usage quota resets. The timer runs on the host, so it survives refreshes. The tab locks until it fires or you cancel.</p>
      <div class="sched-tabs">
        <button data-mode="in" class="active">In…</button>
        <button data-mode="at">At a time…</button>
      </div>
      <div class="sched-mode" data-mode="in">
        <div class="sched-presets">
          <button data-h="1" data-m="0">+1h</button>
          <button data-h="5" data-m="0">+5h</button>
          <button data-h="6" data-m="0">+6h</button>
        </div>
        <div class="sched-duration">
          <input type="number" id="sched-hours" min="0" max="72" value="5"><span>h</span>
          <input type="number" id="sched-mins" min="0" max="59" value="0"><span>m</span>
        </div>
      </div>
      <div class="sched-mode" data-mode="at" hidden>
        <input type="time" id="sched-time">
        <div class="sched-at-hint">If that time has already passed today, it's scheduled for tomorrow.</div>
      </div>
      <div id="sched-preview" class="sched-preview"></div>
      <div class="sched-actions">
        <button id="sched-cancel">Cancel</button>
        <button id="sched-confirm" class="primary">Schedule</button>
      </div>
    </div>`;
  document.body.appendChild(schedDialogEl);

  schedDialogEl.addEventListener('mousedown', (e) => { if (e.target === schedDialogEl) closeScheduleDialog(); });
  schedDialogEl.querySelectorAll('.sched-tabs button').forEach(b =>
    b.addEventListener('click', () => schedSetMode(b.dataset.mode)));
  schedDialogEl.querySelectorAll('.sched-presets button').forEach(b =>
    b.addEventListener('click', () => {
      schedDialogEl.querySelector('#sched-hours').value = b.dataset.h;
      schedDialogEl.querySelector('#sched-mins').value = b.dataset.m;
      schedUpdatePreview();
    }));
  schedDialogEl.querySelectorAll('#sched-hours, #sched-mins, #sched-time').forEach(i =>
    i.addEventListener('input', schedUpdatePreview));
  schedDialogEl.querySelector('#sched-cancel').addEventListener('click', closeScheduleDialog);
  schedDialogEl.querySelector('#sched-confirm').addEventListener('click', confirmSchedule);
  schedDialogEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeScheduleDialog(); }
    else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); confirmSchedule(); }
  });
}

function openScheduleDialog() {
  // Only meaningful for the active session and a live terminal tab.
  if (typeof isActiveSession !== 'undefined' && !isActiveSession) return;
  const tab = activePane?.activeTab;
  if (!tab || tab.type !== 'terminal' || !tab.ptyId) {
    if (typeof showToast === 'function') showToast('Open a terminal tab to schedule an Enter press');
    return;
  }
  if (tab.schedule) { if (typeof showToast === 'function') showToast('This tab already has an Enter scheduled'); return; }

  if (!schedDialogEl) buildScheduleDialog();
  schedTargetTab = tab;
  // Default the clock field to roughly five hours out — the common quota window.
  const def = new Date(Date.now() + 5 * 3600000);
  schedDialogEl.querySelector('#sched-time').value =
    `${String(def.getHours()).padStart(2, '0')}:${String(def.getMinutes()).padStart(2, '0')}`;
  schedSetMode('in');
  schedDialogEl.hidden = false;
  schedDialogEl.querySelector('#sched-hours').focus();
}

function closeScheduleDialog() {
  if (!schedDialogEl || schedDialogEl.hidden) return;
  schedDialogEl.hidden = true;
  schedTargetTab = null;
  activePane?.activeTab?.term?.focus();
}

function confirmSchedule() {
  const fireAt = schedComputeFireAt();
  const tab = schedTargetTab;
  if (!fireAt || !tab) return;
  closeScheduleDialog();
  // The tab may have been closed/replaced while the dialog was open. The server
  // arms the timer and echoes schedule:state, which renders the lock overlay.
  if (tab.ptyId && tab.viewEl.isConnected) {
    wsSend({ type: 'schedule:create', ptyId: tab.ptyId, fireAt: fireAt.getTime() });
  }
}

// Toolbar button (script runs at end of <body>, so the DOM is ready).
document.getElementById('btn-schedule')?.addEventListener('click', openScheduleDialog);

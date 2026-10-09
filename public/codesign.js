// ── CoDesign tab ────────────────────────────────────────────────────────────
// Reviews a living HTML design spec that an agent writes to
// `<dir>/.codesign/spec.html`. The tab renders it in a sandboxed iframe inside a
// device frame, lets you inspect elements and drop comment pins, then either
// "Send feedback" or "Approve & sign off". The agent picks the outcome up with
// `mtx review` (see bin/mtx and codesign-service.js).
//
// The iframe is sandboxed without allow-same-origin (agent-written HTML must not
// get the Meowtrix origin), so this file never touches the spec's DOM — it talks
// to the inspector injected into the page (codesign-inspector.js) via
// postMessage. All review state (revision, comments, decision) lives on the
// server in `.codesign/review.json`; this tab is a renderer of
// `/api/codesign/state`, refreshed on `codesign:update` broadcasts.

const CODESIGN_DEVICES = {
  responsive: { label: 'Responsive', w: null, h: null },
  desktop: { label: 'Desktop', w: 1440, h: 900 },
  tablet: { label: 'Tablet', w: 768, h: 1024 },
  mobile: { label: 'Mobile', w: 390, h: 844 },
};

const CODESIGN_STATUS = {
  drafting: ['Waiting for spec', 'neutral'],
  'in-review': ['Ready for review', 'review'],
  'changes-requested': ['Changes requested', 'changes'],
  approved: ['Approved', 'approved'],
};

const codesignTabs = new Set();

function codesignEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function codesignApi(method, route, dir, body) {
  const url = `/api/codesign/${route}${method === 'GET' ? `${route.includes('?') ? '&' : '?'}dir=${encodeURIComponent(dir)}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify({ dir, ...(body || {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function initCodesignTab(tab, viewEl, dir) {
  viewEl.classList.add('codesign-view');
  tab.codesignDir = dir || '';
  if (dir && !tab.isCustomLabel) tab.label.textContent = `Spec: ${dir.split('/').filter(Boolean).pop() || dir}`;

  const cs = tab.codesign = {
    dir: tab.codesignDir,
    state: null,
    mode: 'comment',
    device: 'responsive',
    zoom: null,          // null = fit to stage
    drawerOpen: true,
    loadedSrc: null,
    frameReady: false,
    scroll: { x: 0, y: 0 },
    activePin: null,
    showResolved: false,
  };

  if (window.DEMO_MODE || !dir) {
    viewEl.innerHTML = `<div class="codesign-empty"><h2>CoDesign</h2><p>${window.DEMO_MODE ? 'CoDesign needs a Meowtrix server — it isn’t available in the demo.' : 'No project folder.'}</p></div>`;
    return;
  }

  viewEl.innerHTML = `
    <div class="codesign-toolbar">
      <div class="cd-seg cd-device" role="group" aria-label="Device">
        ${Object.entries(CODESIGN_DEVICES).map(([k, d]) => `<button data-device="${k}" title="${d.w ? `${d.label} — ${d.w}×${d.h}` : 'Fill the pane'}">${d.label}</button>`).join('')}
      </div>
      <div class="cd-zoom">
        <button data-zoom="out" title="Zoom out">−</button>
        <button data-zoom="fit" class="cd-zoom-label" title="Fit to pane">Fit</button>
        <button data-zoom="in" title="Zoom in">+</button>
      </div>
      <div class="cd-seg cd-mode" role="group" aria-label="Mode">
        <button data-mode="preview" title="Interact with the page normally">Preview</button>
        <button data-mode="inspect" title="Hover to see sizes, typography and colors">Inspect</button>
        <button data-mode="comment" title="Click an element to leave a comment pin">Comment</button>
      </div>
      <span class="cd-spacer"></span>
      <button class="cd-icon-btn cd-reload" title="Reload spec">Reload</button>
      <button class="cd-icon-btn cd-drawer-toggle" title="Toggle comments">💬 <span class="cd-count"></span></button>
    </div>
    <div class="codesign-body">
      <div class="codesign-stage">
        <div class="codesign-frame-wrap"><div class="codesign-frame"><iframe class="codesign-iframe" title="Design spec"></iframe></div></div>
        <div class="codesign-empty cd-empty-state" hidden></div>
        <div class="codesign-composer" hidden>
          <div class="cd-composer-target"></div>
          <textarea rows="3" placeholder="What should change here?  (Enter to add · Shift+Enter for newline)"></textarea>
          <div class="cd-composer-actions"><button class="cd-btn cd-cancel">Cancel</button><button class="cd-btn cd-primary cd-add">Add comment</button></div>
        </div>
      </div>
      <aside class="codesign-drawer"></aside>
    </div>
    <div class="codesign-footer">
      <span class="cd-status"></span>
      <span class="cd-rev"></span>
      <span class="cd-agent" hidden><span class="cd-pulse"></span>Agent is waiting for your review</span>
      <span class="cd-spacer"></span>
      <input class="cd-note" type="text" placeholder="Note for the agent (optional)" maxlength="2000">
      <button class="cd-btn cd-send" disabled>Send feedback</button>
      <button class="cd-btn cd-primary cd-approve" disabled>Approve &amp; sign off</button>
    </div>`;

  const $ = (sel) => viewEl.querySelector(sel);
  const stage = $('.codesign-stage');
  const wrap = $('.codesign-frame-wrap');
  const frameBox = $('.codesign-frame');
  const iframe = $('.codesign-iframe');
  const emptyEl = $('.cd-empty-state');
  const composer = $('.codesign-composer');
  const composerText = composer.querySelector('textarea');
  const drawer = $('.codesign-drawer');
  const noteInput = $('.cd-note');
  let pendingPick = null;

  const send = (msg) => { try { iframe.contentWindow?.postMessage({ __codesign: 1, ...msg }, '*'); } catch {} };

  // ── Layout: device frame + zoom ───────────────────────────────────────────
  function layoutFrame() {
    const d = CODESIGN_DEVICES[cs.device];
    viewEl.querySelectorAll('[data-device]').forEach(b => b.classList.toggle('active', b.dataset.device === cs.device));
    viewEl.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === cs.mode));
    viewEl.classList.toggle('cd-drawer-hidden', !cs.drawerOpen);
    const zoomBox = $('.cd-zoom');
    if (!d.w) {
      stage.classList.add('responsive');
      cs.scale = 1;
      if (cs.sentScale !== 1) { cs.sentScale = 1; send({ cmd: 'scale', scale: 1 }); }
      frameBox.style.cssText = 'width:100%;height:100%;transform:none;';
      wrap.style.cssText = 'width:100%;height:100%;';
      zoomBox.classList.add('disabled');
      $('.cd-zoom-label').textContent = '100%';
      return;
    }
    stage.classList.remove('responsive');
    zoomBox.classList.remove('disabled');
    const pad = 32;
    const fit = Math.min(1, (stage.clientWidth - pad) / d.w, (stage.clientHeight - pad) / d.h);
    const scale = Math.max(0.1, cs.zoom ?? fit);
    cs.scale = scale;
    frameBox.style.cssText = `width:${d.w}px;height:${d.h}px;transform:scale(${scale});`;
    wrap.style.cssText = `width:${Math.round(d.w * scale)}px;height:${Math.round(d.h * scale)}px;`;
    $('.cd-zoom-label').textContent = cs.zoom == null ? `Fit ${Math.round(scale * 100)}%` : `${Math.round(scale * 100)}%`;
    if (scale !== cs.sentScale) { cs.sentScale = scale; send({ cmd: 'scale', scale }); }
  }

  function setZoom(z) {
    cs.zoom = z == null ? null : Math.min(2, Math.max(0.1, Math.round(z * 100) / 100));
    layoutFrame();
  }

  viewEl.querySelectorAll('[data-device]').forEach(b => b.addEventListener('click', () => { cs.device = b.dataset.device; cs.zoom = null; hideComposer(); layoutFrame(); }));
  viewEl.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { cs.mode = b.dataset.mode; send({ cmd: 'mode', mode: cs.mode }); hideComposer(); layoutFrame(); }));
  viewEl.querySelector('[data-zoom="in"]').addEventListener('click', () => setZoom((cs.scale || 1) + 0.1));
  viewEl.querySelector('[data-zoom="out"]').addEventListener('click', () => setZoom((cs.scale || 1) - 0.1));
  viewEl.querySelector('[data-zoom="fit"]').addEventListener('click', () => setZoom(null));
  stage.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey) || stage.classList.contains('responsive')) return;
    e.preventDefault();
    setZoom((cs.scale || 1) * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  }, { passive: false });
  $('.cd-reload').addEventListener('click', () => loadFrame(true));
  $('.cd-drawer-toggle').addEventListener('click', () => { cs.drawerOpen = !cs.drawerOpen; layoutFrame(); });

  // ── Spec iframe ───────────────────────────────────────────────────────────
  function loadFrame(force) {
    const s = cs.state;
    if (!s || !s.exists) return;
    const src = `${s.specUrl}?r=${s.revision}`;
    if (!force && src === cs.loadedSrc) return;
    cs.loadedSrc = src;
    cs.frameReady = false;
    iframe.setAttribute('sandbox', s.sandbox);
    iframe.src = force ? `${src}&t=${Date.now()}` : src;
  }

  function pushPins() {
    const comments = cs.state?.comments || [];
    const pins = comments
      .filter(c => cs.showResolved || c.status !== 'resolved')
      .map(c => ({ id: c.id, n: c.id.replace(/^c/, ''), selector: c.selector, ox: c.ox, oy: c.oy, x: c.x, y: c.y, status: c.status, sent: c.sent, comment: c.comment, active: c.id === cs.activePin }));
    send({ cmd: 'pins', pins });
  }

  function onMessage(e) {
    if (e.source !== iframe.contentWindow || !e.data || e.data.__codesign !== 1) return;
    const m = e.data;
    if (m.evt === 'ready') {
      cs.frameReady = true;
      send({ cmd: 'mode', mode: cs.mode });
      send({ cmd: 'scale', scale: cs.scale || 1 });
      pushPins();
      if (cs.scroll.x || cs.scroll.y) send({ cmd: 'scrollTo', x: cs.scroll.x, y: cs.scroll.y });
    } else if (m.evt === 'scroll') {
      cs.scroll = { x: m.x, y: m.y };
      hideComposer();
    } else if (m.evt === 'pick') {
      showComposer(m);
    } else if (m.evt === 'pinClick') {
      focusComment(m.id);
    }
  }
  window.addEventListener('message', onMessage);

  // ── Composer ──────────────────────────────────────────────────────────────
  function showComposer(pick) {
    pendingPick = pick;
    const fr = iframe.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const scale = stage.classList.contains('responsive') ? 1 : (cs.scale || 1);
    let left = fr.left - sr.left + stage.scrollLeft + pick.clientX * scale + 10;
    let top = fr.top - sr.top + stage.scrollTop + pick.clientY * scale + 10;
    composer.hidden = false;
    const w = composer.offsetWidth, h = composer.offsetHeight;
    left = Math.min(left, stage.scrollLeft + stage.clientWidth - w - 8);
    top = Math.min(top, stage.scrollTop + stage.clientHeight - h - 8);
    composer.style.left = Math.max(8, left) + 'px';
    composer.style.top = Math.max(8, top) + 'px';
    composer.querySelector('.cd-composer-target').innerHTML =
      `<code>${codesignEsc(pick.selector.split(' > ').slice(-2).join(' > ') || pick.tag)}</code>${pick.text ? ` <span>“${codesignEsc(pick.text.slice(0, 60))}”</span>` : ''}`;
    composerText.value = '';
    setTimeout(() => composerText.focus(), 0);
  }

  function hideComposer() {
    composer.hidden = true;
    pendingPick = null;
  }

  async function submitComposer() {
    const text = composerText.value.trim();
    if (!text || !pendingPick) return;
    const p = pendingPick;
    hideComposer();
    try {
      const { comment } = await codesignApi('POST', 'comments', cs.dir, {
        comment: text, selector: p.selector, tag: p.tag, text: p.text,
        ox: p.ox, oy: p.oy, x: p.x, y: p.y, viewportW: p.viewportW, device: cs.device,
      });
      cs.activePin = comment.id;
      await refresh();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Could not add comment: ' + err.message);
    }
  }

  composer.querySelector('.cd-add').addEventListener('click', submitComposer);
  composer.querySelector('.cd-cancel').addEventListener('click', hideComposer);
  composerText.addEventListener('keydown', (e) => {
    e.stopPropagation(); // keep app shortcuts out of the textarea
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitComposer(); }
    else if (e.key === 'Escape') { e.preventDefault(); hideComposer(); }
  });

  // ── Drawer ────────────────────────────────────────────────────────────────
  function focusComment(id) {
    cs.activePin = id;
    if (!cs.drawerOpen) { cs.drawerOpen = true; layoutFrame(); }
    const c = cs.state?.comments.find(x => x.id === id);
    if (c?.status === 'resolved' && !cs.showResolved) cs.showResolved = true;
    renderDrawer();
    pushPins();
    send({ cmd: 'focus', id });
    drawer.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function commentHtml(c) {
    const actions = [];
    if (!c.sent && c.status === 'open') actions.push(`<button data-act="delete" title="Delete">Delete</button>`);
    if (c.sent && c.status === 'open') actions.push(`<button data-act="resolve">Resolve</button>`);
    if (c.status === 'resolved') actions.push(`<button data-act="reopen">Reopen</button>`);
    const kind = c.status === 'resolved' ? 'resolved' : c.sent ? 'sent' : 'draft';
    return `<div class="cd-comment ${kind}${c.id === cs.activePin ? ' active' : ''}" data-id="${c.id}">
      <div class="cd-comment-head"><span class="cd-pin-badge ${kind}">${codesignEsc(c.id.replace(/^c/, ''))}</span>
        <code class="cd-comment-sel" title="${codesignEsc(c.selector)}">${codesignEsc((c.selector || c.tag || '').split(' > ').pop())}</code>
        <span class="cd-comment-actions">${actions.join('')}</span></div>
      <div class="cd-comment-body">${codesignEsc(c.comment)}</div>
      ${c.resolution ? `<div class="cd-comment-resolution">↳ ${codesignEsc(c.resolution)}</div>` : ''}
    </div>`;
  }

  function renderDrawer() {
    const comments = cs.state?.comments || [];
    const drafts = comments.filter(c => c.status === 'open' && !c.sent);
    const sent = comments.filter(c => c.status === 'open' && c.sent);
    const resolved = comments.filter(c => c.status === 'resolved');
    const section = (title, items, hint) => items.length ? `<div class="cd-section"><div class="cd-section-title">${title} <span>${items.length}</span></div>${hint ? `<div class="cd-section-hint">${hint}</div>` : ''}${items.map(commentHtml).join('')}</div>` : '';
    drawer.innerHTML =
      `<div class="cd-drawer-head">Comments</div>` +
      (comments.length ? '' : `<div class="cd-drawer-empty">No comments yet. Switch to <b>Comment</b> mode and click anything in the design.</div>`) +
      section('Not sent yet', drafts, 'Delivered to the agent when you press “Send feedback”.') +
      section('With the agent', sent) +
      (resolved.length ? `<button class="cd-toggle-resolved">${cs.showResolved ? 'Hide' : 'Show'} ${resolved.length} resolved</button>` : '') +
      (cs.showResolved ? section('Resolved', resolved) : '');
    $('.cd-count').textContent = drafts.length + sent.length || '';
  }

  drawer.addEventListener('click', async (e) => {
    if (e.target.closest('.cd-toggle-resolved')) { cs.showResolved = !cs.showResolved; renderDrawer(); pushPins(); return; }
    const item = e.target.closest('.cd-comment');
    if (!item) return;
    const id = item.dataset.id;
    const act = e.target.closest('[data-act]')?.dataset.act;
    try {
      if (act === 'delete') await codesignApi('DELETE', `comments/${id}`, cs.dir);
      else if (act === 'resolve') await codesignApi('POST', 'resolve', cs.dir, { ids: [id] });
      else if (act === 'reopen') await codesignApi('POST', 'resolve', cs.dir, { ids: [id], reopen: true });
      else { focusComment(id); return; }
      await refresh();
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message);
    }
  });

  // ── Footer: status + decisions ────────────────────────────────────────────
  function renderFooter() {
    const s = cs.state;
    const [label, kind] = CODESIGN_STATUS[s?.exists ? s.status : 'drafting'] || CODESIGN_STATUS.drafting;
    const statusEl = $('.cd-status');
    statusEl.textContent = label;
    statusEl.className = `cd-status ${kind}`;
    $('.cd-rev').textContent = s?.exists ? `Revision ${s.revision}` : '';
    $('.cd-agent').hidden = !s?.agentWaiting;
    const unsent = (s?.comments || []).filter(c => c.status === 'open' && !c.sent).length;
    const sendBtn = $('.cd-send');
    sendBtn.disabled = !s?.exists || !unsent;
    sendBtn.textContent = unsent ? `Send feedback (${unsent})` : 'Send feedback';
    const approveBtn = $('.cd-approve');
    approveBtn.disabled = !s?.exists || (s.status === 'approved' && s.decision?.revision === s.revision);
    approveBtn.textContent = approveBtn.disabled && s?.exists ? 'Signed off ✓' : 'Approve & sign off';
  }

  async function decide(type) {
    const unsent = (cs.state?.comments || []).filter(c => c.status === 'open' && !c.sent).length;
    if (type === 'approved' && unsent && !confirm(`You have ${unsent} unsent comment${unsent > 1 ? 's' : ''}. Approve anyway? They'll be sent along with the approval.`)) return;
    try {
      await codesignApi('POST', 'decision', cs.dir, { type, note: noteInput.value });
      noteInput.value = '';
      if (typeof showToast === 'function') {
        showToast(type === 'approved' ? 'Design approved & signed off' : `Feedback sent${cs.state?.agentWaiting ? ' to the waiting agent' : ' — the agent gets it on its next `mtx review`'}`);
      }
      await refresh();
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message);
    }
  }
  $('.cd-send').addEventListener('click', () => decide('changes'));
  $('.cd-approve').addEventListener('click', () => decide('approved'));
  noteInput.addEventListener('keydown', (e) => e.stopPropagation());

  // ── Empty state (no spec yet) ─────────────────────────────────────────────
  function renderEmpty() {
    const exists = !!cs.state?.exists;
    emptyEl.hidden = exists;
    wrap.hidden = !exists;
    viewEl.classList.toggle('cd-no-spec', !exists);
    if (exists) return;
    const prompt = `Design this as a single self-contained HTML file at ${cs.dir}/.codesign/spec.html (inline CSS/JS or CDN links; put any images in .codesign/assets/). Then run \`mtx review\` with a 10-minute tool timeout and wait: it blocks until I approve or send comments. If I send comments, update the spec, run \`mtx resolve <id>\` for each one you addressed, and run \`mtx review\` again. Stop once it prints APPROVED.`;
    emptyEl.innerHTML = `
      <div class="cd-empty-card">
        <div class="cd-empty-icon">${typeof getTabIconSvg === 'function' ? getTabIconSvg('codesign') : ''}</div>
        <h2>Waiting for a design spec</h2>
        <p>Have an agent write <code>.codesign/spec.html</code> in <code>${codesignEsc(cs.dir)}</code>. It appears here as soon as the file exists.</p>
        <p class="cd-empty-sub">Paste this into Claude Code, Codex, or any agent running in a Meowtrix terminal:</p>
        <pre class="cd-prompt">${codesignEsc(prompt)}</pre>
        <button class="cd-btn cd-primary cd-copy">Copy prompt</button>
      </div>`;
    emptyEl.querySelector('.cd-copy').addEventListener('click', async (e) => {
      try { await navigator.clipboard.writeText(prompt); e.target.textContent = 'Copied ✓'; }
      catch { e.target.textContent = 'Copy failed — select the text'; }
    });
  }

  // ── State sync ────────────────────────────────────────────────────────────
  let refreshing = null;
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        cs.state = await codesignApi('GET', 'state', cs.dir);
      } catch (err) {
        cs.state = cs.state || null;
      }
      renderEmpty();
      renderDrawer();
      renderFooter();
      loadFrame(false);
      if (cs.frameReady) pushPins();
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  cs.refresh = refresh;

  const ro = new ResizeObserver(() => layoutFrame());
  ro.observe(stage);
  tab.onActivate = () => layoutFrame();
  tab.disposeCodesign = () => {
    ro.disconnect();
    window.removeEventListener('message', onMessage);
    codesignTabs.delete(tab);
  };
  codesignTabs.add(tab);

  layoutFrame();
  refresh();
}

// `codesign:update` broadcast — some project's review state changed.
function onCodesignUpdate(dir) {
  codesignTabs.forEach(t => { if (t.codesign?.dir === dir) t.codesign.refresh?.(); });
}

// After a reconnect the state may have moved on while we were away.
function refreshAllCodesignTabs() {
  codesignTabs.forEach(t => t.codesign?.refresh?.());
}

// Show (or open) a CoDesign tab for `dir`. From `mtx spec` / `mtx review`
// (via the server's `codesign:open` broadcast), the palette and the tab picker.
// Prefers a pane other than the focused one, so the agent's terminal stays
// visible next to the spec.
function triggerOpenCodesign(dir, { fromAgent = false } = {}) {
  if (!dir) return;
  if (fromAgent && typeof isActiveSession !== 'undefined' && !isActiveSession) return;
  for (const p of getAllPanes()) {
    const existing = p.tabs.find(t => t.type === 'codesign' && t.codesignDir === dir);
    if (existing) { activateTab(p, existing.id); return; }
  }
  let pane = activePane || getAllPanes()[0];
  if (!pane) return;
  if (fromAgent) {
    const others = getAllPanes().filter(p => p !== pane);
    pane = others.length ? others[others.length - 1] : splitPane(pane, 'vertical', { empty: true });
  }
  addTab(pane, 'codesign', undefined, undefined, undefined, dir);
  saveSessionState();
}

function onCodesignOpen(dir) {
  triggerOpenCodesign(dir, { fromAgent: true });
}

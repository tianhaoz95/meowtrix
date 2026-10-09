// Plays the candidates in candidates.js on mock stages (grid cards + a focus view).

const DESIGN_W = 1280;
const OUT_SCALE = 0.55;                       // mirrored dismisses run at 55% of the summon's length
const OUT_EASE = 'cubic-bezier(0.5, 0, 0.75, 0)';
const STORE_KEY = 'meowtrix-overlay-anim-shortlist';

let speed = 1;
let loop = false;
const players = new Set();
let focusIndex = -1;          // focus view state (see bottom of file)
let focusPlayer = null;
let speedBeforeSlowmo = null;

// ---------- timing helpers ----------

// Give every keyframe an explicit offset (WAAPI spaces unset ones evenly between set ones).
function withOffsets(frames) {
  const out = frames.map(f => ({ ...f }));
  out[0].offset ??= 0;
  out[out.length - 1].offset ??= 1;
  let last = 0;
  for (let i = 1; i < out.length; i++) {
    if (out[i].offset == null) continue;
    const gap = i - last;
    for (let j = last + 1; j < i; j++) {
      out[j].offset = out[last].offset + ((out[i].offset - out[last].offset) * (j - last)) / gap;
    }
    last = i;
  }
  return out;
}

function reverseFrames(frames) {
  return withOffsets(frames)
    .reverse()
    .map(({ easing, ...f }) => ({ ...f, offset: +(1 - f.offset).toFixed(4) }));
}

// Expand a candidate's tracks into concrete per-element animations for one stage.
function plan(stage, cand, dir) {
  const expand = tracks => tracks.flatMap(tr => {
    const els = [...stage.querySelectorAll(tr.t)];
    return els.map((el, i) => ({
      el,
      k: tr.k,
      d: tr.d,
      delay: (tr.delay || 0) + i * (tr.stagger || 0),
      e: tr.e || 'linear',
    }));
  });

  if (dir === 'in') return expand(cand.in);
  if (cand.out) return expand(cand.out);

  // Mirror of the summon: reversed keyframes, reversed schedule, faster, accelerating.
  const fwd = expand(cand.in);
  const total = Math.max(...fwd.map(a => a.delay + a.d));
  return fwd.map(a => ({
    el: a.el,
    k: reverseFrames(a.k),
    d: a.d * OUT_SCALE,
    delay: (total - (a.delay + a.d)) * OUT_SCALE,
    e: OUT_EASE,
  }));
}

const planLength = steps => Math.round(Math.max(...steps.map(s => s.delay + s.d)));

// ---------- player: one stage + one candidate ----------

class Player {
  constructor(box, cand, onState) {
    this.box = box;
    this.stage = box.querySelector('.stage');
    this.cand = cand;
    this.onState = onState || (() => {});
    this.shown = false;
    this.anims = [];
    this.loopTimer = null;
    new ResizeObserver(() => {
      this.stage.style.setProperty('--k', String(box.clientWidth / DESIGN_W));
    }).observe(box);
    this.run('out', true);
    players.add(this);
  }

  get running() {
    return this.anims.some(a => a.playState === 'running');
  }

  run(dir, instant = false) {
    clearTimeout(this.loopTimer);
    this.anims.forEach(a => a.cancel());
    this.shown = dir === 'in';
    this.anims = plan(this.stage, this.cand, dir).map(s => {
      const a = s.el.animate(s.k, { duration: s.d, delay: s.delay, easing: s.e, fill: 'both' });
      a.playbackRate = speed;
      if (instant) a.finish();
      return a;
    });
    this.onState(this.shown);
    if (!instant) this.afterFinish();
  }

  // Interrupting mid-flight reverses the running animation instead of jumping.
  toggle() {
    if (this.running) {
      clearTimeout(this.loopTimer);
      this.anims.forEach(a => a.reverse());
      this.shown = !this.shown;
      this.onState(this.shown);
      this.afterFinish();
    } else {
      this.run(this.shown ? 'out' : 'in');
    }
  }

  replay() {
    this.run('out', true);
    requestAnimationFrame(() => this.run('in'));
  }

  afterFinish() {
    const anims = this.anims;
    Promise.all(anims.map(a => a.finished)).then(() => {
      if (anims !== this.anims || !loop || !this.looping()) return;
      this.loopTimer = setTimeout(() => this.toggle(), (this.shown ? 1100 : 500) / speed);
    }, () => {});
  }

  looping() {
    return this.box.isConnected && this.box.offsetParent !== null;
  }

  kick() {
    if (loop && !this.running) this.loopTimer = setTimeout(() => this.toggle(), 200);
  }

  setSpeed(s) {
    this.anims.forEach(a => { a.playbackRate = s; });
  }

  dispose() {
    clearTimeout(this.loopTimer);
    this.anims.forEach(a => a.cancel());
    players.delete(this);
  }
}

// ---------- shortlist ----------

function loadShortlist() {
  try { return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || '[]')); } catch { return new Set(); }
}
const shortlist = loadShortlist();
function saveShortlist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify([...shortlist])); } catch {}
}
function toggleStar(id) {
  shortlist.has(id) ? shortlist.delete(id) : shortlist.add(id);
  saveShortlist();
  renderShortlist();
}

function renderShortlist() {
  const bar = document.getElementById('shortlist');
  const items = document.getElementById('shortlist-items');
  items.innerHTML = '';
  CANDIDATES.forEach((c, i) => {
    const card = document.querySelector(`.card[data-id="${c.id}"]`);
    const on = shortlist.has(c.id);
    card.classList.toggle('starred', on);
    card.querySelector('.star').textContent = on ? '★' : '☆';
    if (on) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `#${i} ${c.name}`;
      chip.onclick = () => openFocus(i);
      items.append(chip, ' ');
    }
  });
  bar.hidden = shortlist.size === 0;
  if (focusIndex >= 0) {
    document.getElementById('focus-kicker').textContent = focusKicker(focusIndex);
  }
}

// ---------- grid ----------

const tpl = document.getElementById('stage-tpl');
const newStage = () => tpl.content.firstElementChild.cloneNode(true);
const label = i => (i === 0 ? 'Baseline' : `#${i}`);

const gridPlayers = [];
const grid = document.getElementById('grid');

CANDIDATES.forEach((cand, i) => {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = cand.id;
  const box = newStage();
  card.appendChild(box);

  const body = document.createElement('div');
  body.className = 'card-body';
  body.innerHTML = `
    <div class="card-head">
      <span class="card-num">${label(i)}</span>
      <span class="card-name">${cand.name}</span>
    </div>
    <div class="card-tag">${cand.tag}</div>
    <p class="card-desc">${cand.desc}</p>
    <div class="card-meta"></div>
    <div class="card-actions">
      <button class="btn primary" data-act="toggle">Summon</button>
      <button class="btn" data-act="replay">Replay</button>
      <span class="grow"></span>
      <button class="btn" data-act="star" title="Add to shortlist"><span class="star">☆</span></button>
      <button class="btn" data-act="focus">Focus ⤢</button>
    </div>`;
  card.appendChild(body);
  grid.appendChild(card);

  const toggleBtn = body.querySelector('[data-act="toggle"]');
  const player = new Player(box, cand, shown => { toggleBtn.textContent = shown ? 'Dismiss' : 'Summon'; });
  gridPlayers.push(player);

  const stage = box.querySelector('.stage');
  body.querySelector('.card-meta').innerHTML =
    `<span class="chip-s">summon ${planLength(plan(stage, cand, 'in'))}ms</span>` +
    `<span class="chip-s">dismiss ${planLength(plan(stage, cand, 'out'))}ms</span>` +
    (cand.in.some(t => /linear\(/.test(t.e || '') || t.k.some(f => /linear\(/.test(f.easing || ''))) ? '<span class="chip-s">spring</span>' : '');

  toggleBtn.onclick = () => player.toggle();
  body.querySelector('[data-act="replay"]').onclick = () => player.replay();
  body.querySelector('[data-act="star"]').onclick = () => toggleStar(cand.id);
  body.querySelector('[data-act="focus"]').onclick = () => openFocus(i);
  box.onclick = () => player.toggle();
});
renderShortlist();

// ---------- global controls ----------

document.getElementById('summon-all').onclick = () =>
  gridPlayers.forEach(p => { if (!p.shown) p.toggle(); });
document.getElementById('dismiss-all').onclick = () =>
  gridPlayers.forEach(p => { if (p.shown) p.toggle(); });

const speedSeg = document.getElementById('speed');
function setSpeed(s) {
  speed = s;
  speedSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.speed) === s));
  players.forEach(p => p.setSpeed(s));
}
speedSeg.addEventListener('click', e => {
  const b = e.target.closest('button[data-speed]');
  if (b) setSpeed(Number(b.dataset.speed));
});

document.getElementById('loop').addEventListener('change', e => {
  loop = e.target.checked;
  players.forEach(p => (loop ? p.kick() : clearTimeout(p.loopTimer)));
});

// ---------- focus view ----------

const focus = document.getElementById('focus');
const focusWrap = document.getElementById('focus-stage-wrap');
const focusToggleBtn = document.getElementById('focus-toggle');

const focusKicker = i =>
  `${label(i)} of ${CANDIDATES.length - 1}${shortlist.has(CANDIDATES[i].id) ? '  ·  ★ shortlisted' : ''}`;

function openFocus(i) {
  focusIndex = (i + CANDIDATES.length) % CANDIDATES.length;
  const cand = CANDIDATES[focusIndex];
  if (focusPlayer) focusPlayer.dispose();
  focusWrap.innerHTML = '';
  const box = newStage();
  focusWrap.appendChild(box);
  document.getElementById('focus-kicker').textContent = focusKicker(focusIndex);
  document.getElementById('focus-name').textContent = cand.name;
  document.getElementById('focus-desc').textContent = cand.desc;
  focus.hidden = false;
  gridPlayers.forEach(p => clearTimeout(p.loopTimer));
  focusPlayer = new Player(box, cand, shown => { focusToggleBtn.textContent = shown ? 'Dismiss' : 'Summon'; });
  box.onclick = () => focusPlayer.toggle();
  // play it once on open so switching candidates shows them immediately
  setTimeout(() => focusPlayer && focusPlayer.run('in'), 250);
}

function closeFocus() {
  focus.hidden = true;
  focusIndex = -1;
  if (focusPlayer) focusPlayer.dispose();
  focusPlayer = null;
  focusWrap.innerHTML = '';
  if (loop) gridPlayers.forEach(p => p.kick());
}

document.getElementById('focus-close').onclick = closeFocus;
document.getElementById('focus-prev').onclick = () => openFocus(focusIndex - 1);
document.getElementById('focus-next').onclick = () => openFocus(focusIndex + 1);
focusToggleBtn.onclick = () => focusPlayer && focusPlayer.toggle();
focus.addEventListener('click', e => { if (e.target === focus) closeFocus(); });

document.addEventListener('keydown', e => {
  if (focus.hidden) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) focusPlayer.toggle();
  } else if (e.key === 'ArrowRight') {
    openFocus(focusIndex + 1);
  } else if (e.key === 'ArrowLeft') {
    openFocus(focusIndex - 1);
  } else if (e.key === 'Escape') {
    closeFocus();
  } else if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey) {
    if (speedBeforeSlowmo == null) { speedBeforeSlowmo = speed; setSpeed(0.25); }
    else { setSpeed(speedBeforeSlowmo); speedBeforeSlowmo = null; }
  } else if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey) {
    toggleStar(CANDIDATES[focusIndex].id);
  }
});

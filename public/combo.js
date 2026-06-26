// ── Keystroke combo FX ───────────────────────────────────────────────────────
// A purely cosmetic layer that rewards typing streaks: every keystroke feeds a
// combo counter that decays when you stop. The longer the streak *and* the
// faster you type, the higher the "intensity" (0..1), which drives every visual
// — particle bursts, a heat-tinted combo readout, an edge glow, and (at the top
// end) a screen shake. It listens at the document level so it catches keystrokes
// from any focused terminal (xterm's hidden textarea bubbles keydowns here),
// the browser URL bar, settings inputs, etc. Nothing here touches PTY input.

(function () {
  // Tunables.
  const RESET_MS    = 1400;   // streak drops to 0 after this long with no key
  const MIN_COMBO   = 4;      // below this, stay invisible (casual typing)
  const COMBO_NORM  = 45;     // combo count that maps to "max" on its own
  const SPEED_NORM  = 14;     // keys/sec that maps to "max" speed
  const HUE_HOT     = 0;      // red
  const HUE_COOL    = 205;    // cyan-blue

  // Streak state.
  let combo = 0;
  let lastHitAt = 0;
  let intensity = 0;          // smoothed 0..1, drives all visuals
  let targetIntensity = 0;
  const hits = [];            // recent keystroke timestamps (for speed)
  let enabled = false; // opt-in; synced from the persisted comboFx setting on boot

  // Effect surfaces (created on boot).
  let canvas, ctx, hud, hudCount, hudTier, glow;
  let particles = [];
  let rafId = null;
  let dpr = Math.max(1, window.devicePixelRatio || 1);

  const TIERS = [
    { at: 55, label: 'MELTDOWN' },
    { at: 38, label: 'INFERNO' },
    { at: 24, label: 'BLAZING' },
    { at: 13, label: 'ON FIRE' },
    { at: MIN_COMBO, label: 'HEATING UP' },
  ];

  const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
  const heatHue = (i) => HUE_COOL + (HUE_HOT - HUE_COOL) * i; // cool → hot

  function build() {
    canvas = document.createElement('canvas');
    canvas.id = 'combo-canvas';
    glow = document.createElement('div');
    glow.id = 'combo-glow';
    hud = document.createElement('div');
    hud.id = 'combo-hud';
    hudCount = document.createElement('div');
    hudCount.id = 'combo-count';
    hudTier = document.createElement('div');
    hudTier.id = 'combo-tier';
    hud.append(hudCount, hudTier);
    document.body.append(glow, canvas, hud);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('keydown', onKey, true);
  }

  function resize() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
  }

  // The combo readout sits bottom-right; particles erupt from there so the burst
  // and the number read as one object.
  function anchor() {
    const r = hud.getBoundingClientRect();
    return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
                   : { x: window.innerWidth - 90, y: window.innerHeight - 70 };
  }

  function typingSpeed() {
    if (hits.length < 2) return 0;
    const recent = hits.slice(-6);
    const span = (recent[recent.length - 1] - recent[0]) / 1000;
    return span > 0 ? (recent.length - 1) / span : 0;
  }

  function onKey(e) {
    if (!enabled) return;
    // Ignore bare modifier presses — they're not really "typing".
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;

    const now = performance.now();
    if (now - lastHitAt > RESET_MS) { combo = 0; hits.length = 0; }
    lastHitAt = now;
    combo++;
    hits.push(now);
    if (hits.length > 8) hits.shift();

    const speed = typingSpeed();
    targetIntensity = clamp01(0.65 * (combo / COMBO_NORM) + 0.35 * (speed / SPEED_NORM));

    if (combo >= MIN_COMBO) burst();
    pulse();
    ensureLoop();
  }

  function burst() {
    const i = Math.max(intensity, targetIntensity);
    const a = anchor();
    const count = Math.round(2 + i * 9);
    const hue = heatHue(i);
    for (let k = 0; k < count; k++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * (0.7 + i);
      const sp = (1.5 + Math.random() * 4) * (1 + i * 1.6);
      particles.push({
        x: a.x + (Math.random() - 0.5) * 14,
        y: a.y + (Math.random() - 0.5) * 14,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 1,
        life: 1,
        decay: 0.012 + Math.random() * 0.02,
        size: 1.5 + Math.random() * (2 + i * 4),
        hue: hue + (Math.random() - 0.5) * 40,
      });
    }
  }

  function tierFor(c) {
    for (const t of TIERS) if (c >= t.at) return t.label;
    return '';
  }

  // Flash the readout on each keystroke.
  function pulse() {
    if (combo < MIN_COMBO) return;
    hudCount.textContent = '×' + combo;
    hudTier.textContent = tierFor(combo);
    // Restart the pop animation: drop the class, force a reflow, re-add it.
    hud.classList.remove('combo-pop');
    void hud.offsetWidth;
    hud.classList.add('combo-pop');
  }

  function ensureLoop() {
    if (rafId == null) rafId = requestAnimationFrame(frame);
  }

  function frame() {
    const now = performance.now();

    // Decay the streak when typing stops.
    if (combo > 0 && now - lastHitAt > RESET_MS) {
      combo = 0;
      targetIntensity = 0;
    }

    // Ease the visible intensity toward its target (snappy up, smooth down).
    const ease = targetIntensity > intensity ? 0.35 : 0.06;
    intensity += (targetIntensity - intensity) * ease;
    if (intensity < 0.002) intensity = 0;

    render(now);

    const alive = particles.length || intensity > 0.002 || combo > 0;
    if (alive) {
      rafId = requestAnimationFrame(frame);
    } else {
      rafId = null;
      clearVisuals();
    }
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalCompositeOperation = 'lighter';

    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      p.vy += 0.12;            // gravity
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      const r = p.size * p.life;
      if (r <= 0) continue;
      ctx.beginPath();
      ctx.fillStyle = `hsla(${p.hue}, 95%, 60%, ${clamp01(p.life)})`;
      ctx.shadowBlur = 12;
      ctx.shadowColor = `hsla(${p.hue}, 100%, 60%, ${clamp01(p.life)})`;
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';

    // Heat readout + glow + shake, all keyed to intensity.
    const showHud = combo >= MIN_COMBO && intensity > 0.01;
    hud.classList.toggle('combo-show', showHud);
    if (showHud) {
      const hue = heatHue(intensity);
      const scale = 1 + intensity * 0.9;
      hud.style.setProperty('--combo-hue', hue.toFixed(0));
      hud.style.setProperty('--combo-scale', scale.toFixed(3));
      hud.style.setProperty('--combo-glow', (4 + intensity * 26).toFixed(1) + 'px');
    }

    glow.style.opacity = (intensity * 0.85).toFixed(3);
    glow.style.setProperty('--combo-hue', heatHue(intensity).toFixed(0));

    // Screen shake only kicks in near the top of the range.
    const shake = Math.max(0, intensity - 0.6) * 14;
    const ws = document.getElementById('workspace');
    if (ws) {
      if (shake > 0.1) {
        ws.style.transform =
          `translate(${(Math.random() - 0.5) * shake}px, ${(Math.random() - 0.5) * shake}px)`;
      } else if (ws.style.transform) {
        ws.style.transform = '';
      }
    }
  }

  function clearVisuals() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    hud.classList.remove('combo-show');
    glow.style.opacity = '0';
    const ws = document.getElementById('workspace');
    if (ws && ws.style.transform) ws.style.transform = '';
  }

  // ── Public API ───────────────────────────────────────────────────────────
  function setComboFxEnabled(on) {
    enabled = on !== false;
    if (!enabled) {
      combo = 0; intensity = 0; targetIntensity = 0;
      particles = [];
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
      clearVisuals();
    }
  }
  window.setComboFxEnabled = setComboFxEnabled;
  window.isComboFxEnabled = () => enabled;

  document.addEventListener('DOMContentLoaded', () => {
    build();
    // Sync with the persisted setting once it's loaded (settings.js fetches on
    // the same event; default to on if it isn't available yet).
    const sync = () => {
      const s = (typeof getSettings === 'function') ? getSettings() : null;
      if (s && 'comboFx' in s) setComboFxEnabled(s.comboFx);
    };
    setTimeout(sync, 0);
    setTimeout(sync, 400);
  });
})();

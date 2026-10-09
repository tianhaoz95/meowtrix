// ── Quick Overlay call-out animations ─────────────────────────────────────────
// The selectable summon/dismiss animations for the global-shortcut overlay
// (Settings → Quick Overlay → Animation style, setting `quickOverlayAnimationStyle`).
// Prototyped in reports/overlay-animation/site, which has a side-by-side review page.
//
// Animations run on the Web Animations API against:
//   #app                       the overlay "window" (in the desktop app the native window is
//                              transparent in overlay mode, so #app is all that's visible)
//   #overlay-anim-island       a black pill that starts over the notch (top-center of the
//                              window, which starts at the top of the screen, centered on the
//                              notch; #app rests below the menu-bar strip) — for notch effects
//   #overlay-anim-shine        a light sweep across #app
//   OVERLAY_CONTENT / panes    #app's main regions, for content fades and cascades
//
// A style is a list of tracks { t: selector, k: keyframes, d: ms, delay?, stagger?, e: easing }
// (k may be a function of { bg, top, notchW, notchH } for theme/screen-dependent values:
// `top` is the menu-bar/notch strip above #app, in px; notchW/notchH the notch size). `out` defaults to the mirror
// of `in`: reversed keyframes and schedule, faster, accelerating. The first `in` keyframe
// (= last `out` keyframe) must leave the window looking empty.

(function () {
  // Damped spring → CSS linear() easing, so springs (with real overshoot) work as easings.
  function spring({ stiffness = 170, damping = 20, mass = 1, samples = 64 } = {}) {
    const dt = 1 / 600;
    let x = 0, v = 0, t = 0, settledFor = 0;
    const pts = [];
    while (t < 3) {
      const a = (-stiffness * (x - 1) - damping * v) / mass;
      v += a * dt;
      x += v * dt;
      t += dt;
      pts.push(x);
      if (Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) {
        settledFor += dt;
        if (settledFor > 0.05) break;
      } else settledFor = 0;
    }
    const step = Math.max(1, Math.floor(pts.length / samples));
    const stops = [];
    for (let i = 0; i < pts.length; i += step) stops.push(+pts[i].toFixed(4));
    stops.push(1);
    return { e: `linear(0, ${stops.join(', ')})`, d: Math.round(t * 1000) };
  }

  const EASE_OUT_EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)';
  const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';
  const OUT_SCALE = 0.55;
  const OUT_EASE = 'cubic-bezier(0.5, 0, 0.75, 0)';

  const APP = '#app';
  const ISLAND = '#overlay-anim-island';
  const SHINE = '#overlay-anim-shine';
  const CONTENT = '#app > #window-header, #app > #toolbar, #app > #workspace';
  const CHROME = '#app > #window-header, #app > #toolbar';
  const PANES = '#workspace .pane';
  // Fallback notch footprint (pt) when the screen's isn't known; on displays without a
  // notch the pill just grows from top-center.
  const NOTCH_W = 190, NOTCH_H = 34;
  const notchFrame = ({ notchW, notchH }, extra = {}) =>
    ({ width: `${notchW}px`, height: `${notchH}px`, borderRadius: '0 0 14px 14px', background: '#000', ...extra });
  // The notch-style islands end covering #app exactly, not the menu-bar strip above it.
  const unclipped = { clipPath: 'inset(0px 0px 0px 0px round 0px)' };
  const clipToApp = top => ({ clipPath: `inset(${top}px 0px 0px 0px round 12px)` });

  const springSoft = spring({ stiffness: 190, damping: 22 });
  const springBouncy = spring({ stiffness: 260, damping: 17 });
  const springSnappy = spring({ stiffness: 380, damping: 30 });
  const springQuake = spring({ stiffness: 230, damping: 21 });

  const STYLES = [
    {
      id: 'classic',
      name: 'Classic drop-in',
      in: [
        { t: APP, d: 360, e: EASE_OUT_EXPO, k: [
          { opacity: 0, transform: 'translateY(-36px) scale(0.96)', filter: 'blur(6px)' },
          { opacity: 1, transform: 'translateY(2px) scale(1.005)', filter: 'blur(0px)', offset: 0.6 },
          { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' },
        ] },
      ],
      out: [
        { t: APP, d: 200, e: EASE_IN, k: [
          { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' },
          { opacity: 0, transform: 'translateY(-36px) scale(0.95)', filter: 'blur(6px)' },
        ] },
      ],
    },
    {
      id: 'notch-morph',
      name: 'Notch Morph',
      in: [
        { t: ISLAND, d: springSoft.d, e: springSoft.e, k: ctx => [
          notchFrame(ctx, unclipped),
          { width: '46vw', height: `${ctx.top + 18}px`, borderRadius: '0 0 26px 26px', background: '#000', ...unclipped, offset: 0.3 },
          { width: '100vw', height: '100vh', borderRadius: '0 0 12px 12px', background: ctx.bg, ...clipToApp(ctx.top) },
        ] },
        { t: APP, d: 220, delay: 230, e: EASE_OUT, k: [
          { opacity: 0, transform: 'translateY(-10px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ] },
      ],
    },
    {
      id: 'quake-drop',
      name: 'Quake Drop',
      in: [
        { t: APP, d: springQuake.d, e: springQuake.e, k: [
          { opacity: 1, transform: 'translateY(-101%)' },
          { opacity: 1, transform: 'translateY(0)' },
        ] },
      ],
      out: [
        { t: APP, d: 210, e: EASE_IN, k: [
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 1, transform: 'translateY(-101%)' },
        ] },
      ],
    },
    {
      id: 'genie',
      name: 'Notch Genie',
      in: [
        // Starts lifted into the notch strip so it pours out of the notch.
        { t: APP, d: 460, e: EASE_OUT_EXPO, k: ({ top }) => [
          { opacity: 1, transform: `translateY(${-top}px)`, clipPath: 'polygon(39% 0%, 61% 0%, 54% 5.7%, 46% 5.7%)' },
          { opacity: 1, transform: 'translateY(0px)', clipPath: 'polygon(20% 0%, 80% 0%, 66% 55%, 34% 55%)', offset: 0.35 },
          { opacity: 1, transform: 'translateY(0px)', clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)' },
        ] },
        { t: CONTENT, d: 460, e: EASE_OUT_EXPO, k: [
          { transform: 'scale(0.3, 0.4)', transformOrigin: '50% 0%' },
          { transform: 'scale(1, 1)', transformOrigin: '50% 0%' },
        ] },
      ],
    },
    {
      id: 'iris',
      name: 'Notch Iris',
      in: [
        // Centered on the notch, above #app.
        { t: APP, d: 420, e: 'cubic-bezier(0.5, 0, 0.2, 1)', k: ({ top, notchH }) => [
          { opacity: 1, clipPath: `circle(0px at 50% ${-Math.max(0, top - notchH / 2)}px)` },
          { opacity: 1, clipPath: `circle(150vmax at 50% ${-Math.max(0, top - notchH / 2)}px)` },
        ] },
        { t: CONTENT, d: 420, e: EASE_OUT, k: [
          { transform: 'scale(1.04)', filter: 'brightness(1.4)' },
          { transform: 'scale(1)', filter: 'brightness(1)' },
        ] },
      ],
    },
    {
      id: 'spotlight',
      name: 'Spotlight Focus',
      in: [
        { t: APP, d: 240, e: EASE_OUT_EXPO, k: [
          { opacity: 0, transform: 'scale(0.94)', filter: 'blur(10px)' },
          { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
        ] },
      ],
    },
    {
      id: 'cascade',
      name: 'Shutter Cascade',
      in: [
        { t: APP, d: 260, e: EASE_OUT_EXPO, k: [
          { opacity: 1, clipPath: 'inset(0 0 100% 0 round 0 0 12px 12px)' },
          { opacity: 1, clipPath: 'inset(0 0 0% 0 round 0 0 12px 12px)' },
        ] },
        { t: CHROME, d: 200, delay: 120, stagger: 50, e: EASE_OUT, k: [
          { opacity: 0, transform: 'translateY(-6px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ] },
        { t: PANES, d: 220, delay: 220, stagger: 45, e: EASE_OUT, k: [
          { opacity: 0, transform: 'translateX(-10px)' },
          { opacity: 1, transform: 'translateX(0)' },
        ] },
      ],
      out: [
        { t: APP, d: 180, e: EASE_IN, k: [
          { opacity: 1, clipPath: 'inset(0 0 0% 0 round 0 0 12px 12px)' },
          { opacity: 1, clipPath: 'inset(0 0 100% 0 round 0 0 12px 12px)' },
        ] },
      ],
    },
    {
      id: 'elastic',
      name: 'Elastic Unfold',
      in: [
        { t: ISLAND, d: 620, e: 'linear', k: ctx => [
          notchFrame(ctx, { easing: springSnappy.e, ...unclipped }),
          { width: `${ctx.notchW + 20}px`, height: `${ctx.top + 16}px`, borderRadius: '0 0 25px 25px', background: '#000', ...unclipped, offset: 0.22, easing: springSnappy.e },
          { width: '100vw', height: `${ctx.top + 16}px`, borderRadius: '0 0 25px 25px', background: '#000', ...unclipped, offset: 0.5, easing: springBouncy.e },
          { width: '100vw', height: '100vh', borderRadius: '0 0 12px 12px', background: ctx.bg, ...clipToApp(ctx.top) },
        ] },
        { t: APP, d: 200, delay: 470, e: EASE_OUT, k: [{ opacity: 0 }, { opacity: 1 }] },
      ],
    },
    {
      id: 'glass',
      name: 'Glass Materialize',
      in: [
        { t: APP, d: 380, e: EASE_OUT_EXPO, k: [
          { opacity: 0, transform: 'scale(1.025)', boxShadow: 'inset 0 0 0 1px rgba(129,140,248,0.9), inset 0 0 60px rgba(99,102,241,0.45)' },
          { opacity: 1, transform: 'scale(1)', boxShadow: 'inset 0 0 0 1px rgba(129,140,248,0.6), inset 0 0 40px rgba(99,102,241,0.25)', offset: 0.5 },
          { opacity: 1, transform: 'scale(1)', boxShadow: 'inset 0 0 0 1px rgba(129,140,248,0), inset 0 0 0 rgba(99,102,241,0)' },
        ] },
        { t: SHINE, d: 650, delay: 60, e: 'cubic-bezier(0.4, 0, 0.2, 1)', k: [
          { transform: 'translateX(-120%) skewX(-18deg)', opacity: 1 },
          { transform: 'translateX(320%) skewX(-18deg)', opacity: 1 },
        ] },
      ],
      out: [
        { t: APP, d: 180, e: EASE_IN, k: [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(0.98)' },
        ] },
      ],
    },
    {
      id: 'hinge',
      name: 'Visor Hinge',
      in: [
        { t: APP, d: springBouncy.d, e: springBouncy.e, k: [
          { opacity: 0, transform: 'perspective(1400px) rotateX(-88deg)', transformOrigin: '50% 0%' },
          { opacity: 1, transform: 'perspective(1400px) rotateX(-40deg)', transformOrigin: '50% 0%', offset: 0.18 },
          { opacity: 1, transform: 'perspective(1400px) rotateX(0deg)', transformOrigin: '50% 0%' },
        ] },
      ],
      out: [
        { t: APP, d: 220, e: EASE_IN, k: [
          { opacity: 1, transform: 'perspective(1400px) rotateX(0deg)', transformOrigin: '50% 0%' },
          { opacity: 0, transform: 'perspective(1400px) rotateX(-88deg)', transformOrigin: '50% 0%' },
        ] },
      ],
    },
    {
      id: 'notch-pulse',
      name: 'Notch Pulse',
      in: [
        { t: ISLAND, d: 300, e: EASE_OUT, k: ctx => [
          notchFrame(ctx, { boxShadow: '0 0 0 0 rgba(129,140,248,0)' }),
          { width: `${ctx.notchW + 32}px`, height: `${ctx.notchH + 8}px`, borderRadius: '0 0 20px 20px', background: '#000', boxShadow: '0 0 24px 6px rgba(129,140,248,0.85)', offset: 0.3 },
          notchFrame(ctx, { boxShadow: '0 0 0 0 rgba(129,140,248,0)' }),
        ] },
        // Springs out of the notch: starts inside the strip above #app.
        { t: APP, d: springSoft.d, delay: 90, e: springSoft.e, k: ({ top }) => [
          { opacity: 0, transform: `translateY(${-Math.max(top, 40)}px) scale(0.3, 0.1)`, transformOrigin: '50% 0%' },
          { opacity: 1, transform: 'translateY(0) scale(1, 1)', transformOrigin: '50% 0%', offset: 0.35 },
          { opacity: 1, transform: 'translateY(0) scale(1, 1)', transformOrigin: '50% 0%' },
        ] },
      ],
      out: [
        { t: APP, d: 200, e: EASE_IN, k: ({ top }) => [
          { opacity: 1, transform: 'translateY(0) scale(1, 1)', transformOrigin: '50% 0%' },
          { opacity: 0, transform: `translateY(${-Math.max(top, 20)}px) scale(0.3, 0.1)`, transformOrigin: '50% 0%' },
        ] },
      ],
    },
  ];

  const DEFAULT_STYLE = 'classic';

  // ── playback ──

  function withOffsets(frames) {
    const out = frames.map(f => ({ ...f }));
    if (out[0].offset == null) out[0].offset = 0;
    if (out[out.length - 1].offset == null) out[out.length - 1].offset = 1;
    let last = 0;
    for (let i = 1; i < out.length; i++) {
      if (out[i].offset == null) continue;
      for (let j = last + 1; j < i; j++) {
        out[j].offset = out[last].offset + ((out[i].offset - out[last].offset) * (j - last)) / (i - last);
      }
      last = i;
    }
    return out;
  }

  const reverseFrames = frames => withOffsets(frames).reverse()
    .map(({ easing, ...f }) => ({ ...f, offset: +(1 - f.offset).toFixed(4) }));

  function ensureElements() {
    if (!document.getElementById('overlay-anim-island')) {
      const island = document.createElement('div');
      island.id = 'overlay-anim-island';
      island.setAttribute('aria-hidden', 'true');
      document.body.appendChild(island);
    }
    const app = document.getElementById('app');
    if (app && !document.getElementById('overlay-anim-shine')) {
      const shine = document.createElement('div');
      shine.id = 'overlay-anim-shine';
      shine.setAttribute('aria-hidden', 'true');
      app.appendChild(shine);
    }
  }

  function plan(style, dir, ctx) {
    const expand = tracks => tracks.flatMap(tr => {
      const k = typeof tr.k === 'function' ? tr.k(ctx) : tr.k;
      return [...document.querySelectorAll(tr.t)].map((el, i) => ({
        el, k, d: tr.d, delay: (tr.delay || 0) + i * (tr.stagger || 0), e: tr.e || 'linear',
      }));
    });
    if (dir === 'in') return expand(style.in);
    if (style.out) return expand(style.out);
    const fwd = expand(style.in);
    const total = Math.max(0, ...fwd.map(a => a.delay + a.d));
    return fwd.map(a => ({
      el: a.el, k: reverseFrames(a.k), d: a.d * OUT_SCALE,
      delay: (total - (a.delay + a.d)) * OUT_SCALE, e: OUT_EASE,
    }));
  }

  let running = [];

  // Cancel any overlay animation (in flight or holding its end state) — the elements
  // fall back to their plain CSS state.
  function cancelOverlayAnimation() {
    running.forEach(a => a.cancel());
    running = [];
    document.documentElement.classList.remove('overlay-animating', 'overlay-anim-uses-island');
  }

  // Play the `dir` ('in' | 'out') animation of `styleId`. Resolves true when it finishes,
  // false if it was cancelled/superseded. Summons drop their fill on completion so no
  // transform/filter lingers on #app; dismisses hold their (empty) end state until the
  // next play or cancelOverlayAnimation(), so the window stays empty while it's hidden.
  function playOverlayAnimation(dir, styleId) {
    cancelOverlayAnimation();
    ensureElements();
    const style = STYLES.find(s => s.id === styleId) || STYLES.find(s => s.id === DEFAULT_STYLE);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#090d16';
    // Screen geometry from the desktop app (overlay.js setOverlayScreenGeometry); it only
    // applies while the window is in its transparent overlay mode (not e.g. a Settings preview).
    const geo = document.documentElement.classList.contains('overlay-transparent') && window.__overlayScreenGeometry || {};
    const ctx = {
      bg,
      top: geo.topInset || 0,
      notchW: geo.notchW || NOTCH_W,
      notchH: geo.notchH || NOTCH_H,
    };
    document.documentElement.classList.add('overlay-animating');
    // The island sits under the notch; only show it for styles that animate it, or it
    // would be a stray black pill on displays without a notch.
    const tracks = dir === 'in' || !style.out ? style.in : style.out;
    document.documentElement.classList.toggle('overlay-anim-uses-island', tracks.some(t => t.t === ISLAND));
    const anims = plan(style, dir, ctx).map(s =>
      s.el.animate(s.k, { duration: s.d, delay: s.delay, easing: s.e, fill: 'both' }));
    running = anims;
    return Promise.all(anims.map(a => a.finished)).then(() => {
      if (running !== anims) return false;
      if (dir === 'in') cancelOverlayAnimation();
      return true;
    }, () => false);
  }

  window.OVERLAY_ANIMATION_STYLES = STYLES.map(s => ({ id: s.id, name: s.name }));
  window.OVERLAY_ANIMATION_DEFAULT = DEFAULT_STYLE;
  window.playOverlayAnimation = playOverlayAnimation;
  window.cancelOverlayAnimation = cancelOverlayAnimation;
})();

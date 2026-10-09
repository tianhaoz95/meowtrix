// Overlay call-out animation candidates.
//
// Every candidate animates the same stage (see app.js / index.html), laid out at a fixed
// 1280×800 design size and scaled to fit:
//   .notch   hardware notch (always on top, never animated)
//   .island  black pill that starts exactly under the notch — for notch-morph effects
//   .dim     full-screen scrim over the desktop
//   .win     the Meowtrix overlay window (900×560, top-centered, flush with the top edge)
//   .win .content / .win .line / .win .shine   parts of the window
//
// A candidate is a list of tracks: { t: selector, k: keyframes, d: ms, delay?, stagger?, e: easing }.
// `in` is the summon. `out` (dismiss) is optional; when omitted it's the mirror of `in`
// (reversed keyframes and timing), sped up and with an accelerating easing.
// The first keyframe of `in` (= last of `out`) must leave the stage looking empty.

// Spring → CSS linear() easing. Simulates a damped spring from 0 to 1 and samples it, so
// springs (with real overshoot) can be used as plain WAAPI easings. Returns { e, d }.
function spring({ stiffness = 170, damping = 20, mass = 1, samples = 64 } = {}) {
  const dt = 1 / 600;
  let x = 0, v = 0, t = 0;
  const pts = [];
  let settledFor = 0;
  while (t < 3) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
    t += dt;
    pts.push([t, x]);
    if (Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) {
      settledFor += dt;
      if (settledFor > 0.05) break;
    } else settledFor = 0;
  }
  const total = t;
  const step = Math.max(1, Math.floor(pts.length / samples));
  const stops = [];
  for (let i = 0; i < pts.length; i += step) stops.push(+pts[i][1].toFixed(4));
  stops.push(1);
  return { e: `linear(0, ${stops.join(', ')})`, d: Math.round(total * 1000) };
}

const EASE_OUT_EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';
const NOTCH_W = 200, NOTCH_H = 32, WIN_W = 900, WIN_H = 560;

const springSoft = spring({ stiffness: 190, damping: 22 });
const springBouncy = spring({ stiffness: 260, damping: 17 });
const springSnappy = spring({ stiffness: 380, damping: 30 });
const springQuake = spring({ stiffness: 230, damping: 21 });

window.CANDIDATES = [
  {
    id: 'baseline',
    name: 'Current (baseline)',
    tag: 'What ships today',
    desc: 'Window drops in 36px from above while scaling up and un-blurring, with a tiny overshoot. Collapse is the same motion reversed in 200ms.',
    in: [
      { t: '.win', d: 360, e: EASE_OUT_EXPO, k: [
        { opacity: 0, transform: 'translateY(-36px) scale(0.96)', filter: 'blur(6px)' },
        { opacity: 1, transform: 'translateY(2px) scale(1.005)', filter: 'blur(0px)', offset: 0.6 },
        { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' },
      ] },
    ],
    out: [
      { t: '.win', d: 200, e: EASE_IN, k: [
        { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' },
        { opacity: 0, transform: 'translateY(-36px) scale(0.95)', filter: 'blur(6px)' },
      ] },
    ],
  },

  {
    id: 'notch-morph',
    name: 'Notch Morph',
    tag: 'Dynamic Island, literally',
    desc: 'A black pill grows out of the notch on a spring — wider first, then down into the full window — and the UI fades up inside it once it has room. Reads as "the notch opened".',
    in: [
      { t: '.island', d: springSoft.d, e: springSoft.e, k: [
        { width: `${NOTCH_W}px`, height: `${NOTCH_H}px`, borderRadius: '0 0 14px 14px', background: '#000' },
        { width: '420px', height: '52px', borderRadius: '0 0 26px 26px', background: '#000', offset: 0.3 },
        { width: `${WIN_W}px`, height: `${WIN_H}px`, borderRadius: '0 0 16px 16px', background: '#090d16' },
      ] },
      { t: '.win', d: 220, delay: 230, e: EASE_OUT, k: [
        { opacity: 0, transform: 'translateY(-10px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ] },
    ],
  },

  {
    id: 'quake-drop',
    name: 'Quake Drop',
    tag: 'Classic drop-down terminal',
    desc: 'The whole window slides down from behind the top edge on a firm spring with a small bounce — the Quake / iTerm hotkey-window idiom. Instantly understood by terminal users.',
    in: [
      { t: '.win', d: springQuake.d, e: springQuake.e, k: [
        { opacity: 1, transform: 'translateY(-101%)' },
        { opacity: 1, transform: 'translateY(0)' },
      ] },
    ],
    out: [
      { t: '.win', d: 210, e: EASE_IN, k: [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 1, transform: 'translateY(-101%)' },
      ] },
    ],
  },

  {
    id: 'genie',
    name: 'Notch Genie',
    tag: 'macOS minimize, inverted',
    desc: 'The window is pulled out of the notch through a funnel: a narrow trapezoid widening into the full rectangle, like the Dock genie effect in reverse.',
    in: [
      { t: '.win', d: 460, e: EASE_OUT_EXPO, k: [
        { opacity: 1, clipPath: 'polygon(39% 0%, 61% 0%, 54% 5.7%, 46% 5.7%)' },
        { opacity: 1, clipPath: 'polygon(20% 0%, 80% 0%, 66% 55%, 34% 55%)', offset: 0.35 },
        { opacity: 1, clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)' },
      ] },
      { t: '.win .content', d: 460, e: EASE_OUT_EXPO, k: [
        { transform: 'scaleX(0.3) scaleY(0.4)', transformOrigin: '50% 0%' },
        { transform: 'scaleX(1) scaleY(1)', transformOrigin: '50% 0%' },
      ] },
    ],
  },

  {
    id: 'iris',
    name: 'Notch Iris',
    tag: 'Circular reveal from the notch',
    desc: 'A circle expands from the notch and reveals the window underneath (Material-style circular reveal). Clean, fast, no geometry distortion of the UI.',
    in: [
      { t: '.win', d: 420, e: 'cubic-bezier(0.5, 0, 0.2, 1)', k: [
        { opacity: 1, clipPath: 'circle(0px at 50% 0%)' },
        { opacity: 1, clipPath: 'circle(1100px at 50% 0%)' },
      ] },
      { t: '.win .content', d: 420, e: EASE_OUT, k: [
        { transform: 'scale(1.04)', filter: 'brightness(1.4)' },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ] },
    ],
  },

  {
    id: 'spotlight',
    name: 'Spotlight Focus',
    tag: 'Quick zoom + desktop dim',
    desc: 'Short and calm: the window zooms from 94% and un-blurs while the desktop behind dims slightly, pulling attention in like Spotlight / Raycast. The fastest of the set.',
    in: [
      { t: '.dim', d: 220, e: EASE_OUT, k: [{ opacity: 0 }, { opacity: 1 }] },
      { t: '.win', d: 240, e: EASE_OUT_EXPO, k: [
        { opacity: 0, transform: 'scale(0.94)', filter: 'blur(10px)' },
        { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
      ] },
    ],
  },

  {
    id: 'cascade',
    name: 'Shutter Cascade',
    tag: 'Frame first, content streams in',
    desc: 'An empty frame rolls down from the top edge, then the toolbar and terminal lines cascade in one after another, as if the session is being printed. Shows the terminal "coming alive".',
    in: [
      { t: '.win', d: 260, e: EASE_OUT_EXPO, k: [
        { opacity: 1, clipPath: 'inset(0 0 100% 0 round 0 0 16px 16px)' },
        { opacity: 1, clipPath: 'inset(0 0 0% 0 round 0 0 16px 16px)' },
      ] },
      { t: '.win .chrome', d: 200, delay: 120, stagger: 50, e: EASE_OUT, k: [
        { opacity: 0, transform: 'translateY(-6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ] },
      { t: '.win .line', d: 180, delay: 220, stagger: 28, e: EASE_OUT, k: [
        { opacity: 0, transform: 'translateX(-8px)' },
        { opacity: 1, transform: 'translateX(0)' },
      ] },
    ],
    out: [
      { t: '.win', d: 180, e: EASE_IN, k: [
        { opacity: 1, clipPath: 'inset(0 0 0% 0 round 0 0 16px 16px)' },
        { opacity: 1, clipPath: 'inset(0 0 100% 0 round 0 0 16px 16px)' },
      ] },
    ],
  },

  {
    id: 'elastic',
    name: 'Elastic Unfold',
    tag: 'Three-beat island sequence',
    desc: 'Pill drops out of the notch → snaps wide → falls open to full height, each beat on its own spring. More theatrical than Notch Morph; the sequencing makes the origin unmistakable.',
    in: [
      { t: '.island', d: 620, e: 'linear', k: [
        { width: `${NOTCH_W}px`, height: `${NOTCH_H}px`, borderRadius: '0 0 14px 14px', background: '#000', easing: springSnappy.e },
        { width: '220px', height: '50px', borderRadius: '0 0 25px 25px', background: '#000', offset: 0.22, easing: springSnappy.e },
        { width: `${WIN_W}px`, height: '50px', borderRadius: '0 0 25px 25px', background: '#000', offset: 0.5, easing: springBouncy.e },
        { width: `${WIN_W}px`, height: `${WIN_H}px`, borderRadius: '0 0 16px 16px', background: '#090d16' },
      ] },
      { t: '.win', d: 200, delay: 470, e: EASE_OUT, k: [
        { opacity: 0 },
        { opacity: 1 },
      ] },
    ],
  },

  {
    id: 'glass',
    name: 'Glass Materialize',
    tag: 'Fade + light sweep',
    desc: 'The window settles from 102% while a sheet of light sweeps across it and the accent border glows then fades. Premium and subtle; the motion itself is minimal.',
    in: [
      { t: '.win', d: 380, e: EASE_OUT_EXPO, k: [
        { opacity: 0, transform: 'scale(1.025)', boxShadow: '0 0 0 1px rgba(129,140,248,0.9), 0 0 60px rgba(99,102,241,0.55)' },
        { opacity: 1, transform: 'scale(1)', boxShadow: '0 0 0 1px rgba(129,140,248,0.6), 0 0 40px rgba(99,102,241,0.35)', offset: 0.5 },
        { opacity: 1, transform: 'scale(1)', boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 24px 60px rgba(0,0,0,0.5)' },
      ] },
      { t: '.win .shine', d: 650, delay: 60, e: 'cubic-bezier(0.4, 0, 0.2, 1)', k: [
        { transform: 'translateX(-120%) skewX(-18deg)', opacity: 1 },
        { transform: 'translateX(260%) skewX(-18deg)', opacity: 1 },
      ] },
    ],
    out: [
      { t: '.win', d: 180, e: EASE_IN, k: [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(0.98)' },
      ] },
    ],
  },

  {
    id: 'hinge',
    name: 'Visor Hinge',
    tag: '3D flip down from the top edge',
    desc: 'The window swings down on a hinge along the top edge of the screen, like a car visor, with a light spring at the end. Strong sense of depth; can feel heavy at full size.',
    in: [
      { t: '.win', d: springBouncy.d, e: springBouncy.e, k: [
        { opacity: 0, transform: 'perspective(1400px) rotateX(-88deg)' },
        { opacity: 1, transform: 'perspective(1400px) rotateX(-40deg)', offset: 0.18 },
        { opacity: 1, transform: 'perspective(1400px) rotateX(0deg)' },
      ] },
    ],
    out: [
      { t: '.win', d: 220, e: EASE_IN, k: [
        { opacity: 1, transform: 'perspective(1400px) rotateX(0deg)' },
        { opacity: 0, transform: 'perspective(1400px) rotateX(-88deg)' },
      ] },
    ],
  },

  {
    id: 'ripple',
    name: 'Notch Pulse',
    tag: 'Acknowledge, then open',
    desc: 'The notch first "answers" the shortcut with a quick glowing pulse (≈90ms), then the window springs down from it. Gives instant feedback even if the window takes a frame to appear.',
    in: [
      { t: '.island', d: 300, e: EASE_OUT, k: [
        { width: `${NOTCH_W}px`, height: `${NOTCH_H}px`, borderRadius: '0 0 14px 14px', background: '#000', boxShadow: '0 0 0 0 rgba(129,140,248,0)' },
        { width: '232px', height: '40px', borderRadius: '0 0 20px 20px', background: '#000', boxShadow: '0 0 24px 6px rgba(129,140,248,0.85)', offset: 0.3 },
        { width: `${NOTCH_W}px`, height: `${NOTCH_H}px`, borderRadius: '0 0 14px 14px', background: '#000', boxShadow: '0 0 0 0 rgba(129,140,248,0)' },
      ] },
      { t: '.win', d: springSoft.d, delay: 90, e: springSoft.e, k: [
        { opacity: 0, transform: 'translateY(-40px) scale(0.3, 0.1)', transformOrigin: '50% 0%' },
        { opacity: 1, transform: 'translateY(0) scale(1, 1)', transformOrigin: '50% 0%', offset: 0.35 },
        { opacity: 1, transform: 'translateY(0) scale(1, 1)', transformOrigin: '50% 0%' },
      ] },
    ],
    out: [
      { t: '.win', d: 200, e: EASE_IN, k: [
        { opacity: 1, transform: 'translateY(0) scale(1, 1)', transformOrigin: '50% 0%' },
        { opacity: 0, transform: 'translateY(-20px) scale(0.3, 0.1)', transformOrigin: '50% 0%' },
      ] },
    ],
  },
];

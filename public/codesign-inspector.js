// CoDesign inspector — injected by codesign-service.js into every served spec.
// Runs *inside* the sandboxed (opaque-origin) spec iframe, so the CoDesign tab
// can't touch this DOM directly; everything goes over postMessage:
//   tab → spec  { __codesign: 1, cmd: 'mode' | 'pins' | 'focus' | 'scrollTo', ... }
//   spec → tab  { __codesign: 1, evt: 'ready' | 'pick' | 'pinClick' | 'scroll', ... }
// Modes: preview (hands off), inspect (hover outline + computed-style HUD),
// comment (hover outline; click picks an element for a new comment pin).
(function () {
  if (window.__codesignInspector || window.parent === window) return;
  window.__codesignInspector = true;

  const post = (msg) => window.parent.postMessage({ __codesign: 1, ...msg }, '*');
  let mode = 'preview';
  let pins = [];
  let ui = 1; // 1 / the tab's zoom, so pins and the HUD stay legible when the frame is scaled down
  let layer, outline, hud, ready = false;

  // ── Selector generation ───────────────────────────────────────────────────
  const cssEscape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&'));
  function selectorFor(el) {
    if (!(el instanceof Element)) return '';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 6) {
      if (node.id && document.querySelectorAll('#' + cssEscape(node.id)).length === 1) {
        parts.unshift('#' + cssEscape(node.id));
        break;
      }
      let part = node.tagName.toLowerCase();
      const classes = [...node.classList].filter(c => !c.startsWith('__cd')).slice(0, 2);
      if (classes.length) part += '.' + classes.map(cssEscape).join('.');
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter(c => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  const snippet = (el) => (el.innerText || el.textContent || el.getAttribute?.('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const isOurs = (el) => el && el.closest && el.closest('[data-codesign-ui]');

  // ── Overlay chrome (outline, HUD, pin layer) ──────────────────────────────
  function el(tag, css, attrs = {}) {
    const e = document.createElement(tag);
    e.setAttribute('data-codesign-ui', '');
    e.style.cssText = css;
    Object.assign(e, attrs);
    return e;
  }

  function build() {
    if (layer) return;
    const font = 'font: 500 11px/1.35 ui-sans-serif, system-ui, -apple-system, sans-serif; letter-spacing: 0;';
    outline = el('div', 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #6366f1;background:rgba(99,102,241,.08);border-radius:2px;display:none;transition:all 60ms ease-out;');
    hud = el('div', `position:fixed;pointer-events:none;z-index:2147483647;display:none;max-width:300px;padding:7px 9px;border-radius:7px;background:rgba(15,20,34,.94);color:#e2e8f0;box-shadow:0 6px 20px rgba(0,0,0,.35);white-space:pre;${font}`);
    layer = el('div', 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483645;');
    document.documentElement.append(layer, outline, hud);
  }

  function showOutline(target) {
    const r = target.getBoundingClientRect();
    outline.style.display = 'block';
    outline.style.borderColor = mode === 'comment' ? '#f59e0b' : '#6366f1';
    outline.style.background = mode === 'comment' ? 'rgba(245,158,11,.10)' : 'rgba(99,102,241,.08)';
    Object.assign(outline.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }

  function showHud(target, x, y) {
    const cs = getComputedStyle(target);
    const r = target.getBoundingClientRect();
    const box = (p) => ['top', 'right', 'bottom', 'left'].map(s => cs[p + s[0].toUpperCase() + s.slice(1)]).map(v => parseFloat(v) || 0);
    const fmtBox = (a) => (a.every(v => v === a[0]) ? `${a[0]}` : a.join(' '));
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '');
    const lines = [
      `${selectorFor(target).split(' > ').pop()}   ${Math.round(r.width)}×${Math.round(r.height)}`,
      `font     ${cs.fontSize} / ${cs.lineHeight}  ${cs.fontWeight}  ${fam}`,
      `color    ${cs.color}`,
    ];
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') lines.push(`bg       ${cs.backgroundColor}`);
    lines.push(`padding  ${fmtBox(box('padding'))}    margin ${fmtBox(box('margin'))}`);
    if (parseFloat(cs.borderTopWidth)) lines.push(`border   ${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`);
    if (parseFloat(cs.borderTopLeftRadius)) lines.push(`radius   ${cs.borderTopLeftRadius}`);
    if (cs.display.includes('flex') || cs.display.includes('grid')) {
      lines.push(`display  ${cs.display}  gap ${cs.gap}`);
      lines.push(`align    ${cs.alignItems} / ${cs.justifyContent}`);
    } else {
      lines.push(`display  ${cs.display}`);
    }
    hud.textContent = lines.join('\n');
    hud.style.display = 'block';
    hud.style.transformOrigin = '0 0';
    hud.style.transform = `scale(${ui})`;
    const w = hud.offsetWidth * ui, h = hud.offsetHeight * ui;
    let left = x + 14, top = y + 14;
    if (left + w > innerWidth - 4) left = Math.max(4, x - w - 14);
    if (top + h > innerHeight - 4) top = Math.max(4, y - h - 14);
    hud.style.left = left + 'px';
    hud.style.top = top + 'px';
  }

  function hideHover() {
    if (outline) outline.style.display = 'none';
    if (hud) hud.style.display = 'none';
  }

  // ── Pins ──────────────────────────────────────────────────────────────────
  // Anchored to their element (selector + fractional offset) so they follow
  // reflow across device sizes; fall back to raw document coords.
  function pinPosition(p) {
    let target = null;
    if (p.selector) { try { target = document.querySelector(p.selector); } catch {} }
    if (target && p.ox != null && p.oy != null) {
      const r = target.getBoundingClientRect();
      if (r.width || r.height) return { x: r.left + scrollX + r.width * p.ox, y: r.top + scrollY + r.height * p.oy };
    }
    if (p.x != null && p.y != null) return { x: p.x, y: p.y };
    return null;
  }

  let lastPinKey = '';
  function renderPins() {
    if (!layer) return;
    const placed = pins.map(p => [p, pinPosition(p)]).filter(([, pos]) => pos);
    // Skip the rebuild when nothing moved, so hovering a pin isn't interrupted.
    const key = ui + JSON.stringify(placed.map(([p, pos]) => [p.id, p.n, p.status, p.sent, p.active, p.comment, Math.round(pos.x), Math.round(pos.y)]));
    if (key === lastPinKey) return;
    lastPinKey = key;
    layer.textContent = '';
    for (const [p, pos] of placed) {
      const color = p.status === 'resolved' ? '#10b981' : p.sent ? '#6366f1' : '#f59e0b';
      const dot = el('button', `position:absolute;left:${pos.x - 12}px;top:${pos.y - 12}px;width:24px;height:24px;border-radius:50% 50% 50% 4px;border:2px solid #fff;background:${color};color:#fff;font:700 11px/20px ui-sans-serif,system-ui,sans-serif;text-align:center;padding:0;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35);transform:scale(${ui * (p.active ? 1.25 : 1)});${p.active ? 'outline:3px solid rgba(99,102,241,.45);' : ''}${p.status === 'resolved' ? 'opacity:.75;' : ''}`);
      dot.textContent = p.n;
      dot.title = p.comment;
      dot.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); post({ evt: 'pinClick', id: p.id }); }, true);
      layer.appendChild(dot);
    }
  }

  // ── Event handling ────────────────────────────────────────────────────────
  document.addEventListener('mousemove', (e) => {
    if (mode === 'preview' || isOurs(e.target)) { hideHover(); return; }
    showOutline(e.target);
    if (mode === 'inspect') showHud(e.target, e.clientX, e.clientY);
    else hud.style.display = 'none';
  }, true);
  document.addEventListener('mouseleave', hideHover, true);

  // Swallow the page's own interactions while inspecting/commenting so a click
  // on a link or button picks it instead of navigating.
  const swallow = (e) => {
    if (mode === 'preview' || isOurs(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'submit'].forEach(t => document.addEventListener(t, swallow, true));

  document.addEventListener('click', (e) => {
    if (mode === 'preview' || isOurs(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (mode !== 'comment') return;
    const target = e.target;
    const r = target.getBoundingClientRect();
    post({
      evt: 'pick',
      selector: selectorFor(target),
      tag: target.tagName.toLowerCase(),
      text: snippet(target),
      ox: r.width ? +((e.clientX - r.left) / r.width).toFixed(4) : 0.5,
      oy: r.height ? +((e.clientY - r.top) / r.height).toFixed(4) : 0.5,
      x: Math.round(e.clientX + scrollX),
      y: Math.round(e.clientY + scrollY),
      clientX: e.clientX,
      clientY: e.clientY,
      viewportW: innerWidth,
    });
  }, true);

  let scrollTimer = null;
  addEventListener('scroll', () => {
    hideHover();
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => post({ evt: 'scroll', x: scrollX, y: scrollY }), 120);
  }, { passive: true });

  addEventListener('message', (e) => {
    if (e.source !== window.parent || !e.data || e.data.__codesign !== 1) return;
    const m = e.data;
    if (m.cmd === 'mode') {
      mode = m.mode;
      document.documentElement.style.cursor = mode === 'comment' ? 'crosshair' : '';
      if (mode === 'preview') hideHover();
    } else if (m.cmd === 'scale') {
      ui = Math.min(4, Math.max(1, 1 / (m.scale || 1)));
      renderPins();
    } else if (m.cmd === 'pins') {
      pins = Array.isArray(m.pins) ? m.pins : [];
      renderPins();
    } else if (m.cmd === 'scrollTo') {
      scrollTo(m.x || 0, m.y || 0);
    } else if (m.cmd === 'focus') {
      const p = pins.find(x => x.id === m.id);
      const pos = p && pinPosition(p);
      if (pos) scrollTo({ left: Math.max(0, pos.x - innerWidth / 2), top: Math.max(0, pos.y - innerHeight / 3), behavior: 'smooth' });
    }
  });

  function start() {
    if (ready) return;
    ready = true;
    build();
    // Re-place pins as the page reflows (fonts/images loading, viewport changes).
    addEventListener('resize', renderPins);
    if (window.ResizeObserver) new ResizeObserver(() => renderPins()).observe(document.documentElement);
    setInterval(renderPins, 1500);
    post({ evt: 'ready', title: document.title || '' });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

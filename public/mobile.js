// ── Mobile on-screen key bar ─────────────────────────────────────────────────
// Phone/tablet soft keyboards lack Esc, Tab, Ctrl, Alt, Cmd and arrow keys, all
// of which a terminal needs. This floats a key bar above the soft keyboard while
// a terminal is focused. Ctrl/Alt/Cmd are "sticky": tap one to arm it, then type
// the next character. Modifiers are applied at the PTY-input layer (see pane.js
// onData → applyStickyMods) rather than by synthesizing keyboard events, because
// many mobile keyboards don't emit reliable keydowns for letters.

const stickyMods = { ctrl: false, alt: false, meta: false };
const modButtons = {};

function isMobileLike() {
  const s = (typeof getSettings === 'function') ? getSettings() : {};
  const mode = s.uiMode || 'auto';
  if (mode === 'mobile') return true;
  if (mode === 'desktop') return false;

  return window.matchMedia('(pointer: coarse)').matches
    || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || window.innerWidth <= 640;
}

function refreshModButtons() {
  for (const k of ['ctrl', 'alt', 'meta']) {
    modButtons[k]?.classList.toggle('armed', stickyMods[k]);
  }
}

function clearStickyMods() {
  stickyMods.ctrl = stickyMods.alt = stickyMods.meta = false;
  refreshModButtons();
}

function toggleMod(k) {
  stickyMods[k] = !stickyMods[k];
  refreshModButtons();
}

// Map a character to its Ctrl-modified control byte (Ctrl+C → 0x03, etc.).
function ctrlEncode(ch) {
  const code = ch.toUpperCase().charCodeAt(0);
  if (code >= 64 && code <= 95) return String.fromCharCode(code - 64); // @ A-Z [ \ ] ^ _
  return ch; // not a control combination — leave as-is
}

// Called from xterm onData. Transforms the typed character per any armed sticky
// modifier and returns what to actually send to the PTY ('' = send nothing).
function applyStickyMods(data) {
  if (!stickyMods.ctrl && !stickyMods.alt && !stickyMods.meta) return data;
  let out = data;
  if (data.length === 1) {
    if (stickyMods.meta) {
      runAppShortcut(data); // Cmd+key drives app shortcuts, nothing goes to the PTY
      out = '';
    } else if (stickyMods.ctrl) {
      out = ctrlEncode(data);
      if (stickyMods.alt) out = '\x1b' + out;
    } else if (stickyMods.alt) {
      out = '\x1b' + data; // Alt/Meta = ESC prefix
    }
  }
  clearStickyMods();
  return out;
}

function sendToActiveTerm(data) {
  const tab = activePane?.activeTab;
  if (tab?.type === 'terminal' && tab.ptyId) {
    // Respect broadcast mode so key-bar keys fan out like typed input.
    if (typeof sendTerminalInput === 'function') sendTerminalInput(tab.ptyId, data);
    else wsSend({ type: 'pty:input', id: tab.ptyId, data });
  }
}

const DEFAULT_MOBILE_KEYS = [
  { label: 'Esc', kind: 'send', payload: '\\x1b' },
  { label: 'Tab', kind: 'send', payload: '\\t' },
  { label: 'Ctrl', kind: 'mod', payload: 'ctrl' },
  { label: 'Alt', kind: 'mod', payload: 'alt' },
  { label: 'Cmd', kind: 'mod', payload: 'meta' },
  { label: '~', kind: 'send', payload: '~' },
  { label: '|', kind: 'send', payload: '|' },
  { label: '/', kind: 'send', payload: '/' },
  { label: '←', kind: 'send', payload: '\\x1b[D' },
  { label: '↑', kind: 'send', payload: '\\x1b[A' },
  { label: '↓', kind: 'send', payload: '\\x1b[B' },
  { label: '→', kind: 'send', payload: '\\x1b[C' },
  { label: 'Hide', kind: 'hide', payload: '' }
];

function unescapePayload(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\e/g, '\x1b');
}

function parseCombo(comboStr) {
  if (typeof comboStr !== 'string') return '';
  const parts = comboStr.toLowerCase().split('+').map(p => p.trim());
  const modifiers = {
    ctrl: parts.includes('ctrl') || parts.includes('control'),
    alt: parts.includes('alt') || parts.includes('option'),
    shift: parts.includes('shift'),
    meta: parts.includes('meta') || parts.includes('cmd') || parts.includes('command')
  };

  const key = parts[parts.length - 1];
  
  let modVal = 1;
  if (modifiers.shift) modVal += 1;
  if (modifiers.alt) modVal += 2;
  if (modifiers.ctrl) modVal += 4;
  if (modifiers.meta) modVal += 8;

  const specialKeys = {
    up: 'A',
    down: 'B',
    right: 'C',
    left: 'D',
    home: 'H',
    end: 'F'
  };

  if (key in specialKeys) {
    if (modVal > 1) {
      return `\x1b[1;${modVal}${specialKeys[key]}`;
    } else {
      return `\x1b[${specialKeys[key]}`;
    }
  }

  const tildeKeys = {
    pgup: '5',
    pageup: '5',
    pgdn: '6',
    pagedown: '6',
    del: '3',
    delete: '3',
    ins: '2',
    insert: '2'
  };

  if (key in tildeKeys) {
    if (modVal > 1) {
      return `\x1b[${tildeKeys[key]};${modVal}~`;
    } else {
      return `\x1b[${tildeKeys[key]}~`;
    }
  }

  if (/^f\d+$/.test(key)) {
    const num = parseInt(key.slice(1));
    if (num >= 1 && num <= 4) {
      const letters = ['P', 'Q', 'R', 'S'];
      if (modVal > 1) {
        return `\x1b[1;${modVal}${letters[num - 1]}`;
      } else {
        return `\x1bO${letters[num - 1]}`;
      }
    } else if (num >= 5 && num <= 12) {
      const codes = {
        5: '15', 6: '17', 7: '18', 8: '19', 9: '20', 10: '21', 11: '23', 12: '24'
      };
      const code = codes[num];
      if (modVal > 1) {
        return `\x1b[${code};${modVal}~`;
      } else {
        return `\x1b[${code}~`;
      }
    }
  }

  if (key === 'tab') {
    if (modifiers.shift) return '\x1b[Z';
    return '\t';
  }
  if (key === 'enter' || key === 'return') {
    return '\r';
  }
  if (key === 'esc' || key === 'escape') {
    return '\x1b';
  }
  if (key === 'space') {
    if (modifiers.ctrl) return '\x00';
    if (modifiers.alt) return '\x1b ';
    return ' ';
  }
  if (key === 'backspace') {
    return '\x7f';
  }

  if (key.length === 1) {
    let ch = key;
    if (modifiers.ctrl) {
      ch = ctrlEncode(ch);
    }
    if (modifiers.alt) {
      ch = '\x1b' + ch;
    }
    return ch;
  }

  return '';
}

function buildKeyBar() {
  const bar = document.createElement('div');
  bar.id = 'mobile-keybar';
  bar.hidden = true;
  document.body.appendChild(bar);
  return bar;
}

function rebuildMobileKeyBar() {
  const bar = document.getElementById('mobile-keybar');
  if (!bar) return;
  bar.innerHTML = '';

  for (const k in modButtons) {
    delete modButtons[k];
  }

  const s = (typeof getSettings === 'function') ? getSettings() : {};
  const keys = s.mobileKeys || DEFAULT_MOBILE_KEYS;

  for (const item of keys) {
    const { label, kind, payload } = item;
    const btn = document.createElement('button');
    btn.className = 'keybar-btn' + (kind === 'mod' ? ' keybar-mod' : '') + (kind === 'hide' ? ' keybar-hide' : '');
    btn.textContent = label;
    if (kind === 'mod') modButtons[payload] = btn;

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (kind === 'mod') {
        toggleMod(payload);
      } else if (kind === 'hide') {
        if (document.activeElement) {
          document.activeElement.blur();
        }
      } else if (kind === 'combo') {
        const bytes = parseCombo(payload);
        if (bytes) sendToActiveTerm(bytes);
      } else {
        sendToActiveTerm(unescapePayload(payload));
      }
    });
    bar.appendChild(btn);
  }

  refreshModButtons();
}

function initMobileKeyBar() {
  const bar = buildKeyBar();
  rebuildMobileKeyBar();

  // Ride just above the soft keyboard using visualViewport tracking.
  // Instead of translating with fixed positioning (which gets displaced by browser auto-scroll),
  // we absolute position both #app and the bar to match the exact visualViewport box.
  const position = () => {
    const vv = window.visualViewport;
    if (!vv) return;

    const appEl = document.getElementById('app');
    if (appEl) {
      if (!bar.hidden) {
        // Map #app to cover the visual viewport completely
        appEl.style.position = 'absolute';
        appEl.style.top = `${vv.offsetTop}px`;
        appEl.style.left = `${vv.offsetLeft}px`;
        appEl.style.width = `${vv.width}px`;
        appEl.style.height = `${vv.height}px`;
        appEl.style.paddingBottom = `${bar.offsetHeight}px`;

        // Position keybar at the bottom of the visual viewport
        bar.style.position = 'absolute';
        bar.style.top = `${vv.offsetTop + vv.height - bar.offsetHeight}px`;
        bar.style.left = `${vv.offsetLeft}px`;
        bar.style.width = `${vv.width}px`;
        bar.style.transform = '';
      } else {
        appEl.style.position = '';
        appEl.style.top = '';
        appEl.style.left = '';
        appEl.style.width = '';
        appEl.style.height = '';
        appEl.style.paddingBottom = '';

        bar.style.position = '';
        bar.style.top = '';
        bar.style.left = '';
        bar.style.width = '';
        bar.style.transform = '';
      }
    }
  };

  let hideTimer;
  const show = () => {
    if (!isMobileLike()) return;
    clearTimeout(hideTimer);
    bar.hidden = false;
    position();
  };
  const hide = () => {
    bar.hidden = true;
    clearStickyMods();
    const appEl = document.getElementById('app');
    if (appEl) {
      appEl.style.position = '';
      appEl.style.top = '';
      appEl.style.left = '';
      appEl.style.width = '';
      appEl.style.height = '';
      appEl.style.paddingBottom = '';
    }
    bar.style.position = '';
    bar.style.top = '';
    bar.style.left = '';
    bar.style.width = '';
    bar.style.transform = '';

    // Reset scroll offset back to top-left
    window.scrollTo(0, 0);
  };

  // Show only while a terminal's hidden textarea is focused (keyboard is up).
  document.addEventListener('focusin', (e) => {
    if (e.target.classList?.contains('xterm-helper-textarea')) show();
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.classList?.contains('xterm-helper-textarea')) hideTimer = setTimeout(hide, 150);
  });

  window.visualViewport?.addEventListener('resize', () => { if (!bar.hidden) position(); });
  window.visualViewport?.addEventListener('scroll', () => { if (!bar.hidden) position(); });

  // Prevent background rubber-band scrolling on touch gestures when keyboard is active
  const preventScroll = (e) => {
    if (bar.hidden) return;

    let target = e.target;
    let canScroll = false;
    while (target && target !== document.body && target !== document.documentElement) {
      if (target.classList.contains('xterm-viewport') ||
          target.classList.contains('pane-tabs') ||
          target.classList.contains('browser-view') ||
          target.classList.contains('settings-panel') ||
          target.classList.contains('editor-sidebar') ||
          target.classList.contains('editor-tree') ||
          target.classList.contains('editor-filetabs') ||
          target.classList.contains('editor-git') ||
          target.classList.contains('keybar-btn') ||
          target.id === 'mobile-keybar' ||
          window.getComputedStyle(target).overflowY === 'auto' ||
          window.getComputedStyle(target).overflowY === 'scroll' ||
          window.getComputedStyle(target).overflowX === 'auto' ||
          window.getComputedStyle(target).overflowX === 'scroll') {
        canScroll = true;
        break;
      }
      target = target.parentElement;
    }

    if (!canScroll) {
      e.preventDefault();
    }
  };

  document.addEventListener('touchmove', preventScroll, { passive: false });
}

function initMobileMenu() {
  const menuBtn = document.getElementById('btn-menu');
  const groupExtra = document.getElementById('toolbar-group-extra');
  if (!menuBtn || !groupExtra) return;

  const closeMenu = () => {
    groupExtra.classList.remove('open');
    menuBtn.classList.remove('active');
  };

  const openMenu = () => {
    groupExtra.classList.add('open');
    menuBtn.classList.add('active');
  };

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (groupExtra.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  // Close the menu when clicking on any action button inside the dropdown
  groupExtra.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (button) {
      closeMenu();
    }
  });

  // Light dismiss: Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!groupExtra.contains(e.target) && e.target !== menuBtn && !menuBtn.contains(e.target)) {
      closeMenu();
    }
  });
}

function checkToolbarButtonsFit() {
  const toolbar = document.getElementById('toolbar');
  const logo = document.getElementById('logo');
  const clock = document.getElementById('toolbar-clock');
  const actions = document.getElementById('toolbar-actions');
  
  if (!toolbar || !logo || !actions) return true;

  // Verify that the stylesheet has loaded and applied
  if (window.getComputedStyle(toolbar).display !== 'flex') {
    return true;
  }

  const htmlEl = document.documentElement;
  const wasMobile = htmlEl.classList.contains('mobile-ui');

  // Temporarily remove mobile-ui to measure desktop layout
  if (wasMobile) {
    htmlEl.classList.remove('mobile-ui');
  }

  // Temporarily prevent actions from shrinking and force natural layout
  const oldFlexShrink = actions.style.flexShrink;
  const oldWidth = actions.style.width;
  actions.style.flexShrink = '0';
  actions.style.width = 'max-content';

  // Measure widths
  const logoWidth = logo.getBoundingClientRect().width;
  const clockWidth = (clock && !clock.hidden) ? clock.getBoundingClientRect().width : 0;
  const actionsWidth = actions.getBoundingClientRect().width;
  const toolbarWidth = toolbar.getBoundingClientRect().width;

  // Restore styles
  actions.style.flexShrink = oldFlexShrink;
  actions.style.width = oldWidth;

  if (wasMobile) {
    htmlEl.classList.add('mobile-ui');
  }

  // Width calculation:
  // logo + clock (if visible) + actions + horizontal padding + gaps
  // padding in desktop: 14px * 2 = 28px
  // gap between logo and clock (or actions) = 24px
  // gap between clock and actions = 12px (clock margin-right is 12px)
  // Let's add a safety margin of 20px
  const paddingAndGaps = (clockWidth > 0) ? (28 + 24 + 12 + 20) : (28 + 24 + 20);
  const requiredWidth = logoWidth + clockWidth + actionsWidth + paddingAndGaps;
  return toolbarWidth >= requiredWidth;
}

function updateUiMode() {
  const s = (typeof getSettings === 'function') ? getSettings() : {};
  const mode = s.uiMode || 'auto';
  
  let shouldCollapse = false;
  if (mode === 'mobile') {
    shouldCollapse = true;
  } else if (mode === 'desktop') {
    shouldCollapse = false;
  } else {
    // auto mode
    const fits = checkToolbarButtonsFit();
    shouldCollapse = isMobileLike() || !fits;
  }

  document.documentElement.classList.toggle('mobile-ui', shouldCollapse);

  // Fit active terminals if UI mode changed
  if (typeof getAllPanes === 'function') {
    getAllPanes().forEach(p => p.tabs.forEach(t => {
      if (t.term && t.fitAddon && t.viewEl.classList.contains('active')) {
        requestAnimationFrame(() => {
          try {
            t.fitAddon.fit();
            if (typeof refreshMobileScrollbar === 'function') refreshMobileScrollbar(t);
          } catch {}
        });
      }
    }));
  }

  if (typeof refreshAllMobileScrollbars === 'function') refreshAllMobileScrollbars();
}

document.addEventListener('DOMContentLoaded', () => {
  initMobileKeyBar();
  initMobileMenu();
  updateUiMode();
  if (typeof refreshAllMobileScrollbars === 'function') refreshAllMobileScrollbars();
  window.addEventListener('resize', () => {
    updateUiMode();
    if (typeof refreshAllMobileScrollbars === 'function') refreshAllMobileScrollbars();
  });
  window.addEventListener('load', () => {
    updateUiMode();
    if (typeof refreshAllMobileScrollbars === 'function') refreshAllMobileScrollbars();
  });
  if (document.fonts) {
    document.fonts.ready.then(() => {
      updateUiMode();
    });
  }
});

function getAllTerminalTabs() {
  const tabs = [];
  if (typeof getAllPanes === 'function') {
    getAllPanes().forEach(p => p.tabs.forEach(t => {
      if (t.type === 'terminal' && t.term) {
        tabs.push(t);
      }
    }));
  }
  return tabs;
}

function refreshAllMobileScrollbars() {
  getAllTerminalTabs().forEach(tab => {
    refreshMobileScrollbar(tab);
  });
}

function refreshMobileScrollbar(tab) {
  if (tab.type !== 'terminal' || !tab.term) return;

  const s = (typeof getSettings === 'function') ? getSettings() : {};
  const enabled = s.mobileScrollbar !== false && isMobileLike();

  let track = tab.viewEl.querySelector('.mobile-scrollbar-track');

  if (!enabled) {
    if (track) {
      track.remove();
      if (tab.mobileScrollDis) { tab.mobileScrollDis.dispose(); tab.mobileScrollDis = null; }
      if (tab.mobileLfDis) { tab.mobileLfDis.dispose(); tab.mobileLfDis = null; }
      if (tab.mobileResizeDis) { tab.mobileResizeDis.dispose(); tab.mobileResizeDis = null; }
      tab.updateMobileScrollbar = null;
    }
    return;
  }

  if (!track) {
    track = document.createElement('div');
    track.className = 'mobile-scrollbar-track';
    
    const thumb = document.createElement('div');
    thumb.className = 'mobile-scrollbar-thumb';
    track.appendChild(thumb);
    
    tab.viewEl.appendChild(track);

    let isDragging = false;
    let startY = 0;
    let startViewportY = 0;

    const updateScrollbar = () => {
      const term = tab.term;
      if (!term) return;
      const activeBuffer = term.buffer.active;
      const baseY = activeBuffer.baseY;
      const viewportY = activeBuffer.viewportY;

      if (baseY === 0) {
        track.classList.remove('visible');
        return;
      }
      track.classList.add('visible');

      const trackHeight = track.clientHeight;
      if (trackHeight === 0) return;

      const totalLines = baseY + term.rows;
      const ratio = term.rows / totalLines;
      const thumbHeight = Math.max(30, Math.min(trackHeight, trackHeight * ratio));
      const scrollableTrackHeight = trackHeight - thumbHeight;

      const thumbTop = (viewportY / baseY) * scrollableTrackHeight;

      thumb.style.height = `${thumbHeight}px`;
      thumb.style.top = `${thumbTop}px`;
    };

    tab.updateMobileScrollbar = updateScrollbar;

    thumb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isDragging = true;
      startY = e.clientY;
      startViewportY = tab.term.buffer.active.viewportY;
      track.classList.add('active');
      thumb.setPointerCapture(e.pointerId);
    });

    thumb.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      e.stopPropagation();

      const deltaY = e.clientY - startY;
      const trackHeight = track.clientHeight;
      const thumbHeight = thumb.clientHeight;
      const scrollableTrackHeight = trackHeight - thumbHeight;
      if (scrollableTrackHeight <= 0) return;

      const baseY = tab.term.buffer.active.baseY;
      const deltaLines = (deltaY / scrollableTrackHeight) * baseY;
      const targetLine = Math.max(0, Math.min(baseY, Math.round(startViewportY + deltaLines)));

      tab.term.scrollToLine(targetLine);
    });

    const stopDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      track.classList.remove('active');
      try {
        thumb.releasePointerCapture(e.pointerId);
      } catch (err) {}
    };

    thumb.addEventListener('pointerup', stopDrag);
    thumb.addEventListener('pointercancel', stopDrag);

    track.addEventListener('pointerdown', (e) => {
      if (e.target === thumb) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = track.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const thumbHeight = thumb.clientHeight;
      const trackHeight = rect.height;
      const scrollableTrackHeight = trackHeight - thumbHeight;
      if (scrollableTrackHeight <= 0) return;

      const targetTop = clickY - thumbHeight / 2;
      const pct = Math.max(0, Math.min(1, targetTop / scrollableTrackHeight));
      const baseY = tab.term.buffer.active.baseY;
      const targetLine = Math.round(pct * baseY);

      tab.term.scrollToLine(targetLine);

      isDragging = true;
      startY = e.clientY;
      startViewportY = targetLine;
      track.classList.add('active');
      thumb.setPointerCapture(e.pointerId);
    });

    tab.mobileScrollDis = tab.term.onScroll(() => updateScrollbar());
    tab.mobileLfDis = tab.term.onLineFeed(() => updateScrollbar());
    tab.mobileResizeDis = tab.term.onResize(() => updateScrollbar());

    requestAnimationFrame(updateScrollbar);
  } else if (tab.updateMobileScrollbar) {
    tab.updateMobileScrollbar();
  }
}

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

function buildKeyBar() {
  const bar = document.createElement('div');
  bar.id = 'mobile-keybar';
  bar.hidden = true;

  // [label, kind, payload]; kind 'send' = literal bytes, 'mod' = sticky modifier
  const keys = [
    ['Esc', 'send', '\x1b'],
    ['Tab', 'send', '\t'],
    ['Ctrl', 'mod', 'ctrl'],
    ['Alt', 'mod', 'alt'],
    ['Cmd', 'mod', 'meta'],
    ['←', 'send', '\x1b[D'],
    ['↑', 'send', '\x1b[A'],
    ['↓', 'send', '\x1b[B'],
    ['→', 'send', '\x1b[C'],
  ];

  for (const [label, kind, payload] of keys) {
    const btn = document.createElement('button');
    btn.className = 'keybar-btn' + (kind === 'mod' ? ' keybar-mod' : '');
    btn.textContent = label;
    if (kind === 'mod') modButtons[payload] = btn;
    // Act on pointerdown + preventDefault so the terminal's textarea keeps focus
    // and the soft keyboard doesn't dismiss when a bar key is tapped.
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (kind === 'mod') toggleMod(payload);
      else sendToActiveTerm(payload);
    });
    bar.appendChild(btn);
  }

  document.body.appendChild(bar);
  return bar;
}

function initMobileKeyBar() {
  const bar = buildKeyBar();

  // Ride just above the soft keyboard. visualViewport shrinks when the keyboard
  // opens; translate the bar up by however much the keyboard overlaps.
  const position = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    bar.style.transform = `translateY(${-overlap}px)`;
  };

  let hideTimer;
  const show = () => {
    if (!isMobileLike()) return;
    clearTimeout(hideTimer);
    bar.hidden = false;
    position();
  };
  const hide = () => { bar.hidden = true; clearStickyMods(); };

  // Show only while a terminal's hidden textarea is focused (keyboard is up).
  document.addEventListener('focusin', (e) => {
    if (e.target.classList?.contains('xterm-helper-textarea')) show();
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.classList?.contains('xterm-helper-textarea')) hideTimer = setTimeout(hide, 150);
  });

  window.visualViewport?.addEventListener('resize', () => { if (!bar.hidden) position(); });
  window.visualViewport?.addEventListener('scroll', () => { if (!bar.hidden) position(); });
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

document.addEventListener('DOMContentLoaded', () => {
  initMobileKeyBar();
  initMobileMenu();
});

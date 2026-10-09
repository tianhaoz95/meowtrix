// ── Quick Overlay & Dynamic Island Module ────────────────────────────────────
// Handles macOS quick-callout overlay, notch drop-down animation, automatic
// session takeover, and keyboard/blur dismissal.

let isOverlayActive = false;
// Bumped on every summon/dismiss/exit, so a dismiss animation that finishes after the
// overlay was re-summoned doesn't go on to hide the window.
let overlayGeneration = 0;

const isDesktopApp = () => !!(window.__TAURI__ || window.__TAURI_INTERNALS__);

function overlayAnimationStyle(settings) {
  if (settings.quickOverlayAnimation === false) return null;
  return settings.quickOverlayAnimationStyle || window.OVERLAY_ANIMATION_DEFAULT || 'classic';
}

// In the desktop app the native window is transparent; in overlay mode the page drops its
// background so only #app (and the call-out animation around it) is visible.
function setOverlayTransparent(on) {
  document.documentElement.classList.toggle('overlay-transparent', on && isDesktopApp());
}

// Called by the desktop app before a summon: the overlay window starts at the very top of
// the screen (over the menu bar and notch) so notch-style call-out animations can grow out
// of the real notch. `topInset` is the menu-bar/notch strip the page keeps empty, so the
// overlay itself rests below it; the notch size is 0 on displays without one.
function setOverlayScreenGeometry(topInset, notchW, notchH) {
  window.__overlayScreenGeometry = { topInset: +topInset || 0, notchW: +notchW || 0, notchH: +notchH || 0 };
  document.documentElement.style.setProperty('--overlay-top-inset', `${window.__overlayScreenGeometry.topInset}px`);
}

function tauriInvoke(cmd, args = {}) {
  if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
    return window.__TAURI__.core.invoke(cmd, args);
  } else if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
    return window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  return Promise.resolve();
}

// Apply overlay opacity both to CSS variable and native window if in desktop app
function applyOverlayOpacity(opacity) {
  const raw = Number(opacity);
  const op = (!isNaN(raw) && raw >= 0.1 && raw <= 1.0) ? raw : 1.0;
  document.documentElement.style.setProperty('--overlay-opacity', String(op));
  tauriInvoke('set_overlay_opacity', { opacity: op }).catch(() => {});
}

// Summon the quick overlay with Dynamic Island animation and automatic session claim
function summonQuickOverlay() {
  overlayGeneration++;
  isOverlayActive = true;
  setOverlayTransparent(true);
  document.body.classList.add('dynamic-island-active');

  const settings = typeof getSettings === 'function' ? getSettings() : {};
  const opacity = settings.quickOverlayOpacity !== undefined ? settings.quickOverlayOpacity : 1.0;
  applyOverlayOpacity(opacity);

  const style = overlayAnimationStyle(settings);
  if (style && typeof playOverlayAnimation === 'function') {
    playOverlayAnimation('in', style);
  } else if (typeof cancelOverlayAnimation === 'function') {
    cancelOverlayAnimation();
  }

  // Auto-claim active session immediately if enabled
  if (settings.quickOverlayAutoClaim !== false) {
    if (typeof claimActiveSession === 'function') {
      claimActiveSession();
    }
    // Suppress inactive overlay visually so user sees active workspace immediately
    const inactiveOverlay = document.getElementById('inactive-overlay');
    if (inactiveOverlay) {
      inactiveOverlay.hidden = true;
    }
    document.body.classList.remove('session-inactive');
  }

  const wsBadge = document.getElementById('workspace-badge');
  const diWsName = document.getElementById('di-workspace-name');
  if (wsBadge && diWsName) {
    diWsName.textContent = wsBadge.textContent || 'Workspace 1';
  }

  // Ensure terminals fit to overlay dimensions and active terminal gets focus
  requestAnimationFrame(() => {
    if (typeof fitAllTerminals === 'function') {
      fitAllTerminals();
    }
    focusOverlayActiveInput();
  });
}

// Dismiss the quick overlay, animate collapse into the notch, and hide window
function dismissQuickOverlay() {
  if (!isOverlayActive && !document.body.classList.contains('dynamic-island-active')) {
    return;
  }

  const settings = typeof getSettings === 'function' ? getSettings() : {};
  const style = overlayAnimationStyle(settings);
  const gen = ++overlayGeneration;

  const finish = () => {
    if (gen !== overlayGeneration) return; // re-summoned (or exited) meanwhile
    document.body.classList.remove('dynamic-island-active');
    isOverlayActive = false;
    applyOverlayOpacity(1.0);
    notifyNativeOverlayHide();
    // In the desktop app the window stays transparent and the dismiss animation holds its
    // empty end state until the window is next shown (summon or exitOverlayMode), so
    // nothing flashes while the native hide is in flight. In a browser there's no window
    // to hide: restore the page right away.
    if (!isDesktopApp()) {
      if (typeof cancelOverlayAnimation === 'function') cancelOverlayAnimation();
      setOverlayTransparent(false);
    }
  };

  if (style && typeof playOverlayAnimation === 'function') {
    playOverlayAnimation('out', style).then(done => { if (done) finish(); });
  } else {
    finish();
  }
}

// Exit overlay mode without hiding window (switches to normal app window mode)
function exitOverlayMode() {
  overlayGeneration++;
  if (typeof cancelOverlayAnimation === 'function') cancelOverlayAnimation();
  setOverlayTransparent(false);
  document.body.classList.remove('dynamic-island-active');
  isOverlayActive = false;
  applyOverlayOpacity(1.0);
}

// Toggle summon/dismiss
function toggleQuickOverlay() {
  if (isOverlayActive) {
    dismissQuickOverlay();
  } else {
    summonQuickOverlay();
  }
}

// Focus the currently active terminal or editor tab
function focusOverlayActiveInput() {
  setTimeout(() => {
    // Try to find active xterm textarea
    const activePane = document.querySelector('.pane.active, .pane');
    if (activePane) {
      const activeTextarea = activePane.querySelector('.xterm-helper-textarea, textarea, input');
      if (activeTextarea) {
        activeTextarea.focus();
        return;
      }
    }
    // Fallback: Monaco editor textarea
    const monacoInput = document.querySelector('.monaco-mouse-cursor-text');
    if (monacoInput) {
      monacoInput.focus();
    }
  }, 60);
}

// Tell native desktop layer to hide the window
function notifyNativeOverlayHide() {
  fetch('/api/overlay/hide', { method: 'POST' }).catch(() => {});
  tauriInvoke('hide_overlay').catch(() => {});
}

// Initialize Dynamic Island UI and keyboard hooks
function initQuickOverlay() {
  if (window.__TAURI__ || window.__TAURI_INTERNALS__) {
    document.body.classList.add('is-tauri-app');
  }

  // Window dragging / double-click zoom on #window-header is handled by Tauri's
  // built-in data-tauri-drag-region script (see src-tauri/capabilities/remote-window.json).

  // Click on the header collapse button
  const headerCollapseBtn = document.getElementById('header-btn-collapse');
  if (headerCollapseBtn) {
    headerCollapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissQuickOverlay();
    });
  }

  // Click on the Dynamic Island dismiss button
  const dismissBtn = document.getElementById('di-btn-dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissQuickOverlay();
    });
  }

  // Click on the Dynamic Island notch pill to collapse
  const notchPill = document.getElementById('dynamic-island-notch');
  if (notchPill) {
    notchPill.addEventListener('click', (e) => {
      if (e.target.closest('#di-btn-dismiss') || e.target.closest('#header-btn-collapse')) return;
      dismissQuickOverlay();
    });
  }

  // Global Esc key handler when in overlay mode
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOverlayActive) {
      // Don't close overlay if command palette or a modal is currently open
      const palette = document.getElementById('palette-dialog');
      const settingsPanel = document.getElementById('settings-panel');
      if ((palette && !palette.hidden) || (settingsPanel && settingsPanel.classList.contains('open'))) {
        return;
      }
      e.preventDefault();
      dismissQuickOverlay();
    }
  }, true);

  // Expose globally for Tauri eval calls
  window.summonQuickOverlay = summonQuickOverlay;
  window.dismissQuickOverlay = dismissQuickOverlay;
  window.exitOverlayMode = exitOverlayMode;
  window.setOverlayScreenGeometry = setOverlayScreenGeometry;
  window.toggleQuickOverlay = toggleQuickOverlay;
  window.applyOverlayOpacity = applyOverlayOpacity;
  window.__meowtrixHide = notifyNativeOverlayHide;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initQuickOverlay);
} else {
  initQuickOverlay();
}

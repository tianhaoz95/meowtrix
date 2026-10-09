// ── Quick Overlay & Dynamic Island Module ────────────────────────────────────
// Handles macOS quick-callout overlay, notch drop-down animation, automatic
// session takeover, and keyboard/blur dismissal.

let isOverlayActive = false;
let isOverlayAnimating = false;

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
  isOverlayActive = true;
  document.body.classList.add('dynamic-island-active');

  const settings = typeof getSettings === 'function' ? getSettings() : {};
  const animate = settings.quickOverlayAnimation !== false;
  const opacity = settings.quickOverlayOpacity !== undefined ? settings.quickOverlayOpacity : 1.0;
  applyOverlayOpacity(opacity);

  if (animate) {
    document.body.classList.remove('dynamic-island-collapsing');
    document.body.classList.add('dynamic-island-animating');
    setTimeout(() => {
      document.body.classList.remove('dynamic-island-animating');
    }, 400);
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
  const animate = settings.quickOverlayAnimation !== false;

  if (animate) {
    document.body.classList.remove('dynamic-island-animating');
    document.body.classList.add('dynamic-island-collapsing');

    setTimeout(() => {
      document.body.classList.remove('dynamic-island-collapsing');
      document.body.classList.remove('dynamic-island-active');
      isOverlayActive = false;
      applyOverlayOpacity(1.0);
      notifyNativeOverlayHide();
    }, 200);
  } else {
    document.body.classList.remove('dynamic-island-active');
    isOverlayActive = false;
    applyOverlayOpacity(1.0);
    notifyNativeOverlayHide();
  }
}

// Exit overlay mode without hiding window (switches to normal app window mode)
function exitOverlayMode() {
  document.body.classList.remove('dynamic-island-active', 'dynamic-island-animating', 'dynamic-island-collapsing');
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

// Initialize Dynamic Island UI, window dragging, and keyboard hooks
function initQuickOverlay() {
  if (window.__TAURI__ || window.__TAURI_INTERNALS__) {
    document.body.classList.add('is-tauri-app');
  }

  // Window header dragging and double-click to maximize/zoom
  const windowHeader = document.getElementById('window-header');
  if (windowHeader) {
    windowHeader.addEventListener('mousedown', (e) => {
      if (e.target.closest('button, input, select, textarea, a, .dynamic-island-pill, .window-header-traffic-spacer')) {
        return;
      }
      if (e.button === 0) {
        tauriInvoke('start_window_drag').catch(() => {});
      }
    });
    windowHeader.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, input, select, textarea, a, .dynamic-island-pill, .window-header-traffic-spacer')) {
        return;
      }
      tauriInvoke('maximize_window').catch(() => {});
    });
  }

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
  window.toggleQuickOverlay = toggleQuickOverlay;
  window.applyOverlayOpacity = applyOverlayOpacity;
  window.__meowtrixHide = notifyNativeOverlayHide;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initQuickOverlay);
} else {
  initQuickOverlay();
}

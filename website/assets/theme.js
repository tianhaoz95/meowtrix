/* Meowtrix project site — light/dark/system theme switcher.
   A "mode" (light | dark | system) is stored in localStorage; the default is
   "system", which auto-detects and live-tracks the OS color-scheme. The mode is
   resolved to a concrete theme and applied as a `data-theme` attribute on
   <html>. The early inline snippet in each page's <head> applies it before first
   paint (avoiding a flash); this file wires up the toggle, which cycles
   system → light → dark → system. */
(function () {
  var KEY = 'meowtrix-theme';
  var MODES = ['system', 'light', 'dark'];

  function systemTheme() {
    return window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function currentMode() {
    try {
      var m = localStorage.getItem(KEY);
      return MODES.indexOf(m) !== -1 ? m : 'system';
    } catch (e) { return 'system'; }
  }

  function resolve(mode) {
    return mode === 'system' ? systemTheme() : mode;
  }

  function apply(mode) {
    document.documentElement.setAttribute('data-theme', resolve(mode));
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.setAttribute('data-mode', mode);
      var label = mode === 'system'
        ? 'Theme: system (matches your OS) — click for light'
        : mode === 'light'
          ? 'Theme: light — click for dark'
          : 'Theme: dark — click for system';
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
  }

  function setMode(mode) {
    try { localStorage.setItem(KEY, mode); } catch (e) {}
    apply(mode);
  }

  function init() {
    apply(currentMode());
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.addEventListener('click', function () {
        var next = MODES[(MODES.indexOf(currentMode()) + 1) % MODES.length];
        setMode(next);
      });
    }
  }

  // Live-track the OS preference while in (or defaulting to) system mode.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
      if (currentMode() === 'system') apply('system');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

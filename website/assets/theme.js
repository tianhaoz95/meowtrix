/* Meowtrix project site — light/dark theme switcher.
   The chosen theme is stored in localStorage and applied as a `data-theme`
   attribute on <html>. The early inline snippet in each page's <head> applies
   the stored/system theme before first paint (avoiding a flash); this file just
   wires up the toggle button and keeps things in sync with the OS preference. */
(function () {
  var KEY = 'meowtrix-theme';

  function systemTheme() {
    return window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function currentTheme() {
    try { return localStorage.getItem(KEY) || systemTheme(); }
    catch (e) { return systemTheme(); }
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      btn.title = theme === 'light'
        ? 'Switch to dark theme' : 'Switch to light theme';
    }
  }

  function setTheme(theme) {
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    apply(theme);
  }

  // Reflect the current state on load and bind the toggle.
  function init() {
    apply(currentTheme());
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.addEventListener('click', function () {
        var next = document.documentElement.getAttribute('data-theme') === 'light'
          ? 'dark' : 'light';
        setTheme(next);
      });
    }
  }

  // Follow OS changes only while the user hasn't made an explicit choice.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function (e) {
      try { if (localStorage.getItem(KEY)) return; } catch (err) {}
      apply(e.matches ? 'light' : 'dark');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

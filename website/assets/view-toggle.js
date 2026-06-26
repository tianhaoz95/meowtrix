/* Meowtrix project site — hero device preview toggle.
   Switches the hero showcase between the desktop browser mockup and the phone
   frame by flipping `data-view` on `.hero-showcase`. The theme (light/dark) is
   handled separately by theme.js; each device preview holds both theme images
   and CSS shows the one matching the active `data-theme`. */
(function () {
  function init() {
    var showcase = document.querySelector('.hero-showcase');
    if (!showcase) return;
    var btns = showcase.querySelectorAll('.view-toggle-btn');
    if (!btns.length) return;

    function select(view) {
      showcase.setAttribute('data-view', view);
      btns.forEach(function (b) {
        var on = b.getAttribute('data-view') === view;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }

    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        select(b.getAttribute('data-view'));
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

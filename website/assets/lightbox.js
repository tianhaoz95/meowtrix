/* Meowtrix project site — screenshot lightbox.
   Clicking the hero screenshot (landing page) or a feature recording (features
   page) opens an enlarged copy floating over the page. Closes on click anywhere
   in the overlay, the × button, or the Esc key. The shown image follows the
   active theme (the visible .app-screenshot) when there's more than one. */
(function () {
  function init() {
    // Landing page: the desktop browser mockup and the phone frame each hold a
    // screenshot (only one visible at a time via the device toggle). Features
    // page: each .feat-media holds a single GIF. Both enlarge on click.
    var wraps = document.querySelectorAll('.screenshot-wrapper, .mob-viewport, .feat-media');
    if (!wraps.length) return;

    var overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Enlarged screenshot');

    var img = document.createElement('img');
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'lightbox-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '&times;';

    overlay.appendChild(img);
    overlay.appendChild(close);
    document.body.appendChild(overlay);

    var currentHighresLoad = null;

    function visibleShot(wrap) {
      // Prefer the theme-aware .app-screenshot pair (landing page); fall back to
      // the single <img> inside a wrapper (feature GIFs).
      var shots = wrap.querySelectorAll('.app-screenshot');
      if (!shots.length) shots = wrap.querySelectorAll('img');
      for (var i = 0; i < shots.length; i++) {
        if (shots[i].offsetParent !== null) return shots[i];
      }
      return shots[0];
    }

    function open(wrap) {
      var shot = visibleShot(wrap);
      if (!shot) return;
      var lowresUrl = shot.currentSrc || shot.src;
      var highresUrl = shot.getAttribute('data-highres');

      if (currentHighresLoad) {
        currentHighresLoad.onload = null;
        currentHighresLoad = null;
      }

      // Show low-res version immediately
      img.src = lowresUrl;
      img.alt = shot.alt || 'Enlarged screenshot';
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';

      if (highresUrl) {
        var loader = new Image();
        currentHighresLoad = loader;

        loader.onload = function () {
          if (currentHighresLoad === loader) {
            img.src = highresUrl;
          }
        };

        loader.src = highresUrl;

        // If already cached and loaded
        if (loader.complete) {
          img.src = highresUrl;
        }
      }
    }

    function hide() {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      if (currentHighresLoad) {
        currentHighresLoad.onload = null;
        currentHighresLoad = null;
      }
    }

    wraps.forEach(function (wrap) {
      wrap.addEventListener('click', function () { open(wrap); });
    });
    overlay.addEventListener('click', hide);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) hide();
    });

    // Background preload of high-res images after the page loads
    window.addEventListener('load', function () {
      setTimeout(function () {
        var shots = document.querySelectorAll('img[data-highres]');
        shots.forEach(function (shot) {
          var highresUrl = shot.getAttribute('data-highres');
          if (highresUrl) {
            var tempImg = new Image();
            tempImg.src = highresUrl;
          }
        });
      }, 500);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

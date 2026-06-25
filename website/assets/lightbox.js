/* Meowtrix project site — screenshot lightbox.
   Clicking the hero screenshot opens an enlarged copy floating over the page.
   Closes on click anywhere in the overlay, the × button, or the Esc key. The
   shown image follows the active theme (the visible .app-screenshot). */
(function () {
  function init() {
    var wrap = document.querySelector('.screenshot-wrapper');
    if (!wrap) return;

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

    function visibleShot() {
      var shots = wrap.querySelectorAll('.app-screenshot');
      for (var i = 0; i < shots.length; i++) {
        if (shots[i].offsetParent !== null) return shots[i];
      }
      return shots[0];
    }

    function open() {
      var shot = visibleShot();
      if (!shot) return;
      img.src = shot.currentSrc || shot.src;
      img.alt = shot.alt || 'Enlarged screenshot';
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function hide() {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    wrap.addEventListener('click', open);
    overlay.addEventListener('click', hide);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) hide();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

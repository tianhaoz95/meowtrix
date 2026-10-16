// Meowtrix's site moved into the HEJI apps site. Map /meowtrix/<path> to the same page there.
(function () {
  var base = 'https://tianhaoz95.github.io/hejitech-apps/meowtrix/site/';
  var rest = location.pathname.replace(/^\/meowtrix\/?/, '').replace(/^index\.html$/, '');
  location.replace(base + rest + location.search + location.hash);
})();

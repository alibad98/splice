/* Slips App Snippet stub. Static and identical for every store (AD-7).
 * Sets one window.__slips guard, loads only from the Slips CDN/API origins, fails silently. */
(function (win) {
  'use strict';
  try {
    if (win.__slips) return; // second boot exits
    var CDN = 'https://cdn.slips.app';
    var API = 'https://api.slips.app';
    var CHANNEL = 'stable'; // stable/canary pointer is resolved by the loader path
    var TIMEOUT_MS = 5000;
    var ALLOWED = [CDN, API];
    win.__slips = { v: 1, api: API, channel: CHANNEL };
    var src = CDN + '/player/' + CHANNEL + '/loader.js';
    var origin = new win.URL(src).origin;
    if (ALLOWED.indexOf(origin) === -1) return;
    var doc = win.document;
    var s = doc.createElement('script');
    s.async = true;
    s.src = src;
    var drop = function () {
      try {
        if (s.parentNode) s.parentNode.removeChild(s);
      } catch {
        /* silent */
      }
    };
    s.onerror = drop;
    win.setTimeout(function () {
      if (!win.__slips || !win.__slips.ready) drop();
    }, TIMEOUT_MS);
    (doc.head || doc.documentElement).appendChild(s);
  } catch {
    /* fail silently: the stub must never break the merchant's page */
  }
})(window);

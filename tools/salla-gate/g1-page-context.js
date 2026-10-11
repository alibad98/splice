/* Gate G1 (+G7 hints, G8 consent hints). Paste into the browser console on a storefront page of the demo store
 * (home, a category, a product). Nothing is sent anywhere. Copy the printed JSON into docs/spike-findings.md.
 * Run it once per page type per theme. */
(async function () {
  var out = { url: location.href, theme: null, time: new Date().toISOString() };
  var s = window.salla, get = function (k) { try { return s && s.config && s.config.get(k); } catch (e) { return 'ERR:' + e.message; } };
  out.sallaPresent = !!s;
  out.config = {};
  ['page.slug', 'page.id', 'store.id', 'store.username', 'user.language_code', 'languages', 'store.features', 'theme.name']
    .forEach(function (k) { out.config[k] = get(k); });
  out.html = { lang: document.documentElement.lang, dir: document.documentElement.dir };
  out.categoryIdFromUrl = (/\/c(\d+)(?:[/?#]|$)/.exec(location.pathname) || [])[1] || null;
  out.snippetScripts = Array.prototype.map.call(document.querySelectorAll('script[src]'), function (el) { return el.src; })
    .filter(function (u) { return /salla|slips/i.test(u); });
  out.slips = window.__slips || null; // present when the Slips stub ran; .page / .store when the loader booted
  out.rocketLoader = !!document.querySelector('script[src*="rocket-loader"], script[data-cf-settings]');
  // Consent hints (G8)
  try { out.consent = { storage: s && s.storage && s.storage.get('cookies-consent'), cookieBarPresent: !!document.querySelector('salla-cookies-bar') }; } catch (e) { out.consent = 'ERR:' + e.message; }
  // Reserved space / layout shift (AD-8): CLS observed so far.
  try {
    var cls = 0;
    new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (!e.hadRecentInput) cls += e.value; }); }).observe({ type: 'layout-shift', buffered: true });
    await new Promise(function (r) { setTimeout(r, 500); });
    out.clsSoFar = cls;
  } catch (e) { out.clsSoFar = 'n/a'; }
  // CSP: response header is not readable from JS, so re-fetch the page headers + listen for violations.
  out.csp = { headerEnforced: null, headerReportOnly: null, metaTag: (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || null, violations: [] };
  try {
    var r = await fetch(location.href, { method: 'GET', credentials: 'same-origin' });
    out.csp.headerEnforced = r.headers.get('content-security-policy');
    out.csp.headerReportOnly = r.headers.get('content-security-policy-report-only');
  } catch (e) { out.csp.headerError = e.message; }
  document.addEventListener('securitypolicyviolation', function (e) {
    out.csp.violations.push({ directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile });
    console.warn('[G1] CSP violation', e.violatedDirective, e.blockedURI);
  });
  // Probe the origins Slips needs (edit them if your staging origins differ): script, connect, media, image.
  var ORIGINS = window.SLIPS_GATE_ORIGINS || { api: 'https://api.slips.app/v1/health', cdn: 'https://cdn.slips.app/', media: 'https://media.slips.app/' };
  out.probes = {};
  for (var name in ORIGINS) {
    try { await fetch(ORIGINS[name], { mode: 'no-cors' }); out.probes[name] = 'fetch allowed (opaque ok)'; }
    catch (e) { out.probes[name] = 'fetch FAILED: ' + e.message + ' (check violations / network tab)'; }
  }
  await new Promise(function (r) { setTimeout(r, 800); });
  console.log('[G1] page context result (copy this):\n' + JSON.stringify(out, null, 2));
  window.__slipsGateG1 = out;
  return out;
})();

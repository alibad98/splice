/* Gates G2 and G3. Paste into the browser console on the demo store (any page where window.salla exists), with
 * your own TEST product ids. Edit the two ids below first (or set window.SLIPS_GATE_IDS before pasting).
 * It adds one simple product and one product with required options to the CURRENT cart, logs every response and the
 * cart events, and leaves everything in window.__slipsGate so you can copy it with: copy(JSON.stringify(window.__slipsGate, null, 2))
 * Run once as a guest (signed out) and once signed in. Use a throwaway store: it really adds items. */
(async function () {
  var IDS = window.SLIPS_GATE_IDS || { simple: 0, withOptions: 0 }; // <-- EDIT: numeric product ids
  var log = (window.__slipsGate = { time: new Date().toISOString(), url: location.href, signedIn: !!(salla.config.get('user') && salla.config.get('user.id')), events: [], steps: [] });
  var note = function (name, data) { var e = { t: Date.now(), name: name, data: data }; log.events.push(e); console.log('[G2/G3] event', name, data); };
  var step = function (name, data) { log.steps.push({ name: name, data: data }); console.log('[G2/G3]', name, data); };
  var safe = function (v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return String(v); } };
  if (!window.salla || !IDS.simple) { console.error('[G2/G3] need window.salla and IDS.simple'); return; }

  ['cart::item.added', 'cart::item.added.failed', 'cart::updated', 'cart::item.updated', 'cart::before.add.item'].forEach(function (ev) {
    try { salla.event.on(ev, function (p) { note(ev, safe(p)); }); } catch (e) { step('listen ' + ev + ' failed', e.message); }
  });

  async function add(label, payload) {
    var before = Date.now();
    try {
      var res = await salla.cart.addItem(payload);
      step(label + ': OK', { ms: Date.now() - before, cartId: res && res.data && res.data.cart && res.data.cart.id, response: safe(res) });
      return res;
    } catch (err) {
      step(label + ': FAILED', { ms: Date.now() - before, status: err && err.response && err.response.status, body: safe(err && err.response && err.response.data), message: err && err.message, raw: safe(err) });
    }
  }

  // G2: simple product, with a tag in notes (also used for G4) and without.
  await add('G2 simple (qty 1)', { id: IDS.simple, quantity: 1 });
  await add('G2 simple with notes tag', { id: IDS.simple, quantity: 1, notes: 'slips:gate-test' });
  await add('G2 invalid id (expect failure shape)', { id: 999999999, quantity: 1 });
  try { var q = await salla.cart.quickAdd(IDS.simple, 1); step('G2 quickAdd: OK', safe(q)); } catch (e) { step('G2 quickAdd: FAILED', safe(e)); }
  try { step('G2 cart id now', salla.cart.api.getCurrentCartId ? await salla.cart.api.getCurrentCartId() : 'api.getCurrentCartId missing'); } catch (e) { step('cart id error', e.message); }
  step('G2 theme mini-cart', 'LOOK at the header cart counter now: did it update without reload? Write yes/no in the findings.');

  // G3: product with required options.
  if (IDS.withOptions) {
    var opts;
    try { opts = await salla.product.api.fetchOptions([IDS.withOptions]); step('G3 fetchOptions', safe(opts)); } catch (e) { step('G3 fetchOptions FAILED', safe(e)); }
    try { var det = await salla.product.getDetails(IDS.withOptions, ['options']); step('G3 getDetails(options)', safe(det)); } catch (e) { step('G3 getDetails FAILED', safe(e)); }
    // Build a selection automatically: first value of every select/radio/colour option; a text for text options.
    var list = [];
    try { var d = opts && (opts.data || opts); list = (Array.isArray(d) ? d : (d && (d[IDS.withOptions] || d.options))) || []; } catch (e) {}
    var selection = {};
    (Array.isArray(list) ? list : []).forEach(function (o) {
      if (o.values && o.values.length) selection[o.id] = o.values[0].id; else if (o.type === 'text' || o.type === 'input') selection[o.id] = 'test';
    });
    step('G3 selection built (CHECK it covers every required option; edit and re-run add if not)', selection);
    await add('G3 options without selection (expect validation failure)', { id: IDS.withOptions, quantity: 1 });
    await add('G3 options with selection', { id: IDS.withOptions, quantity: 1, options: selection });
    try { var price = await salla.product.getPrice({ id: IDS.withOptions, quantity: 1, options: selection }); step('G3 getPrice', safe(price)); } catch (e) { step('G3 getPrice FAILED', safe(e)); }
    step('G3 compare', 'Open the cart: does the line price equal getPrice? Test an out-of-stock variant by hand too.');
  } else step('G3 skipped', 'set IDS.withOptions');

  console.log('[G2/G3] DONE. Copy results with: copy(JSON.stringify(window.__slipsGate, null, 2))');
})();

# Salla spike findings (Epic 1 gate G1 to G8)

**Status: hands-on run on a demo store 2026-10-25; conditional go signed off by Ali on 2026-10-25.** Results below were confirmed on Salla demo store 73897098 unless marked deferred. "Desk verdict" comes from `docs/salla-desk-research.md` (2026-10-10). Hands-on results are all PENDING. Follow `docs/runbooks/salla-gate-testing.md`; tools are in `tools/salla-gate/`.

Demo store: متجر تجريبي / 73897098  Partners app id: 784019 (private app "Splice")  Themes tested: default theme (id 1298199463), Astra (id 2046553023); third theme deferred to pilot  Date: 2026-10-25  Tester: Ali

## Gate results

| Gate | Capability | Desk verdict | Hands-on result | Evidence | Fallback if failed | Affected FRs |
|---|---|---|---|---|---|---|
| G1 | Storefront injection (App Snippet, page type, ids, CSP, reserved space) | Likely pass | **PASS on 2 of 3 themes** (2026-10-25); third theme and reserved-space CLS still open | Default theme (id 1298199463) and Astra (id 2046553023): home `index`, category `product.index` + `page.id`, product `product.single` + `page.id`; App Snippet injected with no theme edit (after reinstall); no CSP beyond `frame-ancestors`; loader requests reached our origin. See hands-on log. | Guided manual snippet (FR17 guide); if neither works: no-go on storefront | FR1, FR2, FR17 |
| G2 | Add to cart, simple products (guest and signed in) | Likely pass | **PASS (guest)** 2026-10-25; signed-in run deferred to pilot | `addItem` and `quickAdd` 200 in about 1 s, cart events fire, theme cart counter updates live; unknown id gives 410. See hands-on log. | Open the product page, CTA "View product"; no reliable cart path: no-go on in-content purchase | FR11, FR23 |
| G3 | Add to cart, products with required options | Likely pass (needs Slips option picker) | **PASS (variants, guest)** 2026-10-25; out-of-stock variant, per-variant price, multi-option combos and required text field deferred to pilot | `fetchOptions` gives options with `details[]` and `is_out`; missing choice 422 naming the option; clean product: S and M map to the right lines, repeat add merges. | Keep FR23: "View options" opens the product page | FR23 |
| G4 | Cart tagging echoed in orders | Unclear | **DEFERRED to pilot store** (2026-10-25): demo store cannot check out (online gateway shows "store under maintenance"; cash on delivery needs ownership verification with real identity and bank data) | `notes` is accepted on add to cart and splits the cart line; whether it reaches `order.created` is untested. | Order note or thank-you beacon with documented accuracy loss; else FR13 demoted to "assisted orders" and E3 re-decided | FR13 |
| G5 | Install and billing events and plan structure | Likely pass, with gaps | **Install events PASS; billing DEFERRED** (2026-10-25) | Easy Mode: `app.installed` then `app.store.authorize` about 3 s later; uninstall and reinstall restore the store (epoch 2). Plans, trials and subscription events not tested. | Manual plan assignment by Slips Admin for the pilot | FR28 and billing (Story 7.2a) |
| G6 | Webhook lifecycle (signature, retries, ordering) | Likely pass | **PASS (signature, ordering, replay)**; retry timing deferred to pilot (2026-10-25) | Header `x-salla-signature`, no event id header; `created_at` is UTC+3 local without offset; stale events after reinstall ignored; fixtures recorded (app and product events). | Periodic reconciliation polling (FR25); FR24 bounds relaxed | FR24, FR25 |
| G7 | Store time zone from Salla | Likely fallback | **FAIL: fallback adopted** (2026-10-25) | `store/info` 200 has no time zone field (`kyc_country: SA`, `currency: SAR` only); `settings?entity=store/products/orders` have no time zone setting; webhook `created_at` is UTC+3 local time without offset. See hands-on log. | Asia/Riyadh default with a merchant setting | FR8 |
| G8 | Dashboard re-entry and consent signal | Re-entry likely pass; consent unclear | **DEFERRED to pilot store** (2026-10-25); fallback already built | Direct-link OAuth sign-in (Story 1.9) and email/password sign-in exist. No cookie bar on the demo store by default. | Separate OAuth login link; consent default per Q-18 | FR28, Q-18 |

## Items to verify (from `_bmad-output/implementation-artifacts/deferred-work.md` and specs, tagged "verify in Story 1.11-1.13")

- [ ] Salla OAuth, user-info and Admin API response shapes, refresh-failure semantics and webhook signature match the adapter fixtures (Story 1.8).
- [ ] Embedded introspection shape (exchange-authority endpoint, `S-Source`, `merchant_id`/`exp`) and iframe behaviour (`getToken` from the URL, `auth.refresh`, `Sec-Fetch-Dest`, `s.salla.sa` framing origin; `EMBED_ALLOWED_ORIGIN` overrides) (Story 1.9).
- [ ] App binding of the embedded token: the documented introspection response has no app id or audience; the adapter checks `app_id`/`aud`/`client_id` only if present, otherwise relies on the `S-Source` header (Story 1.9, security review).
- [ ] Webhook signature header and encoding (hex HMAC-SHA256 of the raw body), absence of an event id (we hash the raw body, so a retry resends the same bytes), authorize payload fields (`data.access_token`, `refresh_token`, `expires`, `scope`), and presence and format of `created_at` (Story 1.10).
- [ ] Real event ordering and timestamps (worst case a stale event is applied once) (Story 1.10).
- [ ] Owner to confirm staff access: any Salla user who can open the app in a store's dashboard gets that store's merchant session (not a hands-on check; a decision).

## Hands-on log

### 2026-10-25: install, uninstall, reinstall (partial G5, G6)

- **Signature:** every Salla webhook verified against `SALLA_WEBHOOK_SECRET`. Headers are only `content-type`, `user-agent: Salla Webhook v1.0`, `x-salla-security-strategy: Signature`, `x-salla-signature`. No event id or delivery id header, which confirms the raw-body hash as event id. An unsigned request gets 401.
- **Custom Mode install from the Partners Portal fails with `install_error=state`.** Salla calls `/callback` with a code but without our `state` or binding cookie, because the flow did not start at `/v1/integrations/salla/install`. Starting at `/install` builds the right authorize URL. Consequence: a Salla-started Custom Mode install (App Store, "Test app") cannot complete today. **Easy Mode is the working path**; decide before launch whether Custom Mode is needed at all.
- **Easy Mode reinstall sequence:** `app.uninstalled` (11:41:35Z), then `app.installed` (11:43:02Z), then `app.store.authorize` (11:43:05Z, about 3 s later). The store was created from the authorize webhook (`install_epoch` 1, tokens stored). `app.installed` arrives **before** the tokens, so it is held as `unknown_store`, and it plus the earlier stale events were then marked ignored without affecting the active store.
- **Authorize payload:** `data.access_token`, `data.refresh_token`, `data.expires` (Unix seconds; 14 days after issue), `data.scope` (space separated), `data.token_type: bearer`, `data.id` = app id. Matches the adapter.
- **`created_at` has no time zone:** `"2026-10-25 14:36:20"` for an event received at 11:36:20Z, so it is Asia/Riyadh (UTC+3) local time. Parse it as +03:00 (G6 ordering; input to G7).
- **`app.installed` payload:** `merchant` (store id), `data.app_scopes`, `data.installation_date` (same local time format), `data.store_type: "demo"`.
- **Scopes are far too broad:** the app currently asks for about 22 scopes including write access to customers, orders, transactions and settlements. Trim in the Partners Portal to `settings.read products.read orders.read webhooks.read_write offline_access` before any real merchant sees the consent screen.
- Fixtures recorded (tokens already scrubbed by the recorder): `app.installed`, `app.uninstalled`, `app.store.authorize`.

### 2026-10-25: G7 store time zone

- `GET /admin/v2/store/info` with the stored token: 200. Fields: `id`, `name`, `entity`, `type: demo`, `email`, `avatar`, `plan: pro`, `status`, `verified`, `currency: SAR`, `domain`, `kyc_country: SA`, `description`, `licenses`, `social`. **No time zone.**
- `GET /admin/v2/settings` needs `entity`; `entity=store`, `products` and `orders` return setting slugs, none for time zone.
- Verdict: fallback. Default the store time zone to Asia/Riyadh (matches Salla's own `created_at` clock), with a merchant setting; `kyc_country` can seed the default for non-SA stores later.
- The stored access token works against the Admin API (also confirms Easy Mode tokens are usable).

### 2026-10-25: G1 home page, default theme (theme id `1298199463`, assets under `themes/1247874246/1.379.0`), before our snippet was registered

- `salla` present. `page.slug` = **`index`** on home (confirms the guess). `page.id` null. `store.id` 73897098. Language `ar`, `<html lang="ar" dir="rtl">`; only AR enabled on the demo store.
- `theme.name` returns a numeric id, not a name: record the human name from Store design.
- **CSP:** the only header is `frame-ancestors 'self' https://s.salla.sa https://mahally.com/ https://portal.salla.partners`. No `script-src` or `connect-src`, no meta CSP, no violations. Third-party script and fetch origins are not restricted by the storefront. (The probe fetches failed only because `*.slips.app` does not resolve yet.)
- **How Salla injects App Snippets:** another app's snippet is served from `cdn.portal.files.salla.network/snippets/dev/<app>/<snippet>.js`. Salla wraps the code: it runs inside `Salla.onReady(...)`, `salla`/`Salla` are an app-scoped object (`Salla.appScope(scopeId)`), and `document` is a Proxy whose `currentScript` is the snippet tag. `window` is not wrapped, so the stub's `window.__slips` guard works. Implication: our stub runs **after** Twilight is ready, not at parse time; the reserved-space slot must come from the stub, not from early HTML.
- **CLS 0.91 on the bare theme before Slips is involved** (theme and Salla widgets shifting). Our reserved-space target (about 0 added CLS) must be measured as the difference with and without the Slips snippet, not as an absolute.
- Rocket Loader: **yes**, Cloudflare Rocket Loader is active on the storefront (console stack traces go through `rocket-loader.min.js`); the script's `rocketLoader` check reports false because it only looks for the script tag, so fix that check. Cookie bar: not present by default (G8 to check with it enabled).
- **Our stub works in the storefront:** pasted into the console (home and preview), it sets `window.__slips` and its loader request reached our API (`GET /player/stable/loader.js` from the storefront, 404 as expected since no loader is served yet). A probe `fetch` to our origin is allowed.
- **App Snippet delivery not working yet (blocker for G1 pass):** two snippets saved in the Partners Portal for app 784019 (plain JS, including a visible badge test) never appear on the storefront or in its preview. The storefront HTML lists only one snippet, `snippets/dev/691365818/198903744.js`, which belongs to another app (Reviews Translator). Snippets were added after the 11:43 install; testing whether a reinstall attaches them. If not, ask Salla Partner Support which step publishes a snippet for a private/dev app.
- **Resolved: Salla attaches an app's snippets to a store at install time.** After uninstall and reinstall (13:05 to 13:06Z) the badge snippet appeared on the storefront and in preview, and later edits to the snippet code propagate without another reinstall. Implications: a merchant who installed before a snippet existed gets none until they reinstall, so the snippet must exist from the first public release; keep the stub tiny and stable and put changing logic in the CDN loader (AD-7).
- **Lifecycle on a real store (Story 1.10 verified):** `app.uninstalled` processed (grace period started), `app.installed` ignored (arrives before the tokens), `app.store.authorize` processed: same store record restored, `install_epoch` 1 to 2, `lifecycle_state` active, new tokens with expiry 14 days out.
- **Real stub injected by Salla (13:17Z, offers page):** served as `cdn.portal.files.salla.network/snippets/dev/784019/1252547298.js` (path is `dev/<app id>/<snippet id>`), loads after Twilight; `window.__slips` set; loader requests reached our API (13:15:47, 13:16:44, 13:16:47Z). No CSP violations. `page.slug` on the offers listing is **`product.index.offers`**, so listing slugs share the `product.index` prefix.
- **Category page (13:27Z, `/<name>/c1479324463`):** `page.slug` = **`product.index`** (confirms the guess), and **`page.id` = 1479324463, the category id**, matching the URL `/c<id>` segment. The player already prefers `page.id` with the URL as fallback. Stub injected, no CSP violations. The offers listing (`product.index.offers`) maps to no placement, as intended.
- **Product page (13:28Z, `/<name>/p490238898`):** `page.slug` = **`product.single`**, **`page.id` = 490238898, the product id** (matches the URL `/p<id>`). Stub injected, no CSP violations. The page also loads Salla's fast-checkout widget and recommendation widgets (similar products, customers also bought/viewed), which compete for the area below the product images.
- **Theme 1 of 3 (default theme, id `1298199463`) complete for G1: home, category and product all pass** (injection without theme edit, page type and id readable, language and direction readable, CSP not blocking). Reserved-space CLS still to be measured once the loader renders something.
- **Theme 2: Astra (developer theme, the only other free theme on the demo store; `theme.name` 2046553023, assets `themes/822457965/1.128.0`). Home (13:41Z):** `page.slug` `index`, stub injected, no CSP violations. **CLS 0.0006** on the bare home page, against about 0.4 to 1.2 on theme 1. But the Astra category page then measured 0.63, so the baseline shift depends on page and theme (listing pages shift as product cards load); always compare with and without Slips on the same page. Opened through a portal preview link (`?expires=…&identifier=<store id>&utm_source=portal&signature=…`), which does not affect the page context.
- **Astra category (13:43Z, `/c131526953`):** `page.slug` `product.index`, `page.id` 131526953 (matches URL). Stub injected, no CSP violations. CLS 0.63 before Slips.
- **Astra product (13:45Z, `/p1903572400`):** `page.slug` `product.single`, `page.id` 1903572400 (matches URL). Stub injected, no CSP violations. CLS 0.11 before Slips. Same Salla widgets as theme 1 (fast checkout, recommendations).
- **Theme 2 (Astra) complete for G1: home, category and product all pass.**
- **Theme availability:** the demo store offers only 2 free themes. The third theme (paid or different layout family) needs a paid theme on a demo store or a real pilot store.
- **The portal snippet editor's HTML ("body") mode parses content as JSX:** inline `<script>` with braces fails (`'}' expected`). Production snippet should be a single brace-free tag, `<script async src="https://cdn.slips.app/player/stub.js"></script>`, or plain JS mode.

### 2026-10-25: G2 add to cart, guest (default theme, private window)

- **`salla.cart.addItem({ id, quantity })` works for a simple product as a guest:** 200, about 0.9 to 1.3 s, `cart::before.add.item`, `cart::updated` and `cart::item.added` fire. `salla.cart.quickAdd(id, 1)` also works. Cart id is available (`3232471214030006849`).
- **Unknown product id:** 410 Gone (not 404 or 422) and `cart::item.added.failed` fires with an AxiosError. Handle 410 as "product no longer available".
- **`notes` is accepted** (`notes: 'slips:gate-test'`) and **creates a separate cart line**: after two runs the cart showed the simple product as three lines (4, 1 and 1) instead of one line of 6. The note is not shown in the cart page UI. Consequence for G4: tagging with `notes` splits lines (a shopper who adds the same product from Slips and from the theme sees two lines). Check in G4 whether the note survives to the order.
- **Header cart counter updates live** after programmatic adds (no reload needed, default theme): the theme listens to Twilight's cart events, so the player does not need to refresh the mini-cart itself.
- Products created for the gate through the Admin API (delete after the gate): `373320626` SLIPS TEST simple, `1753669510` SLIPS TEST required text (required text option `1628989276`).
- **Option model:** variant options (size, colour) come back with `purpose: variants`, `required: false`, even though a choice is needed; only custom options such as text can be `required: true`. FR3's "required-options flag" must treat any variant option as requiring a choice. Creating a text option needs `advance: false`.
- G3 first run: both adds with options failed with 422 because the generic script built an empty selection (it could not parse the `fetchOptions` response). Salla shows a toast saying a variant must be chosen. Script fixed.

### 2026-10-25: G3 products that need a choice, guest (focused run with option ids from the Admin API)

- **`salla.product.api.fetchOptions([ids])`** returns `{ data: [ product ] }`; each product has `options[]` with `id`, `name`, `type: "single-option"`, **`required: true`** (the storefront says required even where the Admin API says `required: false` for variants), `placeholder`, `is_advance`, and values under **`details[]`** (`id`, `name`, `additional_price`, `is_out`, `color`, `image`). This is the shape the Slips option picker should read; `is_out` gives per-value stock.
- **Missing choices fail cleanly:** 422 with `fields.options` naming the missing option, for example "يجب اختيار (اللون) للمنتج فستان" (must choose colour), and Salla shows a toast. No product added.
- **Variant product with both choices (`options: { sizeOptionId: valueId, colourOptionId: valueId }`): 200, but the cart line does not hold what we sent.** We sent size "44 - XL" and colour "44 - XL"; the line came back with no size selected and colour "40 - M" (`value` 209793398, not a value id we sent), and it merged into an existing dress line (quantity 3). The cart page then asks the shopper to choose the size again. The demo product's data is suspect (its colour option holds sizes and the SKU map is irregular), so this is **not yet a verdict on Salla**: re-test with a clean variant product.
- **Required text option created through the Admin API:** still 422 "must choose (الاسم للطباعة)" when a text value was sent. The API returned the option as `advance: true, purpose: variants` despite `advance: false`, so the option is probably malformed. Re-test with a custom text field created in the dashboard.
- `salla.product.getPrice({ id, quantity, options })` works (price 94, regular 189, `sku`), route marked `api.product.price.deprecated`.
- **Clean re-test (15:17Z, `SLIPS TEST clean` `1613722764`, made in the dashboard: one variant option "size" `1585537364` with S `1805703611` and M `1166932100`, so 2 variants/SKUs):** no size: 422, nothing added. S: one line "size: S". M: a second line "size: M". S again: the S line goes to quantity 2. **Variants map exactly to what was sent**, so the dress mismatch above was the demo product's broken data. The cart line's option `value` (209817120, 209817121) is a cart-side id, not the value id we send; read the selected value from `details[].is_selected`.
- **Superseded interim verdict (before the clean re-test):** add to cart for products with choices works when the payload is complete, but the variant result did not match the selection on the demo product. Until a clean re-test passes, plan for the FR23 fallback ("View options" opens the product page) for variant products.

## Other open questions to settle on the way

- [x] `page.slug` values for home and category pages, and the category id source: `index`, `product.index`, category id in `page.id` (URL `/c<id>` also matches). Verified 2026-10-25 on the default theme.
- [ ] Category webhooks (`category.created/updated/deleted`) and `categories.read` scope: not subscribed yet; needed for the category picker (FR8, FR16, Story 2.1) unless daily reconcile (Story 2.6) is enough.
- [ ] Does `notes` survive checkout into `order.created` `items[].notes`; is it visible or editable by the shopper.
- [ ] Do plan upgrade and downgrade fire their own events.

## Go / no-go decision

Rules (Story 1.14):

- List G1 to G8 each with pass or fail, evidence links and the fallback chosen for each fail.
- If any gate failed, list the affected requirements (for example FR11, FR13, FR17, FR23, FR24) with the proposed PRD change, and mark Epics 2 to 7 as **not to be sharded** until the PRD is updated.
- If G1 fails and the manual-snippet fallback does not work: state **no-go for the storefront scope**.
- If G2 has no reliable cart path: state **no-go for in-content purchase**.
- Propose closing **Q-01** and **Q-11** with the evidence, and record the Q-18 consent default from G8.

**Decision (proposed 2026-10-25):** **CONDITIONAL GO.** No gate failed on evidence. G1, G2, G3 and G6 pass on the demo store; G7 takes its planned fallback; G4, G8 and the billing half of G5 could not be run on a demo store and move to the first pilot store, each with a fallback already planned. Epics 2 to 5 may be sharded and built now. The conditions below must be cleared on the pilot store before the features that depend on them ship.

| Condition (verify on pilot store) | Blocks | Fallback if it fails |
|---|---|---|
| G4: `notes` tag (or cart id) reaches `order.created` | Epic 6 attribution (FR13) | Thank-you page beacon with documented accuracy loss; else FR13 becomes "assisted orders" |
| G8: dashboard opens signed in from inside Salla; consent signal | Embedded re-entry polish (FR28), consent default (Q-18) | Direct-link sign-in and email/password sign-in (built) |
| G5 billing: plans, trial and subscription events | Billing (Story 7.2a) | Manual plan assignment by Slips Admin for the pilot |
| G1: a third theme; reserved-space CLS measured as a difference with and without Slips | Epic 5 storefront launch (NFR CLS) | Per-theme slot tuning |
| G3: out-of-stock variant, per-variant price, multi-option combos, required text field | Epic 5 option picker (FR23) | "View options" opens the product page |
| G6: Salla retry timing for failed webhooks | FR24 bounds | Reconciliation polling (FR25) |

**Affected requirements and proposed PRD changes:**
- FR8: store time zone has no Salla source; default Asia/Riyadh with a merchant setting (G7 fallback, as already written in FR8).
- FR3: treat any variant option as "requires a choice" (Salla marks variants `required: false` in the Admin API).
- Install: Easy Mode is the supported install path; a Salla-started Custom Mode install fails the OAuth state check. Decide before launch whether Custom Mode is needed.
- App Snippet: Salla attaches snippets at install time, so the snippet must ship with the first public release; production snippet is a brace-free `<script async src=…>` tag or plain JS.
- Partners app scopes: trim to `settings.read products.read orders.read webhooks.read_write offline_access` (plus `categories.read` if category webhooks are used).

**Q-01 / Q-11 / Q-18 proposals:** Q-01 and Q-11: keep open until the pilot-store G4 and G5 results. Q-18 (consent default): keep the current default until G8 on a store with the cookie bar enabled.

**Product owner sign-off:** Ali, 2026-10-25: **conditional go approved** (conditions above to be verified on the first pilot store).

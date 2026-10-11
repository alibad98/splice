# Salla Desk Research: Epic 1 Gate (G1–G8)

**Purpose:** answer the Epic 1 technical go/no-go gate (PRD §Epic 1, G1–G8) and questions Q-01, Q-11 and Q-18 as far as desk research allows, before a test store is available.
**Date:** 2026-10-10
**Status:** Desk research only. Every "Likely pass" still needs hands-on confirmation in a Salla demo store (see the checklist at the end).

## How this was researched (read first)

- **docs.salla.dev and salla.dev could not be opened directly.** The research sandbox's egress proxy blocks both hosts. Doc content was gathered three ways:
  1. **Web-search extracts of docs.salla.dev pages.** Page IDs and URLs are given; wording comes from search snippets, not a full read.
  2. **Official Salla source code from npm**, read directly: `@salla.sa/twilight` 2.14.590 (Twilight JS SDK, published 2026-10-07), `@salla.sa/twilight-components` 2.14.590, `@salla.sa/analytics` 2.14.590, `@salla.sa/app-functions-types` 0.9.0 and `@salla.sa/embedded-sdk` 0.2.6. Code is the strongest evidence of what the SDK actually does.
  3. **Official SallaApp GitHub org repos:** `SallaApp/salla-partners-agent-kit` (Salla's own developer guidance, which cites docs.salla.dev page IDs throughout), `SallaApp/theme-raed`, `SallaApp/oauth2-merchant` and `SallaApp/store-events-tracker-starter-kit`.
- **Source labels used below:**
  - **[DOC]** docs.salla.dev, seen via search extract.
  - **[SDK]** official npm package source, read directly.
  - **[KIT]** SallaApp/salla-partners-agent-kit. Official org, but it is guidance for coding agents, not the formal reference.
  - **[GH]** other SallaApp repos.
  - **[3P]** third-party or community source; treat with caution.
- "Not documented" means it was not found in any of the sources above.

---

## Summary table

| G# | Capability | Verdict | Mechanism (official) | Still to verify hands-on |
|---|---|---|---|---|
| G1 | Storefront injection | **Likely pass** | **App Snippets**: a pure-JS file the partner defines in the Partners Portal. Salla hosts it on its CDN and injects it **automatically before `</body>` on every storefront page of every store that installs the app**. No theme edits. Context from the Twilight SDK: `salla.config.get('page.slug')` (e.g. `index`, `product.single`), `page.id` (product ID on `product.single`), `store.id`, language, and public app settings via `salla.config.get('app.<key>')`. | Loads on ≥ 3 themes; the `page.slug` value for home and category pages; how to get the category ID (not in `page.id`); whether store CSP allows `connect-src`/`media-src` to Slips' API and media CDN (**CSP not documented**); behaviour with Cloudflare Rocket Loader. |
| G2 | Add to cart, simple products | **Likely pass** | `salla.cart.addItem({id, quantity, notes?})` or `salla.cart.quickAdd(id, qty)` returns a Promise. Events: `cart::item.added` / `cart::item.added.failed` (`salla.cart.event.onItemAdded/onItemAddedFailed`). Works for guests: the SDK creates or gets the cart via `getCurrentCartId()`. | Guest and signed-in flows on real themes; theme mini-cart refresh; error shape for out-of-stock; the SDK's automatic cart-reset-and-retry on non-422 errors. |
| G3 | Add to cart with required options | **Likely pass (needs a Slips-built option picker)** | `salla.product.api.fetchOptions([ids])` and `salla.product.getDetails(id, ['options'])` read options. Pass the selection to `salla.cart.addItem({id, quantity, options: {<option_id>: <value_id \| text \| url>}})`. Price per selection: `salla.product.getPrice({id, quantity, options})`. | Every option type (select, colour, text, upload, date); variant stock; SDK quirk: on `product.single` for the **same** product, `addItem` also validates the page's own options form. |
| G4 | Cart tagging echoed in orders | **Unclear (two candidate paths; neither is a documented "attribution tag")** | (a) **Line-item `notes`**: an official `addItem` parameter, and `items[].notes` appears in the order model (Order webhook and Order Details). (b) **Cart/checkout ID join**: the add-to-cart response gives `data.cart.id`; Salla's storefront "Order Completed" analytics event carries `order_id` + `checkout_id` (= cart ID) + products, and is available in the browser (Device Mode) or server-side (App Functions / Cloud Mode). Orders also carry `source_details` (`type`, `value`, `utm_*`), and merchants or apps can add **Order Tags** after the fact. | Whether `notes` survives checkout into `order.created` items and whether the shopper sees or edits it (it is shopper-visible); whether `checkout_id` equals the cart ID and appears in order webhooks; whether App Functions "Order Completed" is available to public apps. |
| G5 | Install and billing model | **Likely pass, with gaps** | App events auto-deliver to the app webhook URL: `app.installed`, `app.store.authorize` (tokens, **Easy Mode**, the recommended mode for published apps), `app.updated`, `app.uninstalled`, `app.settings.updated`, `app.trial.started/expired/canceled`, `app.subscription.started/renewed/expired/canceled`. Plans are defined in the Partners Portal (recurring: up to 4 monthly + 4 yearly; trial days). Reconcile with `GET /admin/v2/apps/{app_id}/subscriptions`. | **No documented `upgrade` or `downgrade` events**: a plan change probably shows as `subscription.started` for the new plan, which must be confirmed. The **`free` plan type is eligibility-gated** (shipping or communication apps, or a company flag). Trial behaviour. |
| G6 | Webhook lifecycle | **Likely pass** | Store events need a subscription. Product: `product.created/updated/deleted/available/quantity.low` (plus `product.price.updated`, `product.status.updated`, …). Order: `order.created/updated/cancelled/refunded/deleted/products.updated/payment.updated/total.price.updated/status.updated`, …. Security strategy `signature` sends `X-Salla-Signature` = HMAC-SHA256(raw body, secret) and `X-Salla-Security-Strategy`; `token` sends `Authorization: <secret>`. Retries: **3 more attempts, about 5 min apart**, after a non-2xx response or a ~30 s timeout. At-least-once delivery. **No ordering guarantee is documented.** Conditional (rule-filtered) webhooks are available (v2). | Exact headers and retry timing on a live store (KIT notes an older 30s/15s/10s observation); whether `order.refunded` carries partial-refund line detail; out-of-order delivery. |
| G7 | Store time zone | **Likely fallback** | `GET /admin/v2/store/info` exists, but **a store time-zone field is not confirmed** in any extract. Admin API date objects carry `{date, timezone_type, timezone: "Asia/Riyadh"}`, which suggests platform time is Asia/Riyadh. | Call `/store/info` and inspect the response; check whether date objects ever carry a non-Riyadh zone. |
| G8 | Dashboard re-entry and consent | Re-entry: **Likely pass**. Consent: **Unclear; a signal exists in code but is not documented for apps** | **Embedded apps**: an iframe page inside the Salla Merchant Dashboard (`s.salla.sa/embedded/app/{appId}/{route}`), using `@salla.sa/embedded-sdk`. Salla passes a short-lived token; the backend verifies it with `POST https://api.salla.dev/exchange-authority/v1/introspect` (header `S-Source: <app_id>`) and starts its own session. **Consent**: Salla's own `salla-cookies-bar` component emits `salla-cookies-bar::accepted` / `::rejected` and stores the choice in `Salla.storage` key `cookies-consent` (categories: necessary, performance, functional, advertising). It is active when the store feature `website-cookies` is on. This is undocumented for partners. | The embedded page renders and the token introspects; the cookie-bar events fire in a snippet context; what `cookies-consent` holds after "customize"; which stores have `website-cookies` enabled. |

---

## G1: Storefront injection

**What Salla documents**

- **App Snippets** [DOC Intro to App Snippets https://docs.salla.dev/2220706m0.md; HTML to JS migration https://docs.salla.dev/2247590m0.md; KIT `salla-snippets/SKILL.md`, `references/device-mode.md`]:
  - The partner writes a JavaScript snippet in the app's settings in the Partners Portal (App details > Store Events > App Snippets > "View Snippets").
  - Salla uploads it as a `.js` file to its CDN and **injects it automatically on stores that install the app**. Nothing is hosted or deployed by the partner, and the merchant does nothing.
  - On a live store it appears as a `<script src="https://…salla CDN…">` tag. Placement is fixed: `place: "before"`, `tag: "body"`, so it renders before `</body>`.
  - **Only JavaScript is accepted now.** Legacy HTML or Twig snippets (`{{store.id}}` tokens) must be migrated to pure JS.
  - Public and private apps both support snippets.
- **Context available to the snippet** (Twilight JS SDK, `window.salla`, auto-injected by the theme at the `body:end` hook) [SDK `types/tiwlight-config.d.ts`, `dist`; KIT `device-mode.md`; DOC SDK overview https://docs.salla.dev/422610m0.md]:
  - **Page type:** `salla.config.get('page.slug')`. The SDK's own `salla.url.is_page(x)` is implemented as `Salla.config.get("page.slug") === x`. Known slugs include `product.single`, `cart` and `thank-you`. The slugs for home and category pages are not documented; `index` and `product.index` are likely, matching theme-raed template names `pages/index.twig` and `pages/product/index.twig` [GH theme-raed].
  - **Product ID:** `salla.config.get('page.id')`. Per the SDK type comment, `page.id` is available on `product.single`, `customer.orders.single`, `cart`, `thank-you` and `page-single`. **It is not set on category pages.** The category ID must come from the URL or theme markup (to verify).
  - **Store and language:**
    - `store.id` and `store.username` are available.
    - `user.language_code` and `languages[]` (with `is_rtl`) are available.
    - KIT warns that `store.lang` may be null, so fall back to `document.documentElement.lang`.
    - `customer.*` and `store.domain` are deprecated or forbidden.
  - **Merchant settings:** `salla.config.get('app.<key>')` returns App Settings that are marked `public: true`.
  - **Events:** register `salla.event.on('cart::item.added', …)` and similar at the top level, because some events fire before `salla.onReady`.
- **Theme hooks** (where theme-level injection happens) [GH theme-raed]: `head:end`, `body:end`, `product:single.description.*`, `product.single.before_product_info`, `product.index.before_products_group_with_filter` and others. KIT names `product:single.form.start` / `.end` as the product-page insertion points. These are **DOM landmarks** for the snippet to mount near; they are not app-owned slots.
- **Other mechanisms (not needed for MVP):**
  - **Theme Component Bundles / Twilight Bundles** (`@salla.sa/twilight-bundles`, DOC https://docs.salla.dev/2140782m0.md, https://docs.salla.dev/1945783m0.md). Developer-built components, managed through the Salla CLI and a theme. Whether merchants can add bundle components from the theme editor for *any* theme is not confirmed.
  - **App Functions** run server-side only.
- **UI guidance** [KIT `salla-storefront-ui`]: Salla asks that injected UI use native `<salla-*>` web components or theme CSS variables, follow RTL, and look native.
- **CSP:** **Not documented** (no Salla page found). Indirect signs suggest storefronts are permissive: storefronts routinely load third-party pixels (Snapchat, Poptin, addtoany, GTM), and Salla's own analytics posts to `st.salla.dev`. This is not proof; Slips' API, event and media origins must be tested.

**Verdict: Likely pass.** App Snippets give zero-touch injection on all pages without theme edits. The PRD fallback (manual paste) is probably unnecessary.

**Fallback if it fails:** the PRD fallback stands. A theme-specific issue is more likely than a total failure.

**Still to verify:**
- The snippet loads on ≥ 3 themes.
- The `page.slug` values for home and category pages.
- How to get the category ID.
- CSP headers on real stores.
- Rocket Loader wrapping.
- Behaviour in the Salla mobile app webview, if relevant.

## G2: Add to cart, simple products

**What Salla documents** [DOC Add Item https://docs.salla.dev/422625m0.md (Cart), https://docs.salla.dev/apidoc/project-451700/422629m0; SDK `types/api/cart/index.d.ts`, `dist/esm/index.js`]

- **Methods:**
  - `salla.cart.addItem({ id, quantity, options?, notes?, file? })` returns `Promise<CartResponse.update>`.
  - `salla.cart.quickAdd(productId, quantity, offerType?)` uses the endpoint `cart/{cart}/item/{product}/quick-add`.
  - `addItem` uses `cart/{cart}/item/{product}/add`.
- **Events:**
  - Success: `cart::item.added`, with payload `{status, success, message, data:{product_id, cart:{id, sub_total, items[], …}, offer, googleTags}}`.
  - Failure: `cart::item.added.failed`. Callbacks: `salla.cart.event.onItemAdded`, `onItemAddedFailed`, and `cart::before.add.item`.
- **Guests:** `getCurrentCartId()` creates or gets the cart, so guest carts work. Signed-in carts are matched by user and store ID.
- **SDK behaviours (from code):**
  1. On any error other than 422, the SDK **resets the cart and retries once**.
  2. On `product.single`, when the product ID equals the page product, `addItem` (not `quickAdd`) runs the page's `<salla-product-options>` form `reportValidity()`. It fails with "The product options are not valid!" if the page form is incomplete.
  3. A `source` field in the payload is stripped and kept client-side (`Salla.cart.api.addToCartSource`); it is **not sent** to the server.
- **Price:** `salla.product.getPrice({id, quantity, options?})` returns the price Salla will charge, which supports FR24 ("Salla's price governs").

**Verdict: Likely pass.**

**Fallback:** as in the PRD ("View product").

**Still to verify:**
- Guest and signed-in flows.
- Out-of-stock error shape.
- Mini-cart counter update across themes.
- Interaction with the page's own add-to-cart form when Slips shows the same product on its own product page.

## G3: Add to cart, products with required options (Q-11)

**What Salla documents** [DOC Add Item; Fetch Product Options https://docs.salla.dev/569578m0.md; SDK `types/api/product/index.d.ts`, `request.d.ts`; KIT `twilight-js-sdk.md`]

- **Read options:** `salla.product.api.fetchOptions(productIds[])`, or `salla.product.getDetails(id, ['options', 'images', …])`. Admin-side: product webhooks and the Products API include options and SKUs (variants).
- **Add with options:**
  - Call `salla.cart.addItem({ id, quantity, options: { <option_id>: <option_value_id | string | url> }, notes? })`.
  - Select-type options take the value ID. Text options take a string. Upload options take a URL (or use `file`).
  - The SDK type is `options?: Array<{[key:number]: number|string|number[]}>`, so multi-select is possible.
- **Events:** `product::price.updated` and `product-options::change` exist for the theme's own form. They are not needed if Slips renders its own picker.

**Verdict: Likely pass, but in-content variant purchase requires Slips to build an option picker** (bottom sheet) driven by `fetchOptions` and `getPrice`. This is new UI and effort, not a platform blocker.

**Fallback:** keep FR23 "View options" for the MVP and treat the picker as a scoped follow-up (it is FR-PRD-08 / Phase 2 in the PRD).

**Still to verify:**
- Each option type.
- The out-of-stock variant response.
- Options with extra price.
- Required upload or date options. Recommendation: exclude these and fall back to the product page.

## G4: Cart tagging echoed in orders (attribution)

**What Salla documents**

- **No documented "cart attribute", "cart metadata" or attribution-tag API** for apps (searched docs, SDK types and the KIT).
- **Candidate A: line-item `notes`.**
  - `salla.cart.addItem` officially accepts `notes` (a free-text note on the item) [DOC Add Item; SDK `CartRequest.addItem.notes`].
  - The order model has `items[].notes` [SDK `@salla.sa/app-functions-types` `admin-events/order.d.ts`, shared by `order.created`/`order.updated` webhooks; DOC Create Order Item sample shows `"notes": ""` https://docs.salla.dev/5751402e0].
  - **Risks:**
    - It is a shopper-facing field. Some themes show and allow editing of item notes in the cart, and it prints on the merchant's order and invoice.
    - It may be overwritten if the shopper adds the same product again outside Slips.
    - Line items may merge when the same product is added twice.
    - Not documented as an attribution mechanism.
- **Candidate B: cart/checkout ID join.**
  - The `cart::item.added` response includes `data.cart.id` [KIT device-mode payload; SDK].
  - Salla's storefront analytics (Pixels) emit **"Order Completed"** with `order_id`, `reference_id`, `checkout_id`, `products[]`, `total`, `coupon` and `anonymousId` [SDK `app-functions-types/store-events/order-completed.d.ts`].
  - Related types say `checkout_id` *equals `cart_id`* (`address-added.d.ts`: "/** Equals `cart_id` */").
  - These events are available:
    - **in the browser** (Device Mode, Pixels catalogue; DOC https://docs.salla.dev/1724504m0.md, https://docs.salla.dev/1804461m0.md)
    - **server-side** through **App Functions / Cloud Mode** (DOC https://docs.salla.dev/1724667m0.md, https://docs.salla.dev/1726822m0.md).
  - Slips would record `{cart_id, product_id, content_id, ts}` at a confirmed Slips add to cart, then join on `checkout_id` → `order_id`, then reconcile line items against the `order.created` webhook.
  - Note that the KIT says there is no `order.success` JS event on the Twilight `::` bus; detect the thank-you page by `page.slug === 'thank-you'` (where `page.id` is available).
- **Other signals:**
  - `source_details {type, value, device, user-agent, ip, utm_source/medium/campaign/term/content}` on orders [DOC Order Details https://docs.salla.dev/5394147e0, Update Order https://docs.salla.dev/5751605e0, changelog https://docs.salla.dev/421127m0]. These are session-level landing signals; Slips cannot set them from inside the page.
  - **Order Tags** (Merchant API, `orders.read_write`; DOC https://docs.salla.dev/5394155e0) can be written by Slips *after* attribution, so the merchant sees "Slips" on the order. They are not a capture mechanism.
  - Custom analytics events: `Salla.analytics.track(...)` from a snippet, and `custom.event.*` in App Functions [DOC Custom Events https://docs.salla.dev/2007114m0.md].

**Verdict: Unclear.** Path B (cart ID → checkout ID → order ID) looks most robust and hides nothing from the shopper. Path A (`notes`) is the simplest but leaks into shopper and merchant UI.

**Exact fallback if neither works:** the PRD fallback is unchanged, with these refinements:
- Use a thank-you-page beacon (`page.slug==='thank-you'`, `page.id` = order ID) from the snippet. Match the order's line items to Slips add-to-cart records for the same browser (cart ID in local storage) within the window.
- Confirm server-side with the `order.created` webhook.
- Accuracy loss: orders completed on another device or browser, and thank-you pages blocked or skipped (for example, payment redirects).

**Still to verify (critical path):**
1. Does `notes` persist into `order.created` `items[].notes`? Is it visible or editable in the cart or checkout on 3 themes?
2. Does "Order Completed" `checkout_id` equal the `cart.id` returned by `addItem`? Is the cart ID or checkout ID present in the `order.created` webhook or Order Details?
3. Are App Functions / Cloud Mode ecommerce events available to a public app without special enablement?
4. Is the line item a separate row when the same product is added from Slips and from the page?

## G5: Install and billing model

**What Salla documents** [DOC App Events https://docs.salla.dev/421413m0.md, App Subscription webhook events https://docs.salla.dev/2213496m0.md, Authorization https://docs.salla.dev/421118m0.md, App Subscription Details https://docs.salla.dev/5401098e0.md; SDK `app-functions-types/admin-events/app.d.ts`; KIT `salla-app-lifecycle`, `salla-app-billing`, `salla-app-auth`]

- **App events:**
  - `app.store.authorize`, `app.installed`, `app.updated`, `app.uninstalled`, `app.settings.updated`, `app.feedback.created`
  - `app.trial.started`, `app.trial.expired`, `app.trial.canceled`
  - `app.subscription.started`, `app.subscription.renewed`, `app.subscription.expired`, `app.subscription.canceled`

  They **auto-deliver** to the app webhook URL with no subscription needed. The store ID is top-level `payload.merchant`.
- **Subscription payload:** `subscription_id`, `item_type` (`plan` | `addon`), `plan_name`, `plan_type` (`free|once|recurring|on_demand`), `plan_period` (months as a string), `start_date`, `end_date`, `renew_date`, `price`, `tax`, `total`, `features[{key, quantity}]`, `store_type` (`development|demo|live`). Trial payloads are smaller.
- **Auth:**
  - **Easy Mode** (recommended and default for published apps): tokens arrive in the `app.store.authorize` webhook, and no callback is needed.
  - **Custom Mode:** authorization-code flow at `accounts.salla.sa/oauth2/auth` and `/oauth2/token`; for development. Shipping it without a reason can be flagged at review.
  - Refresh tokens are **single-use**, so a per-merchant refresh lock is needed (this matches FR25).
  - `app.updated` is followed by a new `app.store.authorize`.
  - Merchant identity: `GET https://accounts.salla.sa/oauth2/user/info` returns `merchant.id`, `username`, `name`, `plan`, `domain`.
- **Billing setup** (Partners Portal pricing) [KIT `pricing-shapes.md`]:
  - `plan_type` is `recurring` (up to 8 plans: 0–4 monthly and 0–4 yearly), `once` or `on_demand`.
  - `plan_trial` is set in days.
  - There is a per-plan `plan_features` comparison matrix.
  - All prices are in SAR.
  - Add-ons can be bought in-app.
  - **The `free` plan type is gated**: it is allowed only for shipping or communication apps, or when the partner company has the `show_app_free_plan` flag. Check `can_have_free_plan`.
- **Reconciliation:** `GET https://api.salla.dev/admin/v2/apps/{app_id}/subscriptions`.

**Gaps:** **no documented upgrade or downgrade events.** The PRD's FR19 lists "upgrade, downgrade" as distinct events. They will likely appear as `app.subscription.started` (new plan) plus `canceled` or `expired` (old plan), or only the former. Reconcile through the subscriptions API.

**Verdict: Likely pass** for install, uninstall, trial, start, renew, cancel and expire. **Unclear** for upgrade, downgrade and a free tier.

**Fallback:** the PRD fallback (manual plan assignment) is only needed if the Portal billing set-up is rejected. Derive upgrade or downgrade by comparing the new `subscription.started` plan with the stored plan.

**Still to verify:**
- Change plan on a demo store and log the events.
- Trial-to-paid conversion.
- That `store_type` is `demo` on test stores.

## G6: Webhook lifecycle

**What Salla documents** [DOC Webhooks https://docs.salla.dev/421119m0.md, Conditional https://docs.salla.dev/421120m0.md, Order events https://docs.salla.dev/433804m0.md, Product events https://docs.salla.dev/433805m0.md, Register https://docs.salla.dev/5394134e0.md; SDK `app-functions-types` event unions; KIT `salla-webhooks`]

- **Product events:** `product.created`, `product.updated`, `product.deleted`, `product.available`, `product.quantity.low`, plus the finer-grained `product.price.updated`, `product.status.updated`, `product.image.updated`, `product.category.updated`, `product.channels.changed`, `product.tags.updated`. No dedicated per-variant stock event was found; stock changes arrive through `product.updated` / `product.available` / `product.quantity.low` (to verify).
- **Order events:** `order.created`, `order.updated`, `order.status.updated`, `order.cancelled`, `order.refunded`, `order.deleted`, `order.products.updated`, `order.payment.updated`, `order.coupon.updated`, `order.total.price.updated`, `order.shipping.address.updated`, `order.customer.updated`.
- **Also available:** `abandoned.cart`, `customer.*`, `category.*` and others.
- **Subscription:** subscribe to store events in the Portal or with `POST /admin/v2/webhooks/subscribe`. Version 2 is the default. Conditional `rule` filters are supported in v2.
- **Security** (the strategy is set per app; leaving it unset means **none**):
  - `signature`: header `X-Salla-Signature` = hex HMAC-SHA256 of the **raw body** with the webhook secret, plus `X-Salla-Security-Strategy: Signature`.
  - `token`: header `Authorization: <secret>` (plain equality).
  - The docs confirm the two strategies; the exact header and algorithm come from KIT (official org) and should be confirmed live.
- **Delivery:**
  - The endpoint must answer `200` or `201` within about 30 s. Any other status (including 404) counts as failed.
  - Failed deliveries are retried **3 times about 5 minutes apart**. KIT notes an older observation of 30 s / 15 s / 10 s.
  - Duplicates are possible, so handlers must be idempotent.
  - The Portal has a Webhooks Log with attempts and payloads.
- **Ordering:** **not documented.** Assume no ordering guarantee; FR25 "latest update wins" is the right design.

**Verdict: Likely pass.** FR25 reconciliation is still required, because there are only 3 retries in about 15 minutes, after which an event is lost.

**Fallback:** as in the PRD.

**Still to verify:**
- The signature header on a live delivery.
- The retry timing.
- Whether `order.refunded` carries partial-refund amounts per item.
- Stock-change events for variants.
- Ordering under bursts.

## G7: Store time zone

**What Salla documents:**
- **Store Information:** `GET https://api.salla.dev/admin/v2/store/info` [DOC https://docs.salla.dev/5394261e0]. The response schema **could not be read**, and no extract mentions a time-zone field.
- Merchant API date objects are `{date, timezone_type: 3, timezone: "Asia/Riyadh"}` [DOC Order Details, Transaction Details; SDK `app-functions-types/shared/admin-event.d.ts`].
- The storefront `salla.config` has no time-zone key in the SDK types.

**Verdict: Likely fallback** (Asia/Riyadh default plus a merchant setting, as the PRD already plans). Upgrade to a pass only if `/store/info` returns a zone.

**Still to verify:**
- The `/store/info` response.
- Whether date objects ever show a non-Riyadh zone for stores outside KSA.

## G8: Dashboard re-entry and consent signal (Q-18)

**Re-entry: what Salla documents** [DOC Embedded SDK https://docs.salla.dev/embedded-sdk/overview, https://docs.salla.dev/embedded-sdk/getting-started/installation; SDK `@salla.sa/embedded-sdk`; GH `SallaApp/embedded-sdk-playground`; KIT `salla-embedded-app`]

- **Embedded pages** are registered per app (`route`, `iframe_url`, `default`). They appear at `https://s.salla.sa/embedded/app/{appId}/{route}` inside the Merchant Dashboard. Salla appends `token`, `theme` and `lang`.
- **Session flow:**
  1. The frontend reads the token with `embedded.auth.getToken()`.
  2. The backend verifies it with `POST https://api.salla.dev/exchange-authority/v1/introspect` (header `S-Source: <app_id>`).
  3. The backend issues its own session.
  4. The page calls `embedded.ready()`.
  - On 401, use `refresh()` or reload.
- **SDK modules:** page (title and navigation), nav (action buttons), ui (toasts and dialogs), checkout (add-on purchase).
- **Rule:** identity must come only from introspection. KIT warns against a stand-alone dashboard URL that trusts a store ID query parameter.
- **Alternatives:**
  - Merchant-facing **App Settings** forms built in the Portal (`app.settings.updated`).
  - A separate site signed in through OAuth (oauth2-merchant redirects back to `s.salla.sa/apps`).
- **Verdict:** **Likely pass** for re-entry signed in through Salla.

**Consent: what exists** [SDK `@salla.sa/twilight-components` `salla-cookies-bar`, `@salla.sa/analytics` `storefront`]

- Salla ships a storefront cookie bar component, `<salla-cookies-bar>`.
  - On a choice it emits `salla-cookies-bar::accepted` or `salla-cookies-bar::rejected` on the Twilight event bus.
  - It stores the choice in `Salla.storage` under `cookies-consent`, and keeps a session copy keyed by store ID after logout.
  - Category cookie names: `necessary_cookies`, `performance_cookies`, `functional_cookies`, `advertising_cookies`. It is kept for 365 days.
- Salla's own analytics read it with `getConsentState()` → `'accepted' | 'rejected' | 'unknown'`. Consent is enforced only when `salla.config.get('store.features')` includes `website-cookies`.
  - Without consent, Salla's analytics still send events but drop user IDs and remove IP (`disableUserIds`, `ipPolicy: 'remove'`).
- **None of this is in partner-facing docs** (not found on docs.salla.dev). It is an implementation detail that could change.
- **Verdict:** **Unclear.** A usable signal exists technically; the default with no signal remains [NEEDS LEGAL].

**Fallback:**
- Re-entry: a separate login through Salla OAuth (as in the PRD).
- Consent:
  - Read `salla.storage.get('cookies-consent')` and listen for `salla-cookies-bar::*` when `store.features` includes `website-cookies`.
  - Otherwise apply the Q-18 legal default.
  - Mirror Salla's own policy (send pseudonymous events and drop IDs when the state is not `accepted`) as the candidate default for legal review.

**Still to verify:**
- Embedded page load and introspection on a demo store.
- Events and storage values for the cookie bar in a snippet.
- What "customize" stores (per-category or a single state).

## Other findings

- **Rate limits (Merchant API)** [DOC https://docs.salla.dev/421125m0.md via KIT]:
  - Limits are per store, by the store's Salla plan, using a leaky bucket: **Plus 120/min, Pro 360/min, Special 720/min**, then 1 request/second.
  - The Customers endpoint is capped at 500 per 10 min.
  - Exceeding a limit returns 429 with `Retry-After` and `X-RateLimit-*` headers. Sustained abuse can return 403.
  - Impact: initial product sync and daily reconciliation (FR25) for large catalogues on Plus stores must be paced, about 7,000 requests/hour at most. Use webhooks for freshness.
- **App review** [DOC Publishing https://docs.salla.dev/playbook/launch-grow/publish-app, Create first app https://docs.salla.dev/421410m0.md; Salla Help "App launch stages"; KIT `salla-publication-consistency`, `salla-app-auth`, `salla-app-lifecycle`; 3P noqta.tn]. Requirements that bear on Slips:
  - Minimum OAuth scopes, with a justification for each scope.
  - Webhook subscriptions only for relevant events.
  - Easy Mode unless there is a reason not to.
  - Uninstall cleanup and the data deletion policy are reviewed at submission.
  - Listing assets (icon, screenshots that match the current UI, educational video guidelines: https://salla.dev/tutorial/educational-video-guidelines-apps-ar/).
  - Native look for storefront UI.

  **No published rule was found on storefront script size, performance, or CSP for snippets.**
- **Snippet constraints that matter for the design:**
  - The snippet is **one static JS file per app**, served to every installing store. Per-store identity comes at runtime from `store.id` and public app settings, not from a per-store key baked into the script.
  - No secrets may be placed in it.
  - Snippet edits redeploy to all stores. Versioning and rollback (NFR8) should live in Slips' own loader, which the snippet fetches from Slips' CDN, not in the snippet body.
- **No blockers found.** The biggest unknown is G4 (attribution capture), followed by CSP (G1).

---

## Implications for the PRD

1. **Install model (FR9, FR17, FR21, FR18, NFR1, NFR8): switch from "merchant pastes snippet" to App Snippet auto-injection.**
   - Change FR9: the loader identifies the store by `salla.config.get('store.id')` (optionally plus a public app setting). The "store's injector key" becomes an internal public identifier that Slips maps from `store.id`, not something the merchant copies.
   - Change FR17: drop or shrink "store key shown in full with copy", the installation guide and "reinstalling the snippet". Regenerating the key becomes an internal rotation with no merchant action.
   - Change FR21: "install the injector" becomes "verify injector is live", auto-detected from the first storefront ping.
   - Keep the manual guided install only as a theme-compatibility fallback.
   - Keep the Salla snippet as a tiny stub that loads Slips' versioned loader from Slips' CDN, which preserves NFR1 budgets and NFR8 rollout and rollback.
   - Add a Story 1.x AC: "the snippet passes `node --check`, uses no `customer.*` or `store.domain`, and registers `cart::*` listeners at the top level".
2. **Attribution (FR11, FR13, FR26; Story 1.5 / G4): name the capture mechanism as a cart ID join, with item `notes` as the experimental alternative and a thank-you beacon as the fallback. Do not promise a hidden "cart tag".**
   - FR11 "tagged for attribution" should become: record `{store_id, cart_id (from addItem response), product_id, options hash, content_id, event_id, ts}` server-side on a *Salla-confirmed* add to cart (`cart::item.added` success).
   - FR13 then joins on "Order Completed" `checkout_id`/`order_id` (via App Functions or the snippet on `thank-you`) and confirms line items from `order.created`.
   - FR26 gains a natural integrity check: the cart ID must later appear in a real order.
   - Optionally write a Salla **Order Tag** "Slips" on attributed orders, so merchants see it in Salla.
   - Add to Q-01: is App Functions / Cloud Mode available to a public app at launch?
3. **Billing (FR19, Q-04) and variants (FR23, Q-11, Story 5.4): adjust to what Salla's billing and SDK actually expose.**
   - **FR19:**
     - Remove "upgrade" and "downgrade" as distinct Salla events. Derive them by comparing `app.subscription.started` with the stored plan, plus reconciliation through `GET /apps/{app_id}/subscriptions`.
     - Note that a **`free` plan is not available** to a general app without Salla enabling it. Use a trial (`plan_trial` days) or the lowest paid plan instead.
     - Skip billing for `store_type !== 'live'`.
   - **FR23:** keep "View options" for the MVP. Re-scope FR-PRD-08 (variant support) as "Slips option picker using `fetchOptions` + `addItem({options})` + `getPrice`". The platform supports it, so it is an effort decision, not a feasibility one. Exclude upload and date options.
4. **Other smaller changes:**
   - **FR8 / G7:** keep the Asia/Riyadh default and merchant setting. Salla does not visibly expose a store time zone.
   - **FR28 / G8:** specify **Embedded App** (iframe in the Salla dashboard, token introspection) as the primary entry. A separate tab via OAuth is the fallback.
   - **NFR4.c / Q-18:** give legal the concrete signal: `cookies-consent` and the `salla-cookies-bar::accepted|rejected` events, gated by the `website-cookies` store feature. Propose mirroring Salla's own policy (pseudonymous only when not accepted) as the default when no signal exists.
   - **FR25:** add rate-limit pacing (120 requests/min on Plus stores) to reconciliation, and note that webhook retries are only 3 × about 5 minutes.
   - **NFR3:** set webhook strategy `signature` explicitly. Leaving it unset means no verification.

---

## Hands-on test checklist (when a test store is available)

Set-up:
- Partners Portal app (draft) with Easy Mode, webhook URL and strategy `signature`.
- Demo store installed.
- 3 themes: Raed plus 2 popular paid or official themes.
- Products: simple, multi-option (select + colour), text option, out of stock.

**G1 Injection**
- [ ] Create an App Snippet that logs `page.slug`, `page.id`, `store.id`, `user.language_code`, `document.dir` and `salla.config.get('store.features')`. Install and confirm the `<script src>` from Salla's CDN appears on home, category and product pages on each theme without any theme edit.
- [ ] Record the `page.slug` values for home and category. Find a reliable category ID source (URL `/c{id}`, markup, or config).
- [ ] From the snippet, `fetch()` the Slips API, load an HLS/MP4 from the Slips media CDN, and POST an event. Capture response CSP headers and any console CSP violations.
- [ ] Check with Rocket Loader on and off, if store settings allow. Check in the Salla mobile app webview, if in scope.
- [ ] Measure: snippet stub plus Slips loader size and timing. No layout shift with zero content.

**G2/G3 Cart**
- [ ] `salla.cart.addItem({id, quantity:1})` as guest and as signed-in shopper. Log the `cart::item.added` payload (cart ID, items) and confirm the theme mini-cart updates.
- [ ] Out-of-stock and invalid-ID errors: record the `cart::item.added.failed` payload and HTTP status. Note the SDK's reset-and-retry behaviour.
- [ ] On product page X, add product X from Slips. Confirm the page-form validation interference (expected with `addItem` + `quantity`; test `quickAdd`).
- [ ] `fetchOptions([id])` → `addItem({id, quantity, options:{optId: valueId}})` for select, colour and text options. Confirm `getPrice` matches the cart line price. Test an out-of-stock variant.

**G4 Attribution**
- [ ] `addItem({..., notes:'slips:c123'})`. Check whether the note shows in the cart, checkout, order page, invoice and merchant dashboard on each theme. Check whether the shopper can edit it. Check whether `order.created` `items[].notes` contains it.
- [ ] Add the same product from the page and from Slips: one line or two? Which note wins?
- [ ] Complete checkout. Compare `cart.id` from `addItem` with "Order Completed" `checkout_id` (Device Mode listener and, if available, App Function `order.completed`). Check whether `order.created` / Order Details contain a cart or checkout ID.
- [ ] On `thank-you`, log `page.id` and confirm it equals the order ID.
- [ ] Check `source_details` on the order after landing with `?utm_source=slips`.
- [ ] Write an Order Tag through the API and confirm the merchant sees it.

**G5 Install and billing**
- [ ] Log `app.installed`, `app.store.authorize` (tokens, `merchant`), `app.uninstalled` and reinstall, and `app.updated` → re-authorize.
- [ ] Configure 2 recurring plans and a trial. Run trial start, convert, renew (if it can be simulated), cancel and expire. **Change plan up and down and record which events fire.**
- [ ] `GET /apps/{app_id}/subscriptions` matches the events. Confirm `store_type` is `demo`.
- [ ] Refresh-token single use: two concurrent refreshes, one fails.

**G6 Webhooks**
- [ ] Subscribe `product.*` and `order.*`. Verify `X-Salla-Signature` HMAC on raw bytes and `X-Salla-Security-Strategy`.
- [ ] Return 500 deliberately: count retries and intervals. Return 404 and confirm it is treated as failed.
- [ ] Rapidly update a product and order to observe ordering. Partially refund an order and inspect the `order.refunded` payload. Change variant stock and see which event fires.
- [ ] Pull 1,000+ products on a Plus-plan store and observe `X-RateLimit-*` and 429 behaviour.

**G7 Time zone**
- [ ] `GET /admin/v2/store/info`: record the full response and look for any time-zone field.

**G8 Re-entry and consent**
- [ ] Register an embedded page. Open it from the dashboard and verify `getToken()`, backend introspection (`S-Source`), theme and lang parameters, and the 401 refresh path.
- [ ] Enable the store cookie bar (if a merchant setting exists). Accept, reject and customize, and log `salla.storage.get('cookies-consent')`, the `salla-cookies-bar::*` events and the cookie values, from the snippet context. Confirm `store.features` includes `website-cookies`.
- [ ] Ask Salla Partner Support: is the cookie consent state a supported API for apps? Is there a CSP policy for snippets? Are App Functions storefront events available to public apps? Are there upgrade or downgrade events?

---

## Source index

**Official docs** (docs.salla.dev; seen through search extracts or cited by KIT; direct fetch was blocked in this environment):

| Topic | URL |
|---|---|
| App Snippets | https://docs.salla.dev/2220706m0.md |
| HTML to JS snippet migration | https://docs.salla.dev/2247590m0.md |
| Twilight JS SDK overview | https://docs.salla.dev/422610m0.md |
| SDK events | https://docs.salla.dev/422611m0.md |
| Cart | https://docs.salla.dev/422625m0.md |
| Add Item | https://docs.salla.dev/apidoc/project-451700/422629m0 |
| Product | https://docs.salla.dev/422641m0.md |
| Fetch Options | https://docs.salla.dev/569578m0.md |
| Single product page | https://docs.salla.dev/422561m0.md |
| Web components | https://docs.salla.dev/422688m0.md |
| Pixels | https://docs.salla.dev/1724365m0.md |
| Device Mode | https://docs.salla.dev/1724504m0.md |
| Cloud Mode | https://docs.salla.dev/1724667m0.md |
| Device Mode Cart & Checkout | https://docs.salla.dev/1804461m0.md |
| Custom events | https://docs.salla.dev/2007114m0.md |
| App Functions cart and checkout events | https://docs.salla.dev/1726822m0.md |
| Webhooks | https://docs.salla.dev/421119m0.md |
| Conditional webhooks | https://docs.salla.dev/421120m0.md |
| Order events | https://docs.salla.dev/433804m0.md |
| Product events | https://docs.salla.dev/433805m0.md |
| Register webhook | https://docs.salla.dev/5394134e0.md |
| App Events | https://docs.salla.dev/421413m0.md |
| App subscription events | https://docs.salla.dev/2213496m0.md |
| App Subscription Details | https://docs.salla.dev/5401098e0.md |
| Authorization | https://docs.salla.dev/421118m0.md |
| Rate limiting | https://docs.salla.dev/421125m0.md |
| Store Information | https://docs.salla.dev/5394261e0 |
| Order Details | https://docs.salla.dev/5394147e0 |
| Update Order | https://docs.salla.dev/5751605e0 |
| Create Order Item | https://docs.salla.dev/5751402e0 |
| Order Tags | https://docs.salla.dev/5394155e0 |
| Changelog | https://docs.salla.dev/421127m0 |
| Embedded SDK | https://docs.salla.dev/embedded-sdk/overview |
| Component Bundles | https://docs.salla.dev/2140782m0.md |
| Publishing your app | https://docs.salla.dev/playbook/launch-grow/publish-app |
| Create your first app | https://docs.salla.dev/421410m0.md |

**Official code** (read directly):

| Package or repository | Files read |
|---|---|
| npm `@salla.sa/twilight@2.14.590` | `types/api/cart`, `types/api/product`, `types/tiwlight-config.d.ts`, `types/event/cart.d.ts`, `dist/esm/index.js` |
| npm `@salla.sa/twilight-components@2.14.590` | `salla-cookies-bar` |
| npm `@salla.sa/analytics@2.14.590` | `src/storefront/index.js` |
| npm `@salla.sa/app-functions-types@0.9.0` | event unions; `order.d.ts`, `order-completed.d.ts`, `product-added.d.ts` |
| npm `@salla.sa/embedded-sdk@0.2.6` | package source |

**Official GitHub** (https://github.com/SallaApp):

| Repository | What was used |
|---|---|
| `salla-partners-agent-kit` | skills: snippets, webhooks, app-auth, app-lifecycle, app-billing, embedded-app, api-core, publication-consistency |
| `theme-raed` | theme hooks, page templates |
| `oauth2-merchant` | user/info shape |
| `store-events-tracker-starter-kit` | Pixels events tracker |
| `embedded-sdk-playground` | embedded SDK usage |

**Salla help centre:** https://help.salla.sa/en/article/app-launch-stages/ytgxyrwvcaed0ipkbhihao37 · https://help.salla.sa/en/article/add-order-tags/ujabhhczmmfdro0gp7bjwj0h

**Third-party (caution):** https://noqta.tn/en/tutorials/mastering-the-salla-app-store-essential-publishing-standards-for-developers · https://root.packagist.org/packages/salla/laravel-starter-kit (README on Easy and Custom Mode)

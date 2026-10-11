# Salla gate testing (Stories 1.11 to 1.14)

Goal: run the hands-on checks for gates G1 to G8 on a Salla demo store and write the results into `docs/spike-findings.md`. The desk research (`docs/salla-desk-research.md`) says what we expect; this runbook proves it. Plan about half a day. You need no coding, only copy and paste.

Never put real shopper data, secrets or tokens into the repository or into `spike-findings.md`. Use only test orders on the demo store.

## A. One-time setup

1. **Partners account and app.** Sign in at the Salla Partners Portal. Create a new app, type "Public app" (draft). Choose **Custom Mode** for now (Easy Mode, where Salla sends the tokens in a webhook, can be tried later as an extra check for G5). Note the Client ID, Client Secret and App ID.
2. **Demo store.** In the Partners Portal create a demo store. Switch its theme between the 3 test themes in step 8.
3. **Tunnel so Salla can reach your laptop.** Run the API locally (step 5), then in a second terminal: `cloudflared tunnel --url http://localhost:3001` (or `ngrok http 3001`). Copy the `https://....` address it prints. Call it `TUNNEL`. It changes each run, so update the portal URLs when it changes.
4. **Portal URLs** (App details):
   - OAuth callback / redirect URL: `TUNNEL/v1/integrations/salla/callback`
   - Webhook URL: `TUNNEL/v1/webhooks/salla`
   - Webhook security strategy: **Signature**. Copy the webhook secret it shows.
   - Scopes: at least those in `SALLA_DEFAULT_SCOPES` (settings, products, orders read, webhooks read/write, offline access).
   - Subscribe the store events: all `product.*` and `order.*`, plus the app events (installed, authorize, updated, uninstalled, settings.updated, trial.*, subscription.*).
   - Embedded page (for G8): route `home`, iframe URL = dashboard URL, set as default.
   - Billing: create 2 recurring plans and one with a trial.
5. **Environment variables** (copy `.env.example` to `.env`, fill in, then `pnpm --filter @slips/api dev`; Postgres must be running):
   - `SALLA_CLIENT_ID`, `SALLA_CLIENT_SECRET`, `SALLA_APP_ID`, `SALLA_WEBHOOK_SECRET`
   - `SALLA_REDIRECT_URI=TUNNEL/v1/integrations/salla/callback`
   - `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64: `openssl rand -base64 32`) and `OAUTH_STATE_SECRET` (`openssl rand -hex 32`)
   - `DASHBOARD_URL` and `PUBLIC_API_URL` set to your tunnel/host for the dashboard; `SESSION_COOKIE_DOMAIN` only if API and dashboard are on sibling hosts
   - `WEBHOOK_RECORD_DIR=/tmp/salla-recorded` (dev-only fixture recorder, see section C)
6. Check `curl TUNNEL/v1/health` answers. Then install the app on the demo store from the Partners Portal ("Test app"). The dashboard should show it connected.
7. **Register the App Snippet.** The stub (`packages/player/stub/stub.js`) points at `cdn.slips.app`, which does not serve a loader yet. For the gate, make a local, uncommitted copy of the stub with `CDN` and `API` changed to your tunnel hosts (and serve `packages/player/dist/loader.js` at `<CDN>/player/stable/loader.js`), paste it in Partners Portal, App details, Store Events, App Snippets. Follow `docs/runbooks/publish-stub.md` for the portal steps. If you skip the loader, G1 still works with the console snippet below, because that reads the same `salla.config` fields.
8. **Pick 3 themes**: Raed (Salla's default) plus 2 popular other themes (one official, one paid or a different layout family). Write their names in the findings table.
9. **Products**: one simple product, one with required options (a select, a colour and a text option), one out of stock. Note their numeric ids (shown in the dashboard URL).

## B. Gate checks (record each result in `docs/spike-findings.md`)

Paste scripts from `tools/salla-gate/` into the browser developer console (F12, Console tab; allow pasting if the browser asks).

### G1 Storefront injection (Story 1.11)
1. For each theme, open the home page, a category page and a product page.
2. Paste `tools/salla-gate/g1-page-context.js`. Copy the JSON it prints.
3. Record: does the `<script src>` from Salla's CDN appear (see `snippetScripts`) with no theme edit; the `page.slug` for home and category; the category id source (URL `/c<id>`); language and direction; `csp.headerEnforced` and any `csp.violations`; the `probes` results; `clsSoFar` (must be about 0); Rocket Loader yes/no.
4. Pass means: loads on home, category and product on all 3 themes, page type and id readable, CSP does not block the Slips origins. Otherwise the fallback is the guided manual snippet.

### G7 Store time zone (Story 1.11)
1. Get an access token (the dashboard install stored it; in a dev DB use the app's own call, or use the Salla API explorer in the Partners Portal).
2. `GET https://api.salla.dev/admin/v2/store/info` with `Authorization: Bearer <token>`. Save the response with PII removed (no owner name, email, phone).
3. Record whether any time zone field exists. If not: fallback Asia/Riyadh with a merchant setting.

### G2 and G3 Add to cart (Story 1.12)
1. On the storefront (guest, signed out), edit the two ids at the top of `tools/salla-gate/g2-g3-add-to-cart.js` and paste it. Watch the header cart counter.
2. Copy the result with `copy(JSON.stringify(window.__slipsGate, null, 2))`. Repeat signed in as a shopper.
3. Record: success and failure responses, the cart id, whether the mini-cart updated, whether options can be picked and added, whether `getPrice` matches the cart line. Also try the out-of-stock product and a product page of the same product.
4. G2 pass: add works for guest and signed in with a clear success/failure response. G3 pass: the option add works for select, colour and text. Fallbacks: "View product"; "View options" (FR23).

### G4 Cart tagging (Story 1.12)
1. The G2 script adds one line with `notes: "slips:gate-test"`. Place a test order (guest and signed in) from that cart.
2. Look in the recorded `order.created` fixture (section C) for the note in `items[].notes`, and for a cart or checkout id. Check the order page, invoice and merchant dashboard for the note and whether the shopper could edit it.
3. On the thank-you page run `salla.config.get('page.id')` and compare with the order id. Compare the cart id logged by the script with a checkout id in any event.
4. Do not copy shopper names, emails, phones or addresses anywhere. Fallbacks: order note/beacon, then "assisted orders" (FR13).

### G5 Install and billing (Story 1.13)
1. Install, uninstall, reinstall the app on the demo store. Open `TUNNEL`-side logs and the recorded files in `WEBHOOK_RECORD_DIR`.
2. Subscribe to a plan, start the trial, renew (if the portal lets you simulate), upgrade, downgrade, cancel, expire. After each action write down which event arrived (file names in the recorder directory show the event and time).
3. Record events and order/timing, and whether a plan change shows as its own event. Fallback: manual plan assignment by Slips Admin.

### G6 Webhooks (Story 1.13)
1. With `WEBHOOK_RECORD_DIR` set, change a product, its stock, create an order, update, cancel and (partly) refund it. Each verified delivery becomes a file.
2. Signature: deliveries that verify prove the HMAC works (a bad signature returns 401 and is not recorded). Record the header names seen.
3. Redelivery: temporarily make the receiver fail (stop the API, then restart) and note retry count and spacing. Record ordering by sending rapid updates.
4. Fallback if unreliable: periodic reconciliation polling (FR25), FR24 bounds relaxed.

### G8 Dashboard re-entry and consent (Story 1.13)
1. Open the app from the Salla merchant dashboard. Record whether you land signed in (the page calls `getToken()` and `POST /v1/session/embedded`; check the API log) and whether the introspection response carries an app id.
2. On the storefront enable the cookie bar if a setting exists, accept, reject and customize. Run `g1-page-context.js` after each and read `consent.storage`; also run `salla.storage.get('cookies-consent')` and `salla.config.get('store.features')` (contains `website-cookies`?).
3. Ask Salla Partner Support the four questions at the end of the desk-research checklist.

## C. Capturing webhook fixtures (G6)

1. With `WEBHOOK_RECORD_DIR=/tmp/salla-recorded`, every verified webhook is written as one JSON file: headers (signature and credentials redacted) and body with names, emails, phones, addresses, tokens and notes text replaced by `<scrubbed>`. It refuses to run when `NODE_ENV=production`.
2. Open each file and check by eye that no personal data remains (scrub is pattern-based; a store name or product title is kept on purpose). Fix by hand if needed.
3. Copy the 4 or 5 most useful ones (one per event type: app.installed, app.store.authorize with tokens removed, order.created, product.updated, app.uninstalled) to `apps/api/test/fixtures/salla/` and commit them in a separate commit. Never commit the whole folder, and delete the temp folder afterwards.

## D. Filling `docs/spike-findings.md`

1. For each of G1 to G8 set the hands-on result to PASS, FAIL or PARTIAL, link the evidence (theme names, screenshot file, the JSON, event file names) and, for a fail, pick the fallback already listed.
2. Tick each "verify in Story 1.11-1.13" checkbox you confirmed; add a one-line note for any that turned out different from the adapter's assumption.
3. Fill in the go/no-go section using the rules there, then sign it. Stories 1.11 to 1.14 close once this is done.

# Epic 1 Autonomous Run Log

Owner asked (2026-10-11) to finish Epic 1 unattended. Subagents run on Sonnet at low effort, and each story is pushed when done. This log lists every decision made without the owner, so it can be reviewed later.

## Ground rules for this run
- Each story runs through BMAD `bmad-build-auto` (plan, implement, review, commit), then the parent agent verifies the full pipeline under Node 24, pushes to `claude/serene-thompson-kkbae6` (PR #1) and checks CI.
- Stories 1.11–1.14 (Salla gate G1–G8) need a Salla Partners app and a demo store, which are not available. They are prepared as far as possible without one and marked blocked.

## Story log

### Story 1.1: Monorepo and CI. **Done** (`f610c31`)
- CI on PR #1 is green: lint, typecheck, test and build all pass, and both Docker images (api, dashboard) build.
- Decisions: NestJS uses its default HTTP layer (Express). Staging means CI-built images plus `docs/runbooks/staging.md`; no deploy target until hosting is chosen (Q-05). Removed the root `AGENTS.md` that Turbo generated.
- Deferred: DB check in the health endpoint, a CI smoke run of the images, pinning MinIO, and tests for worker queue registration. All are in `deferred-work.md`.

### Story 1.2: Player stub, bundle budget and layout-shift checks in CI. **Done** (`c555197`, review fixes `a91e28b`)
- Player sizes (gzip): initial payload 6.4 KB (limit 50 KB, core warning at 20 KB), viewer 5.2 KB (cap 25 KB), analytics batcher 0.2 KB (cap 5 KB). The size check runs inside `build`, so going over budget fails CI.
- Layout-shift (CLS) suite: Playwright, 18 scenarios across 3 test themes (content, no content, API timeout, invalid key, scroll past the anchor, anchor already on screen). It runs as its own CI job, `player-cls`, and Chrome's scroll anchoring is turned off in the test themes so it can't hide a shift.
- Decisions:
  - Build output is three entries: `loader.js`, `viewer.js` and `analytics.js`, plus a shared Preact chunk.
  - Content is inserted only when its anchor is below the screen (architecture rule AD-8). If the shopper has already scrolled past, nothing is shown until the overlay fallback arrives in Epic 5.
  - The stub's CDN and API addresses are placeholders (`cdn.slips.app` / `api.slips.app`) until hosting is chosen (Q-05).
  - Retries for the CLS tests are 0, so an intermittent layout shift can't pass on a second try.
- Review: an independent reviewer found 2 medium issues. The loader could insert content above the screen, and the tests couldn't catch it because Chrome's scroll anchoring hid the shift. Both are fixed, along with 3 low ones.
- Deferred: the stub doesn't read `salla.config` yet (Story 1.11); the CLS suite runs against a placeholder loader and must be re-run against the real player in Epic 5.

### Story 1.3: Observability baseline. **Done** (`6adbc89`, review fixes `5ca6af8`)
- Delivered:
  - One vendor-neutral telemetry module: pino JSON logs with deep redaction, metrics in Prometheus format at `GET /metrics`, alert rules with runbooks, and env-backed feature flags.
  - `/v1/health` now checks the database and returns 503 "degraded" when it's down; the worker has its own `/health` on port 3002.
  - CI now runs a Postgres 18 service container.
- Decisions:
  - **Redaction is over-cautious by design.** Any key that mentions token, secret, password, cookie, authorization, email, phone, name, address, customer or shopper is masked. Bearer tokens, JWTs, credentials in query strings and email addresses are masked inside free text too.
  - **`/metrics` is off unless `METRICS_TOKEN` is set.** When it's on, it needs `Bearer <token>`, checked with a timing-safe compare.
  - **Alert rules are vendor-neutral PromQL** in `ops/alert-rules.json`: alert at 5% server errors over 5 minutes, and whenever anything is in a dead-letter queue. Owners are placeholder roles, `platform-oncall` and `integration-owner`, until real contacts exist.
  - **Feature flags come from env vars** (`FEATURE_FLAGS=name=true`) for now. AD-22's database config table waits for the schema stories.
- Review: 2 medium findings (log messages and URL query strings skipped redaction) and 6 low ones. All fixed.
- Deferred:
  - No error-tracking vendor yet; errors are only logged, redacted.
  - The alert rules aren't loaded into any alerting system.
  - The dashboard's request-success metric relies on a header that a client could fake.

### CI fix (`961f771`)
- The player CLS job failed on GitHub because it built only `@slips/player`, so `@slips/contracts` had no `dist` on a fresh runner. It now builds the player's dependencies first (`turbo run build --filter=@slips/player...`). From here on, each story runs its CI job commands against a clean checkout before finishing.

### Story 1.4: Design-system foundation tokens. **Done** (`d1a6770`, review fixes `fe20271`)
- Delivered:
  - The approved coral tokens in `packages/ui` (Tailwind 4 with shadcn variables), light and dark.
  - The two-tone focus ring and the `input-border` token.
  - Plus Jakarta Sans and IBM Plex Sans Arabic via `next/font`.
  - The app icon (favicon) and logo SVGs in the dashboard.
  - 10 token tests: no purple, WCAG AA colour pairs, focus ring, type scale, Arabic rules.
- Decisions:
  - **Dark mode follows the OS by default**, with no JavaScript and no flash. The `.dark` and `.light` classes are kept so a manual toggle can be added later.
  - **Fonts are self-hosted at build time** by `next/font/google`. That means the build needs to reach Google Fonts; this is noted in the staging runbook.
  - **Jakarta loads as a variable font** so the 650 heading weight renders. Latin text and digits inside Arabic text fall back to Jakarta.
  - **One contrast exception:** in dark mode, the focus ring's inner white ring on coral fills is 2.81:1. It's accepted because the outer halo carries 3:1 against the surface. The approved tokens are unchanged.
- Review: two high issues are fixed. Dark mode never turned on, and the brand assets were missing. One medium and three low were fixed too.

### Story 1.5: Arabic-first i18n, RTL/LTR and the branded app shell. **Done** (`6412425`, review fixes `171f6ac`)
- Delivered:
  - Typed `ar`/`en` text catalogs; Arabic right-to-left by default.
  - Western digits and Gregorian dates in Arabic, and SAR formatted as "340 ر.س".
  - The app shell: side nav, top bar with the Salla connection chip, support link and language switch, a skip link, a mobile Sheet nav, and placeholder pages.
  - Lint rules that fail on physical CSS (left/right instead of start/end) and on `window.top`; a test that fails on hard-coded UI strings.
- Screenshots: `_bmad-output/implementation-artifacts/screens/shell-*.png` (Arabic desktop, English desktop, Arabic dark, Arabic mobile).
- Decisions:
  - **No i18n library.** The catalogs are typed TypeScript files; English defines the shape and Arabic is checked against it.
  - **Language comes from `?lang=` first, then a first-party cookie, then Arabic.** Inside the Salla iframe the cookie would be third-party, which the architecture forbids (AD-12). So the language is carried in the URL, and saving it per merchant moves to Story 7.1 (Settings > Language).
  - **`/admin` stays English-only** (internal back-office).
  - **Placeholders until Story 1.8:** the connection chip shows "not connected", "Preview store" is disabled with a stated reason, and support is a placeholder `mailto:support@slips.app`.
- Review: 1 high (the language choice wouldn't persist in the iframe; fixed as above), 2 medium and 4 low, all fixed.
- Deferred: the real support channel, testing inside a real Salla iframe, and per-merchant language (Story 7.1).

### Story 1.6: Tenant isolation with row-level security. **Done** (`3d0ec78`, security fixes `44bb7b7`)
- Delivered:
  - Two database roles: `slips_app` (the app) and `slips_admin_ro` (read-only admin). Both are created by migration with no login; deployment grants login and passwords.
  - One helper, `withStoreContext`, that sets the current store for a transaction only.
  - A `StoreScoped` repository base, and RLS helpers for future tenant tables.
  - A registry recording which module owns each table, and a cross-tenant test harness.
  - A lint rule banning hand-written store-context SQL.
- Decisions:
  - **Store IDs are always UUIDs.** If no store is set, the database errors instead of returning data (fail closed). A text option was dropped after review showed it doesn't fail closed.
  - **No default grants.** The app role gets access only to tables explicitly granted in each table's migration. Tenant tables get this automatically.
  - **Queue jobs** run through a `storeScopedJob` wrapper; no real job uses it yet.
- Security review: 3 medium findings were fixed.
  - A connection could be used after it went back to the pool; it is now blocked once the transaction ends.
  - A failed rollback returned a dirty connection to the pool; that connection is now destroyed instead.
  - Default grants exposed every future table; they are now removed.
  - 3 low findings were fixed too. Lint covers more bypasses, and the harness refuses a superuser pool, checks the exact error codes, and tests cross-tenant inserts.
- Deferred: audited admin reads (Epic 7); shipping migrations in the Docker image and running them in deploy; real-schema checks once tenant tables exist (from Story 1.8).

### Story 1.7: Transactional domain event transport. **Done** (`5163ea4`, review fixes `0aa73b1`)
- Delivered:
  - `publishEvent` puts the event on the pg-boss queue in the same database transaction as the change. A rolled-back change publishes nothing.
  - One queue, `events.dispatch`, consumed only by the worker (enforced by a lint rule).
  - A per-handler delivery record (ledger), so handlers are idempotent.
  - An event catalogue with Zod schemas in `packages/contracts`, starting with `integration.store.installed`.
- Decisions:
  - **One queue for all events**, fanned out to handlers by name.
  - **The pg-boss job ID is the event ID** (UUIDv7), so publishing the same event twice can't duplicate it.
  - **The ledger is an infrastructure table** with no owning module.
- Review: 2 medium findings, both fixed.
  - One failing handler stopped the others. Now each handler runs in its own transaction and only the failed ones retry.
  - A tenant event's store wasn't tied to its payload. Now the store comes from the payload and is checked when the event is published and when it's handled.
  - 3 low findings fixed too. An event with no handler now fails loudly instead of being silently dropped, the ledger's DELETE grant is removed, and a real lint rule replaces a weak text-search test.
- Deferred: the web server (http role) can't publish events yet (it needs a send-only pg-boss client, added when the first module publishes), and old ledger rows are never pruned.

### Story 1.8: Install Slips through Salla OAuth and store tokens securely. **Done** (`0fcdccb`, security fixes `060d2e0`)
- Delivered:
  - The `CommercePlatform` port, with a Salla adapter that holds every Salla URL, header and field, and paces calls per store (honouring `Retry-After`).
  - The first tenant tables: `stores`, `merchant_accounts`, `platform_tokens` and `token_access_log`, with forced RLS. Each passes the cross-tenant test harness.
  - The install routes `/v1/integrations/salla/install` and `/callback`.
  - Token refresh: one refresh at a time per store, under a database lock. A definitive rejection marks the store disconnected and emits an event.
  - The web server (http role) can now publish events.
- Built and tested against Salla's documented API with mocked HTTP only. There are no Salla credentials yet.
- Decisions:
  - **Custom Mode OAuth now; Easy Mode (webhook) shares the same core in Story 1.10.**
  - **OAuth scopes:** offline_access, settings.read, products.read, orders.read and webhooks.read_write. They can be overridden with `SALLA_SCOPES`.
  - **Tokens are envelope-encrypted** with AES-256-GCM, bound to the store and field. Every token access is recorded without the token value.
  - **Only a definitive OAuth rejection disconnects a store.** Network errors, server errors and rate limits change nothing.
  - **The Salla-store → Slips-store mapping is write-once** and readable only through one narrow database function.
  - **Required in production:** `OAUTH_STATE_SECRET` and `TOKEN_ENCRYPTION_KEY`.
  - **Deploy order: migrate → worker → web server**, because the worker sets up the event queue.
- Security review: the OAuth state flow and the encryption were clean. 3 medium findings, all fixed.
  - The store mapping could be rewritten to redirect tokens to another tenant. It is now write-once and readable only through the narrow function.
  - The queue grants let one tenant read other tenants' jobs. They are narrowed to the single insert the outbox needs.
  - A token refresh could hold a database lock for minutes during a Salla outage. It now fails fast instead.
  - 3 low findings fixed too: safer saving of rotated tokens, a lock on the install path, and a stable OAuth state secret.
- Deferred (verify in Stories 1.11–1.13 with a real store):
  - The exact Salla response shapes, and whether a failed refresh still uses up the refresh token.
  - Master-key rotation, and retention for the access log.

### Story 1.9: Merchant sign-in from the Salla iframe and from a direct link. **Done** (`7d7b50c`, security fixes `7acfb71`)
- Delivered:
  - **Inside Salla (embedded):** the dashboard sends Salla's `getToken()` token to the API, which checks it with Salla and returns a 15-minute token. The dashboard keeps that token in memory only.
  - **Direct link:** sign-in goes through Salla OAuth and sets an httpOnly cookie, with a CSRF token required on every change.
  - **Sessions** are stored on the server (`merchant_sessions`), so sign-out and the 12-hour idle timeout take effect immediately.
  - **Access** is denied by default for every route. `/admin` refuses everyone until Epic 7 adds an admin sign-in.
  - **Framing:** merchant pages can be framed only by `https://s.salla.sa`; admin pages and API responses can't be framed at all.
  - **Connection chip:** the dashboard's chip now shows real connection data.
- Decisions:
  - **A stored session only works the way it was issued.** An embedded token works only as a bearer header and a cookie session only as a cookie, so a stolen cookie can't be used as a bearer.
  - **Direct-link sign-in reuses the Story 1.8 install flow.** A returning merchant goes through OAuth again.
  - **⚠ Needs your confirmation: staff access.** Any Salla user who can open the app inside that store's Salla dashboard gets the store's session. Salla controls who sees the app, and the MVP has one account per store with no team roles. Each session records which Salla user signed in, for audit.
- Security review: 1 high finding, fixed. Express matches routes regardless of upper or lower case, so a merchant session could reach `/V1/Admin/...`. Routing is now case-sensitive and the guard compares lower-cased paths, with tests.
  - 2 medium findings fixed: an embedded token missing its expiry was accepted, and a token's app ID wasn't checked when present.
  - 3 low findings fixed: a timing-safe compare runs first, the old session is revoked when signing in again, and a callback without a valid state is proven to fail closed.
- Deferred (verify in Stories 1.11–1.13 with a real store):
  - The shape of Salla's token-check response, and whether the token is bound to our app.
  - How the dashboard behaves inside the real Salla iframe.
  - Rate-limiting embedded sign-in, and pruning old sessions.

### Story 1.10: Install and uninstall webhooks and the store lifecycle. **Done** (`fb270fb`, security fixes `b43bb5f`)
- Delivered:
  - `POST /v1/webhooks/salla`, which checks the HMAC signature over the raw body with a timing-safe compare. A bad signature gets 401 and nothing is stored.
  - `webhook_inbox` stores only a cleaned-up copy of each event with no personal data, plus a hash of the body.
  - Easy Mode install via the `app.store.authorize` webhook, reusing the Story 1.8 install code.
  - **Uninstall** stops Slips immediately and starts a 30-day grace period. After that, a resumable purge job deletes the store's data under a per-store lock.
  - **Reinstall** restores the same store record and moves it to a new install "epoch", so work from the old install is dropped.
  - Events for a store Slips doesn't know yet are held and retried for 15 minutes, then dead-lettered. They never get a 404.
  - `isStoreActive` checks are ready for the storefront (Epic 4) and billing.
- Decisions:
  - **Salla documents no event ID, so the event ID is a SHA-256 hash of the raw body.** To be verified with a real store in Story 1.13.
  - **Only `app.store.authorize`, `app.installed` and `app.uninstalled` drive the lifecycle for now.** Other signed events are stored and marked ignored until their stories arrive.
  - **Uninstall runs inside the request**, so Slips stops at once. Installs and retries run in a worker sweep every minute.
  - **Revoking tokens means deleting our stored copy.** There's no revoke call to Salla.
  - **If the merchant reinstalls during the grace period, the reinstall wins**, even if the purge has already started. After a full purge, a reinstall starts fresh under a new epoch.
  - **A purge leaves a small tombstone** (the scrubbed store row and the audit record) so the identifiers stay valid. Story 7.13 must allow for this.
- Security review: the signature check, payload cleaning and purge locking were sound. 1 medium finding fixed: an old signed uninstall replayed after a reinstall could kill the store. Now every applied lifecycle event goes into a replay ledger that survives purge, and events without a timestamp are judged by when they arrived. 3 low findings fixed: stale-authorize checks on active stores, strict timestamp parsing, and narrower database grants (the stored install tokens are readable only through a narrow function).
- Deferred:
  - Exact Salla webhook headers and fields (Story 1.13).
  - Retention for the inbox, audit and ledger tables.
  - Purging media and CDN copies, which arrives with those modules.
  - A replay procedure in the dead-letter runbook.

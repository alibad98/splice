# Epic 1 Context: Install, Sign-in & Salla Go/No-Go

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Set up the base for Slips, a Salla app for shoppable Stories and Reels. When the epic is done, a merchant can install Slips from the Salla App Store and open the dashboard from Salla already signed in. The dashboard shows a branded app shell in Arabic (the default) or English. For the team, the epic delivers the monorepo, a CI pipeline with player bundle-size and layout-shift (CLS) gates, an observability baseline, design-system tokens, tenant isolation, the domain-event transport and the store lifecycle. It ends with a written go/no-go decision on the Salla capabilities G1-G8, based on tests against a real demo store. Later epics are built only on what that decision confirms.

## Stories

- Story 1.1: Scaffold the Turborepo monorepo and CI pipeline
- Story 1.2: Gate the player stub and bundle budget plus CLS in CI
- Story 1.3: Establish the observability baseline
- Story 1.4: Build the design-system foundation tokens
- Story 1.5: Set up Arabic-first i18n, RTL/LTR and the branded app shell
- Story 1.6: Enforce tenant isolation with RLS and the StoreScoped repository
- Story 1.7: Provide the transactional domain event transport
- Story 1.8: Install Slips through Salla OAuth and store tokens securely
- Story 1.9: Sign merchants in from the Salla iframe and the direct link
- Story 1.10: Receive install and uninstall webhooks and run the store lifecycle
- Story 1.11: Verify storefront injection and store time zone on a Salla demo store (G1, G7)
- Story 1.12: Verify add-to-cart and cart tagging on a Salla demo store (G2, G3, G4)
- Story 1.13: Verify webhooks, billing events and dashboard re-entry on a Salla demo store (G5, G6, G8)
- Story 1.14: Record the Salla go/no-go decision

## Requirements & Constraints

- **Install and connection:** Installation uses Salla OAuth with minimal scopes. Tokens are encrypted and refreshed automatically. The dashboard shows "Connected to Salla" with the store name.
- **Uninstall:** Uninstalling stops Slips at once. The storefront content returns empty and billing processing stops. A reinstall within 30 days restores content and settings. After that the store's data is permanently deleted, including its media and CDN copies.
- **Accounts and sessions:** Each store has one merchant account and no team members. Sessions expire after inactivity (12 h for merchants, 30 min for admins). Merchants can sign out. They reach the dashboard from Salla (embedded) or from a direct link.
- **Security:** Tokens and secrets are never logged and every token access is recorded. Webhooks are signature-verified and idempotent. Automated tests cover tenant isolation. TLS 1.2+ and encryption at rest are required.
- **Privacy:** Shopper PII is never stored or logged.
- **Player budget, enforced in CI:**
  - Initial payload: fails above 50 KB gzip; core loader warns above 20 KB.
  - Lazy viewer: capped at 25 KB.
  - Analytics batcher: capped at 5 KB.
  - Layout shift: Slips must cause none, and must reserve no space when nothing is eligible. This is tested on 3 themes in these scenarios: content, no content, API timeout, invalid key, and scroll past the anchor before the manifest loads.
- **Operations:**
  - Structured logs, metrics and SLIs: API error rate, Salla API failures, webhook failures, queue depth and age, dashboard request success.
  - Alerts are mapped to owners and to runbooks.
  - Feature flags have safe defaults.
- **Localization:** All strings live in `ar`/`en` catalogs, with Arabic first. CI fails on hard-coded strings or missing keys.
- **Accessibility:** The dashboard meets WCAG 2.1 AA.
- **Gate checks G1-G8** are recorded in `docs/spike-findings.md`. Each entry has pass/fail, evidence and a fallback. A failed gate lists the affected FRs and the proposed PRD change, and Epics 2-7 are not sharded until the PRD is updated. A G1 failure with no manual-snippet fallback, or no reliable cart path for G2, means an explicit no-go for that scope.

## Technical Decisions

- **Stack (pinned exact versions):**
  - Tooling: pnpm 12.11, Turborepo 2.11, Node 24 (≥24.15), TypeScript 6.0, Vitest 5.0, Playwright 1.64.
  - Dashboard: Next.js 16.4 / React 19.3, Tailwind 4.3, shadcn.
  - API: NestJS 12.1, pino, pg-boss on the main Postgres 18.
  - Database: Drizzle 0.45 / Kit 0.31.
  - Player: Preact 11 with Vite 8.3.
  - Salla: `@salla.sa/embedded-sdk` 0.2, and `@salla.sa/twilight` 2.14 as type-only.
  - Local development: docker compose with Postgres and MinIO.
- **Source tree:**
  - `apps/dashboard`, with `(merchant)` and `/admin` route groups.
  - `apps/api`, with `src/modules`, `src/ports` and `src/adapters`.
  - `packages/contracts`, `db`, `player` (which contains `stub/`), `ui` and `config`.
  - `docs/runbooks/`.
- **Import boundaries (lint-enforced):**
  - Only `apps/api` imports `db`.
  - The player imports `contracts` as types only, and has `preact` as its only runtime dependency.
  - Domain modules never import adapters.
  - Salla SDK and types are imported only in `src/adapters/salla`. The domain depends on the `CommercePlatform` port.
- **Process model:**
  - The API is one image that runs as `role=http` or `role=worker`.
  - Worker queue groups: `realtime`, `media` and `batch`.
  - Retry policy lives in one file: 5 attempts with 30 s-15 min backoff, and 3 attempts for media.
  - HTTP handlers never do long-running work.
- **Contracts:** Every wire shape is a hand-written Zod `v1` schema in `packages/contracts`. Changes are additive only. Job and event payloads carry `v`. The dashboard gets data only through the API and never connects to the database.
- **Tenancy:**
  - Every tenant table has a non-null `store_id`, with RLS enabled and forced. The policy reads `app.store_id` with no `missing_ok`, so it fails closed.
  - The app database role owns no tables.
  - The store is set with `SET LOCAL` through one lint-enforced helper.
  - The `StoreScoped` repository throws when there is no store context, and workers set the context per job.
  - Each table has one owning module, kept in an ownership registry. A test fails on a table with no declared owner.
  - Every tenant table registers with the cross-tenant test harness.
- **Domain events:**
  - Events use a transactional outbox: they are enqueued to pg-boss in the same transaction as the change.
  - Event names follow `<module>.<entity>.<past-verb>`, and each is catalogued with its schema and owner.
  - Handlers run only in the worker and are idempotent on the event ID.
  - Modules never emit events to each other in-process.
- **Salla integration:**
  - Only `integration.getAccessToken(storeId)` refreshes tokens. It is single-flight under `pg_advisory_xact_lock` and persists the new token pair in the same transaction.
  - A definitive refresh failure sets the store to `disconnected` and emits an event.
  - The adapter paces calls per store and honours `Retry-After`.
- **Store identity:**
  - A store is located by `(platform, platform_store_id)`, with no separate public ID.
  - Tables include `stores` (with `lifecycle_state` and `install_epoch`), `merchant_accounts` and `platform_tokens`.
  - Tokens and secrets are envelope-encrypted.
- **Lifecycle:**
  - States move `active → disconnected → uninstalled (30-day grace) → purged`.
  - A reinstall restores the same row and increments `install_epoch`.
  - The purge is one resumable job that takes a per-store lock and re-checks state and epoch. It calls each module's `StoreDataLifecycle` purge and writes an audit record. Work with a stale epoch is dropped.
- **Webhooks:**
  - `X-Salla-Signature` is checked over the raw body with a timing-safe compare. An invalid signature gets 401 and is not stored.
  - `webhook_inbox` keeps only the canonical PII-free payload, the body hash, the type, the store's external ID and the unique Salla event ID, and returns 200.
  - Events for an unknown store are parked and retried for 15 minutes, then dead-lettered. They never get a 404.
  - Raw bodies are never logged.
- **Authentication:**
  - Embedded: the API introspects the token from `getToken()` and mints a short-lived bearer token. The dashboard keeps it in memory only and refreshes it with `getToken()`.
  - Direct link: Salla OAuth, then a first-party httpOnly, Secure, SameSite=Lax cookie plus a CSRF token.
  - No third-party cookies are used.
  - `/admin` has its own sign-in and guard, and merchant sessions get 403 there.
  - `frame-ancestors` allows only the Salla origin for merchant pages, and `'none'` for admin.
- **Player stub:** The App Snippet stub is static and identical for every store, and reads `salla.config`. It sets a `window.__slips` guard against double boot. It loads only from the Slips CDN and API origins and fails silently when blocked. It loads its loader through a stable/canary channel pointer.
- **Conventions:**
  - IDs are UUIDv7.
  - Times are stored as `timestamptz` in UTC, with store time-zone defaults of Asia/Riyadh.
  - Errors are RFC 9457 `problem+json` with a stable `type`. The dashboard localizes the user-facing text.
  - Logs are pino JSON with `request_id`, `trace_id`, `store_id` and `job_id`, with redaction.
  - Environment variables are validated with Zod at boot.
- **Hosting:** The provider, observability vendor and admin auth provider are deferred. Code against ports and adapters, and don't assume a vendor. Staging holds only test or synthetic data until the data-residency decision. Migrations run as a separate release step.

## UX & Interaction Patterns

- **Tokens:**
  - The `packages/ui` `globals.css` Tailwind 4 theme holds the full light and dark token sets, including chart and player tokens.
  - No purple. Gradients appear only in the logo and the story ring.
  - Coral fills use ink text, never white. Links use `info-text`.
  - `input-border` (3:1) is for control boundaries; `border` is decorative only.
- **Focus ring:** Two-tone, at full opacity: 2px ink inside a 2px coral halo. In dark mode the inside is white.
- **Type:** Plus Jakarta Sans and IBM Plex Sans Arabic, self-hosted through `next/font` and ordered by `:lang`. Arabic text has no negative letter-spacing and a body line-height of at least 1.55.
- **Spacing and shape:** 4px base unit, 18px gutter, 28/16px page padding. Radii are 8/12/16/22 and pill. There is one warm card shadow.
- **Shell:**
  - Start-side nav: Overview, Videos & Stories, Products, Analytics, with Settings at the bottom. The active item is a coral pill.
  - The top bar shows the store identity, a connection chip that links to Settings > Connection, "Preview store" and "Need help? Contact support".
  - A skip link comes first.
  - The nav collapses to icons at md and to a Sheet at sm.
  - Layout uses a 12-column grid with a 1360px maximum width.
- **RTL/i18n:**
  - Arabic is the default, with `dir="rtl"` on the root.
  - Only logical CSS properties are allowed, and physical ones fail lint.
  - Directional icons mirror; media icons do not.
  - Digits are Western with `tabular-nums`. Currency uses `Intl.NumberFormat`.
  - LTR values are isolated with `<bdi>`.
  - Copy uses a friendly-coach voice with no emoji.
- **Inside the Salla iframe:**
  - Only the page scrolls (no nested scroll), and sticky elements are relative to the iframe.
  - Modals fit the iframe, and there is no `window.top` navigation.
  - External links open in a new tab.
  - Direct-link sessions show "Open in Salla".
- **Brand:** Use the logo mark plus the EN or AR wordmark from the UX `brand/` folder. Derive the favicon from the mark. Export the app icon for the Salla listing.

## Cross-Story Dependencies

- Story 1.1 underpins all other stories.
- Story 1.6 (RLS) and Story 1.7 (outbox) are prerequisites for 1.8-1.10.
- Story 1.3 (telemetry) underpins logging and redaction everywhere.
- Story 1.4 (tokens) comes before Story 1.5 (shell). Story 1.8 supplies the connection chip data.
- The Story 1.2 stub is reused by Story 1.11. Story 1.12 builds on the demo store from 1.11. Story 1.13 needs Stories 1.8-1.10 deployed to staging.
- Story 1.14 consolidates Stories 1.11-1.13 and decides whether Epics 2-7 (catalog, player, attribution, billing) can proceed.
- Story 1.10 exposes an active-store check for the storefront content endpoint in Epic 4. The `StoreDataLifecycle` port must be implemented by every later module.

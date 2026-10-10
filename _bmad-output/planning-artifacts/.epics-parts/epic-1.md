## Epic 1: Install, Sign-in & Salla Go/No-Go

A merchant can install Slips from the Salla App Store, open the Slips dashboard from Salla already signed in, and see the branded app shell in Arabic or English. The team has a working monorepo, CI with the player budget and CLS checks, observability, the design-system foundation (tokens, focus ring, app shell), and a written go/no-go decision on Salla capabilities G1-G8.

### Story 1.1: Scaffold the Turborepo monorepo and CI pipeline

As a Slips developer,
I want a monorepo laid out exactly per the architecture spine's source tree and Stack table, with CI on every pull request,
So that every later story lands in a known place and every change is checked automatically.

**Requirements:** AD-1, AD-11, NFR8

**Acceptance Criteria:**

**Given** an empty repository and no starter template
**When** the scaffold is created
**Then** it contains `apps/dashboard` (Next.js 16.4 App Router with `(merchant)` and `/admin` route groups), `apps/api` (NestJS 12.1 with `src/modules`, `src/ports`, `src/adapters`), `packages/contracts`, `packages/db`, `packages/player` (with `stub/`), `packages/ui`, `packages/config` and `docs/runbooks/`
**And** tool versions match the spine Stack table (pnpm 12.11, Turborepo 2.11, Node 24 min 24.15, TypeScript 6.0, Vitest 5.0, Playwright 1.64; `@salla.sa/embedded-sdk` 0.2 and `@salla.sa/twilight` 2.14 pinned exactly, twilight type-only)

**Given** the import-boundary rules in `packages/config` eslint
**When** a file imports across a disallowed direction (e.g. `packages/db` from anything but `apps/api`, the player importing `contracts` at runtime, a domain module importing an adapter)
**Then** lint fails with a message naming the rule

**Given** `apps/api` built as one image
**When** it starts with `role=http` or `role=worker` (with `WORKER_QUEUES` groups `realtime`, `media`, `batch`)
**Then** the http role serves a `GET /v1/health` endpoint and the worker role connects to pg-boss on the main Postgres, with per-queue concurrency and retry policy (5 attempts, 30 s-15 min backoff; media 3) defined in one file
**And** env is validated with Zod at boot and the process exits with a clear error on a missing or invalid variable

**Given** `packages/contracts`
**When** a developer adds a wire shape
**Then** it is a hand-written Zod `v1` schema exported from contracts, and a sample `HealthResponse` schema is used by both API and dashboard

**Given** a developer runs `docker compose up`
**When** the stack starts
**Then** local Postgres 18 and MinIO are available and `pnpm dev` runs dashboard, API http and worker against them

**Given** any pull request
**When** CI runs
**Then** lint, typecheck and tests run via Turborepo for all packages and the PR is blocked on failure
**And** a "hello" dashboard and API build is deployable to a staging environment documented as holding only test-store or synthetic data until Q-05 is decided, with migrations run as a separate release step

### Story 1.2: Gate the player stub and bundle budget plus CLS in CI

As a Slips developer,
I want the player's size and layout-shift behaviour checked in CI from day one,
So that the storefront player can never silently exceed its budget or move the merchant's page.

**Requirements:** NFR1, NFR8, AD-7, AD-8, AD-21

**Acceptance Criteria:**

**Given** `packages/player` with a static store-identical stub in `stub/` and a placeholder loader built with Vite 8.3 and Preact 11.0
**When** CI builds the player
**Then** it fails if the initial payload exceeds 50 KB gzip and warns if the core loader exceeds 20 KB gzip
**And** separate size checks exist for the lazy viewer (cap 25 KB gzip) and analytics batcher (cap 5 KB gzip), each failing above its cap

**Given** the player runtime dependency list
**When** lint runs
**Then** any runtime import other than `preact` (e.g. Zod, Drizzle, `@salla.sa/*`) fails the build

**Given** a Playwright reference page with three theme fixtures
**When** the CLS suite runs the four NFR1 scenarios (content present, no content, API timeout, invalid key) plus "scroll past anchor before manifest"
**Then** the test fails if any `layout-shift` entry is attributable to Slips elements
**And** in the no-content, timeout and invalid-key scenarios no Slips element occupies layout space

**Given** the stub source
**When** CI runs
**Then** the stub is linted and tested to set a single `window.__slips` guard (second boot exits), load only from configured Slips CDN/API origins, and fail silently when the loader is blocked or times out
**And** a release step for publishing the stub to the Salla Partners Portal is documented in `docs/runbooks/`

### Story 1.3: Establish the observability baseline

As a Slips developer,
I want structured logs, error tracking, metrics and alerts behind one telemetry module,
So that the team can see and fix problems during the gate spike and pilot.

**Requirements:** AD-22, NFR7, NFR8, NFR3

**Acceptance Criteria:**

**Given** the API http and worker roles
**When** any request or job runs
**Then** pino JSON logs carry `request_id`, `trace_id`, `store_id` (when known) and `job_id`, and job payloads carry `trace_id` and `store_id` so one trace spans request and job

**Given** a request containing a token, secret, `Authorization` header or shopper PII field
**When** it is logged or captured as an error
**Then** those values are redacted, verified by a unit test

**Given** a `Telemetry` port in `src/ports` with a vendor-neutral adapter
**When** the system runs
**Then** metrics exist for API error rate, Salla API failures, webhook processing failures, queue depth and age per queue, and SLI counters for dashboard request success (NFR7)
**And** a metric or alert can be added later for compile lag and player errors without changing callers

**Given** alert rules
**When** the 5-minute API error rate exceeds the configured threshold or a webhook job dead-letters
**Then** an alert fires naming an owner and linking a runbook in `docs/runbooks/`

**Given** a `feature_flags` config mechanism
**When** a flag is read
**Then** it returns the configured value with a safe default when unset

### Story 1.4: Build the design-system foundation tokens

As a merchant,
I want the dashboard to use Slips' coral identity with readable contrast and visible focus,
So that it feels like one trustworthy product and is usable by keyboard.

**Requirements:** UX-DR1, UX-DR2, UX-DR3, UX-DR4, UX-DR5, UX-DR40, NFR6

**Acceptance Criteria:**

**Given** `packages/ui` `globals.css` with the Tailwind 4 theme
**When** the dashboard loads
**Then** every DESIGN.md color token (page, card, primary/accent, muted, border, input-border, info-text, delta-up/down, tints, status `-text` variants, chart-1..5, player tokens) exists as a CSS variable for light and dark, and the dark theme switches the full set
**And** no purple value exists in the token set and gradients appear only in the logo and story-ring tokens

**Given** a focusable control on any surface including a coral fill
**When** it receives keyboard focus
**Then** the two-tone focus ring renders (2px ink inner + 2px coral halo; dark: white inner + ring-dark) at full opacity

**Given** a form control
**When** it renders
**Then** its boundary uses `input-border` (3:1) while `border` stays decorative only

**Given** a primary coral button
**When** it renders
**Then** its text uses ink, never white, and coral is never used for body text (links use `info-text`)
**And** an automated contrast check over the token pairs passes 4.5:1 text and 3:1 UI in light and dark

**Given** Arabic and Latin text
**When** fonts load
**Then** IBM Plex Sans Arabic and Plus Jakarta Sans are self-hosted via `next/font` and ordered by `:lang`, with the type scale (display, h1-h3, body, body-lg, small, kpi), no negative letter-spacing on Arabic, Arabic body line-height at least 1.55 and Arabic display weight 700
**And** spacing (4px base, 18px gutter, 28/16px page padding), radius (sm 8, md 12, base 16, lg 22, pill) and the single warm card shadow exist as tokens, with popovers/dialogs adding a 1px border ring

### Story 1.5: Set up Arabic-first i18n, RTL/LTR and the branded app shell

As a merchant,
I want the dashboard to open in Arabic (or English) with correct direction inside a branded shell,
So that I can find my way around in my own language from the first visit.

**Requirements:** UX-DR7, UX-DR36, UX-DR37, UX-DR39, UX-DR41, UX-DR42, UX-DR43, NFR5

**Acceptance Criteria:**

**Given** `ar` and `en` message catalogs in the dashboard
**When** the app renders with no language preference
**Then** it defaults to Arabic with `lang="ar"` and `dir="rtl"` on the root, and switching to English sets `lang="en"` and `dir="ltr"`
**And** a CI check fails on any hard-coded user-facing string or any missing key in either catalog

**Given** dashboard styles
**When** lint runs
**Then** physical direction utilities and properties (left/right, `ml`/`mr`, `pl`/`pr`) fail the build; only logical properties are allowed
**And** directional icons mirror in RTL while media/playback icons never mirror

**Given** a number, price or date
**When** shown in either locale
**Then** Western digits 0-9 with `tabular-nums` are used, currency formats via `Intl.NumberFormat` ("340 ر.س" in Arabic, "SAR 340" in English, decimals only when non-zero), and LTR tokens (URLs, IDs, SKUs) are isolated with `<bdi>`/`dir="ltr"`

**Given** a signed-in merchant
**When** any page loads
**Then** the shell shows the start-side nav (Overview, Videos & Stories, Products, Analytics; Settings pinned bottom) with a coral-pill active item, an in-flow top bar with the store identity, a connection chip linking to Settings > Connection, "Preview store" and "Need help? Contact support", and a skip-to-content link as the first focusable element
**And** the nav collapses to icons at md and to a Sheet at sm, inside a 12-column grid with max width 1360px and comfortable density

**Given** the shell rendered inside the Salla iframe
**When** the merchant scrolls or opens a modal
**Then** only the page scrolls (no nested scroll), sticky elements are relative to the iframe, modals fit the iframe viewport, there is no `window.top` navigation and external links open in a new tab

**Given** brand assets from `ux-designs/ux-splice-2026-10-10/brand/`
**When** the dashboard loads
**Then** the logo mark sits at the inline-start of the EN or AR wordmark (light or dark per theme) with clear space of 2x the S stroke, the favicon is derived from the mark and legible at 16px, and the app icon (coral tile, ink S, amber ring) is exported for the Salla listing
**And** shell copy is drafted in Arabic first in the friendly-coach voice (no emoji, one next step)

### Story 1.6: Enforce tenant isolation with RLS and the StoreScoped repository

As a Slips developer,
I want every tenant query fenced by store context in both code and Postgres,
So that no query can ever return another store's data.

**Requirements:** AD-3, AD-2, NFR3

**Acceptance Criteria:**

**Given** `packages/db` with Drizzle ORM 0.45 / Kit 0.31
**When** migrations run
**Then** an app DB role exists that owns no tables, and a migration convention requires every tenant table to have non-null `store_id`, `ENABLE` and `FORCE ROW LEVEL SECURITY`, and a policy on `current_setting('app.store_id')` without `missing_ok`

**Given** one helper that opens a transaction and runs `SET LOCAL app.store_id`
**When** code sets the store context any other way
**Then** lint fails

**Given** a `StoreScoped` repository base
**When** it is called without a store context
**Then** it throws, and a raw query with no context returns an error (fail closed), not rows

**Given** a worker job carrying `store_id`
**When** the job runs
**Then** the job runner sets the store context for that job only

**Given** a table ownership registry in `packages/db`
**When** a table is added without a declared owner from the spine ownership map
**Then** a test fails

**Given** a reusable cross-tenant test harness
**When** it runs against a tenant table with rows for store A and store B
**Then** store A's context cannot read, update or delete store B's rows, and every later tenant table must register with this harness

### Story 1.7: Provide the transactional domain event transport

As a Slips developer,
I want domain events enqueued in the same transaction as the state change and consumed only by the worker,
So that cross-module reactions never fire before commit, after rollback, or get lost on a crash.

**Requirements:** AD-17, AD-1, AD-11

**Acceptance Criteria:**

**Given** a module writes a state change and publishes an event through the outbox helper
**When** the transaction commits
**Then** exactly one pg-boss job exists for the event; **when** it rolls back, none exists

**Given** an event catalog in `packages/contracts`
**When** an event is published
**Then** its name matches `<module>.<entity>.<past-verb>`, its payload validates against its v1 Zod schema with a `v` field, and its owning module is declared; an unknown event name fails at compile time

**Given** a handler registered in the worker role
**When** the same event ID is delivered twice
**Then** the handler's effect happens once (idempotent on event ID)
**And** the http role never consumes events

**Given** a module emitting an event through an in-process emitter to another module
**When** lint runs
**Then** it fails

**Given** the event carries `trace_id` and `store_id`
**When** the handler runs
**Then** logs share the originating trace and the store context is set (Story 1.6)

### Story 1.8: Install Slips through Salla OAuth and store tokens securely

As a merchant,
I want to install Slips from the Salla App Store and be connected,
So that I can start using it without any setup outside Salla.

**Requirements:** FR1, AD-4, AD-16, AD-20, NFR3

**Acceptance Criteria:**

**Given** a `CommercePlatform` port (auth, products, orders, subscriptions, webhook verification) and a Salla adapter in `src/adapters/salla`
**When** domain code needs Salla
**Then** it depends only on the port, and lint fails on any Salla SDK or type import outside the adapter

**Given** a merchant installs on a Salla test store
**When** the OAuth flow completes with minimal scopes
**Then** a `stores` row is created (`platform='salla'`, `platform_store_id`, store name, `lifecycle_state='active'`, `install_epoch=1`, synced domains), a `merchant_accounts` row is created for the one store owner, and `platform_tokens` holds the access and refresh tokens envelope-encrypted
**And** the store is located by `(platform, platform_store_id)` with no separate public ID

**Given** tokens and secrets
**When** any log line, error report or API response is produced
**Then** no token or secret value appears in it, and each token access is recorded

**Given** two concurrent callers for the same store with an expired access token
**When** they call `integration.getAccessToken(storeId)`
**Then** exactly one refresh happens under `pg_advisory_xact_lock`, the second caller re-reads the new token, and the new pair is persisted in the same transaction

**Given** Salla rejects the refresh definitively
**When** `getAccessToken` fails
**Then** the store moves to `disconnected` and a `integration.store.disconnected` domain event is emitted

**Given** Salla responds with 429 and `Retry-After`
**When** the adapter calls Salla
**Then** it waits per `Retry-After` and paces calls per store

**Given** an installed store
**When** the merchant opens the dashboard
**Then** the connection chip shows "Connected to Salla" with the store name (Arabic "متصل بسلة")

### Story 1.9: Sign merchants in from the Salla iframe and the direct link

As a merchant,
I want to open Slips from inside Salla already signed in, or from a direct link,
So that I reach my dashboard without a separate password.

**Requirements:** FR28, AD-12, UX-DR41, NFR3

**Acceptance Criteria:**

**Given** the dashboard opened inside the Salla dashboard iframe
**When** the embedded SDK `getToken()` returns a token
**Then** the API introspects it, binds the session to that store, and mints a short-lived bearer token held in memory only and sent as `Authorization`
**And** before expiry the dashboard calls `getToken()` again to refresh, with no third-party cookie used

**Given** the dashboard opened by direct link outside Salla
**When** the merchant signs in
**Then** Salla OAuth runs and a first-party httpOnly, Secure, SameSite=Lax cookie plus CSRF token is issued, and an "Open in Salla" link is shown

**Given** a state-changing request on the cookie session without a valid CSRF token
**When** it reaches the API
**Then** it is rejected with a `application/problem+json` 403

**Given** a merchant session idle for 12 hours
**When** the merchant makes the next request
**Then** the session is expired and the merchant is returned to sign-in with friendly copy
**And** "Sign out" ends the session immediately in either mode

**Given** a merchant session
**When** it calls any `/admin` API route
**Then** it is refused (403), and `/admin` has its own sign-in placeholder and guard

**Given** response headers
**When** a merchant page is served
**Then** `frame-ancestors` allows only Salla's dashboard origin; `/admin` sends `frame-ancestors 'none'`

**Given** a token introspected for an uninstalled or unknown store
**When** sign-in is attempted
**Then** access is refused with a reinstall message, and sessions are tenant-scoped per Story 1.6

### Story 1.10: Receive install and uninstall webhooks and run the store lifecycle

As a merchant,
I want uninstalling to stop Slips immediately and reinstalling within 30 days to bring everything back,
So that my storefront is safe on exit and nothing is lost if I return.

**Requirements:** FR2, AD-20, AD-4, AD-16, AD-17, NFR3, NFR10

**Acceptance Criteria:**

**Given** a Salla webhook for install or uninstall
**When** it arrives
**Then** `X-Salla-Signature` is verified over the raw body with a timing-safe compare; an invalid signature returns 401 and is not stored
**And** a valid one is written to `webhook_inbox` (canonical PII-free payload, body hash, type, store external ID, unique Salla event ID), the handler returns 200, and no raw body is logged

**Given** the same Salla event ID delivered twice
**When** both are received
**Then** one inbox row exists and the transition runs once

**Given** an install webhook for an unknown store that arrives before OAuth completes
**When** it is received
**Then** it is parked and retried for 15 minutes, then dead-lettered (never answered 404)

**Given** an active store
**When** an uninstall event is processed
**Then** `lifecycle_state` becomes `uninstalled` with a 30-day grace end date, `integration.store.uninstalled` is emitted in the same transaction, tokens are revoked, and billing-related processing is skipped for that store
**And** the storefront content endpoint returns an empty result for that store's locator

**Given** an uninstalled store within the 30-day grace
**When** the merchant reinstalls
**Then** the same `stores` row is restored by `(platform, platform_store_id)`, `install_epoch` increments, state returns to `active`, and `integration.store.reinstalled` is emitted

**Given** a `StoreDataLifecycle` port (export, purge, restore)
**When** the grace period ends
**Then** one resumable purge job takes a per-store lock, re-checks state and epoch before each batch, calls every registered module's purge, writes an audit record, sets state `purged`, and drops work carrying a stale epoch
**And** a reinstall during a running purge stops further batches

### Story 1.11: Verify storefront injection and store time zone on a Salla demo store (gate G1, G7)

As a Slips developer,
I want to prove the App Snippet stub loads and reads page context on real Salla themes,
So that the team knows whether storefront injection works before building the player.

**Precondition:** a Salla Partners app and a Salla demo/test store with at least 3 representative themes available to switch between.

**Requirements:** AD-4, AD-7, AD-16, AD-21, NFR1, NFR9

**Acceptance Criteria:**

**Given** the stub from Story 1.2 registered as the App Snippet on the demo store
**When** home, category and product pages are opened on 3 or more themes without editing theme code
**Then** the stub loads on every page type and a spike `StorefrontPlatform` maps `salla.config` to a `PageContext` (`pageType`, `targetId`, `lang`, `dir`) and the `(platform, platform_store_id)` locator

**Given** each theme
**When** the page is checked for CSP and reserved space
**Then** the team records whether CSP blocks Slips CDN/API origins and whether space can be reserved before the script runs (input to AD-8)

**Given** the Salla store API
**When** store details are fetched
**Then** the team records whether the store time zone is available

**Given** the results
**When** the story is complete
**Then** `docs/spike-findings.md` has G1 and G7 entries with pass/fail, evidence (theme names, screenshots or logs) and the fallback if failed (guided manual snippet; Asia/Riyadh default)

### Story 1.12: Verify add-to-cart and cart tagging on a Salla demo store (gate G2, G3, G4)

As a Slips developer,
I want to add products to the Salla cart from the injected script and trace the tag into the order,
So that the team knows whether in-content purchase and attribution are feasible.

**Precondition:** the Salla demo store from Story 1.11 with at least one simple product and one product with required options, and the ability to place test orders as guest and signed-in shopper.

**Requirements:** AD-4, AD-9

**Acceptance Criteria:**

**Given** the injected spike script
**When** it adds a simple product to the cart as a guest and as a signed-in shopper
**Then** the team records the success and failure responses from Salla's cart API (G2)

**Given** a product with required options
**When** the script attempts to choose an option and add it
**Then** the team records whether a supported Salla API allows this (G3)

**Given** a tag set at add-to-cart time and a test order placed from that cart
**When** the order webhook and order API are inspected
**Then** the team records whether the tag or cart/checkout ID is readable and linkable to line items, and whether a thank-you-page beacon is possible (G4)
**And** no shopper PII from the test order is written to the repository or logs

**Given** the results
**When** the story is complete
**Then** `docs/spike-findings.md` has G2, G3 and G4 entries with pass/fail, evidence and the chosen fallback ("View product", FR23 "View options", order note/beacon or "assisted orders")

### Story 1.13: Verify webhooks, billing events and dashboard re-entry on a Salla demo store (gate G5, G6, G8)

As a Slips developer,
I want to observe real Salla lifecycle, billing, catalog and order webhooks plus dashboard re-entry,
So that the team knows which Salla behaviours later epics can rely on.

**Precondition:** the Salla demo store and Partners app from Story 1.11 with app billing plans (incl. a trial) configurable in the Partners Portal; Stories 1.8-1.10 deployed to staging.

**Requirements:** AD-12, AD-20, FR28

**Acceptance Criteria:**

**Given** the app installed, uninstalled, reinstalled and moved through subscription start, renew, upgrade, downgrade, cancel, expire and trial
**When** events arrive at the receiver
**Then** the team records which events arrive, their order and timing, and whether billing supports the planned plan structure (G5)

**Given** product, stock and order (created, updated, cancelled, refunded) changes on the demo store
**When** the webhooks arrive
**Then** the team records that signatures verify, how redelivery and ordering behave, and saves a recorded PII-scrubbed real webhook fixture for the integration test suite (G6)

**Given** the merchant reopens Slips from the Salla dashboard
**When** the iframe loads
**Then** the team records whether the merchant is signed in via `getToken()` and whether Salla exposes a storefront consent state (G8)

**Given** the results
**When** the story is complete
**Then** `docs/spike-findings.md` has G5, G6 and G8 entries with pass/fail, evidence and the fallback if failed (manual plan assignment by Slips Admin; reconciliation polling with relaxed FR24 bounds; OAuth login link and consent default per Q-18)

### Story 1.14: Record the Salla go/no-go decision

As a Slips developer,
I want one consolidated decision on every Salla capability,
So that later epics are built only on what Salla actually supports.

**Precondition:** Stories 1.11-1.13 completed against the Salla demo store.

**Requirements:** FR1, FR2, FR28

**Acceptance Criteria:**

**Given** the entries from Stories 1.11-1.13
**When** `docs/spike-findings.md` is finalised
**Then** it lists G1-G8 each with pass/fail, evidence links and the fallback chosen for each fail, and ends with a go/no-go decision and a product-owner sign-off line

**Given** any gate failed
**When** the decision is recorded
**Then** the affected requirements (e.g. FR11, FR13, FR17, FR23, FR24) are listed with the proposed PRD change, and Epics 2-7 are flagged as not to be sharded until the PRD is updated

**Given** G1 fails with no working manual-snippet fallback, or G2 has no reliable cart path
**When** the decision is recorded
**Then** the document states no-go for the affected scope (storefront or in-content purchase) explicitly

**Given** the PRD open questions
**When** the decision is recorded
**Then** Q-01 and Q-11 are proposed for closure with the evidence

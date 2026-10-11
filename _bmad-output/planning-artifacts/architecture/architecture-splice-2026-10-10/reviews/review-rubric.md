# Rubric Review — Architecture Spine, Slips MVP

- **Reviewed:** `ARCHITECTURE-SPINE.md` (draft, 2026-10-10)
- **Against:** good-spine checklist; driving PRD `docs/prd.md` v0.3 (FR1-FR30, NFR1-NFR14, Epics 1-7), with `docs/prd-addendum.md` §B as context
- **Review date:** 2026-10-10

## Verdict

**Revise before Epics 2-7 are sharded.** The application-level core is good. It has a clear paradigm, mostly enforceable ADs, a verified-current stack and good PRD traceability. The operational envelope is mostly missing. Player rollout and rollback, backups and restore, migration safety, incident handling and observability are either absent or deferred on wrong grounds. Several real divergence points are also still open: the domain-event transport, the manifest key versus the Salla `store.id`, the embedded-app cookie, the attribution-window semantics and table ownership. Stories built on the spine as written would diverge on each of these.

| Severity | Count |
| --- | --- |
| Critical | 1 |
| High | 10 |
| Medium | 13 |
| Low | 9 |

## Checklist summary

| Criterion | Result |
| --- | --- |
| Fixes the real divergence points for epics/stories, misses none | **Partial.** Strong on tenancy, PII, wire contracts, attribution ownership and the webhook inbox. It misses the event transport, table ownership gaps, manifest keying and concurrency, rate-limit/dedup state, worker isolation and the consent gate. |
| Every AD's Rule is enforceable and prevents its divergence | **Mostly.** AD-3, AD-7 and AD-11 are well enforced (lint, CI, tests). AD-2 relies on an incomplete map. AD-6 relies on an undefined event mechanism. AD-9 contradicts FR13 rule 3. AD-12 does not work in an iframe. |
| Nothing under Deferred lets two units diverge | **Fail.** Observability (Story 1.7 is in Epic 1) and consent gating can both diverge. Redis is deferred while rate limits need shared state. |
| Named tech verified-current | **Pass.** All npm versions match `latest` as of 2026-10-10. Node 24 is the current LTS line. Drizzle 1.0 is at RC (see L-4). |
| Covers PRD capabilities | **Mostly.** Missing or thin: NFR8 (operations), NFR11/Story 7.10 (metering), NFR3 upload-security pipeline, FR25 single-flight token refresh, and the FR7/FR18 preview data path. |
| Every owned dimension decided, deferred or an open question | **Fail.** There is no Open Questions section. Backups/restore, incident handling, player rollout/rollback and API rollback are silent. Five PRD `[TBD: Architect]` values are unanswered. |
| Decisions, not rationale | **Pass.** "Prevents" lines are short and useful. |
| Diagrams valid mermaid and convey structure | **Valid.** All 4 blocks parse with mermaid 11.4.1. Structural accuracy is mixed (L-1, L-2). |
| Seed minimal | **Pass.** |

---

## Findings

### Critical

#### C-1 — Player release, rollout, rollback and kill switch undecided (NFR8)
- **Location:** AD-7; Deployment & environments; Deferred
- **Problem:** NFR8 requires the injector to be "versioned with gradual rollout and rollback". AD-7 says only that the identical stub "loads the versioned loader". It does not say:
  - which version a store receives, or who decides
  - how a percentage or per-store rollout works
  - how to roll back within minutes
  - whether loader URLs are immutable
  - how loader version N stays compatible with a `StoreManifest` compiled by API version M
  - how to switch Slips off on every storefront at once if a release breaks themes

  The stub is shared by thousands of live storefronts and cannot be changed quickly, because it ships through the Salla App Snippet. Without a rule, Epic 5 stories and the CI/CD work will each invent their own answer. A bad release would break merchant stores with no defined way back.
- **Suggested fix:** Add AD-16, "Player release channel". It should cover:
  - Loader bundles are immutable, at content-hashed URLs.
  - The stub never hard-codes a loader version. It reads `loader_url` from the manifest, or from a tiny global `channel.json` with a short TTL.
  - The `publishing` module (or a release job) assigns versions per store cohort for percentage rollout. Rollback means repointing the channel.
  - A global `enabled:false` kill switch is honoured by the stub before any render.
  - `StoreManifest` changes are additive within `v1`. The loader tolerates unknown fields. A breaking change needs `v2` and both versions served during rollout.
  - Story 5.6 failures block promotion of a channel.

### High

#### H-1 — Domain-event transport undefined, yet AD-2 and AD-6 depend on it
- **Location:** AD-2, AD-6, AD-1
- **Problem:** Modules "react to its domain events", and the manifest recompiles "only in reaction to these events". The spine never says how events travel. The options are an in-process emitter, a pg-boss queue, or an outbox written in the same transaction. Because `http` and `worker` are separate processes, an in-process emitter in `http` would silently never reach the worker. An emit after commit, without an outbox, can drop events on a crash and break the FR24 one-minute freshness bound. Each story will pick its own mechanism.
- **Suggested fix:** Add to AD-2: "Domain events are published to pg-boss inside the same DB transaction as the state change (transactional enqueue / outbox). Each queue is named after its event. Subscribers are worker jobs and must be idempotent. In-process emitters are forbidden for cross-module events."

#### H-2 — Observability deferred on a false premise
- **Location:** Deferred ("Admin sign-in provider and observability vendor … no story depends on the choice"); Consistency Conventions → Logging
- **Problem:** Story 1.7 is in Epic 1, before the spike ends. It requires metrics, graphs, alerts, and a trace ID that carries across the API and background jobs. NFR8 adds tracing, queue depth, Salla API failure metrics and injector error rates. Only pino logging is decided. These are still open:
  - trace-context propagation through pg-boss job payloads
  - the metrics instrumentation API (for example OpenTelemetry), which can stay vendor-neutral
  - how player errors reach Slips (no endpoint or channel is named)
  - which alert conditions apply
- **Suggested fix:** Decide the vendor-neutral parts now:
  - OpenTelemetry SDK for traces and metrics in `apps/api`.
  - `traceparent` is carried in every job payload contract (AD-11).
  - Player errors are sent as a `player.error` event type through `/v1/events`, sampled.
  - Name the minimum alerts: error rate, webhook failures, queue depth/age, Salla 4xx/5xx, manifest compile lag.
  - Defer only the backend or vendor, with a criterion.

#### H-3 — Backups, restore, DR and availability posture silent
- **Location:** Deployment & environments; Deferred (hosting)
- **Problem:** The PRD fixes several requirements here:
  - NFR8: daily backups, point-in-time recovery, and a restore test at least quarterly
  - NFR3: backups encrypted
  - NFR10: backups kept 35 days
  - NFR7: 99.9% availability for storefront-facing services

  The spine names none of them. Its provider criteria list ("must offer managed Postgres 18, …") also omits PITR, multi-AZ high availability and encrypted backups, so a provider that fails NFR8 could be picked. Object-storage durability and versioning for media and manifests are also not addressed.
- **Suggested fix:** Add an "Operations" subsection. It should say:
  - Managed Postgres with multi-AZ standby, PITR, 35-day encrypted backups and a quarterly restore drill into staging (owner named).
  - Object storage with versioning or soft-delete for media.
  - RPO and RTO targets.
  - Add these to the Deferred provider criteria.

#### H-4 — Migration safety and API rollback not defined
- **Location:** Deployment & environments ("DB migrations run as a separate release step before the new `http` and `worker` versions start")
- **Problem:** Migrations run before the new code. During a rolling deploy, old `http`/`worker` pods then run against the new schema, and a rollback runs old code on a migrated schema. There is no expand/contract rule, no rule against destructive changes in the same release, and no API rollback procedure. Long-running pg-boss jobs whose payloads change shape across versions are also not covered. A further gap: the `events_raw` monthly partitions must be created ahead of time. Nothing says who does that (a migration, a scheduled job or pg_partman). A missing partition makes ingestion fail.
- **Suggested fix:**
  - Rule: migrations must be backward-compatible with the previous release (expand/contract). Drops and renames ship one release later.
  - Rollback means redeploying the previous image, with no down-migrations.
  - Job payloads are versioned contracts, and handlers accept N-1.
  - A scheduled `analytics.partitions-ensure` job keeps 3 future partitions and alerts on failure.

#### H-5 — App Snippet uses Salla `store.id`, but the manifest is keyed by the regenerable public ID
- **Location:** AD-7 (stub "reads `store.id` … fetches the manifest"); AD-6 ("keyed by the store's public ID"); Consistency Conventions → IDs
- **Problem:** The two rules contradict each other. If the stub only knows Salla's `store.id`, it cannot build the public-ID URL. If the manifest is instead keyed by `store.id`, then FR17's "Regenerate" cannot work for App Snippet stores, because the key is fixed and cannot be revoked. The overlap period (FR17, `[TBD: Architect]`) and the process for serving both keys during the overlap are also undecided. The stub, `publishing`, settings (Story 7.1b) and the event-origin check (AD-10) will diverge.
- **Suggested fix:** Decide one of these:
  - (a) The stub fetches `cdn/s/salla/{store.id}.json`, a tiny pointer to the current public-ID manifest. Regenerate rewrites the pointer.
  - (b) The public ID is rendered into the snippet via App Snippet settings.

  Then fix the overlap at a stated value (for example 7 days). Both manifests are served during the overlap, and a scheduled `publishing.key-overlap-expired` job removes the old one. Add that job to the AD-6 trigger list.

#### H-6 — Session cookie `SameSite=Lax` will not be sent inside the Salla embedded iframe
- **Location:** AD-12
- **Problem:** The embedded app runs in an iframe on Salla's dashboard origin. That is a cross-site context, so browsers do not send `SameSite=Lax` cookies there. Safari, and Chrome when third-party cookies are blocked, may drop third-party cookies entirely. Merchant sign-in through the primary entry path will fail or behave differently per browser. Stories 1.3 and 7.x will diverge on workarounds, and the CSRF posture depends on which one is chosen.
- **Suggested fix:**
  - Embedded mode: authenticate each API call with a short-lived bearer token minted from the embedded-SDK token, held in memory and sent in the `Authorization` header. No cookie.
  - Direct-link or top-level mode: `SameSite=Lax` cookie plus CSRF protection.
  - Alternatively, `SameSite=None; Secure; Partitioned` (CHIPS) with an explicit CSRF token. Record which, and state the inactivity timeout (FR28 `[TBD: Architect]`).

#### H-7 — AD-9 records the window at add time; FR13 rule 3 applies the window in force at order time
- **Location:** AD-9 ("recorded with … the window in force")
- **Problem:** FR13 rule 3 says "A changed window applies to orders placed after the change", so the governing window is the one in force when the order is placed. Snapshotting the window on `cart_adds` gives a different answer whenever the merchant changes the window between the add and the order. Because AD-9 recomputes on every order event, a recompute that read the *current* setting would also re-judge old orders after a change. Story 6.2c AC3 and the E3 ±3% reconciliation depend on getting this right.
- **Suggested fix:** Snapshot `attribution_window_days` on the order when `order.created` is first ingested. Every recompute uses that snapshot. Drop the window from `cart_adds`, or keep it for audit only.

#### H-8 — Table-ownership map (AD-2) is incomplete
- **Location:** AD-2; "Core entities and owners" ERD
- **Problem:** AD-2 is only as enforceable as its map. The map leaves out:
  - `STORES` itself (labels on the outgoing edges name other owners)
  - store settings (attribution window, language, default display options, time zone)
  - Salla credentials/tokens
  - injector/public keys and their overlap state
  - order line items
  - categories
  - merchant accounts and sessions
  - admin users and `admin_audit_log`
  - per-store usage metering (NFR11)
  - export/deletion requests
  - reconciliation runs

  `integration`, `publishing`, `billing` and `admin` all have a plausible claim on store settings and keys. That is exactly the "two modules writing the same entity" this AD exists to prevent.
- **Suggested fix:** Replace the ERD-label approach with an explicit ownership table that lists every table and its owner. For example:
  - `stores`, `store_credentials`, `orders`, `order_lines`, `webhook_inbox` → `integration`
  - `store_settings` → a named owner (for example a `settings` module, or `integration`)
  - `store_keys` → `publishing`
  - `usage_meters` → `billing`
  - `admin_users`, `admin_audit_log` → `admin`

  Add a lint or test that fails when a table has no declared owner.

#### H-9 — AD-5 and AD-13 conflict on what `webhook_inbox` stores
- **Location:** AD-5 ("reduced to that canonical form before they are enqueued or persisted"); AD-13 ("Each webhook is stored in `webhook_inbox`")
- **Problem:** A reader can take AD-13 to mean storing the raw body, which contains the shopper's name, phone, email and address and would violate AD-5 and NFR4.b. It is also unclear where the reduction runs. AD-1 says the HTTP handler only validates, persists or enqueues, so the reduction has to happen inline in `http`, before the insert, and that is not stated. Stories 1.4 and 6.2a will diverge here, and Story 7.5 AC2 (no PII in stored records) depends on it.
- **Suggested fix:** State in AD-13: "The HTTP handler verifies the signature on the raw body, maps it through the Salla adapter to the canonical (PII-free) payload, and inserts only that payload into `webhook_inbox`. Raw bodies are never persisted or logged. Request-body logging is disabled on the webhook route." Add a test that feeds a fixture order webhook and asserts that no PII fields reach the DB or the logs.

#### H-10 — Manifest compile concurrency and ordering undefined
- **Location:** AD-6
- **Problem:** Several triggers can fire for the same store within seconds, for example a publish followed by a price webhook. Two workers compiling in parallel can finish out of order, so an older manifest overwrites a newer one and is purged into the CDN. FR24 (one minute) also implies debouncing. Nothing says whether compiles are coalesced, which version wins, or how the player detects a stale manifest.
- **Suggested fix:** Compiles run as a pg-boss singleton per store (`singletonKey = store_id`), debounced for a few seconds. Each compile reads a monotonically increasing `manifest_version` from the DB and writes only if it is newer than the stored version (compare-and-set). The manifest carries `version` and `compiled_at`.

### Medium

#### M-1 — AD-6 recompile trigger list is incomplete, and "No other code purges the CDN" conflicts with media deletion
- **Location:** AD-6
- **Problem:**
  - Missing triggers:
    - linked product deleted (FR25, Story 2.4 AC2)
    - product availability tier change (Low / Out of stock, FR16)
    - default display options or settings changed (FR17, FR29; the manifest contains display options)
    - reinstall within the grace period (FR2)
    - key overlap expiry (H-5)
    - content deactivated by billing (implied, but not named)
  - Story 3.6 and Story 7.9 / NFR4.e require media to be removed from the CDN. AD-6 forbids any module other than `publishing` from purging.
- **Suggested fix:** Make the list exhaustive, or define the trigger as "any domain event in the set `publishing.triggers`" declared in one file. Rule that media URLs are immutable (content-addressed), so deletion removes the object and needs no purge. Alternatively, route media purges through `publishing` via an event.

#### M-2 — Manifest cache policy and size bound undecided
- **Location:** AD-6, AD-7
- **Problem:** The spine sets no `Cache-Control` policy for the manifest. Without one, a browser `max-age` can defeat the one-minute purge guarantee (NFR7, FR24), and the player and `publishing` will each pick their own headers. Negative caching for unknown keys is also unspecified. A per-store manifest holding product snapshots for every product-scoped placement has no size cap. On a store with hundreds of product placements, every page fetches all of them, which works against NFR2 and NFR1.
- **Suggested fix:**
  - Fix the headers: for example `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=30`, and a short negative TTL for 404s.
  - Set a manifest size budget. Above it, shard by page type (`/{id}/home.json`, `/{id}/product/{pid}.json`).

#### M-3 — Rate-limit and dedup state has no shared store; ingestion deviates from the addendum
- **Location:** AD-10; Deferred ("Redis or another queue")
- **Problem:** Per-store and per-viewer rate limits and the dedup window need state shared across all `http` instances. Redis is deferred and no alternative is named, so stories will choose between in-memory limits per instance (wrong at scale) and Postgres (unclear cost at 10× peak). Dedup through a unique index on a monthly-partitioned table must include the partition key, so duplicates that cross a month boundary pass. Addendum §B.3 said events go through a queue. AD-10 appends synchronously from the handler, and that deviation is not recorded with its 10× peak (NFR14) sizing rationale.
- **Suggested fix:** Decide the limiter store, for example Postgres-backed token buckets or an edge/CDN rate-limit rule, and the dedup mechanism (unique `(event_id, received_month)` with a bounded window, or a dedup table with a TTL). Record that the synchronous append replaces the addendum's queue, and the condition that reverts it, tied to the Story 7.11 load test.

#### M-4 — Daily rollups cannot answer "Unique viewers" for arbitrary ranges; rollup lag undefined
- **Location:** AD-10 ("Dashboards read only the daily rollup tables")
- **Problem:**
  - Distinct viewers are not additive. Summing daily uniques over a custom range (FR14) over-counts.
  - The 30-minute view-dedup rule (§1.5) is not placed in the player, at ingestion or in the rollup.
  - Rollup cadence is not stated, so "Last 7 days" including today may show stale data, and each screen will handle that differently.
- **Suggested fix:**
  - Store a per-day HyperLogLog sketch (for example the `hll` extension, if the provider offers it) or a per-day viewer set in rollups.
  - Place view dedup in the rollup job.
  - State the rollup cadence (for example every 15 minutes for today, final at day close in the store's time zone) and show "data as of" in the UI contract.

#### M-5 — One `worker` role mixes CPU-heavy transcoding with latency-sensitive jobs
- **Location:** AD-1, AD-15
- **Problem:** ffmpeg jobs in the same process pool as webhook processing, manifest compiles and schedule boundaries can starve the jobs that carry the FR24 one-minute freshness bound and NFR13 (5 minutes at P95). Nothing sets concurrency or isolation per queue.
- **Suggested fix:** Keep one image, but allow `WORKER_QUEUES` to select queue groups (`realtime`, `media`, `batch`). Deploy media workers separately, with their own concurrency limits. State per-queue concurrency and priority in AD-1.

#### M-6 — Cross-store system jobs have no defined path under RLS
- **Location:** AD-3
- **Problem:** Several jobs must act across stores before any single store context exists:
  - the schedule-boundary scanner (finding all due schedules)
  - the daily reconciliation fan-out
  - partition maintenance
  - the store lookup by public ID on `/v1/events`
  - the pg-boss tables themselves

  Only `admin` may bypass RLS, so each of these stories will invent its own bypass. Also, Postgres table owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set.
- **Suggested fix:** Define a `system` role, limited to a few named non-tenant tables (store directory, schedule index, job tables) and fan-out jobs that only enqueue per-store jobs. Rule that the app role never owns tables and that tenant tables use `FORCE ROW LEVEL SECURITY`.

#### M-7 — No Open Questions section; PRD `[TBD: Architect]` values unanswered
- **Location:** Whole document
- **Problem:** The PRD hands these values to the architect, and the spine does not set them:
  - key overlap period (FR17)
  - session inactivity timeout (FR28)
  - on-demand module size caps (NFR1, Story 1.2 AC2; AD-7 says only "have their own CI cap")
  - media retry count and backoff (NFR12)
  - catalog sync retry and backoff (Story 2.1 AC3)

  Q-05 was due "before architecture" and appears only as a Deferred dependency. It needs an owner and a deadline, because it blocks pilot use of real data (E3, E4).
- **Suggested fix:** Set the values. For example: viewer module ≤ 25 KB gzip; media retries 3× with exponential backoff (30 s, 2 min, 10 min); session idle timeout 12 h. Add an Open Questions table (Q-05, Q-18, the Story 1.6b gate re-baseline) with owner, deadline and the ADs each one blocks.

#### M-8 — Deferred consent gating can let the player diverge
- **Location:** Deferred ("Consent gating of tracking")
- **Problem:** If nothing fixes where consent is checked, Epic 5 and 6 stories will emit events from many places. Retrofitting consent later then means touching each of them, and some may be missed.
- **Suggested fix:** Decide now that every player event goes through a single `track()` in the player, behind a `ConsentGate` on the `StorefrontPlatform` port. Its default behaviour stays deferred to Q-18 / G8.

#### M-9 — Incident handling absent
- **Location:** Operations (missing)
- **Problem:** The spine says nothing about:
  - severity levels, on-call, alert routing or runbooks
  - degraded modes: a Salla API outage (pause sync, keep serving the manifest), event-ingestion backpressure (rely on player-side queueing), a webhook backlog
  - merchant communication during incidents

  NFR7's 99.9% target and the pilot (E4) need these.
- **Suggested fix:** Add a short Incident subsection: an alert-to-owner map, a runbook location (`docs/runbooks/`), named degraded modes, and the kill switch from C-1.

#### M-10 — Cost metering and upload throttling (NFR11, Story 7.10) unowned
- **Location:** Capability map; AD-15; Deferred provider criteria
- **Problem:** No module owns per-store metering. Metering video-delivery bandwidth per store requires CDN log export, which the provider criteria do not require. Abuse throttling for uploads is not placed.
- **Suggested fix:** Assign metering to `billing` (`usage_meters`) and throttling to `media`, applied when the pre-signed URL is issued. Add "CDN access-log export with path-level attribution" to the provider criteria. Make media paths store-prefixed so bytes can be attributed to a store.

#### M-11 — Late cart adds after an order event are not recomputed
- **Location:** AD-9
- **Problem:** Batched and retried player events (NFR7 client queueing) can deliver the cart-add confirmation after the `order.created` webhook arrives. A recompute triggered only by order events then never credits that line, which drifts against E3.
- **Suggested fix:** Also trigger a recompute when a `cart_add` is inserted for a cart ID that already matches an order. Alternatively, run a delayed recompute (for example +30 min) after `order.created`.

#### M-12 — Single-flight token refresh (FR25) has no mechanism
- **Location:** AD-4, AD-13
- **Problem:** FR25 and Story 1.3 AC2 require exactly one token refresh at a time per store, across both `http` and `worker` processes. No lock mechanism is decided.
- **Suggested fix:** Add to AD-4: the `CommercePlatform` adapter refreshes under `pg_advisory_xact_lock(hash(store_id))`, re-reading the token after acquiring the lock. When refresh fails, it emits `integration.store.disconnected`.

#### M-13 — Upload security pipeline has no owner or port
- **Location:** AD-15
- **Problem:** NFR3 and Story 3.3 require type checks from file content, SVG rejection, EXIF/GPS stripping, malware scanning before publish, and SSRF-safe fetching of external links. AD-15 covers only transcoding. Malware scanning is missing from the provider criteria, and the "publish is blocked until scanned" state is not represented in AD-15.
- **Suggested fix:** Add to AD-15: a `MalwareScanner` port, scanning as a mandatory pipeline step before an asset can be `ready`, external fetches only through an egress-restricted fetcher (deny private IP ranges, follow redirects with re-check), and ownership in `media`.

### Low

#### L-1 — Dependency diagram mixes runtime calls with import rules
- **Location:** Invariants & Rules flowchart
- **Problem:** The text says "Arrows are the only allowed dependency directions", but the diagram mixes HTTP calls (`dashboard --> api`) with import edges. The `api` node and the `apps/api` subgraph are disconnected duplicates of the same thing. `player --> api` is labelled "CDN manifest", but the manifest comes from the CDN, not the API. `packages/ui` and `packages/config` are missing, which literally makes dashboard→ui forbidden.
- **Suggested fix:** Draw two diagrams: one for package imports only, including ui and config, and one for runtime calls (already covered by the Containers diagram). Merge the `api` node into the subgraph.

#### L-2 — Containers diagram omits key flows
- **Location:** Containers diagram
- **Problem:** Several edges and components are missing:
  - dashboard → object storage (pre-signed upload, AD-15)
  - media processing ↔ object storage
  - the thank-you-page beacon (AD-9 fallback)
  - Slips Admin
- **Suggested fix:** Add the four edges and nodes.

#### L-3 — `[ADOPTED]` markers are inconsistent
- **Location:** AD-1, AD-4, AD-7 compared with the other ADs
- **Problem:** Only three ADs carry a status, so readers cannot tell whether the untagged ones are proposed or decided. AD-8 carries an inline `[ASSUMPTION]` instead.
- **Suggested fix:** Give every AD a status (`ADOPTED`, `PROPOSED` or `ASSUMPTION` plus its gate).

#### L-4 — Stack: Drizzle 1.0 is at RC; drizzle-zod's future is unclear
- **Location:** Stack; AD-11
- **Problem:** Every version was checked against the npm `latest` tags on 2026-10-10 and all match. Node 24 is the current LTS (24.21). `drizzle-orm@1.0.0-rc.5` is published, though. 1.0 moves Zod generation into `drizzle-orm` and changes the migrator, so a mid-MVP upgrade is likely.
- **Suggested fix:** Pin 0.45 for the MVP, and record an upgrade checkpoint for when 1.0 reaches GA. Keep drizzle-zod use confined to `apps/api` (already ruled) so the blast radius stays small.

#### L-5 — Single global name and custom element tag not named
- **Location:** AD-7
- **Problem:** Story 5.1 AC3 allows "one documented name" in the global namespace. Tech-stack names `<slips-player>`, but the spine names neither the global nor the tag. The CSP domains merchants may need (CDN host, API host) are not listed either.
- **Suggested fix:** Name the global (for example `window.__slips`), the custom element tag, and the two hostnames.

#### L-6 — Preview data path (FR7, FR18) unspecified
- **Location:** Capability map, Epic 3 row
- **Problem:** The spine says "preview embeds the real player" but not where the preview data comes from. Draft content is not in the CDN manifest, and the simulated cart needs a preview `StorefrontPlatform` adapter.
- **Suggested fix:** Add `GET /v1/preview/manifest` returning a `StoreManifest` built from drafts (same contract), plus a `PreviewPlatform` adapter in `packages/player`.

#### L-7 — Where VAT exclusion and discount apportionment happen is unplaced
- **Location:** AD-5, AD-9; Conventions → Money
- **Problem:** FR13 rule 2 and Q-14 require net-of-VAT amounts with order discounts apportioned by line value. The spine does not say whether the adapter's canonical `Order` or `attribution` computes this, so two implementations can appear.
- **Suggested fix:** Rule that the canonical `Order` carries raw amounts and VAT, and that only `attribution` computes credited amounts.

#### L-8 — AD-8's overlay fallback silently overrides the merchant's chosen layout
- **Location:** AD-8
- **Problem:** Strips placed above the fold on product pages will usually fall back to the overlay entry point, which differs from FR29's chosen layout. Merchants and preview won't know.
- **Suggested fix:** Have the player emit a `placement.fallback` event, and have preview show the fallback behaviour.

#### L-9 — Infrastructure-as-code and environment config approach not stated
- **Location:** Deployment & environments
- **Problem:** The spine does not say how staging and production are provisioned, which makes environment parity and the Q-05 region switch harder.
- **Suggested fix:** State "all infra defined as code in `infra/` (tool chosen with the provider)", and that staging mirrors production topology at smaller size.

---

## What is good (keep)
- The paradigm is crisp. Hexagonal ports for Salla, media, storage and CDN directly serve Q-07.
- AD-3 (RLS behind a scoped repository, with an audited admin bypass), AD-5 (PII stops at the adapter) and AD-11 (contracts only) are enforceable and well targeted.
- AD-7 turns NFR1 into CI gates and lint rules.
- AD-9 as a pure recompute with one owner is the right shape for E3.
- AD-13's inbox with an `updated_at` guard covers G6 and FR25 ordering.
- The stack is verified current, and the seed is minimal.
- Deferred items mostly carry explicit revisit triggers (columnar store, HLS, Redis).

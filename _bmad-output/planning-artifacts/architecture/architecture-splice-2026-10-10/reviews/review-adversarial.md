---
type: architecture-review
lens: adversarial (compliant-but-incompatible unit pairs)
target: ../ARCHITECTURE-SPINE.md
context: docs/prd.md v0.3 (FR1-FR30, NFR1-NFR14, Epics 1-7), docs/salla-desk-research.md
reviewed: '2026-10-10'
verdict: 'Not build-ready: the spine is sound in paradigm but leaves five entity, identity and ordering seams open, so units that obey every AD to the letter will still ship a storefront that shows the wrong content and attribution that misses E3.'
counts: { critical: 5, high: 12, medium: 17, low: 6, total: 40 }
---

# Adversarial Review: Architecture Spine, Slips MVP

## Method

For each hole I built two units one level below the spine (stories, or roles: dashboard / API http / worker job / player / admin). Each unit obeys every AD and convention as written. The pair still builds something incompatible. Each hole names:

- **Pair**: the two units.
- **Both compliant because**: why the spine allows each reading.
- **Clash**: what breaks when they meet.
- **Fix**: a new or tightened AD or convention that rules out one of the readings.

Severity:
- **Critical**: breaks an exit criterion (E2, E3, E5) or a storefront-safety promise (FR2, FR10, FR24), or forces an AD violation by the spine's own design.
- **High**: silent wrong data or a merchant-visible defect likely in the pilot.
- **Medium**: rework or an incident is likely, but it can be caught in test.
- **Low**: an ambiguity that is cheap to pin down now.

## Verdict

Not build-ready. The paradigm (modular monolith, precompiled manifest, append-only events, pure-recompute attribution) holds up. The gaps are at the seams, and three cause most of the damage:

1. **No domain-event transport.** AD-2 assumes events are delivered, but nothing says how, or whether they wait for commit.
2. **No store-identity model.** The CDN key, the stub's `store.id`, the "store public ID" and FR17's regenerable key are four names. The spine never says whether they are one thing or several.
3. **No content-lifecycle owner across time.** Schedule boundaries, plan deactivation and media processing each mutate content status from a different module.

The closed list of purge triggers in AD-6 is also incomplete. Because AD-6 forbids purging for any other reason, each missing trigger becomes a guaranteed staleness bug.

---

## Critical

### H-01: Store identity vs key regeneration (AD-6 × AD-7 × FR17)
- **Pair:** Story 5.1 (stub and loader) vs Story 7.1b (regenerate key).
- **Both compliant because:** AD-7 says the stub reads `store.id` from `salla.config` and fetches the manifest. AD-6 says the manifest is keyed by "the store's public ID". The IDs convention says the public ID is "a separate, non-secret, indexed column". So 7.1b rotates `stores.public_id`, and the stub keeps fetching by Salla `store.id`, because that is all a static App Snippet can know (salla-desk-research §G1, recommendation 1).
- **Clash:** One of two things happens.
  - The CDN path uses Salla `store.id`. Then regeneration changes nothing, and the merchant is told a key changed that is not used anywhere.
  - The CDN path uses `public_id`. Then the static stub cannot find the manifest without a DB lookup on the hot path, which breaks AD-6.

  The `public_id` column also has no slot for "old key during overlap". The events endpoint (AD-10 checks "store public ID") and the manifest path can each pick a different identifier.
- **Fix: new AD-16, Store identity and keys.**
  - The storefront locator is `(platform, platform_store_id)`. It is used by the App Snippet and the manifest path.
  - The injector key is a separate `store_keys` table owned by `publishing`, with columns `key`, `status ∈ {active, retiring, revoked}` and `retire_at`. It is used only for manual-paste installs and as an extra event credential.
  - The manifest is published under the locator and under every non-revoked key.
  - Events are accepted with the locator, or with a key whose status is active or retiring.
  - A `publishing.key.retired` job runs at `retire_at` and is an AD-6 trigger.
  - Under App Snippet installs, FR17 shows "no reinstall needed". Regeneration then only matters for pasted snippets. This is recorded as a PRD feedback item.

### H-02: Domain events have no transport and no commit guarantee (AD-1 × AD-2 × AD-6)
- **Pair:** `content` publish handler (http role) vs `publishing` compile job (worker role).
- **Both compliant because:** AD-2 says modules "react to its domain events" but does not say how they are delivered. One developer uses the NestJS in-process `EventEmitter2` inside the http role and emits before commit. Another registers the `publishing` listener only in the worker role, because AD-1 says compiling is worker work.
- **Clash:**
  - The listener never runs, because it lives in another process.
  - Or it runs in-process and reads pre-commit state, so it compiles the old manifest.
  - A rolled-back transaction still triggers a purge.
  - A crash between commit and emit loses the event, and the storefront stays stale indefinitely, because AD-6 forbids any other purge.
- **Fix: new AD-17, Transactional domain events.**
  - Every domain event is written in the same DB transaction as the state change. Use pg-boss `send` with the transaction's executor, or an `outbox` table that a relay drains.
  - Consumers run only in `worker` and are idempotent, keyed on event ID.
  - In-process emitters are lint-banned for cross-module events.
  - An event catalog lives in `packages/contracts/events`. Each event lists its owner module and payload schema, and AD-11 covers job payloads already.

### H-03: Cart-confirm vs order-webhook race (AD-9 × AD-10 × AD-13)
- **Pair:** Player add-to-cart (Story 5.4) vs order ingestion and recompute (Stories 6.2a and 6.2b).
- **Both compliant because:**
  - AD-10 says the player batches events. The player puts the cart confirm in the next batch, sent on unload with retry.
  - AD-9 recomputes only "on every order event". The shopper checks out within seconds, so `order.created` is verified, inboxed and recomputed before the `cart_adds` row exists.
- **Clash:** The recompute finds no cart add, so it writes zero credited lines. No later order event arrives, so the credit is lost for good. This is most common for the fastest buyers, the exact UJ2 case, and it pushes E3 (±3%) out of reach. Offline retry in the player makes the gap longer.
- **Fix: tighten AD-9.**
  - The cart confirm is a dedicated, unbatched `POST /v1/cart-adds` sent immediately with `keepalive`. It is never deferred to the analytics batch.
  - Recompute triggers both ways. On a `cart_adds` insert, the module looks up orders with `checkout_id = cart_id` (or matching beacon rows) and recomputes them.
  - A scheduled `attribution.recheck` job re-runs every order placed in the last 15 days (window max + 1) once a day, as part of FR25 reconciliation.
  - Recompute stays pure, so all three paths converge.

### H-04: Manifest compile races and last-writer-wins on the CDN (AD-6 × AD-1)
- **Pair:** Two `publishing.compile` jobs for the same store. One is triggered by `content.item.archived` at t1, the other by `catalog.product.updated` at t2.
- **Both compliant because:** AD-6 says to recompile on each listed event. pg-boss runs jobs concurrently by default.
  - Job B reads state after the archive and uploads first.
  - Job A started earlier, read state before the archive, finishes later and uploads last.
- **Clash:** The archived or deleted content reappears on the storefront. No new event comes, so it stays there indefinitely. This breaks FR24, Story 3.6 AC2, and any takedown (Q-09). There is also no debounce: a flash sale that changes stock on every order triggers one compile and one purge per order, at 10× peak (NFR14).
- **Fix: new AD-18, Manifest compile protocol.**
  - Use one compile job per store at a time (pg-boss `singletonKey = store_id`, coalescing pending triggers).
  - `store_manifests.revision` is a monotonic bigint. The job takes a snapshot revision at read time and uploads only if a compare-and-set on `revision` succeeds. Otherwise it re-queues.
  - Debounce: compile no sooner than 5 s after the first trigger and no later than 30 s, which keeps the FR24 one-minute bound.
  - The `catalog` module emits product events only when a manifest-visible field changes: price, sale price, availability bucket, name, image, or required-options flag. Raw quantity changes do not count.

### H-05: Two writers of content status at schedule boundaries (AD-2 × Capability map × FR22)
- **Pair:** Story 4.2 (`content`: "goes live at the set time", status changes from Scheduled to Published) vs Story 4.4 (`publishing`: "schedule-boundary jobs", per the Epic 4 row of the capability map).
- **Both compliant because:** The capability map places schedule-boundary jobs in `publishing`, but FR22 status lives in `content_items`, which `content` owns.
  - Reading A: the `publishing` boundary job flips `status`, which breaks AD-2. Or it treats status as irrelevant and evaluates `[start, end)` itself.
  - Reading B: `content` runs its own boundary job to flip status, then emits an event.
  - FR22 is also silent on what an ended item becomes. Under reading A it stays "Published" and keeps counting toward plan limits (AD-14). Under reading B it becomes Archived.
- **Clash:**
  - Two boundary jobs race.
  - The dashboard "Scheduled" tab and the manifest disagree on which items are live.
  - Ended items consume plan slots under one reading but not the other.
- **Fix: new AD-19, Content lifecycle state machine owned by `content`.**
  - The stored status is the FR22 set plus **Ended**. Ended does not count as active and appears in the All tab.
  - `content` alone owns boundary jobs. Each job is keyed by `(item, boundary, schedule_version)` so that a rescheduled item does not fire its old job.
  - Each transition emits `content.item.{went_live,ended}`.
  - `publishing` only filters by `status = Published` and never evaluates time.
  - Transitions caused by other modules arrive as commands to `content`: `media` signals Processing done or failed, and `billing` signals deactivate or reactivate.
  - The allowed-transition table lives in `contracts`, so the dashboard and API share it.

---

## High

### H-06: Old cached player vs new manifest schema, and stale manifests that never recompile (AD-6 × AD-7 × AD-11)
- **Pair:** Loader `v1.4` cached in a browser or on the CDN vs API release that emits `StoreManifest` with a renamed field. Separately: the API release vs a store whose manifest was compiled under the old schema.
- **Both compliant because:** AD-11 says contracts are "versioned v1", but gives no rule for evolving them. AD-6 recompiles only on business events, so a schema bump is not a trigger, and no other code may purge.
- **Clash:**
  - A loader expecting `items[].cta.kind` gets `items[].cta.action` and renders nothing, or throws inside Shadow DOM.
  - Stores with no edits keep old-schema manifests indefinitely, and the new loader breaks on them.
  - The NFR8 gradual rollout has no per-store pin, because the stub is identical for every store.
- **Fix: tighten AD-6, AD-7 and AD-11.**
  - The manifest path includes the schema major: `/m/v{N}/{locator}.json`.
  - Within a major, changes are additive only. Readers ignore unknown fields. The player parses defensively and treats an unknown shape as "no content".
  - During a major transition, `publishing` compiles every live major.
  - A deploy-time `publishing.schema.bumped` backfill job recompiles every store. It is added to the AD-6 trigger list.
  - The manifest carries `loader: {version, url, integrity}`. The stub loads that URL, which enables per-store rollout and rollback without changing the snippet.

### H-07: The closed purge-trigger list in AD-6 misses real manifest inputs
- **Pair:** Any of these units vs `publishing`:
  - Story 7.1b (default display options)
  - Story 2.5 (reinstall restores content)
  - Story 2.4 (linked product deleted)
  - Story 7.2c (deactivation after grace)
  - H-01 (key overlap expires)
  - G7 (store time-zone change)
  - Story 3.6 (media replaced on a live item)
- **Both compliant because:** AD-6 says "only in reaction to these events", and none of the above is on the list. "Content edited" might arguably cover some of them.
- **Clash:** Each of these changes leaves the storefront stale until something unrelated happens. The FR2 and Story 2.5 AC3 case is the worst: a reinstall restores content in the DB, but the manifest stays empty.
- **Fix:** Replace the enumerated list with a dependency rule. `publishing` declares the manifest's inputs in one place: a `ManifestInputs` contract that lists each event it subscribes to. Any module that changes a declared input must emit the matching event (H-02). CI fails if a field read by the compiler has no subscribed event. The list in AD-6 becomes illustrative, and `integration.store.reinstalled`, `catalog.product.deleted`, `content.item.deactivated`, `publishing.key.retired`, display-settings changes and `publishing.schema.bumped` are added.

### H-08: Plan limits enforced twice with different orderings (AD-14 × FR19 × FR30)
- **Pair:** Story 7.2c (`content` deactivates the items over the limit in Q-04 order after the grace period) vs Story 4.3 AC5 (`publishing` "enforces limits in the manifest via `getEntitlements`").
- **Both compliant because:** AD-14 tells both modules to enforce. `publishing` trims to the limit using its natural FR30 order (most recently published first). `content` uses the Q-04 deactivation order, for example oldest first.
- **Clash:**
  - During the grace period, the storefront hides items the dashboard shows as Published.
  - After the grace period, the two modules hide different items.
  - Concurrent publishes (dashboard Publish and the worker auto-publish in Story 3.4b) both read a count of limit − 1 and both pass.
- **Fix: tighten AD-14.**
  - Enforcement has one decision point. `content` admits items at publish time and deactivates them on plan change.
  - `publishing` filters by status only. It may log an assertion if the published count exceeds the entitlement, but it never trims.
  - Publish takes a per-store advisory lock, or `SELECT … FOR UPDATE` on the store's usage row, before counting.
  - "Placements used" is computed by one function in `content`, which billing reads.

### H-09: Admin manual plan vs billing reconciliation; admin writes to other owners' tables (AD-3 × AD-2 × AD-14)
- **Pair:** Story 7.8 / G5 fallback ("manual plan assignment by Slips Admin") vs AD-14's daily reconciliation against the subscriptions API.
- **Both compliant because:** AD-3 gives `admin` an RLS-bypass role with audit, so it writes `subscriptions` directly and the write is logged. `billing` reconciles every day and overwrites the plan with Salla's, which is none for a pilot store.
- **Clash:** The pilot store loses its plan overnight, and its content is deactivated. The same pattern hits admin export and delete (Story 7.9 AC3) and job retries.
- **Fix: tighten AD-3.**
  - The admin DB role is read-only.
  - Admin mutations call the owning module's service in that store's context, with `actor = {type: admin, id}` recorded in `admin_audit_log`.
  - `billing` stores `plan_source ∈ {salla, manual_override}` with `override_until`. Reconciliation never replaces a live override.
  - The admin connection pool is injectable only into `admin`, enforced by a lint boundary rule.

### H-10: Attributed revenue restated after refunds never reaches the rollups (AD-9 × AD-10)
- **Pair:** Story 6.2c (a refund 20 days later replaces the order's `attributed_lines`) vs the AD-10 daily rollup job, which processes "yesterday".
- **Both compliant because:** AD-9 replaces rows atomically. AD-10 says dashboards read only rollups. Neither AD says which day a restatement lands on, or that rollups are re-run.
- **Clash:**
  - The Analytics and Overview pages keep the pre-refund revenue.
  - The Products page attributed-orders column (Story 2.3), the Admin E4 view and the E3 reconciliation each pick a date basis: add-to-cart date, order date or refund date. They disagree, and Story 6.5 AC2 (totals equal the sum of parts) fails across screens.
- **Fix: new convention, Attribution time basis and restatement.**
  - Attributed metrics are bucketed by the order's `placed_at` in the store's time zone, always.
  - A refund or cancellation restates the original day; it is never booked on the refund date.
  - `attribution.order.recomputed {order_id, placed_on}` marks `(store, day)` dirty, and the rollup job re-rolls dirty days.
  - Every screen reads attributed figures from the same rollup.

### H-11: Funnel "Slips adds to cart" has two sources (AD-9 × AD-10 × AD-2)
- **Pair:** Story 6.1a (`add_to_cart` analytics event in `events_raw`, owned by `analytics`) vs Story 6.2b (`cart_adds`, owned by `attribution`). The thank-you beacon (AD-9 fallback) is also an event.
- **Both compliant because:** FR12 lists add to cart as an event, and AD-9 lists the cart confirm as an attribution record. Both can be counted.
- **Clash:**
  - The funnel step (from `events_raw`) and the attributable adds (from `cart_adds`) differ because of rate limits, dedup and unconfirmed adds.
  - Merchants see more adds than could ever be credited.
  - If the beacon lands in `events_raw`, `attribution` must read a table owned by `analytics`, which breaks AD-2.
- **Fix:** One record per fact.
  - A confirmed add exists only as `cart_adds`. The funnel step is defined as the count of `cart_adds`, which `analytics` rollups may join (as AD-2 already allows).
  - The player's `add_to_cart` analytics event is renamed `add_to_cart_attempted`, or dropped.
  - The beacon goes to `POST /v1/attribution/beacons`, owned by `attribution`.

### H-12: "Window in force": add-time vs order-time (AD-9 × FR13.3)
- **Pair:** Story 6.2b (uses `cart_adds.window`, recorded at add time, per AD-9) vs Story 6.2c ("a changed window applies to orders placed after the change").
- **Both compliant because:** AD-9 stores the window at add time, while FR13 keys the window on order time. A recompute after a refund that reads the current setting is also defensible.
- **Clash:**
  - The add-time and order-time readings disagree whenever a merchant changes the window between an add and an order.
  - The current-setting reading silently re-attributes historical orders whenever a refund triggers a recompute.
- **Fix:** `attribution` owns `attribution_window_history (store_id, days, effective_from)`. Recompute uses the window in effect at the order's `placed_at`. `cart_adds.window` is removed or kept only for display. Pure recompute stays deterministic.

### H-13: Money convention assumes halalas, a single currency and VAT-exclusive prices
- **Pair:** Player price formatting (Story 5.4, using `Intl` with an assumed `/100`) vs the `catalog` and `integration` adapters storing Salla amounts. Also attribution discount apportioning (FR13.2) vs the E3 independent recompute.
- **Both compliant because:** The convention says "integer minor units (halalas) plus ISO 4217", but the store base currency may be KWD, BHD or OMR, which have 3-decimal minor units.
  - One unit divides by 100. Another uses the ISO exponent.
  - Product snapshot prices ("the price the cart will charge") are VAT-inclusive, while attributed revenue is VAT-exclusive. Each unit decides on its own whether a stored price includes VAT.
  - Salla multi-currency storefronts may send orders in the display currency.
  - Apportioning a discount across lines leaves rounding remainders, and each implementation handles them differently.
- **Clash:**
  - Prices off by 10×.
  - Line revenue that does not sum to the order total.
  - Mixed-currency sums.
  - E3 drift.
- **Fix: tighten the Money convention.**
  - `Money = {amount_minor: bigint, currency}`, with the exponent taken from an ISO 4217 table in `contracts`. "Halalas" is dropped from the wording.
  - Every stored price carries `tax_inclusive: boolean`.
  - Attribution converts to tax-exclusive with the order's own tax lines.
  - Discount apportioning uses the largest-remainder method, so the lines sum exactly.
  - Amounts in a currency other than the store base are stored flagged and never summed. The adapter must read base-currency amounts if Salla provides them.

### H-14: The SameSite=Lax session cookie does not work inside the embedded Salla iframe (AD-12)
- **Pair:** `apps/dashboard` served as a Salla Embedded App (iframe at `s.salla.sa/embedded/...`, salla-desk-research §G8) vs the AD-12 cookie rule.
- **Both compliant because:** AD-12 fixes `SameSite=Lax`, and also makes the embedded token the primary sign-in.
- **Clash:**
  - Browsers do not send a Lax cookie in a cross-site iframe, so every API call after sign-in returns 401. Safari ITP blocks it in any case.
  - A merchant who switches stores in Salla gets the old store's cookie inside the new store's iframe.
- **Fix: tighten AD-12.**
  - Embedded context: a short-lived bearer session token is held in memory and sent in the `Authorization` header. It is re-minted from `embedded.auth.getToken()` plus introspection on load and on a 401. Alternatively, `SameSite=None; Secure; Partitioned` (CHIPS) is allowed, with the store bound in the session.
  - Direct-link context: the Lax cookie stays.
  - Every session is bound to `store_id`. A request whose introspected store differs from the session store ends that session.

### H-15: Uninstall/reinstall without a lifecycle epoch (FR2 × AD-13 × Story 7.9)
- **Pair:** The `integration` uninstall handler plus a 30-day deletion job vs a reinstall on day 29. Also late webhooks from the previous installation.
- **Both compliant because:**
  - AD-13 orders updates by source `updated_at`, but `app.installed` and `app.uninstalled` are different entities with no shared clock.
  - The deletion job runs on schedule and starts deleting at day 30 minus a few seconds, while the reinstall handler is restoring content.
  - The ERD has `STORES ||--o{ INSTALLATIONS`, so a second installation row is legal. Other units then join through the old installation.
- **Clash:**
  - Partial deletion of a reinstalled store.
  - Or a reinstall that "restores" nothing.
  - Old-installation webhooks or reconciliation writing into the new installation.
  - The manifest stays empty (H-07).
- **Fix: new AD-20, Store lifecycle.**
  - `integration` owns `stores.lifecycle ∈ {installed, uninstalled_grace, purging, purged}` and `install_epoch` (an integer that increments on each install).
  - Deletion jobs take a per-store lock and re-check `lifecycle = uninstalled_grace AND epoch = N` before each batch.
  - Reinstall takes the same lock, and refuses to restore once the state is `purging`; it treats the store as a fresh install instead.
  - Inbox rows and jobs carry the epoch, and stale epochs are dropped.
  - `integration.store.reinstalled` triggers a recompile.

### H-16: Settings have no owning module (AD-2 ERD gap)
- **Pair:** Story 7.1b (settings API) vs the units that consume each setting: Story 6.2c (attribution window), Story 4.1 (default layout), Story 4.2 (store time zone), Story 7.1a (dashboard language).
- **Both compliant because:** The ERD has no settings entity. One developer adds columns to `stores` (owned by `integration`). Another creates `attribution_settings` inside `attribution`, and a third creates `display_defaults` inside `publishing`.
- **Clash:**
  - Two homes for the same value.
  - The settings API writes `stores.attribution_window` while recompute reads its own table.
  - "Changes saved" is shown for a value the consumer never sees.
- **Fix:** Add the following to the ERD ownership map. The settings page calls each owner's service, and a single "Save" is one API request that fans out inside one transaction.

  | Setting | Owner and table |
  | --- | --- |
  | Store time zone, locale, storefront domains | `integration` (`stores`) |
  | Attribution window and its history | `attribution` |
  | Display defaults | `content` (they are inputs to placements) |
  | Injector keys | `publishing` |
  | Dashboard language | per-session preference on `merchant_accounts` (`integration`) |

### H-17: Webhook ordering: equal timestamps, concurrency and cross-entity dependencies (AD-13)
- **Pair:** Two inbox workers processing `order.updated` and `order.refunded` for the same order. Also `app.subscription.started` processed before `app.store.authorize` / install has created the store.
- **Both compliant because:** AD-13 says "applies only if source `updated_at` is newer".
  - Both workers read the old stored value, and both write.
  - Using a strict `>` drops a legitimate second change within the same second.
  - Keying the inbox on "event ID (or body hash)" lets two units choose different dedup keys.
  - Billing processes its row before the store row exists and fails with no store context (AD-3).
- **Clash:**
  - Lost refunds, which breaks E3.
  - A failed billing job that retries until it reaches the dead-letter queue.
- **Fix: tighten AD-13.**
  - Inbox processing is serialized per store, using pg-boss `singletonKey = store_id`, or per entity for order volume.
  - The guarded write is `UPDATE … WHERE source_updated_at < $new`.
  - For orders, the webhook is a signal and the API is the truth. On any order webhook, the adapter re-fetches the order and applies the fetched state, which removes ordering ambiguity.
  - The dedup key is always Salla's event ID when it is present. A body hash is used only when it is absent.
  - Events for an unknown store are parked and retried for 15 minutes before they reach the dead-letter queue.

---

## Medium

### H-18: Schedule input conversion and time-zone changes (Time convention)
- **Pair:** Dashboard schedule form (converts a local input to UTC using the browser's time zone) vs the API (expects a wall-clock time in the store's time zone). Also a merchant who changes the store time zone (G7 fallback) while schedules already exist.
- **Clash:**
  - A merchant who is travelling schedules a launch at the wrong instant.
  - After a time-zone change, existing schedules keep their absolute instant, but the merchant expects the wall-clock time.
  - Daily rollups computed under the old time zone mix with new-time-zone days, so "This month" is wrong.
- **Fix:**
  - The contract for schedule input is `{local: 'YYYY-MM-DDTHH:mm', tz: string}`, and only the API converts it.
  - Changing the store time zone re-anchors future schedules by wall clock (the API emits `content.schedule.reanchored`) and leaves past rollups as they are, with a date marker.
  - Date-range presets are computed server-side in the store's time zone. The client sends a preset name, not timestamps.

### H-19: RLS behaviour for system jobs is undefined (AD-3 × AD-2 rollup exception)
- **Pair:** The `analytics` rollup job, written as one cross-store SQL statement (the efficient choice, and joins are allowed inside rollups) vs RLS keyed on `app.store_id`, with no context set.
- **Clash:**
  - If the policy uses `current_setting(..., true)`, the query returns zero rows, so the rollups are empty and nothing raises an error.
  - If it does not, the job fails.
  - Retention DDL, reconciliation sweeps and the H-03 recheck have the same problem.
  - A pooled connection that uses `set_config(..., false)` leaks one store's context into the next request.
- **Fix:**
  - Policies call `current_setting('app.store_id')` without `missing_ok`, so a missing context fails closed with an error instead of an empty result.
  - The context is set only with `SET LOCAL`, inside a transaction, through a single helper that is lint-enforced.
  - System jobs that span stores either fan out one job per store, or use a named `system_maintenance` role. That role is limited to the specific rollup and retention functions (`SECURITY DEFINER`) and is audited the same way as admin.

### H-20: Token refresh races across process roles (FR25 × AD-1)
- **Pair:** The http role (manual sync request, or token introspection fallback) vs the worker role (reconciliation). Both find an expired token and refresh it.
- **Clash:** Salla refresh tokens rotate. The loser's refresh fails, and FR25 marks the store **Disconnected**, which is a false alarm.
- **Fix:**
  - Only `integration.getAccessToken(storeId)` may refresh.
  - It takes `pg_advisory_xact_lock(hash('token', store_id))` and re-reads the row after acquiring the lock.
  - Only a definitive `invalid_grant` marks the store disconnected.

### H-21: Event dedup window vs the player's retry queue; client clocks (AD-10)
- **Pair:** Story 6.1a (the player queues events offline and retries for days) vs AD-10 (dedup "within the dedup window", plus monthly partitions).
- **Clash:**
  - A retry after the window inserts duplicates.
  - A unique index on a partitioned table must include the partition key. If the partition is chosen from the UUIDv7 timestamp, which comes from the client clock, skewed clocks put duplicates into different partitions.
  - Bucketing by the client timestamp lets a wrong device clock move views to another day.
- **Fix:**
  - The player discards queued events older than the dedup window minus a margin.
  - The server rejects any event whose UUIDv7 time is outside `[now − window, now + 5 min]`.
  - Dedup uses a separate `event_dedup (store_id, event_id)` table, TTL-pruned.
  - Partitioning and rollups use the server's `received_at`.

### H-22: Rate-limit state across http replicas (AD-10 × NFR14)
- **Pair:** The events handler on replica A vs the same handler on replica B, each using an in-memory per-viewer limiter. That choice is compliant, because no store is named.
- **Clash:** The effective limit becomes N × the limit, and limits reset on every deploy. An attacker can inflate views.
- **Fix:** Name the limiter store: the CDN or WAF for per-IP limits, and a Postgres unlogged counter table for per-store limits, or explicitly accept per-replica limits with the limit divided by the replica count. Record the decision in AD-10.

### H-23: Media deletion cannot purge the CDN; browser caching is unbounded (AD-6 "no other code purges")
- **Pair:** Story 7.9 (delete media from storage and CDN) or Story 3.6 (replace a slide) vs AD-6.
- **Clash:**
  - `media` may not purge, so deleted media stays served from the CDN.
  - Manifest `Cache-Control` is unspecified. A CDN purge does not clear browsers, so a long `max-age` breaks the FR24 one-minute bound.
- **Fix:**
  - Media URLs are content-addressed and immutable (`/a/{asset_id}/{hash}/{rendition}.mp4`), so they never need a purge.
  - `media` is the only other module allowed to call `CdnPurger`, and only for asset deletion.
  - Manifests are served with `Cache-Control: public, max-age=30, s-maxage=86400, stale-while-revalidate=30` and an ETag, as a convention.

### H-24: Editing a live item: in-place vs revision; new media on a Published item (FR22 × AD-6)
- **Pair:** Dashboard edit form (RHF autosave sends a PATCH on each change, as allowed by the Dashboard state convention) vs AD-6 ("content edited" triggers a recompile).
- **Clash:**
  - Half-typed titles and CTAs go live.
  - Every keystroke triggers a compile and a purge.
  - Adding a video to a Published item makes it Processing (FR22), and it disappears from the storefront. Alternatively, it stays live with an unprocessed slide.
- **Fix:**
  - Edits to a Published item are written to a `draft_revision`, and only an explicit "Update live" promotes it. Promotion emits `content.item.edited`.
  - The item keeps status Published while the revision's media processes.
  - Autosave is allowed only for Draft items.

### H-25: Delete and duplicate break analytics sums and shared media (AD-2 × Story 6.5)
- **Pair:** Story 3.6 delete (hard-deletes `content_items`) vs Story 6.5 AC2 (the total equals the sum of per-content rows). Story 3.6 duplicate (shares `media_assets`) vs Story 7.9 delete.
- **Clash:**
  - The per-content table loses the deleted item's revenue while the total keeps it.
  - Deleting the copy deletes the original's media.
- **Fix:**
  - Content uses soft delete (a tombstone that keeps the title), shown as "Deleted content" in analytics.
  - Media assets are immutable and garbage-collected by reference count. A duplicate references the same assets, and assets are removed only when no slide references them.

### H-26: Preview path is undefined (FR7 × AD-6 × AD-10)
- **Pair:** Story 3.5 (dashboard embeds the player in preview mode) vs Story 4.3 (the manifest contains only published items).
- **Clash:**
  - Each developer invents a draft data path: a postMessage blob, a draft endpoint, or a manifest with a flag. Any of them can drift from the compiler.
  - The preview player sends real events (rejected by origin, but they inflate the rejected-events metric) or real cart adds.
- **Fix:**
  - `publishing` exports a pure `compileManifest(inputs)`.
  - `POST /v1/preview/manifest` returns a `StoreManifest` for a draft, built by the same function.
  - The player's `mode: 'preview'` swaps in a `SimulatedStorefrontPlatform` and a null analytics sink at the port level.

### H-27: Contract and schema skew across separately deployed units (AD-11 × deploy order)
- **Pair:**
  - Dashboard build N vs API build N+1, which adds a response field. A strict client schema fails to parse.
  - A worker on N+1 vs pg-boss jobs enqueued by http on N.
  - "Migrations run before new versions start", so the old code runs against the new schema.
- **Fix:**
  - Response schemas are parsed non-strict on clients; request schemas are strict on the server.
  - Changes within `v1` are additive only.
  - Job payloads carry `v`, and handlers accept N and N−1.
  - Migrations follow expand/contract: no rename or drop in the same release as the code that stops using the column.

### H-28: Product deletion vs content links (AD-2 × FR25)
- **Pair:** `catalog` (hard-deletes the product on `product.deleted`) vs `content` (`content_product_links` with an FK, or a cascade).
- **Clash:**
  - The FK blocks the catalog delete, so the job fails repeatedly and ends in the dead-letter queue.
  - Or a cascade silently unlinks the product, and "Linked product deleted" is never flagged.
- **Fix:**
  - No FKs with `ON DELETE CASCADE` across module boundaries.
  - `catalog` soft-deletes (`deleted_at`) and emits `catalog.product.deleted`.
  - `content` flags the item and emits `content.item.edited`, and H-07 covers the recompile.

### H-29: Cross-module read composition for list pages (AD-2)
- **Pair:** Story 2.3, the Products page: linked-content count (`content`), attributed orders (`attribution`) and availability (`catalog`). Story 7.8, the admin search across modules.
- **Clash:** One developer joins the tables directly, which breaks AD-2. Another makes N+1 service calls per row, which breaks the NFR2 dashboard target of under 3 s.
- **Fix:** Name the pattern. Either each owner exposes a batch read (`getStatsByProductIds(storeId, ids[])`) and an `http` query handler composes them, or `analytics` maintains per-product and per-store read-model rollups. Admin search reads such a rollup (read-only bypass, audited).

### H-30: Per-store deletion vs whole-partition retention (AD-10 × NFR10 × Story 7.9)
- **Pair:** The retention job (drops whole monthly partitions) vs Story 7.9 (deletes one store's data after the grace period, or on request).
- **Clash:** Partitions are shared across stores, so a per-store delete does not fit the "drop partitions" rule. A developer either skips `events_raw`, which breaches the deletion promise, or runs an unbounded DELETE at peak.
- **Fix:** AD-10 adds that per-store erasure deletes rows by `store_id` in batched, throttled jobs across partitions, scheduled off-peak, with completion recorded. An alternative is hash sub-partitioning by store.

### H-31: Event, queue and webhook names can collide (Naming convention)
- **Pair:** Domain events `<module>.<entity>.<verb>`, queues `<module>.<job>`, Salla webhook names (`app.subscription.started`, `order.created`) and player event types (`view`, `add_to_cart`).
- **Clash:**
  - If domain events are pg-boss queues (H-02), `publishing.compile` (a queue) and a three-part event share one namespace.
  - Salla's `app.*` and `order.*` look like Slips domain events, and a handler subscribes to the wrong one.
  - Two modules each emit "key regenerated" under their own names.
- **Fix:**
  - Use prefixed namespaces: `evt.<module>.<entity>.<verb>`, `job.<module>.<job>`, and `salla.*` for inbox types, which never leave `integration`.
  - Player event types are a closed enum in `contracts`.
  - The event catalog (H-02) is the single registry and lists the owner of each event.

### H-32: Cart ID changes during a session (AD-9 primary join)
- **Pair:** Player (records `cart_id` from the `addItem` response at add time) vs the order's `checkout_id`, after a guest signs in at checkout and Salla merges carts.
- **Clash:** The cart IDs do not match, so the credit is lost, which threatens E3. This is not covered by the G4 deferral, because it is about cart lifecycle, not about whether the tag echoes.
- **Fix:**
  - The player records every cart ID it observes per viewer session (`cart_lineage`).
  - Attribution matches on any ID in the lineage, then falls back to the beacon.
  - Add an explicit G4 test case: "guest add, then sign in, then checkout".

### H-33: The dashboard reads only daily rollups, but screens show "today" (AD-10 × FR15)
- **Pair:** Story 6.4a (Overview: 7-day chart and % change, which merchants expect to include today) vs AD-10 (daily rollups only).
- **Clash:** Today is always zero. One developer then queries `events_raw` to fill it in, which breaks AD-10.
- **Fix:** Add an intraday rollup: the current day is re-rolled incrementally every 5 minutes into the same rollup table, with a `final = false` flag. Ranges are defined as including today, with the time of the latest refresh shown.

### H-34: Inbox, compile and webhook-handling throughput at peak (AD-1 × NFR14)
- **Pair:** Story 7.11 load test (10× traffic) vs the single pg-boss Postgres that also serves `events_raw` inserts and RLS-scoped OLTP.
- **Clash:** Every module compliantly adds queues on the same database. Event ingestion at peak and the compile and inbox jobs compete for connections, and FR24 latencies degrade.
- **Fix:**
  - Separate connection pools per role and queue class (ingest, OLTP, jobs), with stated caps.
  - Ingest uses multi-row `COPY` or batched inserts.
  - The deferral of Redis or another queue gets a measurable trigger: queue latency P95 above 30 s at the Story 7.11 load.

---

## Low

### H-35: The player's role in schedule evaluation
- **Pair:** `publishing` includes upcoming items with `start` and `end` to save recompiles vs a player that renders everything in the manifest.
- **Fix:** The player has no time logic. The manifest contains only items eligible now, and carries `next_boundary_at` so that `max-age` can be capped.

### H-36: `published_at` semantics for FR30 ordering
- **Pair:** Unarchive, reactivation after an upgrade, or "Update live" (H-24) resets `published_at` in one unit and keeps it in another.
- **Fix:** Define `first_published_at` (for ordering) and `last_published_at` (for display). FR30 uses the first.

### H-37: Where views are deduplicated (§1.5 "once per 30 minutes")
- **Pair:** The player deduplicates views client-side vs the rollup deduplicating them as well, or neither doing it.
- **Fix:** The rollup is authoritative. The player sends every open, and dedups within one page view only.

### H-38: A deleted or uninstalled manifest returns 404 vs `{items: []}`
- **Pair:** Story 4.3 ("empty result") vs Story 7.9 (deletes the manifest object after the grace period, so the CDN returns 404).
- **Fix:** The contract says 404, 403, a timeout or an unknown schema all mean "render nothing, reserve nothing, log once" (NFR1 scenarios). After the purge, `publishing` writes a tombstone `{items: []}` and does not delete the object.

### H-39: The Low-stock threshold is computed in more than one place
- **Pair:** The Products page computes `Low` from raw quantity in the dashboard vs the manifest using `catalog`'s availability field.
- **Fix:** `catalog` stores the availability bucket. The threshold is a single constant (Q-15), and clients never recompute it.

### H-40: Allowed origins for event validation
- **Pair:** The events handler (checks the origin against `stores.domain`) vs a store that changes its custom domain, or uses both `*.salla.sa` and a custom domain.
- **Fix:** `integration` keeps `store_domains[]`, refreshed on `store.updated` and on reconciliation. Origin checks accept any of them, and a mismatch is rejected and counted, never silently accepted.

---

## Proposed spine amendments (consolidated)

| New or changed | Closes | One-line rule |
| --- | --- | --- |
| **AD-16 Store identity and keys** | H-01, H-40 | Storefront locator = `(platform, platform_store_id)`. `store_keys` with active/retiring/revoked status is owned by `publishing`. Key retirement is a job and a manifest trigger. |
| **AD-17 Transactional domain events** | H-02, H-31 | Events are written in the same transaction (outbox or pg-boss with the transaction executor), consumed only in the worker, idempotent, and listed in a catalog in `contracts`. Namespaces: `evt.`, `job.`, `salla.`. |
| **AD-18 Manifest compile protocol** | H-04, H-06, H-07, H-23, H-35, H-38 | One compile at a time per store, revision compare-and-set, 5-30 s debounce, dependency-declared triggers, schema major in the path, additive-only within a major, a backfill on schema bump, loader version pinned in the manifest, defined cache headers, tombstones. |
| **AD-19 Content lifecycle state machine** | H-05, H-08, H-24, H-25, H-36 | `content` alone writes status (adding Ended) and runs boundary jobs. Other modules send commands. Single enforcement point for plan limits, under a per-store lock. Live edits go through revisions. Soft delete. |
| **AD-20 Store lifecycle and epochs** | H-15, H-17 | Lifecycle state plus `install_epoch`. Deletion and reinstall are serialized by a lock. Stale-epoch work is dropped. Inbox processing is serialized per store, and order webhooks re-fetch from the API. |
| **AD-9 tightened** | H-03, H-11, H-12, H-32 | Immediate unbatched cart confirm. Recompute triggered from both directions plus a daily recheck. Window history applied by order time. Cart ID lineage. A single source for confirmed adds. |
| **AD-10 tightened** | H-10, H-21, H-22, H-30, H-33 | Server-time bucketing, a dedup table and a bounded client queue, a named rate-limit store, per-store erasure, an intraday rollup, dirty-day re-rolls. |
| **AD-3 tightened** | H-09, H-19 | Admin DB role is read-only and writes go through owner services. RLS fails closed. `SET LOCAL` only. A named system-maintenance role. |
| **AD-12 tightened** | H-14 | Header bearer session (or CHIPS) when embedded. Session bound to the store. |
| **AD-14 tightened** | H-08, H-09 | One enforcement point. `plan_source` with manual override precedence. |
| **AD-11 tightened** | H-27 | Clients parse responses non-strict. Additive-only within `v1`. Versioned job payloads. Expand/contract migrations. |
| **Settings ownership map** | H-16 | Each setting has an owning module in the ERD. Settings saves fan out within one transaction. |
| **Money convention** | H-13 | Minor-unit exponent from ISO 4217, explicit `tax_inclusive`, largest-remainder apportioning, no sums across currencies. |
| **Time convention** | H-18, H-10 | Schedules entered as wall-clock time plus time zone and converted only by the API. Re-anchor on time-zone change. Attributed metrics bucketed by order `placed_at` in the store's time zone. |
| **Cross-module read pattern** | H-29 | Batch reads from owner services, or `analytics` read-model rollups. Never direct joins outside rollup jobs. |
| **Token refresh rule** | H-20 | Single refresher behind a per-store advisory lock. Only `invalid_grant` marks the store disconnected. |
| **FK rule** | H-28 | No cascading FKs across modules. Soft delete plus events. |
| **Scale guardrails** | H-34 | Separate pools per role and queue class. A measurable trigger for leaving pg-boss. |

## Severity counts

| Severity | Count | Holes |
| --- | --- | --- |
| Critical | 5 | H-01 to H-05 |
| High | 12 | H-06 to H-17 |
| Medium | 17 | H-18 to H-34 |
| Low | 6 | H-35 to H-40 |
| **Total** | **40** | |

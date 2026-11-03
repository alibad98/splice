---
title: 'Story 2.7: pause sync when disconnected and resume on reconnect'
type: 'feature'
created: '2026-11-03'
status: 'done'
route: 'dispatch'
baseline_revision: '63e4273ecc6b7c8e73edb4379d76151fca6381d0'
baseline_commit: '63e4273ecc6b7c8e73edb4379d76151fca6381d0'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-6-reconcile-catalog-daily.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When Salla access is lost (store `disconnected`), the merchant gets no clear signal. Product webhooks that need a fetch retry into dead-letter. A reconnect changes the store back to `active` silently, with no catch-up sync. Catalog also has no export or restore for store data.

**Approach:** Webhook work for a disconnected store is skipped (`ignored`, reason `disconnected`) instead of retried. Reconnecting a `disconnected` store publishes a new `integration.store.reconnected` event, which catalog turns into an immediate full sync. The dashboard can now tell `disconnected` apart from "not connected". A disconnected store shows a persistent danger banner on every merchant page, with the last sync time and one Reconnect action. Catalog's `StoreDataLifecycle` gains `restore` (keeps rows) and `export` (products and categories).

## Boundaries & Constraints

**Always:**
- Pause, never lose: no catalog row is deleted or changed because of a disconnect. Storefront-facing data stays as last synced.
- A product webhook whose processing hits `StoreDisconnectedError`/`StoreNotConnectedError` finishes `ignored` (no retry, no dead-letter) and logs `reason: disconnected`. Webhooks with readable data still apply, because they need no token.
- `catalog.full-sync` for a disconnected store keeps today's final outcome: `failed` with reason `store_inactive`, no retry. The dashboard shows no "sync failed" toast for `store_inactive` while the banner is up, and "Sync products" is unavailable with a reason ("Reconnect to sync").
- `integration.store.reconnected` `{ v:1, store_id, install_epoch }` (owner integration) is published in the same transaction as the `disconnected` → `active` write in `installFromTokens`. That path covers the OAuth callback and Easy Mode authorize. It is published only when the stored state was `disconnected`. Catalog handles it like install: one full sync with `run_id = event.id` and the same singleton key and window.
- Banner (every merchant page, above page content): Banner `tone="danger"`. Copy: en "Your Salla connection dropped, so syncing paused. Reconnect to continue." / ar "انقطع الاتصال بسلة، فتوقفت المزامنة. أعد الربط لتكمل.", then "Last synced {relative time}", or nothing when there is no sync time. One action, "Reconnect" / "أعد الربط", linking to the install URL the layout already passes as `signInHref`. It is shown only for `disconnected`, never for `connected` or `not_connected`, and is gone once the session reports `connected`.
- The connection chip keeps its look for `disconnected`. Its tests stay valid.
- Catalog `restore`: keeps rows, writes nothing (the `integration.store.reinstalled` handler already queues the full sync). `export`: `{ products, categories }` rows of the store from `ctx.tx`, with no tokens and no shopper data.

**Never:** Refresh tokens in catalog. Add a new API endpoint or contract field for the banner (it uses the session's `ConnectionStatus` plus `GET /v1/catalog/sync`). Change `catalog.reconcile` (it already skips disconnected stores). Delete or mark data on disconnect. Auto-retry webhooks that were ignored.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Webhook needs fetch, disconnected | product webhook with unreadable data; store `disconnected` | inbox row `ignored`; log reason `disconnected`; no platform call | no retry, no dead-letter |
| Webhook with data, disconnected | readable product webhook; store `disconnected` | applied as usual | — |
| Full sync, disconnected | `catalog.full-sync` job; store `disconnected` | run `failed`/`store_inactive`; rows untouched | no retry |
| Reconnect | OAuth/authorize for a `disconnected` store | state `active`; `integration.store.reconnected` once; one `catalog.full-sync` queued (run id = event id) | — |
| Reauthorize active | OAuth/authorize for an `active` store | no reconnected event, no sync | — |
| Banner shown | signed in, connection `disconnected`, last sync 2 h ago | danger banner with copy, "Last synced 2 hours ago", Reconnect → install URL; on every merchant page | sync status fails to load: banner still shown, no time |
| Banner hidden | connection `connected` or `not_connected` | no banner | — |
| Sync button | disconnected | unavailable with reason; no request sent; no failure toast for `store_inactive` | — |
| Reinstall in grace | uninstalled store reinstalled | catalog `restore` keeps the same product ids; full sync queued (existing handler) | — |
| Export | `export(ctx)` | products and categories of that store only | — |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/v1/events.ts` (+ `events.test.ts`) -- add `integration.store.reconnected` next to `reinstalled` (same schema). Document the consumer (catalog full sync).
- `apps/api/src/modules/integration/integration.service.ts:134` -- `installFromTokens` existing-store branch: remember `store.lifecycleState === 'disconnected'` before `refreshStoreDetails(..., 'active')`, then `publishEvent(ctx, ..., 'integration.store.reconnected', { v:1, store_id: existing, install_epoch: store.installEpoch })`.
- `apps/api/src/worker/integration-jobs.ts` -- add the new name to the logging handler list. `apps/api/src/worker/catalog-jobs.ts` -- add `'integration.store.reconnected'` to the full-sync `triggers`.
- `apps/api/src/modules/integration/webhook-inbox.ts:158-166` -- in `handle()`'s product branch, catch `StoreDisconnectedError | StoreNotConnectedError` around `consumer(...)`, log `product webhook skipped` with `reason: 'disconnected'`, and return `'ignored'`. Errors come from `../integration/errors.js`.
- `apps/api/src/modules/catalog/catalog.lifecycle.ts` -- add `restore` (no-op) and `export` (`select` products and categories `where store_id = $1` via `ctx.tx`). The port is `apps/api/src/ports/store-data-lifecycle.ts`.
- `apps/dashboard/lib/shell.ts:4,17` -- `ShellConnection` gains `{ state: 'disconnected'; storeName?: string }`. `connectionFromStatus` maps it. Check every `connection.state` consumer (`ConnectionChip.tsx:12-13`, `AppShell.tsx:29`, `shell-context.ts:11`, `session-client.ts:31`) so `disconnected` behaves like `not-connected` except for the banner and store name.
- `apps/dashboard/components/shell/DisconnectedBanner.tsx` (new) -- client component: reads the session connection, and when `disconnected` calls `useCatalogSync()` for `last_synced_at`, formatted with `formatRelativeTime` (`i18n/format.ts:45`). Renders `Banner` from `@slips/ui`. Mount it in `AppShell.tsx` inside `<main>` above `<SessionGate>` (~line 107).
- `apps/dashboard/components/products/SyncHeader.tsx` -- disconnected: button `unavailableReason`, and skip the failure toast when `reason === 'store_inactive'`.
- `apps/dashboard/i18n/messages/{en,ar}.ts` -- `shell.disconnected.{message,lastSynced,reconnect}` and `products.sync.reconnectToSync`. The guard test is `lib/i18n-guards.test.ts`.
- Tests: `apps/api/src/composition/integration.test.ts` (reconnect event, reauthorize-active no event), `product-webhooks.test.ts` (fetch path for a disconnected store → `ignored`), `catalog.test.ts` (reconnected → full-sync job; export/restore), `lifecycle.test.ts` if reinstall restore is asserted there. Dashboard: `components/shell/shell.test.tsx` (banner shown/hidden, Reconnect href, RTL copy), `components/products/sync.test.tsx` (unavailable button, no toast), `lib/shell.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/v1/events.ts`, test -- the reconnected event.
- [x] `modules/integration/integration.service.ts`, `worker/integration-jobs.ts`, `worker/catalog-jobs.ts` -- publish and consume it.
- [x] `modules/integration/webhook-inbox.ts` -- skip disconnected product work.
- [x] `modules/catalog/catalog.lifecycle.ts` -- restore and export.
- [x] `apps/dashboard/lib/shell.ts` and its consumers -- the `disconnected` state.
- [x] `components/shell/DisconnectedBanner.tsx`, `AppShell.tsx`, `SyncHeader.tsx`, i18n -- banner and sync button.
- [x] Tests listed in the Code Map -- one per matrix row.

**Acceptance Criteria:**
- Given a disconnected store, when the merchant opens any merchant page in Arabic, then the banner reads the Arabic copy with Western digits and a working Reconnect link, and the page below still renders.
- Given `pnpm turbo run lint typecheck test build`, then everything passes (except the known Windows-only `@slips/player#build`).

## Implementation Notes

- The failure toast is skipped for a `store_inactive` run only while the session reports `disconnected` (the banner is up). With a stale `connected` session the toast still shows, so a refused sync is never silent.
- `useNow` moved to `apps/dashboard/lib/use-now.ts`, shared by `SyncHeader` and `DisconnectedBanner`. The banner calls `useCatalogSync()`, so the Products page now has two observers of the sync query (they share the query; each end-of-run invalidation is idempotent).
- `integration.store.reconnected` has its own catalog handler: it sends with `singletonNextSlot: true` and fails the delivery when no job was queued, so a full-sync job already in the current slot (e.g. the one refused as `store_inactive`) never swallows the catch-up sync.
- `ConnectionChip` is unchanged: `disconnected` still renders the not-connected chip. The shell header shows the store name for `disconnected` when the API sends one.

## Spec Change Log

## Review Triage Log

### 2026-11-03 — Review pass

- verdicts: 24 findings — high 0, medium 3, low 15, false 5, maybe-false 1
- findings:
  - `[medium]` `[patch]` (edge) A reconnect in the same 60 s singleton slot as an earlier full-sync job got `null` from `boss.send`, so the catch-up sync was silently dropped. Fixed: the reconnected event has its own handler with `singletonNextSlot`, and it throws if not queued.
  - `[low]` `[patch]` (blind, edge) The `store_inactive` toast was suppressed even with no banner (stale `connected` session), so a refused sync was silent; this also deviated from "while the banner is up". Fixed: suppressed only while disconnected.
  - `[low]` `[patch]` (verification-gap) Grouped with the row above: no test pinned the toast with a `connected` session. Fixed: test added.
  - `[low]` `[patch]` (blind) Stale docs: `registerIntegrationEventHandlers`, `ShellConnection`, and `useCatalogSync`'s "one instance per page". Fixed.
  - `[medium]` `[defer]` (blind, edge) The session connection is read once, so a mid-session disconnect shows no banner until reload. Needs a session-refresh mechanism.
  - `[medium]` `[defer]` (blind) `isStoreActive` (storefront check, AD-20) returns false for `disconnected`, against "storefront keeps serving last data". Pre-existing, with no caller until Epic 4.
  - `[false]` `[reject]` (blind) The banner shows for uninstalled or purged stores. Uninstall's `suspend` drops sessions, and sign-in opens only active or disconnected stores (`credentials.service.ts:47`).
  - `[false]` `[reject]` (blind) The webhook that first discovers the disconnect retries. `getAccessToken` marks the store disconnected and throws `StoreDisconnectedError`, which the inbox catch handles.
  - `[low]` `[reject]` (blind) A cached token answered 401 on fetch still retries into dead-letter. This needs a token revoked before its expiry, and it is the pre-existing path.
  - `[low]` `[reject]` (edge) `StoreNotConnectedError` (no token row) is ignored forever. Before this story it dead-lettered with the same end result (never applied); reconciliation repairs once connected.
  - `[low]` `[reject]` (blind) Skipped webhooks have no metric, only a log line. Adding a metric is new surface with no consumer yet.
  - `[low]` `[reject]` (blind) No test for `StoreNotConnectedError` or the Easy Mode authorize path. Both go through the same tested catch and `installFromTokens`.
  - `[low]` `[reject]` (blind) Reinstall restore is not tested end to end. `restore` is a no-op, and the existing reinstall flow and handler are already tested.
  - `[low]` `[reject]` (blind, edge) `export` is unbounded and omits sync state. It has no caller yet; batch it when the export endpoint lands.
  - `[low]` `[reject]` (blind) The persistent banner uses `role="alert"`. It is mounted once in the layout and does not remount on client navigation.
  - `[low]` `[reject]` (blind) The header and the banner read different sources (server context vs client session). Both come from the same session describe.
  - `[low]` `[reject]` (blind) The banner imports `fill` from the products folder and repeats non-null assertions. Cosmetic.
  - `[low]` `[reject]` (verification-gap) The rollback test fails before `publishEvent`. It still proves the state rolls back; noted only.
  - `[false]` `[reject]` (verification-gap) `export` has no production caller. The port reserves it; this is not a defect.
  - `[false]` `[reject]` (blind) sprint-status `in-progress` vs spec `in-review`. Sprint status is synced at the end by design.
  - `[false]` `[reject]` (edge) Duplicate of the singleton row (claim form).
  - `[maybe-false]` `[reject]` (edge) Duplicate of the toast row (claim form); covered by the patch.

## Verification

**Commands:**
- `pnpm -C apps/api exec vitest run src/composition/integration.test.ts src/composition/product-webhooks.test.ts src/composition/catalog.test.ts src/composition/lifecycle.test.ts src/worker` -- expected: pass (live DB; locally swap to the Docker DB on 5436 and back).
- `pnpm -C apps/dashboard exec vitest run` -- expected: pass.
- `pnpm turbo run lint typecheck test build` -- expected: pass except `@slips/player#build` on Windows.

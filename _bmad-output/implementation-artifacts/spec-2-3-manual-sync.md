---
title: 'Story 2.3: Sync products manually and see last sync time'
type: 'feature'
created: '2026-11-01'
status: 'done'
route: 'dispatch'
baseline_commit: 'c5a5896f137f48352687aa4fc475dce98bc74ce2'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-ui-kit-global-components.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The catalog only syncs on install. Merchants cannot refresh it, cannot see how fresh it is, and stores installed before Story 2.1 (or whose import failed) sit on "Syncing your products..." forever. Between retries a sync also reads `failed`, so a failure shown to the merchant could be premature.

**Approach:** `POST /v1/catalog/sync` marks the store's sync `queued` and publishes `catalog.sync.requested` in one transaction; the worker turns that event into the existing `catalog.full-sync` job (run id = event id). A run reads `failed` only after its last attempt. The Products page header shows "Last synced {relative time}" and a "Sync products" button; outcomes are shown with toasts. The Button, Spinner and Toast this needs are built in `packages/ui` per the UI-kit spec.

## Boundaries & Constraints

**Always:** Single-flight per store: a request while a run is `queued` or `running` (and touched within 15 min) returns that run with 202 and enqueues nothing. A request less than 60 s after the previous request answers 429 problem+json with `type` `sync-rate-limited` and a `Retry-After` header. The event goes through `publishEvent` in the state-change transaction; the job is enqueued by the worker (singleton per store), never by the HTTP role. Retryable failures before the last attempt keep the run `running`; the last attempt sets `failed` with its reason. The previous catalog stays visible during and after a failed sync. Cookie sessions need the CSRF token. New route documented in `apps/api/src/docs/openapi.ts`. All copy in `ar` and `en`, friendly-coach voice. Components follow the UI-kit spec rules; their registry rows are updated.

**Never:** Read billing/plan data; let the dashboard decide rate limits; block the HTTP request on the sync; auto-dismiss the failure toast; recompute availability.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| First manual sync | state `never` | 202 `queued`; worker imports; `succeeded` with `last_synced_at` | — |
| After success | state `succeeded`, last request > 60 s ago | 202 `queued`, new run id | — |
| While running | state `queued`/`running`, fresh | 202 with that run, nothing enqueued | — |
| Stale running | `running`, untouched > 15 min | treated as idle: new run queued | — |
| Too soon | previous request < 60 s ago, idle | 429 `sync-rate-limited`, `Retry-After` | dashboard: friendly toast |
| Transient failure, not last attempt | 503 from Salla, attempt 2 of 5 | state stays `running`; retried | — |
| Last attempt fails | attempt 5 of 5 fails | `failed` + reason; dashboard action toast "Retry" (never auto-dismisses), old catalog shown | Retry posts again |
| Final failure (auth/inactive) | `auth_rejected` | `failed` at once, no retry | same toast |
| Header | `last_synced_at` 5 min ago | "Last synced 5 minutes ago" (ar/en), exact time in store time zone on hover/focus | `never` → "Not synced yet" |
| Button | click | spinner, `aria-busy`, further clicks ignored until the run ends | — |
| Completion | `queued`/`running` → `succeeded` | products and categories refetched, time updates, toast "Products updated" | — |
| No CSRF (cookie) | POST without `x-csrf-token` | 403 `csrf_invalid` | — |

</frozen-after-approval>

## Code Map

- `packages/db/migrations/0013_catalog_sync_request.sql`, `packages/db/src/schema/catalog.ts` -- add `requested_at timestamptz`; allow status `queued` (check constraint + `CATALOG_SYNC_STATUSES`). Additive.
- `packages/contracts/src/v1/catalog.ts`, `events.ts` -- `CatalogSyncStatus.status` adds `queued`; new event `catalog.sync.requested` (owner `catalog`: `store_id`, `run_id`).
- `apps/api/src/modules/catalog/catalog.repository.ts`, `catalog.service.ts` -- `requestSync(storeId)`: in one store-context tx, `SELECT ... FOR UPDATE` the state, apply single-flight/rate-limit, upsert `queued` + `requested_at`, `publishEvent`. Inject `EVENT_SENDER` and telemetry like `catalog-sync.ts`.
- `apps/api/src/modules/catalog/catalog-sync.ts` -- `run(storeId, runId, { finalAttempt })`: a `queued` row with the same run id starts from page 1; retryable failure writes `failed` only when `finalAttempt`, else keeps `running` and rethrows.
- `apps/api/src/worker/worker.ts`, `catalog-jobs.ts` -- `work(..., { includeMetadata: true })`; handler passes `retryCount >= retryLimit`; register `catalog.sync.requested` → send `catalog.full-sync` (same pattern as install).
- `apps/api/src/modules/catalog/catalog.controller.ts` -- `POST v1/catalog/sync` → 202 `CatalogSyncStatus`; 429 with `Retry-After`.
- `apps/api/src/adapters/telemetry/http.ts` -- problem `type` from the exception body when given (default `about:blank`).
- `apps/api/src/docs/openapi.ts` -- route, 202/429; `Problem.type` description.
- `packages/ui/src/` -- `button.tsx` (variants primary/secondary/accent/ghost/destructive, sizes, `pending`, `unavailableReason`), `spinner.tsx`, `toast.tsx` (Toaster + `toast()` store; Radix Toast via `radix-ui`; bottom-start, F8, action toasts persist, plain 5 s pausing on hover/focus).
- `apps/dashboard/app/(merchant)/layout.tsx` -- mount Toaster once.
- `apps/dashboard/lib/api/catalog.ts` -- `useRequestSync` mutation; `useCatalogSync` always on for the Products page, polling while `queued`/`running`.
- `apps/dashboard/components/products/SyncHeader.tsx` (new), `ProductsView.tsx` -- header, toasts (failure shown once per run id).
- `apps/dashboard/app/(dev)/ui/page.tsx` -- gallery (404 in production) with Button, Spinner, Toast, StatusChip.
- `_bmad-output/implementation-artifacts/spec-ui-kit-global-components.md` -- registry rows Button (+ Spinner) and Toast + Toaster → `built (Story 2.3)`.
- Dev DB: no migrate command exists; apply `0013` by hand (`psql -1`) like `0012`.

## Tasks & Acceptance

**Execution:**
- [x] Migration + schema + contracts (status `queued`, event) + tests.
- [x] API: `requestSync`, controller route, problem `type`, final-attempt handling, worker wiring + composition tests for every matrix row.
- [x] Docs: route + tests stay green.
- [x] `packages/ui`: Button, Spinner, Toast + tests; gallery page; UI-kit registry update.
- [x] Dashboard: Toaster, sync hook, SyncHeader, toasts + tests (relative time ar/en, pending button, 429 toast, failure toast once with Retry, completion refetch).

**Acceptance Criteria:**
- Given a store on `never`, when the merchant presses "Sync products", then products appear without a reload.
- Given the button is pending, when focused, then it stays focusable, announces busy, and Enter/clicks do nothing.
- Given `pnpm turbo run lint typecheck test build`, then all new code passes, and `/products` first-load JS growth is reported.

## Implementation Notes

- Run id = event id: `publishEvent` gained an `eventId` option so `requestSync` records the `queued` row and publishes `catalog.sync.requested` with the same UUIDv7.
- Between attempts a run stays `running` with `reason` = the attempt's error; that marks it "waiting for retry", so the retry is not mistaken for a busy attempt (heartbeat) and a newer run may take it over. The API reports `reason` only for `failed`.
- `CatalogSyncStatus` gained `run_id` (nullable, default null) for the dashboard's once-per-run failure toast; 429 also carries `code: sync_rate_limited`.
- The requested-event handler sends the job with `singletonNextSlot`, so a collision with an install-triggered job in the same 60 s slot defers the manual run instead of dropping it.
- Concurrent first requests (no row yet) are serialized with a transaction-scoped advisory lock.
- `/ui` gallery: the proxy lets it open without a session outside production; the page itself 404s in production.
- `/products` first-load JS: 211.9 KB to 227.1 KB gzip (+15.2 KB; 704.1 to 750.0 KB raw), measured from the build's client-reference manifest. Most of it is the Radix Toast chunk.

## Spec Change Log

## Review Triage Log

### 2026-11-01 -- blind-hunter, edge-case-hunter, verification-gap (3 subagents)

- `[high]` `[patch]` A stranded `queued`/`running` run (job dropped, worker down, last attempt expired or failed in `begin`) is reported active forever; the button stays pending and polls every 5 s, though POST would accept a new run after 15 min (BH1, EC2, EC3, EC claim, VG other) -- GET reports a run idle past `STALE_RUN_MS` as `failed` (`internal`); the final attempt also marks `failed` when `begin` throws.
- `[medium]` `[patch]` `boss.send` returning null for `catalog.sync.requested` leaves a `queued` row with no job (BH2, EC1) -- throw so the event delivery retries.
- `[medium]` `[patch]` After a quick failure, pressing Retry within 60 s answers 429 and the toast says "You just synced" (BH3, EC6); `Retry-After` is parsed but unused and not readable cross-origin (BH4, EC7, VG other) -- neutral rate-limit copy with the server's seconds; expose `Retry-After` in CORS.
- `[medium]` `[patch]` A failure that ended while the merchant was away is never shown; the story's AC says "when the merchant views the page" (BH5) -- on load, a `failed` run not yet shown (per run id, sessionStorage) raises the toast.
- `[low]` `[patch]` Toast `label` with `{hotkey}` passed to the Radix Provider (announced literally) instead of the Viewport (EC4).
- `[low]` `[patch]` Relative time can read "in 1 minute" under clock skew and "now" under a minute (BH9, EC5) -- clamp to the past; "just now" under a minute.
- `[low]` `[patch]` `useCatalogSync({ onFinished })` unused (BH6, VG other) -- remove; `CatalogSync.run` options defaulting to non-final (BH7) -- make required.
- `[medium]` `[patch]` Untested: concurrent first requests (advisory lock), `queued -> failed` in the dashboard; the Enter-key "ignored" assertions cannot fail in jsdom (VG1, BH8) -- add/fix tests. Gallery has two "Button" headings (BH10) -- rename.
- `[medium]` `[defer]` Wave-1 first-load budget: Button+Spinner+Toast add 15.2 KB of the 15 KB wave-1 budget, mostly Radix Toast (BH9) -- lazy-load the Toaster; owner to decide when.
- `[low]` `[defer]` Toast's inline close SVG instead of the shared icon set; relative-time hover text not Escape-dismissable (BH10) -- move `Icon` into `packages/ui` and build Tooltip in UI-kit wave 2.
- `[medium]` `[defer]` No test that the merchant layout mounts the Toaster (VG2) -- needs a server-layout test harness.
- `[low]` `[reject]` 401/403 on POST shown as "check your connection" (BH4, EC8) -- 401 already returns the merchant to sign-in through the session client; 403 CSRF is not reachable from the dashboard, which always sends the token.
- `[low]` `[reject]` Clock skew stretching Retry-After, blocked `type="reset"` button, toast re-show exit-timer race, no metric for rate-limited outcomes (EC9-11, BH10) -- unlikely; fixes add guards.
- `[false]` `[reject]` Spec/sprint status mismatch, UI-kit spec still draft (BH10) -- statuses advance per workflow; the UI-kit spec stays a living draft by owner decision.
- `[false]` `[reject]` singletonNextSlot collision untested (BH8) -- covered once the null-send throws (redelivery is tested).

## Design Notes

- Relative time via `Intl.RelativeTimeFormat` (`numeric: 'auto'`), re-rendered each minute; exact time via `formatDate` (store time zone, Asia/Riyadh until the store zone is exposed).
- Toast copy (en / ar): updated "Products updated" / "تم تحديث المنتجات"; too soon "You just synced. Try again in a minute." / "زامنت قبل قليل. جرّب بعد دقيقة."; failed "We couldn't sync your products. Your current list is still here." / "ما قدرنا نزامن منتجاتك. قائمتك الحالية باقية." + "Retry" / "حاول مرة ثانية".

## Verification

**Commands:**
- `pnpm turbo run lint typecheck test build --continue` -- expected: all pass (live DB tests on the Docker DB at 5436 locally).

**Manual checks:**
- Signed in as store 5002 (no Salla connection): Sync → failure toast with Retry. As store 73897098: Sync → "Products updated", time refreshes.

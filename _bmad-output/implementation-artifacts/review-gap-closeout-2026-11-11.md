# Pilot review-gap closeout — 2026-11-11

Owner authorized closing review gaps before Home placements. This pass audited 2.6-2.7 and 3.3-3.12, reusing 3.13's final review and rerunning shared content behavior. Baseline: `b6463b5768e3ea6cd036dc367be082ac8dc7dea0`. Previously approved planning changes were preserved. No deployment, enrollment or merchant communication occurred.

## Findings resolved

- **2.6 verification:** replaced expected-only outcomes with executed catalog/reconcile/webhook tests. Added worker startup tests exercising the real registration calls, covering both daily reconcile and webhook-sweep cron bindings and every catalogued domain event. Media-only workers do not register those cron jobs.
- **2.7 live connection state:** visible dashboard sessions refresh every 30 seconds and on focus/visibility return. Disconnect/reconnect metadata reaches subscribers without a reload. Refreshes are single-flight, preserve healthy state on network failure and discard stale successful responses after stop. Background metadata requests use the already-allowed `x-slips-client` header and do not extend cookie idle expiry; authenticated expiry still clears the session. Existing reconnect singleton/catch-up, paused jobs/webhooks and banner/toast coverage passed.
- **3.6/3.9 attachment race:** content re-reads media through its owner service and takes ordered shared asset locks inside the content transaction. Completion/failure before attachment uses fresh state; concurrent updates wait until references commit. A newly failed asset rejects attachment; retained failed slides reconcile the item to Failed. Kind-only duplication retains its intentional initial Draft behavior. Actual interleaved create/PATCH and PostgreSQL lock-wait tests cover these cases.
- **3.10 API documentation:** OpenAPI paths now use `{id}`/`{profile}` templates with required path parameters, preserving query parameters and controller routes. Tests cover every path placeholder.
- **3.6 resolution-feedback evidence:** browser checks cover English/Arabic at 1280/390 widths, actual image metadata, named dimensions/minimum, rejection before upload, replacement-picker action and refreshed warnings. Inspected English desktop and Arabic mobile screenshots; no horizontal overflow or page errors.
- **Test repeatability:** database suites accept `TEST_DATABASE_PORT`, keeping 5433 as the CI default and preserving existing URL overrides. Turbo forwards/hashes the variables. The purge-sweep fixture is placed inside the first bounded page without deleting unrelated rows. List tests provide `matchMedia` before delayed skeletons can mount.
- **Context/debt:** restored exact 15-minute upload expiry, throttling/abuse metrics, stored-byte metering and processing-duration measurement in Epic 3 context. Updated its pilot approval state. Existing real FFmpeg wiring is retained.

## Actual verification

Executed with Node 24.15.0. A new isolated PostgreSQL 18 container, `splice-review-gap-testdb`, used localhost port 15433 because Windows blocks binding 5433. Tests did not use the development database. FFmpeg 9.0.2 from a temporary `imageio-ffmpeg` environment supplied `FFMPEG_PATH`; the real adapter test decoded generated frames/audio and inspected the poster.

| Check | Final result |
| --- | --- |
| `pnpm turbo run lint typecheck test build --continue` | 26/26 tasks successful; 18 reused successful task results, 8 executed after final changes |
| API | 36 files / 677 tests passed, including catalog, reconnect/lifecycle, tenant isolation, media, content, preview, docs and startup |
| Dashboard | 29 files / 367 tests passed, including mounted refresh/cleanup, cookie expiry client behavior, editor and uploader |
| Contracts / DB / UI / player unit tests | 92 / 62 / 102 / 62 passed |
| `pnpm --filter @slips/dashboard exec playwright test` | 16 passed |
| `pnpm --filter @slips/player exec playwright test` | 33 passed, including 18 synthetic-theme CLS cases |
| Player build/budgets | Passed on Windows; initial payload 7.08 KB gzip, below 50 KB cap |
| `git diff --check` | Passed |

Logs: system temp `splice-review-gaps/verification.log`, `dashboard-browser-final.log`, `player-browser-final.log`. Screenshots: dashboard `test-results/media-resolution-*/resolution.png`. Early failures were corrected: blocked DB port, missing/full-feature FFmpeg executable, missing required fixture alt text, test-only SQL lint annotation, delayed-skeleton browser API stub and browser route interception of Vite source modules. One initial parallel player run had a transient fixture fetch failure; its focused rerun and subsequent full default-parallel 33-test run passed without a player code change. Historical Windows budget failures are no longer current.

## Per-story disposition

| Story | Review conclusion | Evidence / outstanding acceptance |
| --- | --- | --- |
| 2.6 | Closed | Reconcile/catalog/webhook integration, guarded changes, count/last-sync metrics, retry/dead-letter alerts, fan-out and worker cron wiring passed |
| 2.7 | Engineering gaps closed; full story remains review | Pausing/reconnect/banner/session refresh passed. The explicit storefront-last-data obligation still needs the publishing path in 4.4-4.6; the current active-token guard must not be used there |
| 3.3 | Closed | Create/edit/title/CTA validation, domain allowlist, explicit Published save, localized errors and unsaved navigation passed |
| 3.4 | Closed | Picker, stock/options warnings, link counts, deletion flags/events and cross-tenant behavior passed |
| 3.5 | Closed within specified adapter scope | Upload grants/expiry/limits/throttling, storage accounting, inspection/scanner port, metadata stripping and tenant isolation passed; production scanner selection remains a launch gate |
| 3.6 | Closed | Upload/progress/retry, slide order/keyboard/alt text, saved edits and current resolution-feedback unit/browser checks passed |
| 3.7 | Closed within specified fetcher scope | Import policy, DNS/private-address/redirect protections, bounded fetch/retry, shared upload pipeline and UI passed; deployed HTTPS/media compatibility remains launch validation |
| 3.8 | Engineering gaps closed; full story remains review | Real playable FFmpeg output, renditions/poster and processing metrics passed. The required 60-second 1080p staging P95 measurement has not been performed |
| 3.9 | Closed | Permanent QC failure, transient retries, shared-asset recovery, attachment races and auto-publish no-placement refusal passed; real placement admission belongs to 4.1 |
| 3.10 | Closed | Authenticated single-item preview, safe inspected media, isolation/no writes and corrected OpenAPI paths passed |
| 3.11 | Closed | Real preview viewer, protocol/media/CTA simulation, direction/accessibility and unit/browser/budget checks passed |
| 3.12 | Closed | Saved-preview updates, unsaved Published isolation, protected media ownership, failures/recovery and responsive browser checks passed |
| 3.13 | Existing final review confirmed | Shared content/editor/menu/browser regression passed; original final review remains the detailed evidence source |

Sprint changes follow these individual dispositions. Do not mark Epic 2 or Epic 3 done while the remaining full-story acceptance above is open.

## Remaining dependencies and launch gates

- **4.1:** replace no-placement admission stub and gate every transition into Published/Scheduled, including Undo/reactivate/go-live. No placement implementation was added in this closeout.
- **4.4-4.6:** disconnected retains last manifest; uninstall/purge/unknown returns empty. Scheduling-boundary recovery belongs to 4.3; entitlement admission to 7.4.
- **Before live pilot:** select production provider/region and real scanning or separately approved safe ingestion restrictions; validate real merchant formats, unknown-duration WebM/encoded dimensions, representative 60-second staging P95, capped memory/transaction behavior, HTTPS imports, Salla deletion semantics, theme/cart/freshness, security/data rights, caps, backup/restore, monitoring and rollback. These are explicit open gates in pilot readiness, not claims established by synthetic tests.

The local engineering gate before the Home placement slice is clear. Full story 2.7 and 3.8 closeout remains conditional on their outstanding acceptance; pilot deployment remains gated separately.

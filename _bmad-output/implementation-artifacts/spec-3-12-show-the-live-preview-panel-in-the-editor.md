---
title: 'Story 3.12: show the live preview panel in the editor'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: 'fac6bad99dc11686998b80194232f8be8eea761c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The editor displays a placeholder although the authenticated preview manifest and real player already exist. Merchants cannot judge saved content before publishing.

**Approach:** Embed the existing player in a persistent same-origin iframe, refresh its manifest after successful saves, and provide the phone frame, safety note, loading and retry states.

## Boundaries & Constraints

**Always:**
- Show a 9:16 phone frame with rounded-lg corners and ink bezel in the end-side column. Preserve the existing small-screen preview toggle and medium-screen sticky button. Keep localized “Preview: no real cart or analytics” visible outside the iframe in every state.
- Render saved server state. Refresh immediately after a successful create/update, product/slide-order save, or observed processing change; deliver the refreshed manifest within 2 seconds under normal API/media response times. Unsaved edits and failed saves must not replace saved preview content. Before first save, show a localized save-first state without a manifest request.
- Fetch `GET /v1/preview/content/{id}` through the merchant SessionClient and validate StoreManifest v1. Use the existing real player entry and MockStorefrontPlatform; updates must not reload the iframe. Locale changes update the player too.
- Register the parent listener before loading the iframe; validate exact origin, iframe window, message type and version. Configure the child from trusted same-origin application configuration. Never transmit session credentials. Constrain the child with a CSP allowing required scripts/styles/media and no commerce or analytics connections.
- Decision (2026-11-10, framing fix): Next.js must serve `/player-preview/index.html` with `frame-ancestors 'self' <configured Salla origin>` so the full dashboard/Salla ancestor chain is permitted. Keep the existing framing policies for merchant, auth and admin routes. Verify actual browser initialization through Next.js as well as the editor harness.
- Resolve public media against the configured API base. For bearer-protected API media, authenticate only known API media paths, create blob URLs, and retain them until replacement/destroy. Never forward credentials to product/CDN URLs. Cancel or ignore superseded work, clean up stale blobs/listeners, and prevent older responses replacing newer saves.
- Show a skeleton phone frame after 150 ms of loading. Fetch, media preparation, asset/iframe startup failure or handshake timeout shows “Preview didn't load. Try again.” and Retry. Refresh errors may retain the last valid view with an error notice; Retry must recover without resaving content.
- Arabic/English copy, accessible iframe title, polite loading announcements, logical CSS and reduced-motion support. Preserve native player controls and existing editor save semantics.
- Decision (2026-11-10): use Impeccable for UI implementation and visual review, preserving Slips' established design. Update shared UI kit components/tokens when needed and document changes in its living spec.

**Never:** Change API contracts, implement placements/scheduling, production cart/analytics, full Epic 5 playback, or preview unsaved form values.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| New content | No saved ID | Save-first state and safety note | No preview request |
| Save | Title/CTA/product/order persisted | Latest manifest posted to same iframe within 2 seconds | Failed save retains saved preview |
| Slow/failing work | Fetch or player startup delayed | Skeleton after 150 ms | Localized error and working Retry |
| Race/lifecycle | Rapid saves, locale change, unmount | Latest result wins; resources released | Ignore stale completions |
| Auth/media | Cookie or embedded bearer session | Protected media works; public URLs remain public | No token leakage; cleanup blobs |
| Untrusted message | Wrong source/origin/version | Ignore message | Preserve valid view |

</frozen-after-approval>

## Code Map

- `apps/dashboard/components/content/editor/{ContentEditor,PreviewPlaceholder}.tsx` — replace placeholder with `LivePreviewPanel.tsx`, passing the latest `saved` snapshot; retain responsive aside/toggle.
- `apps/dashboard/lib/api/preview.ts` (new) — authenticated manifest retrieval, URL preparation and blob ownership; reuse `SessionClient.apiFetch`, `apiUrl`, StoreManifest and media selection behavior from `packages/player/src/viewer`.
- `apps/dashboard/components/content/editor/use-live-preview.ts` (new) — refresh/handshake lifecycle and stale-result protection; reuse session/i18n providers.
- `packages/player/src/preview/{index,protocol}.ts` and README — reuse unchanged mountPreview and ready/update protocol; parent owns retrieval and media lifetime.
- `apps/dashboard/preview/` (new) — iframe HTML/bootstrap calling the built player, with CSP and trusted origin/API configuration.
- `apps/dashboard/scripts/{prepare-preview,dev}.mjs`, dashboard `package.json`, root `package.json`, `pnpm-lock.yaml`, `turbo.json`, `.gitignore`, dashboard `Dockerfile` — workspace player build dependency; copy player JS chunks and iframe assets to ignored `public/player-preview` before build/dev, include generated output in Turbo cache and production image. Root dev currently excludes the player build.
- `apps/dashboard/i18n/messages/{ar,en}.ts` — replace soon copy with preview states; preserve key parity.
- Existing `editor.test.tsx`, `slides.test.tsx` and UI kit living spec — update placeholder assumptions and register the integrated component.
- `apps/dashboard/lib/embedded/policy.ts`, policy/proxy tests, `playwright.config.ts`, `e2e/next-preview.spec.ts` — allow same-origin framing only for the preview document and verify its real production Next.js headers, handshake and player rendering.

## Tasks & Acceptance

**Execution:**
- [x] Build/dev/package files and `preview/` — serve the built player reliably in development and production.
- [x] `lib/api/preview.ts` and adjacent tests — implement manifest/media preparation and auth/cleanup matrix.
- [x] `use-live-preview.ts`, `LivePreviewPanel.tsx`, `ContentEditor.tsx` — implement persistent iframe lifecycle, phone states and saved-state refresh; remove placeholder.
- [x] i18n, editor tests and new preview tests — cover timing, save integration, races, retry, authentication, messaging and teardown.
- [x] `apps/dashboard/e2e/preview.spec.ts` plus browser harness/config — verify the real built player, updates without reload, simulated CTA, responsive Arabic/English layouts and failure recovery; inspect captures.
- [x] Player README and UI kit registry — document embedding, resource ownership and deployment assets.
- [x] `.claude/skills/impeccable/` guidance — read craft-floor before UI edits, inspect desktop/mobile captures together, fix in one batch, confirm at most once, and run the required detector once on finished UI.
- [x] Framing regression — reproduce the original proxy-policy failure, permit dashboard/Salla ancestors for the preview document, and add a browser regression through the actual Next.js server.

**Acceptance Criteria:**
- Given a saved item, when the editor opens, then the real iframe player and always-visible safety note appear in the responsive phone panel.
- Given title, CTA, product or slide-order changes, when save succeeds, then the same iframe displays saved changes within 2 seconds under normal response times.
- Given loading exceeds 150 ms or fails, when the merchant waits or retries, then the skeleton/error/recovery behavior matches the matrix.

## Implementation Notes

- Editor passes its saved server snapshot to the persistent preview; all existing save and processing paths share that snapshot. No form watcher feeds the player.
- Parent validates StoreManifest v1 and uses the player's media selection to prepare only needed protected bytes. API credentials stay in SessionClient; product and CDN URLs stay public. Abort/generation ownership prevents stale results and releases blob URLs.
- Trusted generated iframe assets use the existing mountPreview entry and ready/update protocol unchanged, with a no-connections CSP. Build/dev, workspace dependency, Turbo outputs/environment and Docker public assets are integrated.
- Browser harness uses the actual ContentEditor and built player with mocked merchant API and navigation/session adapters. Existing editor/slides suites isolate the preview UI; dedicated preview suites cover its lifecycle and API behavior.

## Spec Change Log

- 2026-11-10 — User reported persistent broken preview/loading. The actual Next.js proxy supplied `frame-ancestors https://s.salla.sa`, blocking the dashboard's same-origin iframe. Vite-only browser coverage had bypassed this policy. User authorized the fix and spec update: document the required ancestor chain and add real Next.js browser coverage. Preserve exact-origin messaging, existing merchant/auth/admin framing restrictions, and the child document's no-connections CSP.
## Review Triage Log

| ID | Verdict | Evidence / disposition |
|---|---|---|
| B1 | medium | API-prefixed paths resolve differently in apiUrl and selectMedia, so bearer media selection misses them. Patch consistent normalization and a prefixed processed-media regression. |
| B2 | medium | Each saved metadata change refetches unchanged video bytes before display, exceeding the update target for normal large uploads. Patch reuse of unchanged prepared bytes across replacement snapshots, with lifecycle coverage; initial loading remains bounded by actual media response time. |
| B3 | false | Per-slide public media errors are handled by the existing player's localized unavailable state, rather than panel startup/media-preparation failure. Prepared media URLs are normalized; the separately identified CTA validation discrepancy is E3. No new player acknowledgment protocol is required. |
| B4 | low | Revocation occurs before queued message delivery; a narrow loading/interaction window can observe an obsolete URL before replacement. Reject an acknowledgment protocol for this negligible transient case; new URLs stay alive and active replacement occurs on the next message task. |
| B5 | false | Parent loadPreview resolves every media URL to an absolute URL before posting. The child's API base therefore does not resolve these URLs, so differing Next env-file loading cannot produce the claimed broken media. |
| B6 | medium | Dedicated browser integration covers successful title saves only, while legacy editor tests mock the panel. Patch unsaved/failed-save, first-create, product/order and processing snapshot coverage. |
| B7 | medium | Current browser polling starts the timing assertion after save polling and mobile toggling. Patch timing directly from the successful save response. |
| B8 | low | Loading copy accidentally contains a question mark. Patch to an ellipsis. |
| E1 | medium | Same verified API-prefix discrepancy as B1; patch together. |
| E2 | false | Individual public/cookie media loading errors intentionally use the existing player's per-slide fallback. The parent still handles fetch, protected-byte preparation and player startup errors with Retry. |
| E3 | medium | URL parsing accepts some URLs containing whitespace that the stricter child validator rejects; canonicalize and validate CTA URLs during preparation, with coverage. |
| V1 | medium | Pre-verified: dashboard browser tests are not invoked by CI, allowing missing bootstrap assets to pass. Patch the existing browser CI job to run dashboard coverage. |
| V2 | medium | Pre-verified: current loadPreview tests exercise only scanned sources, leaving processed rendition/poster authentication untested. Patch image/video selection and unselected-URL assertions. |
| V3 | medium | Pre-verified: timeout test only checks Retry appears. Patch actual blocked-bootstrap recovery through Retry in the browser. |

## Verification

- Dashboard: lint, typecheck, all 336 tests and production build passed after final media/lifecycle refinements; the focused preview suites contain 10 tests.
- Dashboard browser: 4/4 scenarios passed at 1280px and 390px in Arabic and English, including real player startup, Retry, simulated CTA, saved title refresh within 2 seconds and unchanged iframe timeOrigin. Captures under ignored `apps/dashboard/test-results/preview-{locale}-{width}.png` were inspected together; no layout fixes required.
- Player: build and all bundle budgets passed; 62 unit tests and 33 existing browser regressions passed.
- Impeccable context and craft-floor read; detector ran once over changed UI and returned `[]`.
- Dependency installation initially exposed broken links; a forced install hit a locked optional native module, but subsequent scoped execution repaired links and all verification suites became runnable.

### Final review and verification

- All retained review findings patched; no work deferred. URL normalization handles API path prefixes and accepted CTA paths; unchanged protected media shares reference-counted ownership across saved snapshots. Individual media failures retain the existing player fallback.
- Added CI invocation, processed image/video/poster authentication regressions, first-create and unsaved/failed-save browser checks, save-response timing, and blocked-bootstrap Retry recovery. All six matrix rows have passing API/lifecycle/browser coverage.
- Parent verified using portable Node 24.15.0: dashboard lint, typecheck, production build, 27 unit files / 346 tests and 7 browser cases passed. Player build/budgets, 62 unit tests and 33 browser regressions passed. Logs: system temp `splice-3-12-final/{dashboard-unit,dashboard-lint,dashboard-typecheck,dashboard-build,dashboard-browser,player-unit,player-build,player-browser}.log`.
- Impeccable visual review inspected both locales at desktop/mobile sizes; detector returned no findings. Existing shared components/tokens suffice; UI kit living spec documents the new panel. Docker asset copying was reviewed; the Docker image was not built locally. Integration browser tests use mocked merchant API/session adapters; credential handling is covered by API tests.

- Dashboard lint, typecheck, unit suite and build; player build/budget and existing browser regressions.
- New dashboard browser integration and visual captures at desktop/mobile sizes in both locales.
- `git diff --check`.

### Framing fix verification (2026-11-10)

- Before the fix, new policy/proxy regressions failed with the original Salla-only header. After the fix, all 13 policy/proxy tests pass, including no-cookie iframe navigation, custom Salla origin, lookalike-path isolation and existing merchant/auth/admin restrictions.
- Live development server at port 3003 returns HTTP 200 and `frame-ancestors 'self' https://s.salla.sa` for the preview document.
- Node 24.15.0: production build (including TypeScript), focused ESLint, and all 8 dashboard browser tests pass. The new case uses an actual production Next.js server, asserts its CSP header, and proves browser framing, ready handshake and content rendering. Logs: system temp `splice-3-12-final/framing-{build,browser}.log`.


### Pilot review closeout — 2026-11-11

Closed: current editor/player integration and browser checks pass for saved updates, explicit Published-save isolation, protected media ownership, retry/bootstrap recovery and responsive controls.

Actual shared verification: API 677, dashboard 367, contracts 92, DB 62, UI 102 and player 62 unit tests passed; dashboard 16 and player 33 browser tests passed. All 26 repository lint/typecheck/test/build tasks succeeded. See [review-gap closeout](review-gap-closeout-2026-11-11.md) for commands, environment, initial failures, cache use and remaining acceptance/launch gates. These are executed results; older expected-only commands above remain historical.

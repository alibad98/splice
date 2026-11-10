---
title: 'Story 3.11: render content in the player preview mode'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: 'e3dd4db6025b1811b113155c3dd7b99a9ae73261'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/.claude/skills/impeccable/reference/craft-floor.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The preview manifest exists, but the player viewer is a placeholder. The dashboard cannot display saved content using the storefront player.

**Approach:** Build a reusable Shadow DOM viewer in `packages/player`, a mock storefront port, and an iframe preview entry that accepts manifest updates. Story 3.12 will embed this entry in the editor.

## Boundaries & Constraints

**Always:**
- Consume StoreManifest v1 using type-only imports; Preact is the only runtime dependency. Render the first item with ordered slides, localized previous/next and native video controls. Autoplay, gestures and feeds belong to Epic 5.
- Render media, title, current product snapshot and CTA inside a 9:16 Shadow DOM host. Use system fonts, logical CSS, documented `--slips-*` styling properties with defaults, locale-derived `dir` (`ar` RTL, `en` LTR), and `dir="auto"` for merchant text. Render text as text, never HTML.
- Expose a minimal `StorefrontPlatform` port and `MockStorefrontPlatform`. Preview cart adds resolve as simulated success with accessible localized feedback; navigation actions are also simulated. No real Salla calls, navigation, analytics, cart-confirm requests or telemetry. Every viewer action goes through the port.
- Choose a processed image/web rendition or video rendition; for processing slides prefer a supplied poster, then inspected source. Missing/failed media and load errors show localized placeholders. Missing/deleted products show no purchasable card; unavailable/required-options states remain explicit. Display prices from integer minor units and currency.
- Provide mount/update/destroy and a preview build entry. Updates reuse the host without reload, reset slide selection, stop obsolete video and clear feedback. Destroy unmounts and removes listeners.
- Document a versioned message envelope carrying manifest and locale, and an exact-origin parent/iframe handshake. Accept updates only from the configured parent origin and `window.parent`; reject malformed envelopes/manifests, unsupported versions and unsafe media URL schemes without replacing the last valid state. Never use wildcard target origins.
- Accept HTTP(S), API-relative media resolved against an explicit API base, and host-created blob URLs. Never send tokens in messages/URLs. Story 3.12 owns authenticated fetching and blob lifetime for bearer-only media.
- Retain loader/stub behavior and existing bundle/CLS gates; preview rendering uses the same viewer module that Epic 5 will extend.
- Decision (2026-11-10): use Impeccable to create a polished preview component and update the UI kit living spec as necessary. Inherit the established Slips design; keep the player independent of the React UI kit.

**Never:** Build the editor preview panel, fetch manifests, change API/auth/storage contracts, implement production Salla cart integration, placements, scheduling, tracking or the full Epic 5 player.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Complete content | Story/Reel, image/video, product, CTA | 9:16 viewer, ordered navigation, media, title, product price and CTA | Failed media becomes placeholder |
| Incomplete draft | Empty items/slides, null URLs/product, processing/failed slide | Localized empty/processing/unavailable state | No exception or fabricated URL |
| CTA | Add cart, open product, open link | Mock result and localized feedback | No external side effects |
| Locale/text | Arabic/English; markup in title/product/label | Correct direction; literal merchant text | No HTML execution |
| Update | New manifest while video is active | Same iframe/host, new content, reset selection | Old playback and feedback cleared |
| Untrusted update | Wrong origin/source, bad version/shape, script URL | Last valid content retained | Ignore update safely |

</frozen-after-approval>

## Code Map

- `packages/player/src/viewer/index.ts` — replace placeholder with shared viewer; add adjacent component/styles/media helpers as needed.
- `packages/player/src/platform/{types,mock}.ts` (new) — minimal viewer port and mock; retain existing `salla.ts` page-context spike.
- `packages/player/src/preview/{index,protocol}.ts` (new) — mount API, validated messaging and lifecycle; obey `packages/config/eslint.js` boundaries.
- `packages/player/src/index.ts`, `package.json`, `vite.config.ts` — expose preview entry and declaration exports without adding it to the loader's static imports.
- `packages/contracts/src/v1/{manifest,content}.ts` — reuse manifest, product and CTA types unchanged.
- `packages/player/e2e/{server.mjs,preview.spec.ts,fixtures/preview.html}` — real iframe harness and browser assertions. Existing `cls.spec.ts` covers loader regressions.
- `packages/player/scripts/check-size.mjs` — preserve gzip gates; use `fileURLToPath` here and in the E2E server for Windows.

## Tasks & Acceptance

**Execution:**
- [x] Platform files — define the port and isolated mock, with unit tests.
- [x] Viewer files — implement accessible localized rendering, media fallbacks, slide navigation and mock CTA feedback.
- [x] Preview files — implement validated messages, trusted-parent handshake and mount/update/destroy; unit-test rejection and cleanup.
- [x] Package/build files and `packages/player/README.md` — expose entry, document protocol, URL/auth responsibility and CSS properties; preserve lazy separation.
- [x] Browser harness/spec and size script — cover the matrix using the built player in an iframe, verify no action/telemetry requests and existing CLS behavior.
- [x] `_bmad-output/implementation-artifacts/spec-ui-kit-global-components.md` — register the player preview with its owning package, visual tokens, states and integration boundary; dashboard phone frame/editor composition remains story 3.12.
- [x] `packages/player/e2e` — capture built preview at desktop and mobile widths, Arabic/English and incomplete media states under `.impeccable/review/`; inspect in one batched pass, fix together, at most one confirmation pass. Include a complete synthetic product/media fixture labelled as demonstration outside the player. Use an existing photo asset or a clearly identified local image fixture; no dependency on remote demo media.

**Acceptance Criteria:**
- Given a built player loaded in an iframe, when a valid manifest arrives, then the real shared viewer renders the specified media and product/CTA presentation inside Shadow DOM.
- Given an active preview, when its CTA is pressed or a new manifest arrives, then simulation and updates complete without real commerce/events or iframe reload.
- Given changed player files, when lint, typecheck, unit tests, build/budget and browser tests run, then they pass with any infrastructure limitations reported.

## Implementation Notes

- Shared Preact viewer, mock platform, exact-origin protocol and package subpaths implemented. Host direction/language is restored on destroy; active video is stopped and obsolete sources removed on update.
- Parent matrix audit: built iframe tests cover complete media/product/CTA, incomplete/failed states, simulation, Arabic/literal text, active-video updates and untrusted messages; unit tests cover media selection, currency exponents and protocol lifecycle.
- Impeccable detector returned []; fresh finish reviewer returned ship after all eight captures. Documenter verified README/UI kit documentation and preserved existing DESIGN.md. Pre-existing design-schema drift was reported without repair.

## Spec Change Log

## Review Triage Log

| ID | Layer | Verdict | Evidence / disposition |
| --- | --- | --- | --- |
| B1 | Blind | high | Intl fraction digits differ from contracts CURRENCY_EXPONENTS for IQD/YER, producing wrong prices. Patch conversion/display precision and cover all supported currency exponents without runtime contract imports. |
| B2 | Blind | medium | The content domain validator uses URL.protocol and preserves the entered URL; the player's case-sensitive scheme regex rejects valid uppercase HTTPS. Patch case-insensitive matching. |
| B3 | Blind | low | Direct update accepts extra fields, then structuredClone throws for an extra function. Patch clone-failure rejection before viewer mutation. |
| B4 | Blind | false | Reproduced in the built Chromium iframe: retain old image handle, update manifest, dispatch error on the detached image. Current media remains intact. Preact detaches the obsolete handler when the keyed media subtree unmounts. Reject additional generation guards. |
| B5 | Blind | medium | The stock/options ternary hides required-options information when both flags apply. Patch to display both independent existing states. |
| B6 | Blind | medium | Null draft alt text renders the substantive image as decorative. Patch fallback to the item title, preserving an explicit alt string. |
| B7 | Blind | low | No cross-origin deployment is required by this story; a second-origin blob harness adds infrastructure for a speculative integration issue. Reject that expansion; exercise parent-created blob media in the intended same-origin iframe instead. |
| B8 | Blind | medium | Searches confirm no deferred/rejecting adapter coverage for the shared viewer's pending/error/stale-feedback paths. Patch browser coverage using its existing platform port. |
| B9 | Blind | medium | Navigation tests only count frames; they do not detect same-frame location changes, popups or requests. Patch observable side-effect assertions. |
| E1 | Edge | medium | every skips sparse array holes, while rendition find dereferences undefined. Patch dense validation of each nested array; regression must preserve last valid content. |
| E2 | Edge | low | Same demonstrated clone failure as B3; same patch, recorded separately. |
| V1 | Verification | medium | Pre-verified gap: replacing open_product's product check with purchasable passes all current tests. Patch out-of-stock and required-options navigation assertions. |

## Direction contract

**THESIS:** A merchant should judge the actual story, its product and its action at a glance. Media owns the frame; controls stay familiar and quiet.

**OWN-WORLD:** Extend Slips' existing system (DESIGN.md and `packages/ui/src/styles/globals.css`): ink/amber player CTA, white product surface, muted secondary text, coral focus, 12–16px corners and 4px spacing. Map these to documented `--slips-*` defaults, with no React/Tailwind imports. System fonts are binding for the player.

**STORY:** Move through saved slides, read product availability/price, and try the simulated CTA. Empty and failed states explain what the merchant should do next.

**FIRST VIEWPORT:** A fitted 9:16 stage with a compact title and slide position above the media, a product/action dock below it and clear previous/next buttons. Media remains visible on short screens; long titles/product names wrap within bounded areas without hiding controls. Native video controls remain unobstructed. Localized preview safety note always visible.

**FORM:** Local component extension in the established world; Operate mode, code-led. No new identity or concept roll. Signature interaction: the slide indicator and active media change together while the product/action dock stays stable. Respect reduced motion; no decorative gradients or fake progress animation.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Existing DESIGN.md is preserved; documentation of the extension belongs in the player README and UI kit registry. Parent workflow owns Impeccable detector/finish review and BMAD review after implementation; implementation should report capture paths and verification without spawning its own reviewers or rerunning Impeccable context.

## Verification

- `pnpm --filter @slips/player lint`
- `pnpm --filter @slips/player typecheck`
- `pnpm --filter @slips/player test`
- `pnpm --filter @slips/player build`
- `pnpm --filter @slips/player test:e2e` — preview and existing CLS suites.
- `pnpm --filter @slips/config test` — dependency boundary regressions.
- `git diff --check`

### Executed verification (Node 24.15.0)

- Direct ESLint and TypeScript CLI checks passed; Vite and declaration build passed.
- Player Vitest: 27 passed. Playwright: 31 passed, including 18 existing CLS cases; real active-video cleanup and long Arabic text verified.
- Config boundary tests: 34 passed via direct Vitest.
- Gzip: initial 7.08 KB, loader 6.45 KB, viewer 10.00 KB, analytics 0.22 KB; all gates pass.
- Used direct tool CLIs because this environment's pnpm script invocation printed commands without test output. Portable Node24 was used for player verification.
- git diff --check passed.

### Final review and verification

- All retained findings patched. Sparse nested arrays now reject safely; clone failures preserve the last view; uppercase HTTP(S) CTA schemes are accepted. Product availability/options and draft image accessibility corrected. No new deferred work.
- Currency regression checks compare every supported contract currency in both locales; IQD and YER accounting precision is corrected without runtime contract imports.
- Parent ran Node24 direct CLIs: ESLint, typecheck, Vite/declarations and gzip gates passed. Player unit suite: 8 files / 62 tests passed. Config boundary suite: 34 passed. Full Playwright: 33 passed, including all 18 existing CLS cases, parent-created blobs, unavailable-product navigation and deferred/rejecting adapter lifecycle.
- Final gzip: initial 7.08 KB, loader 6.45 KB, viewer 10.07 KB, analytics 0.22 KB. Logs: system temp/splice-3-11-final/{lint,typecheck,unit,boundaries,build,browser}.log.
- Impeccable verdict pass scored all three material design fixes resolved and returned ship; all eight final captures valid. Documenter rechecked current code and documentation with no necessary changes.

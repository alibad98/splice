---
title: 'Story 1.2: Gate the player stub and bundle budget plus CLS in CI'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '4a542fa47b68fa6105e875092bf604cddf7bc5f8'
route: 'dispatch'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-1-scaffold-monorepo-ci.md'
warnings: []
deferred:
  - summary: >-
      The stub's CDN and API origins are placeholders (cdn.slips.app, api.slips.app) and the stub does not yet read salla.config.
    evidence: |-
      Real origins depend on hosting (Q-05) and the Story 1.11 spike; the stub currently only sets the guard and loads the loader.
    location: >-
      packages/player/stub/stub.js
    severity: medium
  - summary: >-
      The CLS suite runs against a placeholder loader and a fake manifest API; it must be re-run against the real player in Epic 5.
    evidence: |-
      loader.tsx renders a fixed-height list; real Story/Reel rendering and AD-8 space reservation are not decided until gate G1/G7 results.
    location: >-
      packages/player/src/loader.tsx
    severity: medium
  - summary: >-
      The CLS job and playwright install step have not run on a GitHub runner.
    evidence: |-
      Only verified locally with the pre-installed Chromium; CI wiring is untested.
    location: >-
      .github/workflows/ci.yml
    severity: low
---

<intent-contract>

## Intent

**Problem:** The player has no size or layout-shift protection, so it could silently exceed its budget or move the merchant's page.

**Approach:** Add a Vite multi-entry player skeleton (core loader, lazy viewer, analytics batcher), a gzip budget gate, a runtime-import allowlist lint, a static stub with tests, and a Playwright CLS suite on three theme fixtures, all wired into CI.

## Boundaries & Constraints

**Always:** Initial payload fails above 50 KB gzip; core loader warns above 20 KB; viewer fails above 25 KB; analytics batcher fails above 5 KB. Only `preact` (plus type-only `@slips/contracts`) may be a runtime import in `packages/player/src`. The stub is static, sets one `window.__slips` guard, loads only from Slips origins, and fails silently.

**Never:** No real Story/Reel rendering, hosting, or CDN deployment; no Salla-specific logic (Story 1.11).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Content present | manifest has items | Slips root inserted, no layout-shift entries | N/A |
| No content / timeout / invalid key | empty, hanging or 401 manifest | no Slips element in layout | silent |
| Scroll past anchor | content arrives after scroll | inserted, no shift | N/A |
| Second stub boot | `window.__slips` set | exits, no script added | silent |
| Runtime import | zod, drizzle, @salla.sa/* in player src | lint fails | names boundary rule |

</intent-contract>

## Code Map

- `packages/player/src/{index,loader}.ts(x)`, `viewer/`, `analytics/` -- three build entries
- `packages/player/scripts/{size-budget,check-size}.mjs` -- budget logic and gate, run by `build`
- `packages/player/stub/stub.js` -- the static App Snippet
- `packages/player/e2e/` -- CLS suite, fixtures, fake API server
- `packages/config/eslint.js` -- runtime-import allowlist
- `.github/workflows/ci.yml` -- `player-cls` job; `docs/runbooks/publish-stub.md`

## Tasks & Acceptance

**Execution:**
- [x] Player entries, Vite multi-entry build, size gate with unit tests
- [x] Lint allowlist plus boundary tests
- [x] Stub plus tests (guard, origins, silent failure, timeout)
- [x] Playwright CLS suite (3 themes x 5 scenarios), CI job, publish runbook

**Acceptance Criteria:**
- Given the player build, when sizes exceed the caps, then the build fails (initial, viewer, batcher) or warns (loader).
- Given a non-preact runtime import in the player, when lint runs, then it fails.
- Given the CLS suite, when run on the three themes, then no layout shift is attributable to Slips and empty scenarios leave no Slips layout space.
- Given the stub, when tested, then guard, origin and silent-failure behaviour pass.

## Spec Change Log

## Review Triage Log

Self-review of the diff by the parent (no separate reviewer subagents in this unattended run). Mutation check: moving the insert point to the top of the body made 3 CLS tests fail, so the suite does detect shifts.

## Implementation Notes

- DECISION: Build output renamed from `dist/player.js` to three entries (`loader.js`, `viewer.js`, `analytics.js`) plus a shared preact chunk; package `exports` points to `loader.js`.
- DECISION: Initial payload = stub gzip + core loader and its static chunks; viewer and batcher are measured with their static chunks (preact included).
- DECISION: Size gate runs inside the player `build` script so the normal turbo build fails CI; the CLS suite is a separate `test:e2e` script and CI job (not in `pnpm test`) because it needs a browser.
- DECISION: Placeholder loader inserts content only after a manifest with items arrives and only while the anchor is outside the viewport, so visible content never moves; no space is reserved otherwise (satisfies NFR1 without needing AD-8 results).
- DECISION: Stub origins are placeholders (cdn.slips.app / api.slips.app) pending hosting (Q-05).
- DECISION: Runtime-import lint uses a regex allowing only preact, relative paths and `@slips/contracts`; test files are exempt.
- Playwright uses `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` or `/opt/pw-browsers/chromium` locally; CI installs Chromium.

## Auto Run Result

Status: done. Implemented the gates described above; commit recorded in git log.
- Verification: `pnpm turbo run lint typecheck test build` passes 25/25 under Node 24; `pnpm --filter @slips/player test:e2e` passes 15/15 (ran twice). Sizes: initial 6.40 KB, loader 5.77 KB, viewer 5.21 KB, batcher 0.22 KB gzip.
- Not run: the GitHub Actions workflow.
- Patches applied: none after review. Follow-up review recommended: false.

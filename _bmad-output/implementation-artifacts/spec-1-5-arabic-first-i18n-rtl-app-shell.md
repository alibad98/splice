---
title: 'Story 1.5: Set up Arabic-first i18n, RTL/LTR and the branded app shell'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_revision: '47ae70f88a5049088be66022344c73f53b2d4d0c'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-splice-2026-10-10/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-splice-2026-10-10/EXPERIENCE.md'
warnings: []
deferred:
  - summary: >-
      Connection chip, store name and Preview store URL come from a placeholder getShellContext(); support link is a placeholder mailto.
    evidence: |-
      Real data arrives with Story 1.8 (Salla OAuth); support channel is undefined (lib/shell.ts, TODO markers).
    location: >-
      apps/dashboard/lib/shell.ts
    severity: low
  - summary: >-
      Iframe behaviors (no nested scroll, modals fit iframe) are verified by static guards only, not in a real Salla iframe.
    evidence: |-
      Needs the Salla iframe harness (Story 1.8+) to confirm auto-resize and modal sizing end to end.
    severity: low
---

<intent-contract>

## Intent

**Problem:** The dashboard is English-only with no shell: no Arabic/RTL default, locale-aware numbers, navigation, connection chip or brand placement (UX-DR7, 36, 37, 39, 41-43, NFR5).

**Approach:** Add typed ar/en catalogs with a cookie-backed locale (default Arabic, root `lang`/`dir`), Intl formatters, CI guards (string hardcoding, catalog parity, physical-direction utilities), and a branded responsive app shell in the (merchant) route group.

## Boundaries & Constraints

**Always:** Arabic first; Western digits 0-9 with tabular-nums; logical CSS properties only; friendly-coach voice, no emoji, one next step; no purple; connection chip renders from a typed prop (not-connected default) until Story 1.8; page-only scroll, no `window.top`, external links `target="_blank" rel="noopener noreferrer"`.

**Never:** no real Salla/connection data, no real pages beyond placeholders, no new runtime dependencies for i18n or UI kits, no changes to tokens.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default locale | no cookie | `lang="ar" dir="rtl"` | n/a |
| English | cookie `en` | `lang="en" dir="ltr"` | invalid cookie falls back to ar |
| Currency | 340 / 340.5 SAR | ar "340 ر.س", en "SAR 340"; decimals only when non-zero | n/a |
| Digits | any number/date, ar | digits 0-9 only | n/a |
| Missing key | key in one catalog only | test fails | n/a |
| Physical utility | `ml-2`, `left-0`, `pr-4` in dashboard source | lint fails | n/a |

</intent-contract>

## Code Map

- `apps/dashboard/app/layout.tsx` -- root layout (was `lang="en"`); reads locale, sets lang/dir, provides messages.
- `apps/dashboard/app/(merchant)/` -- page + new layout wrapping AppShell; placeholder routes content/products/analytics/settings.
- `apps/dashboard/i18n/` -- config, catalogs, formatters, server locale, provider, tests.
- `apps/dashboard/components/shell/` -- AppShell, nav, top bar, connection chip, mobile sheet, logo, icons.
- `apps/dashboard/eslint.config.js` -- physical-direction and window.top restrictions.
- `apps/dashboard/public/brand/` -- brand assets (from 1.4); add app icon for Salla listing.

## Tasks & Acceptance

**Execution:**
- `apps/dashboard/i18n/*` -- catalogs, locale config/cookie, Intl formatters, provider, switch action
- `apps/dashboard/components/shell/*`, `app/(merchant)/layout.tsx` -- shell, nav (md icons, sm Sheet), top bar, chip, skip link, logo
- `apps/dashboard/eslint.config.js` + tests -- direction/hardcoded-string/parity/iframe guards
- `apps/dashboard/public/brand/app-icon.{svg,png}` -- Salla listing icon

**Acceptance Criteria:**
- Given no preference, when rendered, then root is `lang="ar" dir="rtl"`; switching sets `en`/`ltr`; CI fails on hard-coded JSX strings or catalog key mismatch.
- Given physical utilities in dashboard source, when lint/tests run, then they fail; directional icons mirror in RTL, media icons never.
- Given numbers/prices/dates, then Western digits, tabular-nums, Intl currency per matrix, LTR tokens in `<bdi>`.
- Given any page, then shell shows skip link first, start-side nav with coral-pill active item and Settings at bottom, in-flow top bar with store identity, connection chip linking to Settings > Connection, Preview store, Need help; nav icons at md, Sheet at sm; 12-col grid max 1360px.
- Given the iframe, then no nested scroll, no `window.top`, external links open new tab.
- Given brand assets, then mark sits at inline-start of wordmark (light/dark), 2x stroke clear space, favicon from mark, app icon exported.

## Spec Change Log

## Review Triage Log

## Design Notes

Catalogs are TS objects: `en` defines the shape, `ar` is typed against it, so a missing key fails typecheck and a parity test.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm turbo run lint typecheck test build` -- expected: all tasks successful (after deleting dist/.next).

## Implementation Notes

- DECISION: no i18n library; typed TS catalogs (en defines shape, ar typed against it) with a cookie (slips-locale) read in the root layout; switching uses a server action. Avoids a new dependency and keeps root lang/dir server-rendered.
- DECISION: formatters force Western digits and Gregorian calendar via the -u-ca-gregory-nu-latn locale extension; the Arabic riyal output strips bidi marks and the trailing full stop so it reads "340 ر.س".
- DECISION: /admin stays English-only and is excluded from the hard-coded-string guard (internal back-office, Epic 7).
- DECISION: physical-direction rule is a local ESLint rule (apps/dashboard/eslint-rules) plus a CSS scan in vitest; window.top/top.location/_top targets are lint errors.
- DECISION: logo lockup is HTML (mark img then wordmark text in the page fonts) so the mark sits at inline-start in both directions with 2x stroke padding; the standalone wordmark SVGs are unchanged.
- DECISION: nav sheet below md is a native modal dialog from the inline-start edge; icons-only nav at md; placeholder pages for content/products/analytics/settings so nav links resolve.
- DECISION: Preview store renders aria-disabled with a reason until a store URL exists; support link is a placeholder mailto.
- Implemented without subagents (none available); parent runs the independent review.

## Auto Run Result

Status: done
Summary: Arabic-first i18n (ar/en catalogs, cookie locale, root lang/dir), Intl formatters, CI guards, branded responsive shell, app icon export.
Files: apps/dashboard/{i18n,components,eslint-rules,lib/shell.ts,lib/i18n-guards.test.ts,app/layout.tsx,app/(merchant)/*,public/brand/app-icon*}.
Review: self-review only (no subagents); no patches; deferred items listed in frontmatter.
Verification: clean-slate `pnpm install --frozen-lockfile && pnpm turbo run lint typecheck test build` -> 26/26 successful; dashboard tests 71 passed; manual Playwright smoke: default ar/rtl, switch to en/ltr, skip link first focus, sheet at 390px, no horizontal overflow at 1280/800/390.
Residual risks: shell iframe behavior unverified in a real Salla frame.

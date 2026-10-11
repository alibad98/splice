---
title: 'Story 1.4: Build the design-system foundation tokens'
type: 'feature'
created: '2026-10-11'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-splice-2026-10-10/DESIGN.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The dashboard has no styling system: no tokens, fonts, focus ring or contrast guarantees (UX-DR1-5, UX-DR40, NFR6).

**Approach:** Ship the approved Studio-Coral tokens as `packages/ui/src/styles/globals.css` (Tailwind 4), consumed by the dashboard, with `next/font` self-hosted fonts and an automated token contrast/purple/gradient test.

## Boundaries & Constraints

**Always:** ink text on coral; coral never body text (links use `info-text`); `input-border` on controls, `border` decorative; two-tone focus ring; no purple; gradients only in `--story-ring-gradient`.

**Never:** no component library or restyle of pages; no web fonts in the player.

</intent-contract>

## Code Map

- `packages/ui/src/styles/globals.css` -- tokens (light/dark), `@theme inline`, type scale, Arabic rules, focus ring; exported as `@slips/ui/globals.css`.
- `packages/ui/src/styles/tokens.test.ts` -- coverage, purple/gradient and WCAG AA pair checks.
- `apps/dashboard/app/layout.tsx`, `postcss.config.mjs` -- font variables and Tailwind PostCSS.

## Tasks & Acceptance

**Execution:**
- `packages/ui/src/styles/globals.css` -- port approved tokens, add player, gradient, type-scale, spacing, popover-ring tokens
- `packages/ui/src/styles/tokens.test.ts`, `vitest.config.ts`, `tsconfig.build.json` -- automated checks
- `apps/dashboard/*` -- Tailwind 4 deps, PostCSS, `next/font/google` (Plus Jakarta Sans, IBM Plex Sans Arabic)

**Acceptance Criteria:**
- Given the token file, when parsed, then every DESIGN.md token exists for light and dark, no purple, one gradient token.
- Given a focusable element, then the two-tone ring renders (ink/white inner, coral outer).
- Given token pairs, then 4.5:1 text and 3:1 UI hold in light and dark.
- Given Arabic, then `:lang(ar)` orders Plex first, letter-spacing 0, body line-height 1.6, display weight 700.

## Implementation Notes

- DECISION: tokens live in `packages/ui` (per AC) and are imported by the dashboard layout; `@source` directives cover dashboard and ui.
- DECISION: raw shadow variable renamed `--card-shadow` (theme `--shadow-card` references it) to avoid a self-referencing variable.
- DECISION: page padding is a plain `--page-padding` variable (16px, 28px from 1024px), gutter is `--spacing-gutter` 18px.
- DECISION: dark focus inner (white) on a coral fill is 2.81:1; exempted in the test because the `ring-dark` halo carries 3:1 against the surface. Approved tokens left unchanged.
- DECISION: light chart-4 amber is graphics-only and exempt from the 3:1 check on white (per DESIGN.md, chart colors are never text).
- DECISION: fonts use `next/font/google`, which self-hosts the files at build time (woff2 emitted to `.next/static/media`).
- Player styles/tokens are defined here but the player (Shadow DOM, system fonts) does not import this CSS.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm turbo run lint typecheck test build` -- expected: 26/26 tasks successful (run after deleting dist/.next).

---
title: 'UI kit: global components for the dashboard (living spec)'
type: 'feature'
created: '2026-11-01'
status: 'draft'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-splice-2026-10-10/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-splice-2026-10-10/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every page so far hand-rolls its own buttons, errors, empty states and loaders (Products page, auth forms, shell). Upcoming stories need progress bars, warnings, toasts, dialogs and more, and without one shared set they will drift in look, accessibility and behaviour.

**Approach:** Build the app's global components once in `packages/ui`, starting from shadcn/ui sources restyled to DESIGN.md tokens. Ship them in waves; this spec is a living registry, and each wave is approved and built before the next is added.

## Boundaries & Constraints

**Always:**
- Visuals come only from `packages/ui/src/styles/globals.css` tokens (colour, radius, shadow, focus ring, type). Light and dark themes; no hard-coded colours.
- RTL and LTR: logical CSS properties only; directional icons mirror, media icons never do; text and numbers bidi-safe.
- Accessibility: WCAG 2.1 AA (text 4.5:1, UI 3:1), visible two-tone focus ring, correct roles and live regions, keyboard operable, 24px minimum targets.
- Motion: CSS transitions/keyframes first; every animation stops or becomes instant under `prefers-reduced-motion`. A JS animation library is allowed only where CSS cannot do the job, loaded lazily so it never lands in the first load of pages that do not use it.
- Performance: components are server-renderable where possible (`'use client'` only on interactive parts), tree-shakeable named exports, no runtime CSS-in-JS, no layout shift on mount. Report each wave's added first-load JS for `/products` from `next build`.
- Copy inside components comes from props (callers pass `ar`/`en` strings); components never hold user-facing text except accessible defaults passed in by the app.
- Each component: unit tests (render, roles/ARIA, keyboard where interactive, reduced motion) and an entry on the dev-only gallery page.

**Never:** Copy code from external libraries without checking its licence permits it (record the source and licence in the file header); add a second icon set; use purple or gradients outside the logo and story ring; use white text on coral; rely on colour alone for meaning; ship page spinners (skeletons instead); auto-dismiss a toast that has an action.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Button pending | `pending` while saving | spinner, `aria-busy`, clicks ignored, focus stays | — |
| Unavailable action | `unavailableReason` set | `aria-disabled`, focusable, reason announced | — |
| Determinate progress | value 40 of 100 | bar at 40%, `role="progressbar"` with value text | value clamped to 0..max |
| Indeterminate progress | no value | moving bar; static under reduced motion | — |
| Usage meter | 8 of 10 / 9 of 10 / 10 of 10 | ink / warning / destructive fill, text "8 of 10" always | max 0 → shows "0 of 0", empty bar |
| Inline error | block failed | danger alert: what failed + Retry, other blocks unaffected | Retry pending state |
| Warning | non-blocking issue | warning alert with icon + text (never colour alone) | — |
| Banner | store disconnected | full-width in-flow danger strip, one action, persistent | — |
| Toast with action | "Archived" + Undo | stays until dismissed; reachable with F8; announced politely | — |
| Plain toast | "Changes saved" | dismisses after 5 s, pauses on hover/focus | — |
| RTL | `dir="rtl"` | mirrored layout and directional icons; progress fills from the inline start | — |
| Dark theme | `.dark` | every component switches to dark tokens | — |

</frozen-after-approval>

## Code Map

- `packages/ui/src/styles/globals.css` -- all tokens; add motion tokens (durations, easing) here if needed.
- `packages/ui/src/{card,table,status-chip,data-table}.tsx` -- existing components (Story 2.2); reuse `cn`, follow their style.
- `apps/dashboard/components/shell/Icon.tsx` -- the project's own icon set with RTL mirroring; move to `packages/ui` and extend it rather than adding a library.
- `apps/dashboard/components/products/ProductStates.tsx` -- hand-rolled empty, error and skeleton states; migrate to the kit once it exists.
- `apps/dashboard/components/auth/AuthAlert.tsx`, `FormInput.tsx` -- hand-rolled alert and input; migrate in the forms wave.
- New: `packages/ui/components.json` (shadcn CLI pointed at `packages/ui`), `apps/dashboard/app/(dev)/ui/page.tsx` (gallery, 404 in production).

## Component Registry

| Wave | Component | Covers | Status |
|------|-----------|--------|--------|
| 1 | Button (+ Spinner) | primary, secondary, accent, ghost, destructive; sizes 32/36/44; pending; unavailable-with-reason | built (Story 2.3) |
| 1 | Progress | linear determinate and indeterminate (uploads, sync, processing) | planned |
| 1 | Meter | plan usage: 6px bar, 80% warning, 100% destructive, "n of m" text | planned |
| 1 | Alert | inline info / success / warning / danger with optional action (block errors with Retry) | planned |
| 1 | Banner | page-level in-flow strip: warning (offline), danger (disconnected) | planned |
| 1 | Toast + Toaster | pre-mounted live region, F8, bottom-start, action toasts persist | built (Story 2.3) |
| 1 | EmptyState | sentence + optional action/link; filtered-empty variant | planned |
| 1 | Skeleton | boneyard-based blocks, shimmer off under reduced motion | planned |
| 2 | Tooltip, Popover | KPI definitions, help text | later |
| 2 | Dialog, ConfirmDialog, Sheet | destructive confirm naming the item, support sheet | later |
| 2 | DropdownMenu | row menus | later |
| 3 | Field, Input, Select, Combobox, Textarea, Switch, Checkbox | forms (RHF + Zod), product picker | later |
| 3 | Tabs, Segmented control | status tabs, Stories/Reels toggle | later |

New components are added as rows; a wave moves to `in-progress` only after its rows are approved.

**Built on demand:** while Epic 2+ stories are in progress, a story that needs a registry component builds it in `packages/ui` to the rules in this spec (Boundaries, matrix rows for that component, tests, gallery entry) and sets its row's status to `built (Story X.Y)`. Wave approval then covers only the rows not built yet.

## Tasks & Acceptance

**Execution (wave 1):**
- [ ] `packages/ui` -- set up shadcn CLI (`components.json`), Radix/`radix-ui` as needed, and move the icon set in -- one source for primitives and icons.
- [ ] `packages/ui/src/*` -- build the wave 1 registry rows to the matrix above, with tests.
- [ ] `apps/dashboard/app/(dev)/ui/page.tsx` -- gallery of every component in AR/EN, light/dark, reduced motion.
- [ ] `apps/dashboard` -- mount the Toaster once in the merchant layout; migrate ProductStates to Alert, EmptyState and Skeleton.
- [ ] Design pass with the `impeccable` skill on the gallery (critique, polish, audit) before review.

**Acceptance Criteria:**
- Given the gallery page, when viewed in Arabic and English, light and dark, then every wave 1 component matches DESIGN.md and passes an AA contrast check.
- Given `prefers-reduced-motion: reduce`, when any wave 1 component renders, then nothing animates.
- Given `next build`, when compared with the previous build, then the added first-load JS for `/products` is reported and stays under 15 KB gzip for wave 1.
- Given the Products page, when its states render, then they use the kit's Alert, EmptyState and Skeleton with no visual regression.
- Given `pnpm turbo run lint typecheck test build`, then all packages pass.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

- Sources: shadcn/ui is the base (copied in, restyled). React Bits and Skiper UI are references for motion and polish ideas; copy code only when its licence allows and the result meets the motion and performance rules.
- Motion budget: hover/press 120-160 ms, enter/exit 180-240 ms, ease-out in, ease-in out. Toast and Sheet enter/exit are the only expected candidates for a JS animation library; try CSS first.
- Wave 1 budget of 15 KB gzip covers Radix pieces that wave 1 needs (Toast) plus the components; most wave 1 components are static and need no JS.

## Verification

**Commands:**
- `pnpm turbo run lint typecheck test build --continue` -- expected: all pass.

**Manual checks:**
- Gallery at `http://localhost:3003/ui` in AR/EN, light/dark, and with reduced motion on (OS setting or DevTools emulation).

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
- Accessibility: WCAG 2.1 AA (text 4.5:1, UI 3:1), visible single 2px amber focus outline at zero offset with no gap (system Highlight in forced colors), correct roles and live regions, keyboard operable, 24px minimum targets. Keep original component fills and selected colors; focus polish must not recolor tabs, sidebar items, checkboxes, switches or options.
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

### LivePreviewPanel (dashboard editor, Story 3.12)

`apps/dashboard/components/content/editor/LivePreviewPanel.tsx` embeds the real
player in the existing end-side responsive editor column. Uses the established
rounded-lg 9:16 ink bezel, shared Button for Retry, small warning text for the
always-visible safety note, and logical layout utilities. No shared tokens changed.
The small-screen toggle and medium sticky button preserve the existing editor flow.

States: save-first (no request), loading (polite announcement and skeleton after
150 ms), saved player, startup/fetch/media failure with Retry, and retained valid
view on refresh error. Skeleton animation obeys reduced motion. Arabic/English
titles and messages are localized; iframe title names the saved-content preview.
Only saved server snapshots trigger manifests, and the persistent iframe receives
locale changes through the v1 update protocol. Parent owns authentication and blob
cleanup; the child makes no commerce or analytics connections.

| Wave | Component | Covers | Status |
|------|-----------|--------|--------|
| 1 | Button (+ Spinner) | primary, secondary, accent, ghost, destructive; sizes 32/36/44; pending; unavailable-with-reason | built (Story 2.3) |
| 1 | Progress | linear determinate and indeterminate (uploads, sync, processing) | built (UI rework) |
| 1 | Meter | plan usage: 6px bar, 80% warning, 100% destructive, "n of m" text | built (UI rework) |
| 1 | Alert | inline info / success / warning / danger with optional action (block errors with Retry); role alert for danger/warning, status otherwise | built (UI rework) |
| 1 | Banner | page-level in-flow strip: warning (offline), danger (disconnected) | built (UI rework) |
| 1 | Toast + Toaster | pre-mounted live region, F8, bottom-start, action toasts persist | built (Story 2.3) |
| 1 | EmptyState | sentence + optional action/link; filtered-empty variant | built (UI rework) |
| 1 | Skeleton | boneyard-based blocks, shimmer off under reduced motion | built (UI rework) |
| 2 | Tooltip | KPI definitions, help text | built (UI rework) |
| 2 | Popover | rich help content; Radix Popover (`radix-ui`) is in the kit as the Combobox popup (anchored to the input, focus kept in the input, `pop-in`/`pop-out`); a standalone `Popover` export comes with its first help-content use | built (Story 3.4, inside Combobox) |
| 2 | Dialog, ConfirmDialog, Sheet | destructive confirm naming the item (alertdialog, Cancel focused first), sheet from the inline-start edge (mobile nav) | built (UI rework) |
| 2 | AlertDialog + global `dialog.confirm()` / DialogHost | one alert look for every confirm: tone medallion (neutral / warning / danger, icon override), blur-in scrim, panel rises out of a soft blur, one ripple from the medallion; Radix AlertDialog (no outside-click dismiss, Cancel focused); async `onConfirm` stays open + pending, stays open on reject; imperative store like `toast()`, host mounted once in the merchant layout; ConfirmDialog is now a controlled wrapper of the same view. Used by Sign out | built (UI rework 3) |
| 2 | Sidebar (shadcn) | collapsible icon rail pinned to the viewport's inline-start edge (both directions), width animates with a spacer in flow, state in the `sidebar_state` cookie read on the server (no first-paint shift), Ctrl/Cmd+B, rail strip, tooltips towards the inline end when collapsed, sheet below md (replaces MobileNav) | built (UI rework 3) |
| 2 | DropdownMenu | row menus | built (UI rework) |
| 3 | Field, Input, PasswordInput, Select, Textarea, Switch, Checkbox | one control look (`control.ts`), Field wires id/aria-describedby/aria-invalid via context; no native `<select>` or pickers anywhere | built (UI rework) |
| 3 | ErrorSummary | form error summary on submit: danger tint, `role="alert"`, focuses itself on mount and on each `focusKey` change, one link per error that focuses its field (ids from Field `htmlFor`); renders nothing without items; copy via props | built (Story 3.3) |
| 3 | OtpInput | LTR digit group, paste + iOS one-time-code autofill, Home/End/arrows | built (UI rework) |
| 3 | Combobox | product picker: generic `Combobox<T>` (APG combobox + listbox popup on Radix Popover): search Input with `role="combobox"`, `aria-expanded`/`aria-controls`/`aria-activedescendant`, ArrowUp/Down move, Enter picks (never submits the form), Escape closes and keeps the text, click picks without moving focus; caller owns options/search; `status` ready/loading/error with empty, loading and error (Retry) contents via props | built (Story 3.4) |
| 1 | Badge (+ StatusChip on top of it) | bordered pill: 7 tones x soft/solid/outline, sm/md/lg, icon or (pulsing) dot, glass; trust marks, plans, counts, deltas, statuses. StatusChip: `variant` soft/outline and a leading `icon` node replacing the dot (ended, archived); pulse static under reduced motion | built (UI rework 2; outline/icon Story 3.2) |
| 1 | DataTable | TanStack headless + shadcn Table: 56px rows, sortable headers (`aria-sort`), card list below `md`; optional `onRowActivate` (row `tabIndex=0`, click or `Enter` opens; clicks on controls/portals ignored) and `rowClassName` (e.g. failed 6% tint) | built (Story 2.2; row activation Story 3.2) |
| 3 | DropZone | media uploader: dashed `input-border` zone (`rounded-lg`, the base radius), title + limits hint via props, a "Choose files" Button that opens the native picker (Enter/Space; a click on the zone does too), hidden `accept`/`multiple` file input out of the tab order, drag-over state (static under reduced motion), `disabled` with a visible reason (e.g. slide cap); emits `File[]` in drop order, the caller pre-checks and uploads | built (Story 3.6) |
| 3 | Tabs (also the segmented control) | status tabs, Stories/Reels toggle | built (UI rework) |
| 3 | ThemeToggle (+ THEME_INIT_SCRIPT) | animated sun/moon morph driven by the `dark` variant, circular View Transition reveal, saved choice applied before paint | built (UI rework) |
| 1 | Pagination | named `<nav>` pager: "from-to of total" summary, optional rows-per-page Select (caller-given sizes), Previous/Next Buttons disabled at the ends; copy via props; Products uses 10/25/50 (default 10) kept in the URL | built (Products page size) |

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

### Review Findings

Code review 2026-11-03 (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor) of the uncommitted UI rework.

- [x] [Review][Decision] Motion runs past the budget in Design Notes (enter/exit 180-240 ms): alert-in 360 ms, scrim-in 260 ms, rise-in 480 ms, medallion ripple 900 ms, ring-draw 1100 ms, sidebar width 300 ms, theme reveal 520 ms. Trim the code to the budget, or keep the reworked motion and widen the budget. Resolved 2026-11-03: trimmed to budget (scrim 220, alert 240, rise 240, sidebar 200 ms); medallion icon + ripple, logo ring draw + dot pop and theme reveal kept as named decorative exceptions in globals.css.
- [x] [Review][Patch] Fused class `sm:p-7text-card-foreground` in Dialog and AlertDialog [packages/ui/src/dialog.tsx:49] — fixed during review
- [x] [Review][Patch] OTP: deleting with an Android soft keyboard (empty `change`, key `Unidentified`) is ignored and the digit snaps back [packages/ui/src/otp-input.tsx:72]
- [x] [Review][Patch] OTP: pasting text with no digits wipes the typed code [packages/ui/src/otp-input.tsx:112]
- [x] [Review][Patch] OTP: typing into a slot past the entered digits lands in an earlier slot while focus jumps ahead [packages/ui/src/otp-input.tsx:80]
- [x] [Review][Patch] OTP: `setDigit` comment says nothing shifts; the code shifts later digits left [packages/ui/src/otp-input.tsx:67]
- [x] [Review][Patch] Select ships a test-only DOM `change` bridge; real item selection (and the `""` item) is untested [packages/ui/src/select.tsx:58]
- [x] [Review][Patch] Search input with `dir="auto"`: the group wrapper resolves LTR, so the icon and padding sit on opposite sides once Arabic is typed [packages/ui/src/input.tsx:41]
- [x] [Review][Patch] PasswordInput reveal toggle stays active when the field is disabled [packages/ui/src/input.tsx:70]
- [x] [Review][Patch] Ctrl+B never fires on an Arabic keyboard layout (`event.key` is not `b`) [packages/ui/src/sidebar.tsx:66]
- [x] [Review][Patch] SidebarRail hairline offset in RTL (physical `-translate-x-1/2`) [packages/ui/src/sidebar.tsx]
- [x] [Review][Patch] Banner `danger` (store disconnected) is announced politely (`role="status"`) [packages/ui/src/banner.tsx:39]
- [x] [Review][Patch] Progress indeterminate bar runs left-to-right in RTL [packages/ui/src/styles/globals.css]
- [x] [Review][Patch] EmptyState `filtered` variant is not compact as documented [packages/ui/src/empty-state.tsx:21]
- [x] [Review][Patch] Set/reset password lost the "Back to login" link [apps/dashboard/components/auth/NewPasswordForm.tsx]
- [x] [Review][Patch] Tests: `cn` keeps `text-button*` sizes alongside text colours [packages/ui/src/components.test.tsx]
- [x] [Review][Patch] Tests: Tabs switching and OTP keyboard (Backspace, arrows, Home/End); drop `expect(Input).toBeDefined()` [packages/ui/src/interactive.test.tsx]
- [x] [Review][Patch] Tests: NewPasswordForm validation and VerifyOtpForm `invalid_otp` branch [apps/dashboard/components/auth]
- [x] [Review][Patch] Tests: sign-out asks first, signs out on confirm only [apps/dashboard/components/session/SessionActions.tsx]
- [x] [Review][Patch] Tests: mobile sidebar sheet opens and closes after a nav click [packages/ui/src/sidebar.tsx]
- [x] [Review][Defer] Hard-coded colours outside tokens (Salla button teal, DotField canvas RGB, `bg-black/40` scrims) [apps/dashboard/components/auth/SallaButton.tsx] — deferred: partner brand colour and canvas need a token-reading helper; revisit with the next design pass
- [x] [Review][Defer] Skeleton is not boneyard-based yet [packages/ui/src/skeleton.tsx] — deferred: registry row says boneyard; wire it when the first skeleton-heavy page lands
- [x] [Review][Defer] Wave-1 acceptance items open: Products states not on kit Alert/EmptyState/Skeleton, budget report, AA check, impeccable pass [apps/dashboard/components/products/ProductStates.tsx] — deferred: close with the wave-1 sign-off
- [x] [Review][Defer] Two icon sets in the dashboard (`components/shell/Icon` and kit `Icon`) [apps/dashboard/components/shell/AppShell.tsx] — deferred: migrate shell icons to the kit

Rejected:
- false — VerifyOtp back arrow points the wrong way in RTL: `arrow` has `mirror`, so mirror + rotate points to the inline start.
- false — NewPasswordForm stays pending if `onSubmit` rejects: the auth client catches network errors and never rejects.
- false — inline theme script blocked by CSP: the dashboard sets no CSP.
- false — Arabic 600 weights render 700: DESIGN.md says semibold resolves to 700 in Arabic.
- false — duplicate nav landmark on mobile: the desktop container is hidden below `md`.
- fix edits a spec — DESIGN.md h3 note vs Typography; change-log order.
- low — OTP `onComplete` re-fires on a changed full code; ThemeToggle label before hydration, `onThemeChange` timing, storage key removal; `dialog.confirm()` with no host; Cancel inert while pending; mobile sheet left open when widening; Meter/Progress with NaN/Infinity; Select sentinel in a posted form; orphan `shell.openMenu` message; Alert dismiss label not enforced by type; focus after `invalid_otp`; `*:hover` scrollbar rule cost; search cancel button hidden; DotField reduced-motion change mid-session; Checkbox indeterminate / DropdownMenu extras (built on demand).

## Implementation Notes

## Spec Change Log

- 2026-11-11 — Follow-up form-control polish: thinner 1px focus outline at 80% opacity, zero gap, a faded `0 2px 8px` amber shadow at 14%, and a faint hover outline/shadow on fine-pointer devices. Shared Input, Textarea, Select trigger and OTP styling use the same treatment. Invalid borders and forced-color focus are preserved. UI tests, softened-outline contrast checks, lint and desktop/mobile browser inspection in both themes pass; Impeccable detector reports no findings.

- 2026-11-11 — Corrected the scope of focus polish after user review: removed teal tokens and restored original component colors (coral sidebar/checkbox/switch, neutral tabs and options). Only focus uses amber, with a darker light-theme shade for contrast; input border and outline meet with zero gap. Upload feedback and language switching are retained.
- Verification: UI 101 tests and 71 affected dashboard tests pass; UI/dashboard lint passes. Rebuilt the shared UI for the running local server. Chromium at 1440px English and 390px Arabic, light/dark, confirms matching input border/outline colors and zero outline offset, plus original coral checkboxes and neutral active tabs. Component sources for sidebar, tabs, checkbox, switch, select, dropdown and combobox match the pre-teal versions. Impeccable detector: no findings.

- 2026-11-01 — UI rework 4: Arabic font -> Tajawal (digits come from Figtree, so still tabular); auth layout responsive to height: illustration and headline scale with dvh, stats hide under 760px tall and the reels under 600px, form spacing tightens; checked 1024x640 to 1920x1080 with no page scroll and no panel clipping.

- 2026-11-01 — UI rework 3: Arabic font Rubik -> Alexandria (Tajawal rejected: no tabular digits); auth panel 50/50 and wider, brand panel text not selectable, showcase simplified to three abstract fanned reels + a quiet stats line.

- 2026-11-01 — UI rework 2: Badge component (StatusChip now wraps it, so every status pill is bordered); fonts changed to Figtree (Latin) + Rubik (Arabic) in DESIGN.md and globals.css; auth brand panel content centred, new showcase card (story rings, reel with product sheet, stats), DotField gets an edge fade and an idle drifting light.

- 2026-11-01 — UI rework (outside a story, on request): finished wave 1-3 rows above; moved the auth pages, Products filters and mobile nav onto the kit (no native select/dialog left); new logo mark (ring open at the top-end with a story dot, S from two stacked arcs) in `public/brand` and as the inline `LogoMark`; auth layout is one screen with no inner scroller (iframe rule); canvas DotField background on the auth brand panel (original code, React Bits Dot Grid as reference only).

- 2026-11-03 — Dialog and button polish: button labels use their own type steps `text-button-sm/-/-lg` (13/14/15px, tight leading; `lg` was 16px body-lg); Dialog anatomy is Header / new `DialogBody` / Footer at 24px apart, padding 24 → 28px from `sm`, footer split off by a full-bleed divider with full-width stacked buttons on phones; AlertDialog widened to 416px with more room between medallion, text and actions.

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

### Player preview (Story 3.11)

Owner: `packages/player`, entry `@slips/player/preview`, shared viewer `@slips/player/viewer`. This is a Preact Shadow DOM component with system fonts and no React/Tailwind/UI-kit runtime imports. It renders the first StoreManifest v1 item and its ordered slides in a 9:16 stage. Locale controls host direction and merchant text uses `dir="auto"`.

Visual tokens: ink #15110f, amber #ffc23d CTA text, white product surface, muted #615954, coral #ff4a3d focus; 4px spacing and 12–16px corners. The player README registers the full `--slips-*` property/default table. Native video controls stay unobstructed; title/product names wrap within bounded areas, navigation and the localized safety note stay visible.

States: complete image/video, processing poster/inspected-source fallback, empty item/slides, missing/failed media, missing/deleted product, limited/out-of-stock, required options, disabled CTA, keyboard focus and localized simulated feedback. Text is never interpreted as HTML. Preview actions exclusively use MockStorefrontPlatform; no real cart, navigation or analytics.

Integration boundary: explicit API base and parent origin, exact-source/origin versioned handshake, validated updates without iframe reload, parent-owned authenticated fetching and blob lifetime. Dashboard phone frame, editor layout and loading/retry composition belong to Story 3.12. Existing DESIGN.md is preserved.

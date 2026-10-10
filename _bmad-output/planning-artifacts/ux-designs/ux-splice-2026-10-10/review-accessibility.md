# Accessibility Review: Slips UX spines (DESIGN.md + EXPERIENCE.md)

Lens: WCAG 2.1 AA (dashboard); "AA except captions" (NFR6, storefront player). Date: 2026-10-10. Spines not modified.

## Verdict

**Pass with fixes.** The colour system is mostly sound. The headline pairs check out: ink on coral is 5.63:1, all `-text` status variants are 5.6:1 or better, and dark mode is strong. The Accessibility Floor covers the right areas. Before build, fix 0 critical, 5 high, 10 medium and 6 low findings. The high ones are: an undo toast you cannot reach with a keyboard, focus lost when the CTA becomes disabled, slide reordering that needs drag, the input border failing non-text contrast, and the delta-up colour failing for text.

## Contrast check (computed, WCAG relative luminance)

| Pair | Ratio | Need | Result |
|---|---|---|---|
| ink #15110F / coral #FF4A3D | 5.63 | 4.5 | pass |
| ink / dark coral #FF6A5C | 6.67 | 4.5 | pass |
| white / coral | 3.33 | 4.5 | fail (already forbidden for text) |
| coral ring / white | 3.33 | 3 | pass |
| coral ring / page #FAF8F6 | 3.15 | 3 | pass (thin margin) |
| coral ring at 50% (`outline-ring/50` in globals.css) / white | ~1.8 | 3 | **fail** |
| dark ring #FF8A7E / dark card | 7.86 | 3 | pass |
| info-text #B8291A / white | 6.23 | 4.5 | pass |
| #3A2600 / amber | 8.95 | 4.5 | pass |
| amber / ink (player CTA) | 11.65 | 4.5 | pass |
| muted-fg / muted, page (light) | 6.19 / 6.47 | 4.5 | pass |
| muted-fg dark / muted-dark, card-dark | 6.27 / 6.91 | 4.5 | pass |
| white / destructive #C0123C | 6.19 | 4.5 | pass |
| destructive-text / white | 8.33 | 4.5 | pass |
| #1A0306 / dark destructive | 6.70 | 4.5 | pass |
| success #1BAA5A / white | 3.02 | 3 (graphic) | pass as graphic only |
| **white / success (`--success-foreground` in globals.css)** | 3.02 | 4.5 | **fail** if used for text |
| success-text / white | 6.35 | 4.5 | pass |
| warning-fg / warning | 8.17 | 4.5 | pass |
| warning-text / white | 6.33 | 4.5 | pass |
| **delta-up #178A4A / white (12px text)** | **4.40** | 4.5 | **fail** |
| delta-down #C0123C / white | 6.19 | 4.5 | pass |
| delta up/down dark | 9.18 / 7.24 | 4.5 | pass |
| **celebration label, 80% ink on coral (13px)** | **4.42** | 4.5 | **fail** |
| status chips: Scheduled / Published / Failed / Deactivated (text on tint) | 5.67 / 5.60 / 7.31 / 5.82 | 4.5 | pass |
| **border #ECE8E4 / white (input boundary)** | **1.22** | 3 | **fail (1.4.11)** |
| border dark / card dark | 1.24 | 3 | fail for input boundary |
| seen ring #D3CDC8 / white | 1.57 | 3 | fail as sole state cue |
| amber ring end / white | 1.61 | 3 | partial (the coral half carries it) |
| chart-4 #F5A300 / white | 2.07 | 3 | **fail** |
| chart-3 / chart-5 / white | 3.38 / 3.43 | 3 | pass |
| progress white / 35% white track over black | 7.0 | 3 | pass on dark frames |
| progress white / bright video frame | ~1.0 | 3 | **fail with no scrim** |
| white overlay text / 60% black scrim over white frame | 5.74 | 4.5 | pass |

## Findings

### High

**H1. Undo toast cannot be reached in time with a keyboard (2.1.1, 2.2.1)**
Location: EXPERIENCE > Interaction Primitives > Dashboard (Toasts, Destructive actions); UJ3 step 6.
Archive "is undoable via toast" and the toast auto-dismisses after 5 s. Pause is on hover or focus, but a keyboard or screen-reader user cannot get focus to the toast before it goes.
Fix: give toasts with actions no auto-dismiss, or at least 10 s plus a hotkey (Sonner's `F8` / `alt+T` region hotkey). Announce "Archived. Undo available" politely. Also offer Restore from the Archived row so undo never relies on the toast alone.

**H2. Disabling the CTA during pending drops focus (2.4.3, 4.1.3)**
Location: EXPERIENCE > Component Patterns > Product card + CTA; the Out of stock row.
"pending (spinner, CTA disabled)" and "Disabled CTA 'Out of stock'". A native `disabled` button loses focus and drops out of the tab order, so focus falls to `body`, which may sit outside the trap. Screen readers then skip the out-of-stock reason.
Fix: use `aria-disabled="true"` plus `aria-busy`, and keep focus on the CTA. Announce the result through a live region that exists before it is filled. Out of stock stays focusable with the name "Out of stock".

**H3. Slide reordering has no keyboard alternative (2.1.1)**
Location: EXPERIENCE > Media uploader ("Reorderable slides"); Products filter.
Fix: add "Move earlier" / "Move later" buttons or menu items on each slide (or dnd-kit keyboard sensor with announcements). Name the directions by logical position, not left/right, so they work in RTL.

**H4. Input and control borders fail non-text contrast (1.4.11)**
Location: DESIGN frontmatter `border`, `components.input`, `button-secondary`; globals `--input`.
#ECE8E4 is 1.22:1 on white and the dark value is 1.24:1. Inputs and outline buttons have no other visible boundary.
Fix: add an `--input` token of about #8F8681 light (at least 3:1) and about #6E6560 dark. Keep `--border` for decorative card dividers.

**H5. Delta-up green and the celebration label fail text contrast (1.4.3)**
Location: DESIGN > Components > KPI tile (delta up #178A4A, 12px); `kpi-tile-celebration.label` #15110FCC. These are 4.40:1 and 4.42:1. The DESIGN "verified" block misses both.
Fix: change delta-up to #127A41 or darker (use `success-text` #0E6E39, 6.35:1). Make the celebration label solid ink, or at least 90% opacity.

### Medium

**M1. Focus ring at 50% opacity in globals.css.** Location: tokens/globals.css line 76, `outline-ring/50`. This gives about 1.8:1 and contradicts DESIGN's "2px ring, 2px offset". Fix: set the outline to `ring` at full opacity, with `outline-offset: 2px`.

**M2. Focus ring on coral surfaces.** Location: DESIGN > Elevation (focus ring), the primary button, the active nav pill, the celebration tile (which links to Analytics). The coral ring against the coral fill is 1:1, so visibility depends entirely on the 2px offset gap. Fix: specify a two-tone ring (2px page-colour gap plus 2px ink `#15110F` ring) for coral fills, or an ink ring everywhere in light mode. Also state that ring-offset colour = surface colour in dark mode.

**M3. Seen and unseen rings differ by colour only, and the ring has no accessible name.** Location: DESIGN story-ring; EXPERIENCE Story ring. Fix: make each item a `button` named "{title}, story, new" or "...seen", with `aria-describedby` to the product name. The label under the ring must not be truncated in the accessible name. Optionally make the seen ring thinner (shape cue).

**M4. Progress segments: no semantics, and invisible on bright frames.** Location: EXPERIENCE Viewer; DESIGN `player-progress`. Fix: render a top gradient scrim behind the progress bar (at least 3:1 on any frame). Give the group a visually hidden "Slide 2 of 5" (`aria-live=off`; announce on manual navigation only). Do not use a ticking `progressbar` value that floods screen readers.

**M5. Reduced-motion end of slide is undefined (2.2.2).** Location: EXPERIENCE Accessibility Floor > Motion; gestures. With no auto-advance, what happens when a video slide ends (loop, freeze on last frame, or show a "Next" prompt)? Do Reels autoplay the next item under reduced motion? Should muted autoplay start at all under reduced motion? Fix: under reduced motion, specify that the video stops on its last frame with a focusable Next control, and that autoplay is off (poster plus Play) or pausable within 5 s. Also note that the visible Pause button is required in every mode, not only reduced motion. The spine already does this; keep it.

**M6. Keyboard map gaps in the player.** Location: Interaction Primitives > Player gestures. `PageUp`/`PageDown` for Story groups is marked as an assumption and the button alternative is "—", which contradicts "Every swipe has a button alternative". Arrow keys in RTL are correct, but the spine must say they are bound to `dir` of the viewer, not the page. The Next/Prev buttons are only "visible on focus/desktop", which leaves no touch-visible alternative for users of switch control or voice control. Fix: add Next/Prev group buttons, make tap zones real `button`s with names ("Next slide", "Previous slide") so voice control works, and state that single-key shortcuts (`M`, `K`) only work while focus is inside the viewer (2.1.4).

**M7. Viewer dialog semantics in the host page.** Location: EXPERIENCE Viewer, floating bubble. Fix: `role="dialog"`, `aria-modal="true"`, a name ("{merchant} stories"). Set `inert` on the host page siblings, because the Shadow DOM cannot trap reliably on its own. Initial focus goes to Close or Pause, not the video. If the entry no longer exists (bubble dismissed, carousel re-rendered), return focus to the nearest stable entry or `body` start. Block background scroll.

**M8. Form errors and session expiry.** Location: State Patterns > Error Form; Iframe. Fix: on submit, move focus to the error summary (`role=alert`, `tabindex=-1`). Use `aria-invalid` and `aria-describedby` on fields. Destructive-text messages need an icon, not colour alone. Iframe token refresh failure or expired session: preserve form data (drafts queued locally) and re-authenticate without losing work (2.2.1). Warn before any server-side timeout that would discard explicit-save edits.

**M9. Hover-only tooltips and chart data.** Location: KPI tile ("Tooltip on label"), UJ3 tooltip, charts. Fix: tooltips must open on focus, be dismissable with `Esc` and be hoverable (1.4.13). Put the §1.5 definition in a disclosure or popover button for touch. Give every chart a visible data table or "View as table". Give chart-4 amber a 3:1 alternative (for example #B87A00) or direct labels.

**M10. Arabic small text legibility.** Location: DESIGN badge 11.5px 600; story ring label 12px truncated; `small` line-height 1.45. Arabic glyphs at 11.5px are hard to read (dots and diacritics). Fix: set a minimum of 12px for Arabic and 13px for badges in `:lang(ar)`, line-height at least 1.5 for Arabic small text, and two lines for ring labels in Arabic. Confirm the player's system stack (`Geeza Pro`, `Noto Sans Arabic`) has an adequate fallback on Windows (Segoe UI is fine) and set `lang` on product names when it differs from the UI.

### Low

**L1.** The globals `--success-foreground: #FFFFFF` on success is 3.02:1. Remove it or set it to ink, so no one puts white text on green.
**L2.** Live regions: the add-to-cart and toast regions must be mounted at viewer or app load (empty), not injected with the message. Use `polite` for success. Add-to-cart failure can be `assertive`. The cart count change should be included in the message ("Added to cart. Cart: 3 items").
**L3.** Skip link inside the Salla iframe: it must target `main` inside the frame. Check that it does not clash with Salla's own skip link, and that `Esc` from shadcn dialogs is not swallowed by the parent frame. Modals are sized to the iframe viewport, so confirm they still fit at 400% zoom / 320 CSS px (1.4.10) with nested scroll avoided.
**L4.** Targets: dashboard sm button 32px and compact rows 40px pass the 24px floor. Make the toast close, row menu triggers and the floating bubble's dismiss "x" explicitly at least 24px (dashboard) or 44px (player). The bubble dismiss is not specified.
**L5.** Processing chip "animated dot": also include the text "Processing". Skeleton shimmer should stop under reduced motion. The celebration line on publish should be announced (status region).
**L6.** Bidi: the Arabic "View options" copy ("اختر المقاس واللون") differs in meaning from the English. Keep the accessible name the same as the visible label in each locale (2.5.3). Chart RTL axis order must match the table order for screen readers.

## Counts

Critical 0 · High 5 · Medium 10 · Low 6

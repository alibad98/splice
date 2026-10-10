---
name: Slips
description: Visual identity for Slips (سليبس), a Salla app for shoppable Stories/Reels — merchant dashboard (shadcn/ui + Tailwind 4) and neutral storefront player. Direction "Studio".
colors:
  background: '#FFFFFF'
  page: '#FAF8F6'
  foreground: '#15110F'
  card: '#FFFFFF'
  primary: '#FF4A3D'
  primary-foreground: '#15110F'
  accent: '#FFC23D'
  accent-foreground: '#3A2600'
  muted: '#F5F3F1'
  muted-foreground: '#615954'
  border: '#ECE8E4'
  input-border: '#8F8681'
  info-text: '#B8291A'
  delta-up: '#0E6E39'
  delta-down: '#C0123C'
  story-ring-seen: '{colors.story-ring-seen}', seenRingWidth: 1.5px
  success-tint: '#1BAA5A1F'
  primary-tint: '#FF4A3D14'
  destructive-tint: '#C0123C14'
  warning-tint: '#FFB54726'
  focus-ring-inner: '#15110F'
  ring: '#FF4A3D'
  destructive: '#C0123C'
  destructive-foreground: '#FFFFFF'
  destructive-text: '#9C0E31'
  success: '#1BAA5A'
  success-text: '#0E6E39'
  warning: '#FFB547'
  warning-foreground: '#3D2500'
  warning-text: '#8A5300'
  chart-1: '#FF4A3D'
  chart-2: '#2B2523'
  chart-3: '#0F9D8A'
  chart-4: '#F5A300'
  chart-5: '#2E8FE0'
  player-scrim: '#000000'
  player-surface: '#FFFFFF'
  player-surface-foreground: '#15110F'
  player-cta: '#15110F'
  player-cta-foreground: '#FFC23D'
  player-progress: '#FFFFFF'
  player-progress-track: '#FFFFFF59'
  background-dark: '#100D0C'
  page-dark: '#0B0908'
  foreground-dark: '#F5F1EE'
  card-dark: '#1A1615'
  primary-dark: '#FF6A5C'
  primary-foreground-dark: '#15110F'
  accent-dark: '#FFC23D'
  accent-foreground-dark: '#3A2600'
  muted-dark: '#241F1D'
  muted-foreground-dark: '#A89F99'
  border-dark: '#2E2826'
  input-border-dark: '#7A716C'
  info-text-dark: '#FFB3A8'
  delta-up-dark: '#3FD27F'
  delta-down-dark: '#FF7A95'
  story-ring-seen-dark: '#4A423E'
  success-tint-dark: '#3FD27F26'
  primary-tint-dark: '#FF6A5C26'
  destructive-tint-dark: '#FF5C8026'
  warning-tint-dark: '#FFC46B26'
  focus-ring-inner-dark: '#FFFFFF'
  ring-dark: '#FF8A7E'
  destructive-dark: '#FF5C80'
  destructive-foreground-dark: '#1A0306'
  destructive-text-dark: '#FFA3B5'
  success-dark: '#3FD27F'
  success-text-dark: '#8AF0B5'
  warning-dark: '#FFC46B'
  warning-foreground-dark: '#3D2500'
  warning-text-dark: '#FFD699'
  chart-1-dark: '#FF6A5C'
  chart-2-dark: '#D9D2CD'
  chart-3-dark: '#2DD4BF'
  chart-4-dark: '#FFC23D'
  chart-5-dark: '#60B4FF'
typography:
  family-latin: { fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }
  family-arabic: { fontFamily: '"IBM Plex Sans Arabic", "Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif' }
  family-player: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Geeza Pro", "Noto Sans Arabic", Tahoma, sans-serif' }
  display: { fontSize: 2.25rem, fontWeight: 800, lineHeight: 1.1, letterSpacing: -0.035em }
  h1: { fontSize: 1.75rem, fontWeight: 800, lineHeight: 1.2, letterSpacing: -0.03em }
  h2: { fontSize: 1.125rem, fontWeight: 700, lineHeight: 1.3, letterSpacing: -0.01em }
  h3: { fontSize: 0.875rem, fontWeight: 650, lineHeight: 1.4, note: 'Arabic falls back to 600 (Plex has no 650)' }
  body: { fontSize: 0.875rem, fontWeight: 400, lineHeight: 1.55 }
  body-lg: { fontSize: 1rem, fontWeight: 400, lineHeight: 1.6 }
  small: { fontSize: 0.75rem, fontWeight: 500, lineHeight: 1.45 }
  kpi: { fontSize: 2rem, fontWeight: 800, lineHeight: 1.1, letterSpacing: -0.02em }
  numerals: { note: 'font-variant-numeric: tabular-nums; Western digits (0-9) in both locales' }
rounded:
  sm: 0.5rem
  md: 0.75rem
  base: 1rem
  lg: 1.375rem
  pill: 999px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '8': 32px
  '10': 40px
  '12': 48px
  gutter: 18px
  page-desktop: 28px
  page-mobile: 16px
components:
  button-primary: { background: '{colors.primary}', foreground: '{colors.primary-foreground}', rounded: '{rounded.pill}', height: 36px, paddingInline: 14px, fontWeight: 600 }
  button-secondary: { background: transparent, foreground: '{colors.foreground}', border: '{colors.input-border}', rounded: '{rounded.pill}', height: 36px }
  button-accent: { background: '{colors.accent}', foreground: '{colors.accent-foreground}', rounded: '{rounded.pill}' }
  badge: { rounded: '{rounded.pill}', fontSize: 11.5px, fontWeight: 600, paddingBlock: 3px, paddingInline: 8px }
  card: { background: '{colors.card}', rounded: '{rounded.base}', padding: 22px, shadow: '0 8px 24px -14px rgba(40,24,16,.16)', shadowDark: '0 8px 24px -14px rgba(0,0,0,.6)' }
  kpi-tile: { background: '{colors.card}', foreground: '{colors.foreground}', rounded: '{rounded.base}', padding: 20px, value: '{typography.kpi}', label: '{colors.muted-foreground}', deltaUp: '{colors.delta-up}', deltaDown: '{colors.delta-down}' }
  kpi-tile-celebration: { background: '{colors.primary}', foreground: '{colors.primary-foreground}', label: '{colors.primary-foreground}', delta: '{colors.primary-foreground}', rounded: '{rounded.base}', padding: 20px, value: '{typography.kpi}' }
  input: { background: '{colors.background}', border: '{colors.input-border}', rounded: '{rounded.md}', height: 36px, focusRing: '{components.focus-ring}' }
  focus-ring: { inner: '{colors.focus-ring-inner}', outer: '{colors.ring}', width: 2px, offset: 0, opacity: 1, note: 'two-tone: 2px ink ring + 2px coral halo (dark: white inner + ring-dark); visible on coral fills' }
  status-published: { background: '{colors.success-tint}', foreground: '{colors.success-text}', dot: '{colors.success}' }
  status-scheduled: { background: '{colors.primary-tint}', foreground: '{colors.info-text}', dot: '{colors.primary}' }
  status-draft: { background: '{colors.muted}', foreground: '{colors.muted-foreground}', dot: '{colors.muted-foreground}' }
  status-failed: { background: '{colors.destructive-tint}', foreground: '{colors.destructive-text}', dot: '{colors.destructive}' }
  status-ended: { background: '{colors.muted}', foreground: '{colors.muted-foreground}', dot: none, style: 'outline border {colors.border}' }
  status-deactivated: { background: '{colors.warning-tint}', foreground: '{colors.warning-text}', dot: '{colors.warning}' }
  status-processing: { background: '{colors.primary-tint}', foreground: '{colors.info-text}', dot: '{colors.primary}', dotAnimation: 'pulse; static under reduced motion' }
  status-archived: { background: '{colors.muted}', foreground: '{colors.muted-foreground}', dot: none, style: 'outline border {colors.input-border}, archive icon' }
  story-ring: { size: 68px, ringWidth: 2.5px, gap: 2.5px, gradient: 'conic {colors.primary} -> {colors.accent}', seen: '#D3CDC8', avatarRounded: '{rounded.pill}' }
  player-product-card: { background: '{colors.player-surface}', foreground: '{colors.player-surface-foreground}', rounded: '{rounded.lg}', padding: 12px, thumb: 56px }
  player-progress-bar: { fill: '{colors.player-progress}', track: '{colors.player-progress-track}', height: 2px, gap: 4px, scrim: 'top gradient {colors.player-scrim} 50% -> transparent, 64px' }
  toast: { background: '{colors.foreground}', foreground: '{colors.background}', rounded: '{rounded.md}', action: '{colors.primary}' }
  banner: { warning: '{colors.warning-tint}', danger: '{colors.destructive-tint}', foreground: '{colors.foreground}', border: '{colors.input-border}' }
  player-cta: { background: '{colors.player-cta}', foreground: '{colors.player-cta-foreground}', rounded: '{rounded.pill}', height: 48px, fontWeight: 700 }
---

# Slips — Visual Identity ("Studio · Coral")

Reference mockup: [mockups/identity-studio-coral.html](mockups/identity-studio-coral.html) (dashboard Overview, player, Arabic KPI row, states). Logo assets: [brand/](brand/) ([logo sheet](brand/logo-sheet.html)). This spine and EXPERIENCE.md win over any mockup on conflict; e.g. the Arabic UI uses Western digits 0-9 even where the mockup shows Arabic-Indic digits.

## Brand & Style

Energetic and social, built with precision. Slips sells creator-tool energy (Stories, Reels, a ring that begs to be tapped) to merchants who need a dashboard that reads like Linear or Stripe: crisp edges, quiet chrome, data that tells the truth. The energy lives in two places only: hot coral `{colors.primary}` and sunny amber `{colors.accent}`. Everything else is calm.

**Voice: friendly coach.** Warm, short, encouraging. Celebrate wins in one line ("أول مبيعة من قصة! 🎉" is wrong — no emoji; "أول مبيعة من قصة. أحسنت." is right). Errors say what happened and the next step. Never blame the merchant.

**Arabic-first.** Designs are drawn RTL first; English is the mirror, not the master.

### Logo & Wordmark

- **Mark** (`brand/logo-mark.svg`): a story ring (coral→amber gradient arc, open at the top-end like a "new story" indicator) around a geometric bold "S" built from two stacked arcs. Outlined paths, legible at 16px.
- **Wordmarks**: `brand/logo-wordmark-en.svg` ("Slips", Plus Jakarta Sans 800, −0.03em) and `brand/logo-wordmark-ar.svg` ("سليبس", IBM Plex Sans Arabic 700). Use the mark at the inline-start of the wordmark (right side in RTL).
- On coral backgrounds the mark uses an ink `{colors.foreground}` S with a white→amber arc (`brand/logo-mark-on-coral.svg`, filename kept). The app icon is a coral tile with an ink S and amber ring. Minimum clear space = the S stroke width × 2. Never recolor the ring to a single flat color except mono (all `{colors.foreground}` or all white).
- Sheet: `brand/logo-sheet.html`.

## Colors

| Role | Light | Dark | Use |
|---|---|---|---|
| primary | #FF4A3D | #FF6A5C | Primary buttons (ink text), active nav, chart-1, celebration tile; links use `{colors.info-text}` |
| accent | #FFC23D | #FFC23D | Highlights, player CTA text, ring end. Fill only — never text on light surfaces |
| success | #1BAA5A (text #0E6E39) | #3FD27F (text #8AF0B5) | Published, positive state |
| warning | #FFB547 (text #8A5300) | #FFC46B (text #FFD699) | Deactivated, plan limits |
| destructive | #C0123C (text #9C0E31) | #FF5C80 (text #FFA3B5) | Failed, delete |
| muted / muted-foreground | #F5F3F1 / #615954 | #241F1D / #A89F99 | Secondary surfaces and copy |

Charts: series in order chart-1..5; never encode meaning by color alone (legend + label).

**WCAG AA (verified):**
- **Button text rule: ink on coral, always.** #15110F on #FF4A3D = 5.63:1; #15110F on #FF6A5C (dark primary) = 6.67:1 — pass. White on #FF4A3D = 3.33:1 — forbidden for text (applies to buttons, active nav pills, celebration tile, avatars).
- Coral as a graphic on white = 3.33:1 (passes 3:1 non-text); never body text on white — use `{colors.info-text}` (6.23:1) for links and coral-toned text; `{colors.info-text-dark}` on card-dark = 10.5:1.
- Control boundaries (inputs, outline buttons, checkboxes) use `{colors.input-border}` (3.56:1 on white) / `{colors.input-border-dark}` (3.77:1 on card-dark). `{colors.border}` is for decorative dividers only.
- KPI delta: up `{colors.delta-up}` 6.35:1, down `{colors.delta-down}` 6.19:1; dark 9.18 / 7.24. Celebration tile label is solid ink (5.63:1).
- Seen story ring is not a sole state cue: it is also thinner and the accessible name says "seen".
- #3A2600 on amber #FFC23D = 8.95:1; amber on #15110F (player CTA) = 11.65:1 — pass. White on amber is forbidden.
- Muted-foreground on muted: #615954 on #F5F3F1 = 6.19:1 light; #A89F99 on #1A1615 = 6.91:1 dark.
- **Fixes:** destructive is a deeper crimson **#C0123C** (white on it 6.19:1; text #9C0E31 = 8.33:1) so it never reads as coral. Dark destructive #FF5C80 takes **#1A0306** text (6.7:1). Success #1BAA5A is 3.0:1 on white → never text; status text uses **#0E6E39** (6.35:1). Charts: coral, charcoal, teal, amber, sky (light #FF4A3D/#2B2523/#0F9D8A/#F5A300/#2E8FE0; dark #FF6A5C/#D9D2CD/#2DD4BF/#FFC23D/#60B4FF), no purple; graphics-only, never text. Status badges and destructive states always carry a label/icon, never colour alone, so coral/red/amber are never confused.

## Typography

- **Arabic UI:** IBM Plex Sans Arabic 400/500/600/700. No negative letter-spacing on Arabic, ever; no all-caps concept; line-height ≥1.55 for body. Arabic display uses 700 (Plex has no 800).
- **Latin UI:** Plus Jakarta Sans 400–800; display/headings 800 with tight tracking (scale in frontmatter). Base size 14px (`{typography.body}`), airy.
- Font stack order follows `lang`: `:lang(ar)` puts Plex Arabic first; Latin glyphs inside Arabic text fall back to Jakarta.
- **Numerals:** Western digits (0-9) in both locales (Salla convention), `tabular-nums` everywhere numbers align (KPIs, tables, prices). KPI values use Jakarta 800 even in Arabic UI.
- **Bidi:** wrap numbers, SKUs, URLs, and currency amounts in `<bdi>` / `dir="ltr"` isolates; currency follows locale ("1,250 ر.س" / "SAR 1,250"). Percentages keep the sign with the number inside the isolate.

## Layout & Spacing

- 4px base scale; card gutter 18px; page padding 28px desktop / 16px mobile.
- **Logical properties only:** `margin-inline-start`, `padding-inline`, `inset-inline-end`, `text-align: start`. Tailwind: `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`. Directional icons (chevrons, arrows) flip in RTL; media/playback icons do not.
- **Dashboard grid:** 12-col, max 1360px. KPI row = 4 tiles (2×2 at <1024px, 1 col at <640px; the celebration tile is first in reading order). Main row 8/4 (trend chart / funnel), list row 8/4.
- Embedded in Salla's iframe: no fixed full-viewport chrome; top bar is in-flow.
- Density: comfortable default (row height ~56px with thumbs); tables may go compact (40px) — never smaller.

## Elevation & Depth

Flat by default. Cards and tiles use one soft warm-neutral shadow (`{components.card.shadow}` / `shadowDark`) on a tinted page (`{colors.page}`). Popovers/dialogs add a 1px `{colors.border}` ring. No stacked shadows, no glows except the focus ring `{components.focus-ring}`: full opacity, two-tone (2px `{colors.focus-ring-inner}` ink ring inside a 2px `{colors.ring}` halo; dark: white inner + `{colors.ring-dark}`), so it stays visible on coral fills (primary button, active nav, celebration tile). The player uses the same two-tone ring (white inner, ink outer) on entry points. The player uses a black scrim (60–80%) and white surfaces only.

## Shapes

`{rounded.base}` (16px) for cards and tiles; `{rounded.md}` (12px) for inputs, thumbs and segment controls; `{rounded.sm}` for tiny chips; `{rounded.pill}` for every button, badge and the player CTA; circles for story rings/avatars. Story thumbs are 9:16 rectangles at `{rounded.sm}`. Nested radius = outer − padding.

## Components

- **Button:** pill, 36px (32 sm, 44 lg / touch). Primary coral with ink text; secondary = outline border; accent (amber + dark text) reserved for one "make something" action per screen. Hover: brightness 1.08; disabled 50% opacity.
- **Badge / status:** pill, 11.5px 600, leading 6px dot. One chip per status name in EXPERIENCE.md: `status-draft` (muted), `status-processing` (coral tint, `info-text`, pulsing dot), `status-failed` (crimson tint + row tint 6%), `status-scheduled` (coral tint, `info-text`), `status-published` (green tint, `success-text`), `status-ended` (outline, no dot), `status-archived` (outline + archive icon), `status-deactivated` (amber). Role words map: neutral = draft/ended/archived, info = scheduled/processing, danger = failed, success = published, warning = deactivated. Always a text label, never dot alone. Arabic chips use 12px minimum.
- **KPI tile:** label 13px muted, value `{typography.kpi}` tabular, delta 12px 600 (`{colors.delta-up}` / `{colors.delta-down}`, dark `-dark` variants, always with an arrow icon + sign). **`{components.kpi-tile-celebration}`**: the Revenue tile is solid coral with ink value, solid ink label, ink delta — one per dashboard, never more.
- **Card:** shadcn Card composition; title `{typography.h3}`, 22px padding.
- **Input:** 36px, 12px radius, `{colors.input-border}` → `{components.focus-ring}` on focus; error = destructive border + text-destructive-text message below.
- **Story ring (`{components.story-ring}`):** conic gradient coral→amber ring, 2.5px with 2.5px background gap; seen = flat `{colors.story-ring-seen}`, 1.5px (shape cue as well as colour). Label under, 12px, 1 line truncate.
- **Player product card** (EXPERIENCE: "Player product card + CTA"): white surface, 22px radius, 56px product thumb, name (2 lines), price tabular, inside bottom sheet over the scrim.
- **Player CTA (`{components.player-cta}`):** near-black pill (#15110F) with amber text, 48px, full width — reads on any video frame and any merchant theme.
- **Player progress (`{components.player-progress-bar}`):** segmented white bars on `player-progress-track`, always over a top scrim so they hold 3:1 on bright frames.
- **Viewer controls:** mute / pause / close / next / previous are 44px round buttons, white icon on 40% `player-scrim` disc; arrows visible on desktop, tap zones are named buttons.
- **App shell:** side nav (start side) on `{colors.card}`, active item = coral pill with ink text; top bar in-flow, `{colors.border}` bottom divider; connection chip uses `status-published` / `status-failed` styling.
- **Attribution caption:** `{typography.small}` `{colors.muted-foreground}` + "How we count" link in `{colors.info-text}`.
- **Onboarding checklist:** Card; steps with 20px check circle (`{colors.success}` done, `{colors.input-border}` outline pending).
- **Content table:** shadcn Table in Card; 56px rows with 9:16 thumb; compact 40px; status chip column; row hover `{colors.muted}`.
- **Content editor / Media uploader / Product picker:** shadcn Form + Inputs; uploader is a dashed `{colors.input-border}` drop zone `{rounded.base}`; slide thumbs `{rounded.sm}` with Move earlier/later menu; picker = Combobox with thumb + availability chip.
- **Live preview:** 9:16 phone frame, `{rounded.lg}`, `{colors.foreground}` bezel, persistent `status-scheduled`-style "Preview" note above.
- **Floating bubble:** 56px circle with story-ring gradient, 24px dismiss button (44px hit area) at its top-end.
- **Plan usage meter:** 6px pill bar; fill `{colors.foreground}` <80%, `{colors.warning}` at 80%, `{colors.destructive}` at 100%, always with "8 of 10" text.
- **Support sheet:** shadcn Sheet from the end side; channel rows as secondary buttons.
- **Toast (`{components.toast}`):** ink surface, white text, coral-outlined action button; close button 24px.
- **Banner (`{components.banner}`):** full-width in-flow strip, tint + icon + text + action (offline = warning, disconnected = danger).
- **Skeleton:** `{colors.muted}` blocks with `{rounded.sm}`; shimmer stops under reduced motion.
- **Player rule:** the storefront player uses **neutral Slips styling** (no theme matching in MVP), rendered inside **Shadow DOM** so merchant CSS cannot leak in or out, and uses the **system font stack** (`{typography.family-player}`) — **no web fonts load in the player**.

## Do's and Don'ts

- Do keep coral + amber as the only loud colors; never introduce purple/violet; Don't add gradients outside the logo and story ring.
- Do use the celebration tile once (revenue); Don't make every KPI coral.
- Do use `-text` color variants for status text; Don't put success/warning/amber fills as text on white.
- Do use logical properties and test RTL first; Don't use `left`/`right`/`ml-`/`mr-`.
- Do use tabular Western numerals with bidi isolates; Don't letter-space Arabic.
- Do keep the player neutral, Shadow-DOM-scoped, system-font; Don't load Jakarta/Plex in the storefront.
- Don't use emoji in UI copy.

---
name: Slips
description: Visual identity for Slips (سليبس), a Salla app for shoppable Stories/Reels — merchant dashboard (shadcn/ui + Tailwind 4) and neutral storefront player. Direction "Studio".
colors:
  background: '#FFFFFF'
  page: '#F6F3FC'
  foreground: '#17112B'
  card: '#FFFFFF'
  primary: '#6A2BFF'
  primary-foreground: '#FFFFFF'
  accent: '#C8F25A'
  accent-foreground: '#1C2A00'
  muted: '#F4F1FB'
  muted-foreground: '#5E5873'
  border: '#E9E4F5'
  ring: '#6A2BFF'
  destructive: '#D1242A'
  destructive-foreground: '#FFFFFF'
  destructive-text: '#B3171B'
  success: '#1BAA5A'
  success-text: '#0E6E39'
  warning: '#FFB547'
  warning-foreground: '#3D2500'
  warning-text: '#8A5300'
  chart-1: '#6A2BFF'
  chart-2: '#7FB800'
  chart-3: '#FF6FB5'
  chart-4: '#B69CFF'
  chart-5: '#FFB547'
  player-scrim: '#000000'
  player-surface: '#FFFFFF'
  player-surface-foreground: '#17112B'
  player-cta: '#17112B'
  player-cta-foreground: '#C8F25A'
  player-progress: '#FFFFFF'
  player-progress-track: '#FFFFFF59'
  background-dark: '#0F0B1C'
  page-dark: '#0A0714'
  foreground-dark: '#F2EEFF'
  card-dark: '#181329'
  primary-dark: '#7A45FF'
  primary-foreground-dark: '#FFFFFF'
  accent-dark: '#C8F25A'
  accent-foreground-dark: '#1C2A00'
  muted-dark: '#211A38'
  muted-foreground-dark: '#A49CC0'
  border-dark: '#2D2547'
  ring-dark: '#A784FF'
  destructive-dark: '#FF6166'
  destructive-foreground-dark: '#1A0306'
  destructive-text-dark: '#FFA3A6'
  success-dark: '#3FD27F'
  success-text-dark: '#8AF0B5'
  warning-dark: '#FFC46B'
  warning-foreground-dark: '#3D2500'
  warning-text-dark: '#FFD699'
  chart-1-dark: '#A784FF'
  chart-2-dark: '#C8F25A'
  chart-3-dark: '#FF8CC6'
  chart-4-dark: '#6A54B8'
  chart-5-dark: '#FFC46B'
typography:
  family-latin: { fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }
  family-arabic: { fontFamily: '"IBM Plex Sans Arabic", "Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif' }
  family-player: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Geeza Pro", "Noto Sans Arabic", Tahoma, sans-serif' }
  display: { fontSize: 2.25rem, fontWeight: 800, lineHeight: 1.1, letterSpacing: -0.035em }
  h1: { fontSize: 1.75rem, fontWeight: 800, lineHeight: 1.2, letterSpacing: -0.03em }
  h2: { fontSize: 1.125rem, fontWeight: 700, lineHeight: 1.3, letterSpacing: -0.01em }
  h3: { fontSize: 0.875rem, fontWeight: 650, lineHeight: 1.4 }
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
  button-secondary: { background: transparent, foreground: '{colors.foreground}', border: '{colors.border}', rounded: '{rounded.pill}', height: 36px }
  button-accent: { background: '{colors.accent}', foreground: '{colors.accent-foreground}', rounded: '{rounded.pill}' }
  badge: { rounded: '{rounded.pill}', fontSize: 11.5px, fontWeight: 600, paddingBlock: 3px, paddingInline: 8px }
  card: { background: '{colors.card}', rounded: '{rounded.base}', padding: 22px, shadow: '0 8px 24px -14px rgba(60,20,140,.25)' }
  kpi-tile: { background: '{colors.card}', foreground: '{colors.foreground}', rounded: '{rounded.base}', padding: 20px, value: '{typography.kpi}' }
  kpi-tile-celebration: { background: '{colors.primary}', foreground: '{colors.primary-foreground}', label: '#FFFFFFCC', delta: '{colors.accent}', rounded: '{rounded.base}', padding: 20px, value: '{typography.kpi}' }
  input: { background: '{colors.background}', border: '{colors.border}', rounded: '{rounded.md}', height: 36px, focusRing: '{colors.ring}' }
  status-published: { background: '#1BAA5A1F', foreground: '{colors.success-text}', dot: '{colors.success}' }
  status-scheduled: { background: '#6A2BFF14', foreground: '#4B17C9', dot: '{colors.primary}' }
  status-draft: { background: '{colors.muted}', foreground: '{colors.muted-foreground}', dot: '{colors.muted-foreground}' }
  status-failed: { background: '#D1242A14', foreground: '{colors.destructive-text}', dot: '{colors.destructive}' }
  status-ended: { background: '{colors.muted}', foreground: '{colors.muted-foreground}', dot: none, style: 'outline border {colors.border}' }
  status-deactivated: { background: '#FFB54726', foreground: '{colors.warning-text}', dot: '{colors.warning}' }
  story-ring: { size: 68px, ringWidth: 2.5px, gap: 2.5px, gradient: 'conic {colors.primary} -> {colors.accent}', seen: '#C9C3D9', avatarRounded: '{rounded.pill}' }
  player-product-card: { background: '{colors.player-surface}', foreground: '{colors.player-surface-foreground}', rounded: '{rounded.lg}', padding: 12px, thumb: 56px }
  player-cta: { background: '{colors.player-cta}', foreground: '{colors.player-cta-foreground}', rounded: '{rounded.pill}', height: 48px, fontWeight: 700 }
---

# Slips — Visual Identity ("Studio")

## Brand & Style

Energetic and social, built with precision. Slips sells creator-tool energy (Stories, Reels, a ring that begs to be tapped) to merchants who need a dashboard that reads like Linear or Stripe: crisp edges, quiet chrome, data that tells the truth. The energy lives in two places only: electric violet `{colors.primary}` and lime `{colors.accent}`. Everything else is calm.

**Voice: friendly coach.** Warm, short, encouraging. Celebrate wins in one line ("أول مبيعة من قصة! 🎉" is wrong — no emoji; "أول مبيعة من قصة. أحسنت." is right). Errors say what happened and the next step. Never blame the merchant.

**Arabic-first.** Designs are drawn RTL first; English is the mirror, not the master.

### Logo & Wordmark

- **Mark** (`brand/logo-mark.svg`): a story ring (violet→lime gradient arc, open at the top-end like a "new story" indicator) around a geometric bold "S" built from two stacked arcs. Outlined paths, legible at 16px.
- **Wordmarks**: `brand/logo-wordmark-en.svg` ("Slips", Plus Jakarta Sans 800, −0.03em) and `brand/logo-wordmark-ar.svg` ("سليبس", IBM Plex Sans Arabic 700). Use the mark at the inline-start of the wordmark (right side in RTL).
- On violet backgrounds the mark goes white with a lime arc. Minimum clear space = the S stroke width × 2. Never recolor the ring to a single flat color except mono (all `{colors.foreground}` or all white).
- Sheet: `brand/logo-sheet.html`.

## Colors

| Role | Light | Dark | Use |
|---|---|---|---|
| primary | #6A2BFF | #7A45FF | Primary buttons, links, active nav, chart-1, celebration tile |
| accent | #C8F25A | #C8F25A | Highlights, positive deltas on violet, player CTA text, ring end. Fill only — never text on light surfaces |
| success | #1BAA5A (text #0E6E39) | #3FD27F (text #8AF0B5) | Published, positive state |
| warning | #FFB547 (text #8A5300) | #FFC46B (text #FFD699) | Deactivated, plan limits |
| destructive | #D1242A (text #B3171B) | #FF6166 (text #FFA3A6) | Failed, delete |
| muted / muted-foreground | #F4F1FB / #5E5873 | #211A38 / #A49CC0 | Secondary surfaces and copy |

Charts: series in order chart-1..5; never encode meaning by color alone (legend + label).

**WCAG AA (verified):**
- White on #6A2BFF = 6.17:1; white on #7A45FF (dark primary) = 5.09:1 — pass.
- #1C2A00 on lime #C8F25A = 11.8:1; lime on #17112B (player CTA) = 14.2:1 — pass. White on lime = 1.3:1 — forbidden.
- Muted-foreground on muted: 6.0:1 light, 6.95:1 dark (on card).
- **Fixes:** light destructive #E5383B → **#D1242A** (white on it was 4.23:1, now ≈5.2:1). Dark destructive #FF6166 with white text was 2.94:1 → dark destructive-foreground is **#1A0306** (≈6.6:1). Success #1BAA5A is 3.0:1 on white → never text; status text uses **#0E6E39** (6.35:1). Chart-2 #7FB800 is graphics-only (3:1 non-text rule), never text.

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

Flat by default. Cards and tiles use one soft violet-tinted shadow (`0 8px 24px -14px rgba(60,20,140,.25)`; dark `rgba(0,0,0,.6)`) on a tinted page (`{colors.page}`). Popovers/dialogs add a 1px `{colors.border}` ring. No stacked shadows, no glows except the focus ring (2px `{colors.ring}`, 2px offset). The player uses a black scrim (60–80%) and white surfaces only.

## Shapes

`{rounded.base}` (16px) for cards and tiles; `{rounded.md}` (12px) for inputs, thumbs and segment controls; `{rounded.sm}` for tiny chips; `{rounded.pill}` for every button, badge and the player CTA; circles for story rings/avatars. Story thumbs are 9:16 rectangles at `{rounded.sm}`. Nested radius = outer − padding.

## Components

- **Button:** pill, 36px (32 sm, 44 lg / touch). Primary violet; secondary = outline border; accent (lime + dark text) reserved for one "make something" action per screen. Hover: brightness 1.08; disabled 50% opacity.
- **Badge / status:** pill, 11.5px 600, leading 6px dot. Published (green), Scheduled (violet), Draft (muted), Failed (red tint + row tint 6%), Ended (outline, no dot), Deactivated (amber). Always a text label, never dot alone.
- **KPI tile:** label 13px muted, value `{typography.kpi}` tabular, delta 12px 600 (up #178A4A / down #D1242A; dark up = lime). **`{components.kpi-tile-celebration}`**: the Revenue tile is solid violet with white value, 80% white label, lime delta — one per dashboard, never more.
- **Card:** shadcn Card composition; title `{typography.h3}`, 22px padding.
- **Input:** 36px, 12px radius, border → ring on focus; error = destructive border + text-destructive-text message below.
- **Story ring (`{components.story-ring}`):** conic gradient violet→lime ring, 2.5px with 2.5px background gap; seen = flat #C9C3D9. Label under, 12px, 1 line truncate.
- **Player product card:** white surface, 22px radius, 56px product thumb, name (2 lines), price tabular, inside bottom sheet over the scrim.
- **Player CTA (`{components.player-cta}`):** near-black pill (#17112B) with lime text, 48px, full width — reads on any video frame and any merchant theme.
- **Player rule:** the storefront player uses **neutral Slips styling** (no theme matching in MVP), rendered inside **Shadow DOM** so merchant CSS cannot leak in or out, and uses the **system font stack** (`{typography.family-player}`) — **no web fonts load in the player**.

## Do's and Don'ts

- Do keep violet + lime as the only loud colors; Don't add gradients outside the logo and story ring.
- Do use the celebration tile once (revenue); Don't make every KPI violet.
- Do use `-text` color variants for status text; Don't put success/warning/lime fills as text on white.
- Do use logical properties and test RTL first; Don't use `left`/`right`/`ml-`/`mr-`.
- Do use tabular Western numerals with bidi isolates; Don't letter-space Arabic.
- Do keep the player neutral, Shadow-DOM-scoped, system-font; Don't load Jakarta/Plex in the storefront.
- Don't use emoji in UI copy.

# Spine Pair Review — Slips

## Overall verdict
The spine pair is in good shape for downstream use. The structure follows the canonical form, all three journeys exist as Key Flows with climax beats, and the light/dark color tokens have hex values with verified contrast. Three things block a clean extraction. First, UJ1 drifts from the PRD (a Reel instead of a Story). Second, several hexes used in the prose (info-text, the seen ring, the KPI delta, dark info-text) are not frontmatter tokens. Third, the status-chip vocabulary in EXPERIENCE.md ("info", "danger", Processing, Archived) has no matching DESIGN.md component rows. About ten behavioral components also have no visual row.

## 1. Flow coverage — adequate
Checked UJ1-UJ3 from docs/prd.md §1.6 against EXPERIENCE.md Key Flows for a protagonist, numbered steps, a climax and a failure path.
### Findings
- **high** UJ1 is titled "publishes her first Reel" and has her pick format Reel and see a carousel. PRD UJ1 says "first Story", and she sees "the story ring on her home page" (EXPERIENCE.md Key Flows › UJ1 heading, steps 3, 6, 9). *Fix:* restore the PRD's Story and story ring, or log a PRD change.
- **medium** UJ3 has no failure path (data load error, numbers that don't reconcile, empty range) (Key Flows › UJ3). *Fix:* add a failure branch line like UJ1's.
- **low** UJ2's failure branches sit inside the numbered steps (6, 7), while UJ1 has a separate "Failure branches" line. *Fix:* pick one convention.

## 2. Token completeness — adequate
Extracted every frontmatter token and every `{path}` reference. All references resolve. Light/dark pairs are present for the dashboard palette, and contrast is stated for the load-bearing pairs.
### Findings
- **critical** `info-text` (#B8291A light / #FFB3A8 dark) carries links, Scheduled chip text and coral-toned text, but it is not a token. It appears only as literal hexes (DESIGN.md Colors table row primary, WCAG bullets, frontmatter `status-scheduled.foreground`). *Fix:* add `info-text` and `info-text-dark` to `colors` and reference them.
- **high** Other hardcoded hexes have no token: story ring seen #D3CDC8, KPI delta up #178A4A, the celebration label #15110FCC, the status tint backgrounds (#1BAA5A1F etc.), and the dark-mode shadow (DESIGN.md frontmatter components, Components › KPI tile / Story ring). The delta up #178A4A also differs from `success-text` #0E6E39. *Fix:* tokenize them or derive them from existing tokens (e.g. `success-text`), and give dark values.
- **medium** No dark variants for the player tokens or for `story-ring` / `status-*`, yet EXPERIENCE.md Foundation says the player follows `prefers-color-scheme` (DESIGN.md frontmatter player-*). *Fix:* either state that the player is light-only (scrim plus white surfaces) and drop the assumption, or add dark pairs.
- **low** `h3` uses fontWeight 650, which IBM Plex Sans Arabic does not have (400/500/600/700). *Fix:* note the Arabic fallback to 600.

## 3. Component coverage — thin
Compared the components used in each spine with DESIGN.md Components (visual rows) and EXPERIENCE.md Component Patterns (behavioral rows).
### Findings
- **high** Behavioral components with no DESIGN.md visual row: App shell / side nav / top bar, Attribution caption, Onboarding checklist, Content table, Content editor, Media uploader, Product picker, Live preview, Floating bubble, Viewer (progress segments, mute/pause/close controls), Plan usage meter, Support sheet, Toast, Banner (offline / disconnected), Skeleton (EXPERIENCE.md Component Patterns, State Patterns). *Fix:* add brief visual rows, or map each one to shadcn primitives plus tokens (e.g. the viewer progress bar to `player-progress` / `player-progress-track`, which are currently unreferenced).
- **high** The status chip vocabulary does not match. EXPERIENCE.md uses neutral/info/danger/success/warning and includes Processing and Archived. DESIGN.md defines status-published/scheduled/draft/failed/ended/deactivated only, and has no "info" or "danger" role (EXPERIENCE.md State Patterns › Content statuses; DESIGN.md frontmatter `status-*`). The "[ASSUMPTION colors from DESIGN.md]" tag hides this gap. *Fix:* add `status-processing` and `status-archived` and reference the `{components.status-*}` names directly.
- **medium** Button, Badge, Input and Card have visual rows but no behavioral row. Some behavior is covered elsewhere (Forms, Destructive actions). *Fix:* add one Component Patterns row for buttons (pending, disabled, the rule of one accent per screen).
- **low** The Product card in EXPERIENCE.md is "Product card + CTA". In DESIGN.md it is "Player product card". *Fix:* use one name.

## 4. State coverage — adequate
Walked each IA surface (dashboard screens, player surfaces) for empty, loading, error, offline and permission states.
### Findings
- **medium** Slips Admin has no states: sign-in failure, permission-denied, store not found (IA › Slips Admin). *Fix:* add a row.
- **medium** No state for the Injector not detected after setup. The Settings › Injector tab has no error or pending treatment beyond the checklist poll (IA › Settings; Component Patterns › Onboarding checklist). *Fix:* add a "not detected" state with a next step.
- **medium** Store Preview has no loading or error state for the preview iframe (IA › Store Preview; Live preview). *Fix:* add a row.
- **low** Products has no sync-failure state beyond the global disconnected banner (State Patterns › Empty Products). *Fix:* add a "sync failed" row with retry and the last sync time.
- **low** The player has no focus state for entry points (ring, bubble). *Fix:* state that the focus ring applies on the storefront using a player token.

## 5. Visual reference coverage — adequate
Files: mockups/identity-studio-coral.html, mockups/identity-studio-coral.png, brand/* (10 files). imports/ and wireframes/ are empty or absent. .working/ was ignored. "Spines win on conflict" is stated once, in DESIGN.md.
### Findings
- **medium** The mockup is linked once, at the top of DESIGN.md, with a generic description. No section points to it inline (Components, the KPI row), and EXPERIENCE.md never references it in IA or Key Flows (DESIGN.md intro). *Fix:* link it at the KPI tile, Player and status sections, and in EXPERIENCE.md Overview / UJ2.
- **low** These are orphans: mockups/identity-studio-coral.png, brand/logo-sheet.png, brand/logo-app-icon.svg (described but not linked), the brand/*-dark.svg variants, and tokens/globals.css. *Fix:* link them or note them, especially globals.css as the code mirror of the tokens.
- **low** EXPERIENCE.md says "on conflict about looks, DESIGN.md wins". DESIGN.md says "this spine and EXPERIENCE.md win over any mockup". The two statements are consistent but split across files. *Fix:* acceptable as is; optional cross-reference.

## 6. Bloat & overspecification — adequate
### Findings
- **low** The DESIGN.md Colors table and WCAG bullets restate frontmatter hexes, so the two can drift (they already have, for info-text). *Fix:* refer to tokens by name in the prose.
- **low** EXPERIENCE.md Interaction Primitives › Forms / URL state name libraries (React Hook Form, Zod, nuqs) and Loading names boneyard. That is implementation detail architecture already owns. *Fix:* keep the behavior and move the library choice to architecture.
- **low** The pixel values in DESIGN.md Components prose (22px padding, 13px label, 12px delta, 11.5px badge) duplicate the frontmatter or bypass the type scale. *Fix:* reference the tokens.

## 7. Inheritance discipline — adequate
`sources` resolve (prd.md, ARCHITECTURE-SPINE.md, .memlog.md). DESIGN.md has no `sources` frontmatter (it relies on its companion).
### Findings
- **high** The UJ1 name is not verbatim from the source ("first Reel" vs "first Story"). See finding 1.
- **medium** The voice samples contradict each other. DESIGN.md Brand & Style models the first sale as "أول مبيعة من قصة. أحسنت." with no exclamation. EXPERIENCE.md Voice table uses "أول طلب من سليبس! 340 ر.س…" with "!", and its English drops the "!" (EXPERIENCE.md Voice and Tone). *Fix:* align on one line.
- **low** The "View options" Arabic ("اختر المقاس واللون", "choose size and color") does not translate the English. *Fix:* align the meaning or note the intent.
- **low** The glossary term "Injector" matches the PRD. The checklist step reads "injector detected" in one place and "App Snippet is seen" in another (IA, UJ1 step 2). This is fine, but gloss it once.

## 8. Shape fit — strong
DESIGN.md sections are in canonical order. EXPERIENCE.md has every required default, plus Responsive & Platform (multi-surface, iframe) and Inspiration & Anti-patterns (reference products). Both are triggered and both earn their place. DESIGN.md also has a "Logo & Wordmark" subsection under Brand & Style, which is fine.

## Mechanical notes
- The color token for info-text and its dark variant are missing. Several literal hexes have no token (see §2).
- The DESIGN.md status component names (`status-*`) never appear in EXPERIENCE.md. EXPERIENCE.md uses role words instead.
- `player-progress`, `player-progress-track`, `player-scrim`, `button-accent`, `button-secondary`, `input`, `badge` and `card` are never referenced by EXPERIENCE.md.
- Player gestures › Story group row: the RTL cell explains both directions in a parenthetical and the LTR cell says "Swipe left". This is ambiguous. Restate it as "forward = swipe toward the inline-start edge".
- DESIGN.md has no `sources` / `status` / `updated` frontmatter, unlike EXPERIENCE.md.
- The spines contain no Mermaid.

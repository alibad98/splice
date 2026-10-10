---
name: Slips
status: draft
sources:
  - docs/prd.md (v0.4: FR1-FR30, NFR6, NFR9, §1.5, §1.6, Epics 3-7)
  - _bmad-output/planning-artifacts/architecture/architecture-splice-2026-10-10/ARCHITECTURE-SPINE.md (AD-8, AD-12, AD-19, AD-20, AD-23)
  - .memlog.md (owner decisions, 2026-10-10)
companion: DESIGN.md
updated: 2026-10-10
---

# Slips (سليبس): Experience Spine

## Foundation

| Aspect | Decision |
|---|---|
| Surfaces | (1) Merchant dashboard: responsive web, embedded in the Salla dashboard iframe, also reachable by direct link (AD-12). (2) Storefront player: mobile-first overlay/inline in Salla themes, loaded by the injector. (3) `/admin`: internal support view, never framed. |
| Form factors | Dashboard desktop/tablet first, usable on mobile. Player phone first, works on desktop (NFR9). |
| Language | Arabic first (RTL default), English available. Dashboard language set in Settings. Player follows the storefront language (FR10). |
| Theme | Light first, full dark theme (dashboard). Player follows the shopper's `prefers-color-scheme` [ASSUMPTION]. |
| UI system | shadcn/ui on Radix + Tailwind 4. Visual direction "Studio". |
| Visual reference | `DESIGN.md` owns color, type, radius, components. This file owns behavior. On conflict about looks, DESIGN.md wins; about behavior, this file wins. |

## Information Architecture

### Dashboard

Shell: side nav on the right in RTL (left in LTR): Overview, Videos & Stories, Products, Analytics; Settings pinned at the bottom. Top bar: store identity + connection status, "Preview store" button, "Need help? Contact support". Both on every page (FR18, FR20).

| Screen | Route [ASSUMPTION] | Reached from | Purpose | FR |
|---|---|---|---|---|
| Overview | `/` | App open, nav | 4 KPIs (Views, CTR, Product clicks, Attributed revenue) with % change, 7-day chart, latest content with All/Published/Drafts filter; onboarding checklist until complete; empty banner "Create your first story" | FR15, FR21 |
| Onboarding checklist | Card on Overview | First install | 4 steps: store connected, products synced, injector detected, first content created; each done/not done | FR21 |
| Content list ("Videos & Stories") | `/content` | Nav | Tabs All/Published/Scheduled/Drafts with counts; edit, duplicate, archive, delete | FR6, FR22 |
| New / Edit content | `/content/new`, `/content/[id]` | List, Overview CTA | Editor (format, title, media, product, CTA, placements, layout, schedule, auto-publish) beside a live vertical preview | FR4, FR5, FR7, FR8, FR29 |
| Products | `/products` | Nav | Synced products: category, price, linked content count, attributed orders, availability; filter + search; last sync time + manual sync | FR3, FR16 |
| Analytics | `/analytics` | Nav | 4 KPIs (Views, Unique viewers, Product clicks, Attributed orders), date range, funnel, per-content table, methodology link | FR13, FR14 |
| Settings | `/settings?tab=` | Nav (bottom) | Tabs: Connection, Injector, Attribution, Language, Plan & billing | FR17, FR19 |
| Plan & billing | Settings tab | Settings, plan-limit notices | Plan, usage meters (active items, placements), 80%/100% warnings, upgrade via Salla | FR19 |
| Store Preview | `/preview` | "Preview store" button | Real player in preview mode, Stories/Reels toggle, product card, install instructions | FR18, AD-23 |
| Methodology | `/analytics/methodology` [ASSUMPTION] | "How we count" links | Plain-language FR13 rules | Story 6 AC4 |
| Support | Sheet from top bar | Every page | Email + WhatsApp, hours (Sun-Thu, Asia/Riyadh), response time | FR20 |
| Slips Admin | `/admin` | Direct URL, separate sign-in | Store lookup: connection, sync, jobs, failures, plan, pilot status | FR27, AD-12 |

Nav collapses to icons on `md`, becomes a `Sheet` on `sm`. Dialogs stack one level deep.

### Storefront player

| Surface | Appears | Purpose |
|---|---|---|
| Story ring row | Home/category (default entry) when its anchor is below the viewport at insertion (AD-8) | Circular avatars, tap opens viewer |
| Product strip / carousel | Product page / home-category per placement layout (FR29), same AD-8 rule | Inline entry points |
| Floating bubble | Fallback when inline insertion is not allowed (anchor already in view) | Overlay entry, mounted on `body`, no layout shift |
| Full-screen viewer | Tap on any entry | Stories (segmented progress) or Reels (vertical swipe feed); muted autoplay |
| Product card | Bottom of viewer | Image, name, the price the cart will charge, CTA; secondary: open product / open cart |
| "View options" fallback | Products with required options (FR23) | CTA opens the product page instead of adding |
| Out of stock | Unavailable product | Disabled CTA "Out of stock" (FR16) |

Nothing renders and nothing reserves space when there is no eligible content, the API is unreachable, or the key is invalid (FR10, AD-21).

## Voice and Tone

Friendly coach: warm, short, encouraging. Celebrate wins in one line. Errors say what happened and the next step. No emoji, no exclamation stacks, no blame. Arabic drafted first (Modern Standard, light and conversational), English is a translation of meaning, not words.

| Rule | Do | Don't |
|---|---|---|
| Lead with outcome | "Your Story is live." | "The operation completed successfully." |
| One next step | "Reconnect to resume syncing." | "An error occurred. Please try again later or contact support." |
| Numbers as proof | "SAR 4,200 from Slips this month" | "Great results!" |
| Honest attribution | "Counted only when added to cart from Slips" | "Slips drove SAR 20,000 in sales" |
| Plain words | "Injector", glossed once as "Slips script" in onboarding | Internal terms: manifest, epoch, rendition |

| Situation | Arabic | English |
|---|---|---|
| Publish success | قصتك صارت مباشرة على متجرك. | Your Story is live on your store. |
| First attributed sale | أول طلب من سليبس! ٣٤٠ ر.س من هذا الريل. | First order from Slips. SAR 340 from this Reel. |
| Settings saved | تم حفظ التغييرات. | Changes saved. |
| Empty content list | ما عندك محتوى بعد. ابدأ بقصة قصيرة لأكثر منتج مبيعاً. | Nothing here yet. Start with a short Story for your best seller. |
| Empty analytics | الأرقام تظهر بعد أول مشاهدة. انشر محتوى وتابع هنا. | Numbers appear after your first view. Publish something and check back. |
| Generic error | ما قدرنا نحمّل البيانات. حاول مرة ثانية. | We couldn't load this. Try again. |
| Disconnected | انقطع الاتصال بسلة، فتوقفت المزامنة. أعد الربط لتكمل. | Your Salla connection dropped, so syncing paused. Reconnect to continue. |
| Failed upload | ما اكتمل تجهيز الفيديو: الدقة أقل من 720p. ارفع نسخة أوضح أو أعد المحاولة. | This video didn't finish processing: resolution is below 720p. Upload a sharper version or retry. |
| Plan limit 80% | استخدمت ٨ من ١٠ محتويات نشطة في باقتك. | You're using 8 of 10 active items on your plan. |
| Plan limit 100% | وصلت حد باقتك. أوقف محتوى أو رقِّ باقتك لتنشر المزيد. | You've reached your plan limit. Pause an item or upgrade to publish more. |
| Shopper add success | أُضيف للسلة | Added to cart |
| Shopper add failure | ما قدرنا نضيفه الآن. حاول مرة ثانية. | Couldn't add it right now. Try again. |
| View options | اختر المقاس واللون | View options |

## Component Patterns

Behavioral only. Visuals per `DESIGN.md` tokens.

| Component | Use | Behavioral rules |
|---|---|---|
| App shell | Dashboard | Nav item marks current route; "Preview store" uses {colors.primary} pill ({rounded.pill}); connection status chip is clickable to Settings > Connection. |
| KPI tile | Overview, Analytics | Value, label, % change ("—" when previous is 0). Tooltip on label gives the §1.5 definition. Attributed revenue renders as {components.kpi-tile-celebration}; only one celebration tile per screen. Tile links to its Analytics breakdown. |
| Attribution caption | Every attributed figure | Shows "7-day window, add-to-cart only" (live window value) + "How we count" link. Never hidden. |
| Onboarding checklist | Overview | Steps auto-tick from live state (injector detection polls) [ASSUMPTION: poll every 10 s while visible]. Collapses to a "Setup complete" line after all done; dismissible thereafter. |
| Content table | Content list, Overview | Row click opens editor. Status chip per AD-19. Row menu: Edit, Duplicate, Archive, Delete (confirm dialog). Tabs and filters in URL. |
| Content editor | New/Edit | Two columns: form (start side) and preview (end side); stacked with preview toggle on `sm`. Drafts autosave (indicator "Saved"); Published items save explicitly with "Save changes" (AD-19). Publish blocked without a placement, with inline reason. |
| Media uploader | Editor | Drag/drop or pick, multi-file; client-side pre-check against FR5 limits before upload; per-file progress, then "Processing" with poster when ready; Failed shows reason + Retry. Reorderable slides. |
| Product picker | Editor | Searchable combobox of synced products with availability; required-options products show a "View options" note on the CTA preview. |
| Live preview | Editor, Store Preview | Iframe of the real player with mock storefront (AD-23). Cart actions show simulated success; a "Preview: no real cart or analytics" note is always visible. |
| Story ring | Storefront | {components.story-ring}: unseen items show the gradient ring, seen items a muted ring (per viewer, local) [ASSUMPTION]. Horizontal scroll follows text direction. |
| Floating bubble | Storefront fallback | Fixed at bottom start corner [ASSUMPTION], dismissible per session, never covers the theme's cart/checkout button. |
| Viewer | Storefront | Focus-trapped dialog. Muted autoplay; visible mute and pause buttons; close button. Respects reduced motion (no auto-advance animation, crossfade only). |
| Product card + CTA | Viewer | {components.player-cta} pill. Tap: pending (spinner, CTA disabled, playback paused) → success toast "Added to cart" + cart count, playback resumes → or error message inline, CTA re-enabled. Price updates to Salla's price if it differs (FR24). |
| Plan usage meter | Settings, publish dialog | Neutral under 80%, warning at 80%, blocking at 100% with upgrade action. |
| Support sheet | Every page | Opens a side sheet; channels open externally (`mailto:`, WhatsApp) in a new tab, since the iframe cannot host them. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Loading | Dashboard pages, tables, charts | boneyard skeletons matching final layout (KPI row, chart, 6 table rows). No spinners for page loads; spinners only inside buttons. Skeleton shows after 150 ms to avoid flash [ASSUMPTION]. |
| Loading | Player | Poster image first, then video; no skeleton on the storefront (nothing renders until eligible). |
| Empty | Overview | Banner "Create your first story" + checklist. |
| Empty | Content list tab | One sentence + primary action; filtered-empty says "No Scheduled items" + "Show all". |
| Empty | Analytics | KPIs show 0 with "Numbers appear after your first view". |
| Empty | Products | "Syncing your products..." during first sync; after sync with none: link to Salla products. |
| Error | Any data block | Inline at the block, not full page: what failed + Retry. Other blocks keep working. |
| Error | Form | Field-level messages on blur and submit; summary at top on submit with links to fields. |
| Offline | Dashboard | Top banner "You're offline. Changes will save when you're back." Drafts queue locally; explicit saves disabled. |
| Offline / unreachable | Player | Already-loaded media keeps playing; new loads fail silently; add to cart shows the failure message. |
| Disconnected store (AD-20) | Dashboard global | Persistent warning banner on every page with "Reconnect"; sync paused; last sync time shown; storefront keeps serving cached content. |
| Uninstall grace (AD-20) | Dashboard on reinstall | If reinstalled within 30 days: "Welcome back. Your content and settings are restored." After purge: fresh onboarding. During grace the dashboard is not reachable (app uninstalled) [ASSUMPTION]. |
| Plan limit | Publish, Settings, Content list | 80%: inline warning. 100%: Publish disabled with reason + upgrade. Downgrade: notice listing Deactivated items and grace period. |
| Linked product deleted | Content row, editor | Flag "Linked product deleted" + action to relink (FR25). |

Content statuses (AD-19 = FR22 + Ended):

| Status | Meaning | Chip [ASSUMPTION colors from DESIGN.md] | Tab | Primary action |
|---|---|---|---|---|
| Draft | Not live; includes passed processing without auto-publish | neutral | Drafts | Publish |
| Processing | Media transcoding | info, animated dot (static under reduced motion) | Drafts | — (wait) |
| Failed | Processing failed after retries | danger + reason | Drafts | Retry |
| Scheduled | Waits for start time (store time zone) | info + date | Scheduled | Edit schedule |
| Published | Live within schedule | success | Published | View on store |
| Ended | Schedule end passed | neutral muted | All | Duplicate / reschedule |
| Archived | Merchant archived | neutral muted | All | Restore |
| Deactivated | Switched off by plan limit | warning | All | Upgrade / free a slot |

## Interaction Primitives

### Player gestures

| Action | RTL storefront | LTR storefront | Keyboard | Button alternative |
|---|---|---|---|---|
| Next slide/Story | Tap left third | Tap right third | `→` in LTR, `←` in RTL; `Space` does not advance | Next button (visible on focus/desktop) |
| Previous slide | Tap right third | Tap left third | Opposite arrow | Previous button |
| Next/previous Reel | Swipe up / down | Swipe up / down | `↓` / `↑` | Next/Prev buttons |
| Next/previous Story group | Swipe toward start edge (right-to-left drag goes forward in LTR, reversed in RTL) [ASSUMPTION] | Swipe left | `PageDown` / `PageUp` [ASSUMPTION] | — |
| Pause / resume | Long-press (release resumes) | Long-press | `Space` / `K` | Pause button |
| Mute toggle | Tap mute icon | Tap mute icon | `M` | Mute button |
| Close | Swipe down | Swipe down | `Esc` | Close button |
| Add to cart | Tap CTA | Tap CTA | `Enter` on focused CTA | — |

Tapping the product card or CTA area never triggers navigation taps. Opening the card pauses Story auto-advance.

### Dashboard

| Pattern | Rule |
|---|---|
| Forms | React Hook Form + Zod; one schema client and server. Validate on blur, re-validate on change after first error. Submit button shows pending state; double submit prevented. |
| Saving | Drafts autosave (debounced) [ASSUMPTION: 1 s]; Settings and Published content save explicitly with "Changes saved" toast. Leaving with unsaved changes asks to confirm. |
| URL state | nuqs for tabs (`?tab=`), content status filter, search, date range, sort, pagination. Shareable and back-button safe; shallow updates for filters. |
| Tables | Sort by header click; search debounced; keyboard row focus with `Enter` to open. |
| Destructive actions | Confirm dialog naming the item; Archive is undoable via toast, Delete is not. |
| Toasts | Bottom start corner [ASSUMPTION], auto-dismiss 5 s, pause on hover/focus, announced via `aria-live=polite`. |

## Accessibility Floor

| Area | Dashboard (WCAG 2.1 AA) | Player ("AA except captions", NFR6) |
|---|---|---|
| Keyboard | All actions reachable; visible focus ring; skip-to-content link | Full keyboard operation per table above; focus moves into viewer on open, returns to entry on close |
| Focus trap | Dialogs/sheets via Radix | Viewer is a modal dialog with trap and `Esc` |
| Motion | Respect `prefers-reduced-motion`: no count-up numbers, no slide animations | No auto-advance transitions; Stories still advance on timer but pausable [ASSUMPTION: auto-advance off under reduced motion] |
| Pause | — | Pause control for auto-advancing Stories and playing video (WCAG 2.2.2) |
| Gestures | — | Every swipe has a button alternative |
| Contrast | Text 4.5:1, UI 3:1 in light and dark | Overlay text on video uses scrim per DESIGN.md |
| Media | Alt text required on image slides in editor [ASSUMPTION] | Captions deferred to Phase 2 (documented exception) |
| Language | `lang` + `dir` on root; mixed-direction strings isolated | Follows storefront `lang`/`dir` |
| Announcements | Status changes, saves, errors via live regions | "Added to cart" and errors announced |
| Targets | 24 px minimum | 44 px minimum |

## Key Flows

### UJ1. Noura onboards and publishes her first Reel

1. Noura installs Slips from the Salla App Store; Salla opens the dashboard in its iframe, already signed in (AD-12).
2. Top bar reads "Connected to Salla: Noura Abayas". Overview shows the checklist: store connected (done), products synced (done automatically), injector detected (pending, flips to done when the App Snippet is seen), first content (pending).
3. She taps "Create your first story", picks format Reel.
4. She uploads three clips from her phone; each shows progress, then Processing with a poster.
5. She links her best-selling abaya in the product picker; the CTA stays "Add to cart".
6. She chooses placement Home with the carousel layout default; schedule "Now".
7. The live preview on the side plays the Reel exactly as shoppers will see it; tapping the CTA shows a simulated "Added to cart".
8. She turns on auto-publish and leaves. Status: Processing.
9. **Climax:** minutes later processing passes; status flips to Published, the last checklist step ticks, and a one-line celebration reads "Your Reel is live on your store." with "View on store".
10. She opens Store Preview, then her real storefront, and sees the entry on her home page.

Failure branches: no placement → stays Draft with reason. Processing fails → Failed with reason and Retry. Plan at 100% → Publish disabled with upgrade path.

### UJ2. Faisal buys from a Reel on his phone

1. Faisal browses Noura's store (Arabic, RTL) on Android Chrome. The ring/carousel inserts below the hero without moving the page; if its anchor was already in view, a floating bubble appears instead (AD-8).
2. He taps a Reel; the viewer opens full screen, muted autoplay, focus inside.
3. He taps unmute, watches; the product card shows image, name, SAR price.
4. He taps "Add to cart". CTA shows pending; video pauses.
5. **Climax (success):** "Added to cart" confirmation with cart count; playback resumes; he keeps swiping up to the next Reel.
6. Failure: out of stock → CTA disabled "Out of stock"; API error → "Couldn't add it right now. Try again." in place, he stays in the viewer.
7. Required options: on a different abaya the CTA reads "View options"; tapping opens the product page (counts as product click, no attribution credit).
8. Secondary action "Open cart" or swipe down to close; focus returns to the entry.
9. Two days later he checks out; the line item is credited to the Reel (7-day window).

### UJ3. Noura checks her ROI

1. Two weeks later Noura opens Analytics (skeletons, then data within 2 s).
2. Date range "Last 30 days" is in the URL; KPIs show 3,000 views, unique viewers, product clicks, attributed orders, each with % change.
3. The funnel shows views → product clicks → adds to cart → attributed orders with step-to-step rates.
4. **Climax:** the attributed revenue figure, captioned "7-day window, add-to-cart only", with per-content rows summing exactly to the total. Tooltip: only products added from Slips count; refunds are subtracted.
5. She opens "How we count", then her Salla orders; the line items match.
6. She sorts the table by attributed revenue, archives a low performer (undo toast), and duplicates the best Reel, landing in the editor with a Draft copy to relink to a new product.

## Responsive & Platform

| Topic | Rule |
|---|---|
| Iframe (AD-12) | No third-party cookies; token in memory, refreshed via Salla SDK `getToken()`. No `window.top` navigation; external links open in a new tab. Avoid nested scroll: page scroll only, sticky elements relative to the iframe. Modals sized to the iframe viewport. Height managed by Salla frame [ASSUMPTION: confirm auto-resize behavior at Epic 1 gate]. |
| Direct link | Same UI; OAuth cookie session. Shows a "Open in Salla" link [ASSUMPTION]. |
| `/admin` | Desktop only, never framed, English-first acceptable [ASSUMPTION]. |
| Breakpoints | `sm` phone: nav in Sheet, editor preview behind toggle, tables become card lists. `md` tablet: icon nav, single column editor with sticky preview button. `lg+` desktop: full nav, two-column editor. |
| Player | Phone: full-screen viewer, safe-area insets respected. Desktop: centered 9:16 viewer with backdrop, arrow buttons visible. |
| Numerals | Arabic UI uses Western digits (0-9) for KPIs and prices [ASSUMPTION: matches Salla convention; open question]. Dates in Arabic month names, Gregorian. |
| Currency | Store base currency via `Intl.NumberFormat`. AR: "٣٤٠ ر.س" or "340 ر.س" per numeral decision, symbol after; EN: "SAR 340". Two decimals only when non-zero [ASSUMPTION]. |
| Bidi | Wrap product names, URLs, store key and numbers in `<bdi>`/`dir="auto"`; mirror directional icons (arrows, chevrons), never mirror media, play icons, or charts' time axis [ASSUMPTION: time axis runs right-to-left in RTL? see open questions]. Use logical CSS properties throughout. |
| Time zone | Schedules shown in the store's time zone with its label. |

## Inspiration & Anti-patterns

| Source | Take |
|---|---|
| Instagram Stories / Reels | Segmented progress, tap zones, long-press pause, swipe-down close: shoppers already know these. |
| Linear | Crisp keyboard-friendly dashboard, quiet chrome, fast transitions. |
| Stripe | Honest, well-labeled numbers; every metric explains itself; reconciliation-friendly tables. |

| Anti-pattern | Why avoided |
|---|---|
| Autoplay with sound | Hostile on storefronts; always start muted (FR10). |
| Fake urgency, countdowns, "only 2 left" not from data | Dark pattern; damages merchant trust. |
| Inflated attribution (view-through, whole-order credit) | Contradicts FR13; numbers must reconcile with Salla. |
| Layout shift or reserved empty space on storefront | Violates NFR1/AD-8. |
| Hidden close or tiny pause controls | Accessibility and trust. |
| Confirmshaming on downgrade/uninstall | Friendly coach never guilts. |
| Emoji and exclamation-heavy copy | Off-voice. |

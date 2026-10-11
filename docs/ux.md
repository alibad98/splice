# Slips UX

The UX spec for the Slips MVP lives in [`_bmad-output/planning-artifacts/ux-designs/ux-splice-2026-10-10/`](../_bmad-output/planning-artifacts/ux-designs/ux-splice-2026-10-10/):

- **DESIGN.md**: the visual identity ("Studio · Coral"). Hot coral `#FF4A3D` with ink text, an amber accent and warm ink neutrals, light and dark. Plus Jakarta Sans and IBM Plex Sans Arabic. Tokens, components, and contrast rules.
- **EXPERIENCE.md**: how it works. Screen map, Arabic-first friendly-coach voice, component and state patterns, player gestures (RTL and LTR), accessibility floor, and journeys UJ1 to UJ3.
- **tokens/globals.css**: Tailwind 4 and shadcn CSS variables to drop into `apps/dashboard`.
- **brand/**: logo mark (a story ring around an S), EN and AR wordmarks, app icon, logo sheet.
- **mockups/**: Overview dashboard, content editor, Settings, and storefront Story viewer.
- **Reviews and decision log**: `review-*.md` and `.memlog.md`.

Owner decisions:
- Hot coral, no purple anywhere.
- Arabic first, using Western digits 0-9.
- RTL chart time axes run right to left.
- With reduced motion on, shoppers tap to advance; nothing advances on its own.
- The storefront entry is a story ring by default.

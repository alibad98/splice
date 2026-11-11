# Slips Architecture

The architecture for the Slips MVP is the BMAD architecture spine:

- **Spine (binding for all stories):** [`_bmad-output/planning-artifacts/architecture/architecture-splice-2026-10-10/ARCHITECTURE-SPINE.md`](../_bmad-output/planning-artifacts/architecture/architecture-splice-2026-10-10/ARCHITECTURE-SPINE.md). Architecture decisions AD-1 to AD-23, conventions, stack, structure, deferred items and open questions.
- **Decision log (why each call was made):** `.memlog.md` in the same folder.
- **Reviews:** `reviews/` in the same folder.

Inputs: `docs/prd.md` (v0.4), `docs/prd-addendum.md`, `docs/tech-stack.md`, `docs/salla-desk-research.md`.

Approved pilot amendment (2026-11-11): PRD v0.5 introduces Home/Story/Ring/publish-now first, preserving module ownership, shared compiler/player contracts and the full MVP. AD-20 distinguishes disconnected stores (retain last good manifest) from uninstalled/purged/unknown stores (empty). AD-22 requires a production environment and operational evidence before live use; see [production pilot runbook](runbooks/production-pilot.md). Provider/region, merchant, named support and numeric caps remain open launch decisions.

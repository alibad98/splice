# Controlled Salla pilot: sprint change proposal

Date: 2026-11-11. Status: proposed; release-scope approval pending.
Mode: batch, inferred from the request to produce a complete plan and then finish 3.13.
Scope: moderate backlog reprioritization. Story 3.13 is separately authorized and retains its existing acceptance criteria.

## 1. Issue summary and evidence

The owner wants the earliest controlled pilot. The existing MVP combines storefront validation, two content formats, multiple layouts, scheduling, billing, attribution, analytics and public launch. Completing every backlog story before testing the merchant-to-shopper journey delays feedback.

- `implementation-artifacts/sprint-status.yaml` (updated November 10): Epic 1 done; 2.6–2.7 and 3.3–3.12 review; 3.13 backlog; Epics 4–7 backlog. Twelve review entries do not mean twelve missing implementations.
- Specs 2.6 and 2.7 contain triaged reviews but verification lists commands with **expected** outcomes; these need execution evidence before closeout.
- Specs 3.3–3.9 contain implementation and review records; 3.8 records API 636/dashboard 312 passing tests, 3.9 API 643/contracts 89/dashboard 326. Earlier Windows player-budget failure was reported. These are historical reports, not new runs.
- Spec 3.10 records API 652/contracts 92 passing tests and checks. Spec 3.11 records player 62 unit/33 browser tests and passing budgets. Spec 3.12 records dashboard 346 unit/7 browser tests, player 62 unit/33 browser tests, and passing builds/budgets. Reuse these assets; only recheck affected behavior and unresolved concerns.
- `docs/spike-findings.md`: Ali approved a **conditional go** on October 25. Injection passed two themes; third-theme/added CLS, signed-in cart, re-entry/consent, billing, order tagging and retry timing remain partly unverified. Introductory “all PENDING” sentence conflicts with the detailed results and must be corrected.
- `docs/runbooks/staging.md`: no selected hosting/deploy target; staging is synthetic/demo data only. A real pilot needs an appropriate production environment.
- Deferred-work ledger includes stale entries: `http.ts` now wires `FfmpegMediaProcessor` for workers; do not rebuild transcoding. It still defaults to `EicarMalwareScanner`, which is not production malware scanning.

## 2. Impact analysis

| Area | Pilot impact | Public release impact |
| --- | --- | --- |
| Epic 1 | Reuse install/session/lifecycle; clear applicable conditional gates | Complete all applicable gate evidence and listing setup |
| Epic 2 | Reuse catalog; close 2.6/2.7 with checks; resolve correctness risks affecting linked products | Full supported catalog behavior and operations |
| Epic 3 | Finish 3.13 unchanged; reuse editor, media and real-player preview | Keep both already-built creation formats; enable storefront capabilities when verified |
| Epic 4 | Home placement, fixed Story ring, publish-now, manifest compile/delivery/freshness | Remaining placements/layouts, scheduling and defaults |
| Epic 5 | Story storefront journey, real cart, safe option fallback, RTL/LTR, rollback, browser/theme/performance checks | Reels and additional layouts; complete supported compatibility matrix |
| Epic 6 | No analytics/ROI promises; no new shopper tracking in initial pilot | Event trust, orders, attribution/refunds, rollups and truthful dashboards |
| Epic 7 | Pilot access control, cost caps, support, data rights/purge, focused security and accessibility | Billing/entitlements, full admin/settings/onboarding, scale and exit report |

PRD conflict: current goals/exit criteria describe a listed, attributed, ten-merchant MVP. Add an earlier controlled pilot milestone; do not silently declare E1–E5 achieved. Architecture and module boundaries remain suitable. Keep one manifest compiler, one player and existing schemas/ports. UX changes are availability/copy controls, not redesign: show only enabled pilot choices, retain existing editor capabilities, hide unimplemented analytics or label unavailable rather than fabricated zero values.

## 3. Recommended approach and smallest release

Choose direct adjustment plus a staged MVP review. Preserve completed work; no rollback or stack migration. Start with one explicitly enrolled live merchant, then expand to at most three after the first acceptance run. Proposed pilot is free, manually onboarded, with named support and operational upload/storage caps. Owner must approve these commercial/scope assumptions.

End-to-end journey: Easy Mode install → verified dashboard sign-in (direct link if embedded fails) → product sync → create Story → upload/process image or video → link one product → preview → choose Home → publish now → see Story ring → open accessible player → add an available simple product to Salla cart → archive/delete removes content within freshness bounds.

Reuse existing image/video processing and preview playback. Required options use “View options” to the product page; do not build an option picker. Reels, category/product placements, scheduling, extra layouts, billing automation and attributed ROI are outside this first milestone. Disable unsupported controls; do not remove completed editor/media code. No new viewer identifier, event ingestion or consent-dependent analytics until its consent design is verified. G4 is a blocker for attribution claims, not for an explicitly uninstrumented playback/cart pilot. No cart-tagged order claim is made.

Effort: medium-to-high remaining implementation, driven by manifests, storefront adapter and production readiness; planning change itself is low effort. Risk: medium-to-high until live Salla behavior and hosting are proven. No delivery date is justified by historic test counts. Estimate after the first publish-to-store slice and hosting decisions, using observed throughput.

## 4. Detailed proposed edits (apply scope changes only after approval)

### PRD `docs/prd.md`, §1.3 and §1.6

OLD: “The MVP is done ... only when all exit criteria are met”; journeys combine storefront publication, Reels and ROI.

NEW: Insert a preceding “Controlled pilot” milestone using the journey and gates in this proposal. Preserve E1–E5 as full MVP exit criteria. State that the free pilot proves publication/playback/cart usability, not revenue attribution or willingness to pay. Record enrollment cap, owner, support and stop conditions. Keep original FRs for public MVP.

### Epics 4 and 5, pilot delivery slices

OLD: 4.1–4.3 cover all page types/layouts/schedules before the full storefront plan; 5.7 and 5.11 add Reels/layout breadth.

NEW: Deliver pilot slices of 4.1 (Home), 4.2 (fixed Ring default, reuse integration settings owner), 4.4–4.6 and 5.1–5.6, 5.8–5.10, 5.12–5.13 first. Scheduling remains disabled, not simulated. Record partial story completion in the pilot checklist; do not mark full stories done until original criteria pass. Compiler handles absent schedules as publish-now and retains contracts for later schedules. Keep 4.3, 5.7 and 5.11 in backlog for full MVP.

### Architecture `docs/architecture.md`, AD-20/AD-22 and deployment runbook

OLD: `isStoreActive` rejects disconnected stores; vendor/deploy choices unresolved; historic runbook only covers staging.

NEW: On the publishing path distinguish unavailable tokens from uninstall: disconnected stores retain last good manifest; uninstalled/purged/unknown stores serve empty. Choose production region/provider, storage/CDN, database backup/restore and monitoring. Document migrate → worker → HTTP → dashboard order, supported same-site session configuration, protected source-media access, public processed assets only, kill switch and rollback. No boundary or technology replacement.

### UX and truthful availability

OLD: full format/placement/scheduling/analytics navigation implied by the full MVP.

NEW: Pilot supports Home/Story/publish-now, hides unsupported storefront choices and tracking dashboards, keeps Arabic/English and accessible player controls. Published editing remains explicit Save changes. Show a pilot notice and real support channel. Reuse current components/tokens; no new design system.

### Tracking and evidence

OLD: twelve stories remain in review; ledger mixes resolved prerequisites with active production gaps.

NEW: Audit review records, run checks for open acceptance gaps, record real outcomes and close only proven stories. Annotate superseded ledger entries with code/spec evidence; retain history. Add a pilot readiness checklist linked from sprint status after approval. Preserve IDs and full-story statuses. Story 3.13 proceeds immediately under its original scope.

## 5. Ordered implementation handoff

| Order | Work | Dependency / completion evidence |
| --- | --- | --- |
| 0 | Owner approves pilot scope and selects live merchant, hosting region/provider and support contact | Proposed scope, commercial terms and environment suitable for real merchant data |
| 1 | Finish **3.13** unchanged | Atomic explicit Published save; duplicate with shared slides/product; archive/Undo/restore; named delete confirmation; tenant isolation and reference safety |
| 2 | Close **2.6–2.7, 3.3–3.12** review gaps | Reuse historic evidence; rerun current affected integration/browser paths; do not mass-promote statuses |
| 3 | **4.1**, pilot part of **4.2** | Home placement, Ring, publish eligibility, all return-to-live transitions gated; no placement means no publish |
| 4 | **4.4 → 4.5 → 4.6** | Reuse preview compiler, processed assets only, newest-first cap, transactional trigger/queue wiring, monotonic revision, CDN purge, price/stock/deletion freshness; archive/delete ≤1 min |
| 5 | **5.1 → 5.2 → 5.3** | Stable stub/channel, kill switch/rollback, enrollment restriction, page eligibility, one home entry, fail invisibly/double-boot safety |
| 6 | **5.4 → 5.5 → 5.6 → 5.8** | Reuse preview viewer; verify production adapter, accessible controls, RTL/LTR, muted playback, progressive rendition choice |
| 7 | **5.9 → 5.10** | Real simple-product cart, guest/signed-in verification, 410/out-of-stock handling, required-options product-page fallback |
| 8 | Pilot slices **7.7, 7.11–7.15**, production deployment tasks | Named support, caps/throttles, export/delete procedure and audited execution, uninstall media/CDN purge, i18n/a11y, no open high/critical security findings |
| 9 | **5.12 → 5.13**, bounded pilot load/restore/rollback rehearsal | Third representative theme and added CLS/CWV evidence, target mobile/desktop browsers, queue/storage budget, deployed journey with live merchant permission |
| 10 | Enroll first merchant, observe, then expand within cap | Owner acceptance record; support response, failures and costs monitored; disable promptly on harm |
| 11 | Full public MVP | Remaining 4.x/5.x, Epic 6, 7.1–7.6/7.8–7.10, complete 7.11–7.17, billing G5 and attribution G4, listing/legal review and E1–E5 |

Production tasks start alongside steps 1–7, not at the end. PO owns approval, terms, merchant permission, provider/support decisions and gate acceptance; developer owns code, tests, deployment artifacts and evidence; architecture responsibility is production configuration and data/operations decisions. These are responsibilities, not a requirement to create additional agents.

## 6. Release blockers and stop conditions

| Gate | Required before real pilot shoppers | Additional public MVP requirement |
| --- | --- | --- |
| Storefront | Deployed journey, real cart success, option fallback, absent/deleted/out-of-stock product handling, archive/delete freshness | Full promised formats/layouts/schedules |
| Salla | Easy Mode + least-privilege scopes configured before install; authenticated direct or embedded re-entry; guest/signed-in cart; three themes and measured added CLS cleared | Billing events; order-tag propagation before attribution; full retry/freshness evidence |
| Data/security | Suitable production environment, secret/session configuration, real scanning or an approved safe media-ingestion restriction; no high/critical findings; no shopper tracking without resolved consent | Full external review and all applicable security/privacy requirements |
| Media | Real processor already exists: verify actual runtime FFmpeg, limits and representative source fixtures; shared references safe | Broader format/container compatibility |
| Operations | HTTPS/domains, storage/CDN, backups with restore proof, real error/queue alerts and owner, caps, kill switch, rollback; uninstall and request deletion include media/CDN | Full scale test and metering/admin automation |
| Merchant commitment | Explicit pilot terms/permission, truthful capabilities, real support, export/deletion route and applicable data/legal decisions | Listing, pricing/subscription/entitlements and required public legal documents |
| Analytics | Unavailable UI; no ROI claim or placeholder performance numbers | G4 + trusted collection + FR13/refunds + ±3% reconciliation + E3/E4 evidence |

Stop/disable enrollment or player on cross-store exposure, broken cart/theme, unresolved high/critical security issue, excessive resource use, or inability to withdraw content. Pilot size is not a waiver for security, privacy or data-rights obligations. Manual support/export is acceptable only with a tested authorized procedure and audit evidence; no direct unaudited DB bypass.

## 7. Checklist and approval record

- [x] 1.1–1.3 Trigger/context: owner speed request after 3.12; no failed architecture or required rollback.
- [x] 2.1–2.5 All epics assessed; none obsolete; resequence delivery slices without renumbering.
- [x] 3.1–3.4 PRD, architecture, UX and deployment/test/tracking impacts captured above.
- [x] 4.1 Direct adjustment viable, medium implementation effort/risk; 4.2 rollback rejected (wastes verified work); 4.3 earlier milestone viable; 4.4 hybrid selected.
- [x] 5.1–5.5 Issue, impacts, before/after proposals, milestone plan and role handoff recorded.
- [x] 6.1–6.2 Evidence reviewed; historical test claims distinguished from current checks.
- [!] 6.3 Owner approval pending. Do not apply pilot scope reductions until approved.
- [N/A] 6.4 No epic/story IDs added, removed or renumbered; no scope-driven status changes yet.
- [x] 6.5 Concrete next action: original Story 3.13 already authorized; later scope changes await approval.

This proposal does not authorize deployment, enrollment or merchant communications. Story 3.13 implementation can proceed independently of the proposed pilot restrictions.

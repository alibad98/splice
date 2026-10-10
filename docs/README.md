# Slips (سليبس): BMAD Project Kit

This folder is the starting point for building Slips with the BMAD method.

```
slips-bmad/
├── README.md                  <- this file
└── docs/
    ├── Slips_SRS_v0.1.md      <- full requirements (all phases), the detailed reference
    └── prd.md                 <- BMAD-format PRD: MVP requirements, 7 epics, 34 stories
```

> BMAD's agent names, commands, and folder conventions have changed between versions. The order below is the standard BMAD flow; check the commands against the docs of the version you install.

## Setup

1. Create a new git repository and copy this `docs/` folder into it.
2. Install BMAD in the repo (`npx bmad-method install` at the time of writing) and choose your IDE/agent tooling (Claude Code, Codex, or Antigravity).
3. Commit the baseline before any agent touches the files.

## Run order

| Step | Agent | Input | Output |
|---|---|---|---|
| 1 | **You** (not an agent) | `prd.md` Epic 1 | Run the **Salla spike** by hand or with a dev agent: OAuth, injection, add-to-cart, order webhook on a test store. Write `docs/spike-findings.md`. |
| 2 | **Architect** | `prd.md`, SRS, `spike-findings.md` | `docs/architecture.md`: stack, data model, event pipeline, attribution design, performance budget |
| 3 | **UX Expert** | Demo (`slips-sage.vercel.app`), `prd.md` | `docs/front-end-spec.md`: screens, RTL rules, player interaction model |
| 4 | **PM** | Spike findings | Update `prd.md` where the spike changed an assumption (especially FR13 attribution and FR9 injection) |
| 5 | **PO** | All of the above | Run the PO checklist, fix gaps, then **shard** the PRD and architecture into `docs/prd/` and `docs/architecture/` |
| 6 | **SM** | Sharded epics | Draft one story at a time into `docs/stories/` |
| 7 | **Dev** | One approved story | Implement, test, mark ready for review |
| 8 | **QA** | Finished story | Review; fix; mark done |

Repeat steps 6 to 8 for each story, in epic order.

## Rules that keep this safe

1. **Do the spike before the architecture.** Epic 1 answers the biggest unknown (what Salla allows). An architecture written before it is a guess.
2. **One story at a time, in a fresh agent session.** Small context means fewer mistakes.
3. **Review security-sensitive stories yourself.** Stories 1.3, 1.4, 3.3, 5.4, 6.1, 6.2, and 7.5 touch tokens, webhooks, uploads, cart actions, and attribution. AI-written code needs a human read here.
4. **Tests are part of "done".** Attribution (6.2), tenant isolation, and webhook idempotency must have automated tests before launch.
5. **Keep the performance budget in CI from Story 1.2 onward.** The player size is a selling point.
6. **Change the docs, not just the code.** If a story reveals a requirement was wrong, update the PRD first, then continue.

## Suggested pace

| Block | Content | Notes |
|---|---|---|
| Days 1-3 | Epic 1 (spike and foundation) | Biggest risk; gives you a demo for sales |
| Week 1-2 | Epics 2, 3, 4 | Dashboard, content, scheduling |
| Week 2-4 | Epics 5, 6 | Player, purchase, analytics, attribution |
| Week 4-6 | Epic 7 and pilots | Billing, security review, Salla submission |

These are planning estimates for one senior developer working with AI agents, not guarantees. Salla's review time is outside your control, so give customers milestones rather than a fixed delivery date.

## Open decisions to settle early

- Final plan names and prices (Q-04)
- Data residency (Q-05)
- Managed video service (Mux, Cloudflare Stream, or similar) vs custom transcoding
- Whether the dashboard is built fresh or evolves from the existing demo code

# Epic 1 Autonomous Run Log

Owner asked (2026-10-11) to finish Epic 1 unattended. Subagents run on Sonnet at low effort, and each story is pushed when done. This log lists every decision made without the owner, so it can be reviewed later.

## Ground rules for this run
- Each story runs through BMAD `bmad-build-auto` (plan, implement, review, commit), then the parent agent verifies the full pipeline under Node 24, pushes to `claude/serene-thompson-kkbae6` (PR #1) and checks CI.
- Stories 1.11–1.14 (Salla gate G1–G8) need a Salla Partners app and a demo store, which are not available. They are prepared as far as possible without one and marked blocked.

## Story log

### Story 1.1: Monorepo and CI. **Done** (`f610c31`)
- CI on PR #1 is green: lint, typecheck, test and build all pass, and both Docker images (api, dashboard) build.
- Decisions: NestJS uses its default HTTP layer (Express). Staging means CI-built images plus `docs/runbooks/staging.md`; no deploy target until hosting is chosen (Q-05). Removed the root `AGENTS.md` that Turbo generated.
- Deferred: DB check in the health endpoint, a CI smoke run of the images, pinning MinIO, and tests for worker queue registration. All are in `deferred-work.md`.

### Story 1.2: Player stub, bundle budget and layout-shift checks in CI. **Done** (`c555197`, review fixes `a91e28b`)
- Player sizes (gzip): initial payload 6.4 KB (limit 50 KB, core warning at 20 KB), viewer 5.2 KB (cap 25 KB), analytics batcher 0.2 KB (cap 5 KB). The size check runs inside `build`, so going over budget fails CI.
- Layout-shift (CLS) suite: Playwright, 18 scenarios across 3 test themes (content, no content, API timeout, invalid key, scroll past the anchor, anchor already on screen). It runs as its own CI job, `player-cls`, and Chrome's scroll anchoring is turned off in the test themes so it can't hide a shift.
- Decisions:
  - Build output is three entries: `loader.js`, `viewer.js` and `analytics.js`, plus a shared Preact chunk.
  - Content is inserted only when its anchor is below the screen (architecture rule AD-8). If the shopper has already scrolled past, nothing is shown until the overlay fallback arrives in Epic 5.
  - The stub's CDN and API addresses are placeholders (`cdn.slips.app` / `api.slips.app`) until hosting is chosen (Q-05).
  - Retries for the CLS tests are 0, so an intermittent layout shift can't pass on a second try.
- Review: an independent reviewer found 2 medium issues. The loader could insert content above the screen, and the tests couldn't catch it because Chrome's scroll anchoring hid the shift. Both are fixed, along with 3 low ones.
- Deferred: the stub doesn't read `salla.config` yet (Story 1.11); the CLS suite runs against a placeholder loader and must be re-run against the real player in Epic 5.

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

### Story 1.3: Observability baseline. **Done** (`6adbc89`, review fixes `5ca6af8`)
- Delivered:
  - One vendor-neutral telemetry module: pino JSON logs with deep redaction, metrics in Prometheus format at `GET /metrics`, alert rules with runbooks, and env-backed feature flags.
  - `/v1/health` now checks the database and returns 503 "degraded" when it's down; the worker has its own `/health` on port 3002.
  - CI now runs a Postgres 18 service container.
- Decisions:
  - **Redaction is over-cautious by design.** Any key that mentions token, secret, password, cookie, authorization, email, phone, name, address, customer or shopper is masked. Bearer tokens, JWTs, credentials in query strings and email addresses are masked inside free text too.
  - **`/metrics` is off unless `METRICS_TOKEN` is set.** When it's on, it needs `Bearer <token>`, checked with a timing-safe compare.
  - **Alert rules are vendor-neutral PromQL** in `ops/alert-rules.json`: alert at 5% server errors over 5 minutes, and whenever anything is in a dead-letter queue. Owners are placeholder roles, `platform-oncall` and `integration-owner`, until real contacts exist.
  - **Feature flags come from env vars** (`FEATURE_FLAGS=name=true`) for now. AD-22's database config table waits for the schema stories.
- Review: 2 medium findings (log messages and URL query strings skipped redaction) and 6 low ones. All fixed.
- Deferred:
  - No error-tracking vendor yet; errors are only logged, redacted.
  - The alert rules aren't loaded into any alerting system.
  - The dashboard's request-success metric relies on a header that a client could fake.

### CI fix (`961f771`)
- The player CLS job failed on GitHub because it built only `@slips/player`, so `@slips/contracts` had no `dist` on a fresh runner. It now builds the player's dependencies first (`turbo run build --filter=@slips/player...`). From here on, each story runs its CI job commands against a clean checkout before finishing.

### Story 1.4: Design-system foundation tokens. **Done** (`d1a6770`, review fixes `fe20271`)
- Delivered:
  - The approved coral tokens in `packages/ui` (Tailwind 4 with shadcn variables), light and dark.
  - The two-tone focus ring and the `input-border` token.
  - Plus Jakarta Sans and IBM Plex Sans Arabic via `next/font`.
  - The app icon (favicon) and logo SVGs in the dashboard.
  - 10 token tests: no purple, WCAG AA colour pairs, focus ring, type scale, Arabic rules.
- Decisions:
  - **Dark mode follows the OS by default**, with no JavaScript and no flash. The `.dark` and `.light` classes are kept so a manual toggle can be added later.
  - **Fonts are self-hosted at build time** by `next/font/google`. That means the build needs to reach Google Fonts; this is noted in the staging runbook.
  - **Jakarta loads as a variable font** so the 650 heading weight renders. Latin text and digits inside Arabic text fall back to Jakarta.
  - **One contrast exception:** in dark mode, the focus ring's inner white ring on coral fills is 2.81:1. It's accepted because the outer halo carries 3:1 against the surface. The approved tokens are unchanged.
- Review: two high issues are fixed. Dark mode never turned on, and the brand assets were missing. One medium and three low were fixed too.

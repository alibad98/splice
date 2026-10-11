---
title: 'Story 1.1: Scaffold the Turborepo monorepo and CI pipeline'
type: 'chore'
created: '2026-10-11'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-splice-2026-10-10/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repo holds only planning docs. Every later story needs a known place to land, plus automatic checks on each PR.

**Approach:** Hand-build (no starter) a pnpm + Turborepo monorepo matching the spine's source tree and Stack table. Wire lint (with import-boundary rules), typecheck and tests through Turborepo, run them in GitHub Actions on every PR, and add docker compose for local Postgres 18 + MinIO.

## Boundaries & Constraints

**Always:**
- Exact pinned versions:
  - pnpm 12.11.2, Turborepo 2.11, Node ≥24.15 (`engines` plus `.nvmrc` 24), TypeScript 6.0.3.
  - Next.js 16.4 / React 19.3, NestJS 12.1, Vitest 5.0, Playwright 1.64.
  - Zod 4.6, pg-boss 12.37, Drizzle ORM 0.45 / Kit 0.31, Preact 11.0, Vite 8.3.
  - `@salla.sa/embedded-sdk` 0.2.6 and `@salla.sa/twilight` 2.14.590, pinned exactly. Twilight is a devDependency, type-only.
- Import boundaries live in shared ESLint flat config in `packages/config` and fail lint with the rule name:
  - `@slips/db` is imported only by `apps/api`.
  - `packages/player` imports `@slips/contracts` type-only, and `preact` is its only runtime dependency.
  - `apps/api/src/modules/**` never imports `apps/api/src/adapters/**`.
  - Salla packages are imported only under `apps/api/src/adapters/salla/**` (API side).
- API process model:
  - One codebase, `ROLE=http|worker`.
  - The worker reads `WORKER_QUEUES` (subset of `realtime,media,batch`).
  - Queue concurrency and retry policy live in one file: 5 attempts, backoff 30 s→15 min; media gets 3 attempts.
- Env is validated with Zod at boot. A missing or invalid variable exits non-zero and names the variable.
- `HealthResponse` is a hand-written Zod schema in `@slips/contracts` (`v1`). The API serves it at `GET /v1/health` and the dashboard renders it.
- Package scope is `@slips/*`. Arabic-first and the coral tokens arrive in Stories 1.4–1.5; don't style here beyond a bare page.

**Never:**
- No hosting provider, deploy target or secrets: hosting waits on Q-05. Staging means CI-built Docker images (`apps/api`, `apps/dashboard`) plus `docs/runbooks/staging.md`, which states the test/synthetic-data-only rule and that migrations are a separate release step.
- No database tables, RLS, telemetry, design tokens or player stub logic. Those belong to Stories 1.2–1.7.
- No starter templates or `create-*` CLIs left in the history.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| API http boot | valid env, `ROLE=http` | `GET /v1/health` returns 200 and a body that parses with `HealthResponse` | N/A |
| API worker boot | valid env, `ROLE=worker`, `WORKER_QUEUES=realtime,batch` | connects pg-boss, registers only those queue groups | unknown group: exit 1, naming it |
| Bad env | `DATABASE_URL` missing | process exits 1 before listening | message names `DATABASE_URL` |
| Boundary breach | `apps/dashboard` imports `@slips/db` | `pnpm lint` fails | message names the boundary rule |
| Player runtime import | `packages/player` value-imports `@slips/contracts` | lint fails | type-only import passes |

</frozen-after-approval>

## Code Map

- Repo root: only `docs/`, `_bmad*`, `.claude/` and `skills-lock.json` exist. No code yet. Don't touch `_bmad/`, `.claude/` or `docs/`, except to add `docs/runbooks/`.
- `docs/tech-stack.md` and the spine Stack table are the version sources.
- Brand assets in `_bmad-output/planning-artifacts/ux-designs/ux-splice-2026-10-10/brand/` are not used yet.

## Tasks & Acceptance

**Execution:**
- [ ] `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.npmrc`, `.gitignore`, `tsconfig.base.json` -- workspace root with `packageManager: pnpm@12.11.2`; turbo tasks `build`, `dev`, `lint`, `typecheck`, `test` -- one entry point for all checks
- [ ] `packages/config` -- shared tsconfig presets, ESLint flat config with the boundary rules, Vitest preset -- one place for rules
- [ ] `packages/contracts` -- Zod `HealthResponse` v1 plus index; Vitest test -- shared wire shapes
- [ ] `packages/db` -- Drizzle config and empty schema index, no tables -- the API-only DB package exists for the boundary rule
- [ ] `packages/ui` -- empty shared component package (tokens come in 1.4)
- [ ] `packages/player` -- Preact + Vite library skeleton with an empty `src/stub/` and a type-only contracts import -- enables 1.2
- [ ] `apps/api` -- NestJS 12.1:
  - `src/main.ts` role switch; `src/config/env.ts` Zod env
  - `src/modules/health` (http) and `src/worker/` (pg-boss bootstrap with `queues.ts` policy)
  - empty `src/ports` and `src/adapters/salla`
  - Vitest tests for env parsing, health and queue policy
  - `Dockerfile` -- the AD-1 process model
- [ ] `apps/dashboard` -- Next.js 16.4 App Router:
  - `app/(merchant)/page.tsx`, which fetches `/v1/health` and shows its status
  - `app/admin/page.tsx` placeholder
  - test; `Dockerfile` -- route groups exist
- [ ] `docker-compose.yml` -- Postgres 18 and MinIO with healthchecks; `.env.example` -- local stack
- [ ] `.github/workflows/ci.yml` -- on pull request and push:
  - setup Node 24 and pnpm, `pnpm install --frozen-lockfile`
  - `turbo run lint typecheck test build`
  - docker build of both images (no push) -- PR gate
- [ ] `docs/runbooks/staging.md`, `README.md` (dev quickstart) -- documents the staging and data rule

**Acceptance Criteria:**
- Given a fresh clone with Node 24, when `pnpm install && pnpm turbo run lint typecheck test build` runs, then all packages pass.
- Given `docker compose up -d` and `pnpm dev`, then the dashboard shows API health "ok", and the worker logs its registered queue groups.
- Given a PR, when CI runs, then any lint, typecheck, test or build failure fails the workflow.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

- HTTP adapter: NestJS default (Express). Fastify can come later behind the same module code.
- The boundary lint uses `eslint-plugin-boundaries` element types `app-api`, `app-dashboard`, `pkg-db`, `pkg-contracts`, `pkg-player`, `pkg-ui`, `api-module` and `api-adapter`, plus `@typescript-eslint/consistent-type-imports` and a `no-restricted-imports` value-import ban in the player.

## Verification

**Commands:**
- `npx -y node@24 $(which pnpm) install` -- expected: lockfile written, no engine errors.
- `pnpm turbo run lint typecheck test build` (under Node 24) -- expected: all green.
- Temporarily add `import '@slips/db'` to `apps/dashboard`, then run `pnpm lint` -- expected: fails naming the boundary rule. Revert afterwards.
- `ROLE=http` with no `DATABASE_URL` -- expected: exit 1 naming the variable.

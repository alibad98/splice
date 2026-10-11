# Slips

Shoppable Stories and Reels for Salla stores. pnpm + Turborepo monorepo.

```
apps/
  api/          NestJS API, one codebase run as ROLE=http or ROLE=worker
  dashboard/    Next.js App Router: (merchant) and /admin route groups
packages/
  contracts/    Zod wire schemas (v1)
  db/           Drizzle schema and migrations (imported by apps/api only)
  player/       Preact storefront player (stub/ arrives in Story 1.2)
  ui/           shared UI components (tokens arrive in Story 1.4)
  config/       shared tsconfig, ESLint (incl. import-boundary rules), Vitest presets
docs/runbooks/  operational runbooks (see staging.md)
```

## Quickstart

Requires Node 24 (>= 24.15, see `.nvmrc`), pnpm 12.11.2 (`corepack enable` picks it up from `packageManager`) and Docker.

```sh
pnpm install
cp .env.example .env
docker compose up -d          # Postgres 18 + MinIO
pnpm dev                      # API http on :3001, API worker, dashboard on :3000
```

Open http://localhost:3000: the page shows `API health: ok`. The worker logs `registered queue groups: ...`.

## Checks

```sh
pnpm turbo run lint typecheck test build
```

CI (`.github/workflows/ci.yml`) runs the same on every pull request and push to `main`, then builds both Docker images without pushing.

### Import boundaries

`packages/config/eslint.js` fails lint when:

- anything but `apps/api` imports `@slips/db` (`boundary app-api-only-db`);
- `apps/api/src/modules/**` imports `apps/api/src/adapters/**` (`boundary api-module-no-adapter`);
- Salla packages are imported outside `apps/api/src/adapters/salla/**` (`boundary salla-adapter-only`);
- `packages/player` value-imports `@slips/contracts` or imports any other `@slips/*` package (`boundary player-contracts-type-only`, `boundary player-preact-only`).

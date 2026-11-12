# Staging

Status: no hosting provider yet. Hosting, deploy target and secrets wait on **Q-05**.

Controlled-pilot scope was approved on 2026-11-11. This does not make staging suitable for live merchants. Resolve production decisions and evidence in [production pilot](production-pilot.md); deployment/enrollment require separate authorization.

## What "staging" means today

- CI builds two Docker images on every pull request and push to `main`, without pushing them:
  - `apps/api/Dockerfile`: one API image (AD-1). Start it with `ROLE=http`, or `ROLE=worker` plus `WORKER_QUEUES` (any subset of `realtime,media,batch`).
  - `apps/dashboard/Dockerfile`: the Next.js dashboard (standalone output).
- Both images are built from the repo root: `docker build -f apps/<app>/Dockerfile .`
- Nothing is deployed anywhere, and no secrets live in the repo or CI.

## Data rule

- Staging uses **test or synthetic data only**. Never load real merchant, shopper or order data into staging, and never point a staging process at a production database or bucket.
- Salla access in staging is limited to Salla demo/test stores.

## Migrations

- Database migrations (`packages/db`, Drizzle Kit) are a **separate release step**. They run before the new API image is rolled out, never on API or worker boot.
- A release that needs a migration runs it first, checks it, then starts the new `http` and `worker` processes.

## Environment

- Every process validates its environment with Zod at boot and exits non-zero, naming the variable, when one is missing or invalid. See `.env.example` for the variable list.
- Live-Postgres tests default to local test port 5433. When Windows blocks that port, set `TEST_DATABASE_PORT` to an isolated test PostgreSQL instance; do not point tests at development or production data. Existing full-URL test overrides remain supported. Set `FFMPEG_PATH` to a full FFmpeg binary with test-source filters and H.264/AAC/WebP support for processor tests. Turbo forwards these test variables and includes them in test cache keys.

## Dashboard build and Google Fonts

`next build` for the dashboard downloads Plus Jakarta Sans and IBM Plex Sans Arabic from `fonts.googleapis.com` / `fonts.gstatic.com` and self-hosts them in the output. These hosts must be reachable from CI and Docker builds.

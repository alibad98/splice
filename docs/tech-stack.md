# Slips: Preferred Tech Stack (input for the Architect)

These are the owner's stack preferences. The architecture step (`bmad-architecture`) should treat them as the default and record any deviation with a reason.

## Merchant dashboard (frontend)
- **Next.js** (App Router), React, TypeScript
- **shadcn/ui** on **Radix UI** primitives, Tailwind CSS
- **React Hook Form** + **Zod** for forms and validation
- **TanStack Query** for server state; **TanStack Table** for data tables
- **nuqs** for URL search-param state (filters, tabs, pagination)
- **boneyard-js** for skeleton loading screens

## Backend
- **NestJS**, TypeScript
- **PostgreSQL**

## Repo
- Monorepo (Turborepo) holding the dashboard, the API, and shared packages (types, Zod schemas)

## Open decisions for the Architect
- **ORM / query layer:** Prisma, Drizzle, or TypeORM (not chosen yet).
- **Storefront player:** the PRD budget is ≤ 50 KB initial (~20 KB core) with zero layout shift. A full React/Next bundle will not fit, so the injected player likely needs its own lightweight build (vanilla TS or Preact). Decide after the Salla spike.
- Auth, background jobs/queues (webhooks, analytics events), media storage and transcoding, hosting.

## Agent skills installed for this stack (`.claude/skills/`)
impeccable, web-design-guidelines, vercel-react-best-practices, vercel-composition-patterns, shadcn, boneyard, next-best-practices, tanstack-query, tanstack-table, nuqs, react-hook-form-zod, zod, nestjs-best-practices, supabase-postgres-best-practices (applies to any Postgres), turborepo.
Sources are pinned in `skills-lock.json`; update with `npx skills update`.

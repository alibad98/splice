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
- **Drizzle ORM** + Drizzle Kit migrations; **drizzle-zod** to generate Zod schemas shared with the dashboard
  - Why: SQL-like queries keep the analytics and attribution reports readable; full Postgres feature support; one source of truth for types and validation across the monorepo.

## Storefront player (injected into Salla stores)
- **Preact** (React-compatible JSX, ~4 KB), TypeScript
- Mounted as a **Web Component** (`<slips-player>`) with **Shadow DOM**, so Salla theme CSS and player CSS cannot affect each other
- Built as its own package with **Vite** (library mode), separate from the Next.js dashboard
- Budget from the PRD: ≤ 50 KB initial, ~20 KB core, zero layout shift

## Repo
- Monorepo (Turborepo): `apps/dashboard` (Next.js), `apps/api` (NestJS), `packages/player` (Preact), and shared packages (DB schema, Zod schemas, types)

## Open decisions for the Architect
- How the player is loaded into Salla storefronts (script injection mechanism): depends on the Salla spike.
- Multi-platform later (Zid, Shopify): keep Salla-specific code behind a platform-adapter interface; build only the Salla adapter in the MVP.
- Auth, background jobs/queues (webhooks, analytics events), media storage and transcoding, hosting.

## Agent skills installed for this stack (`.claude/skills/`)
impeccable, web-design-guidelines, vercel-react-best-practices, vercel-composition-patterns, shadcn, boneyard, next-best-practices, tanstack-query, tanstack-table, nuqs, react-hook-form-zod, zod, nestjs-best-practices, supabase-postgres-best-practices (applies to any Postgres), drizzle-orm, turborepo. (No maintained Preact skill exists; the React skills largely apply.)
Sources are pinned in `skills-lock.json`; update with `npx skills update`.

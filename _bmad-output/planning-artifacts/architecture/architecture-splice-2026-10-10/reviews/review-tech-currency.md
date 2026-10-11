# Review: Technology Currency and Compatibility

**Target:** `ARCHITECTURE-SPINE.md` (Stack table, AD-1, AD-4, AD-7, AD-8, AD-11, AD-13, Consistency Conventions)
**Date checked:** 2026-10-10
**Method:** `npm view <pkg> dist-tags / peerDependencies / engines / time`, plus inspection of the published `pg-boss@12.37.1` and `@salla.sa/twilight@2.14.590` tarballs, plus WebSearch. `docs.salla.dev` and `devblogs.microsoft.com` could not be fetched directly from this sandbox (DNS failure or proxy 403), so the Salla and TS 7 facts come from search-result excerpts of those pages.

## Verdict

**Needs changes (one blocker).** Every package exists, and every pinned major.minor matches the current npm `latest`. One pin can't be built with the rest of the stack today: **TypeScript 7.0**. One pin is very new: **Preact 11.0**, which went GA 10 days ago. AD-8 and AD-13 each rest on a fact that is only partly verified. Everything else checks out.

## Findings needing a change

| # | Severity | Area | Finding | Recommended fix |
|---|---|---|---|---|
| F1 | **High (blocker)** | Stack: TypeScript 7.0 | `typescript@7.0.2` is `latest` (GA 2026-07-08). It is the native Go compiler, and its package root export is only `./lib/version.cjs`. The JS compiler API is shipped only under `typescript/unstable/*`. `typescript-eslint@8.71.1` (latest) and `@typescript-eslint/parser` declare a peer of `typescript >=4.8.4 <6.1.0`. `@nestjs/cli@12.0.8` depends on `typescript ~6.0.2`, and a maintainer says the CLI must wait for the TS 7.1 programmatic API. `ts-loader` and `fork-ts-checker` also use the compiler API. Next.js 16.3+ reportedly runs with TS 7 for `next build` (secondary source only). So a single repo-wide TS 7.0 pin breaks ESLint type-aware rules, which the boundary lint in `packages/config` needs, and breaks the Nest CLI build. | Pin **TypeScript 6.0.x (6.0.3)** in the Stack table and the shared tsconfig. Optionally, run TS 7 `tsc` (or `@typescript/native-preview`) as an extra, faster `typecheck` CI step only. Revisit when TS 7.1 ships a stable API and typescript-eslint widens its peer range. Write tsconfig without options that TS 7 removed, so a later upgrade is mechanical. |
| F2 | Medium | Stack: Preact 11.0 / AD-7 | `preact@11.0.0` GA was 2026-09-30, and `11.0.1` came out 2026-10-08. Release candidates ran only Aug to Sep 2026. Tooling is compatible: `@preact/preset-vite@2.10.6` accepts Vite 8, `@prefresh/vite` and `@prefresh/core` accept `^11.0.0-0`, and `@testing-library/preact` accepts `>=10`. However, no field reports exist yet for rendering into Shadow DOM, for event delegation across shadow roots, or for coexisting with Salla's Twilight web components (Stencil). The player is the most risk-sensitive deployable, because of NFR1 and the CLS gate. | Keep 11.0.x only if the Epic 1 player spike (stub + loader + Shadow DOM render on 3 themes) passes on it. Otherwise pin **Preact 10.29.x** (10.29.8, mature). Record the fallback in AD-7 and add `[ASSUMPTION until Story 1.2 spike]`. |
| F3 | Medium | AD-8 (CLS policy) | Confirmed: shifts within 500 ms of input are excluded through `hadRecentInput`, but only for *discrete* input (tap, click, keypress). **Scrolling does not count as recent input**, so "insert when the anchor has left the viewport during scroll" gets no exemption. Also confirmed: a shift is scored only when a *visible* element moves. Inserting **below** the viewport moves nothing visible and is safe. Inserting **above** the viewport, after the user scrolls past, pushes visible content down. That counts as a shift unless browser scroll anchoring (`overflow-anchor`) compensates. | Restrict AD-8 to anchors **below** the viewport. For anchors above it, insert only if scroll anchoring is confirmed to apply, or use the overlay fallback. Do not rely on the 500 ms window for scroll-triggered inserts. Add a Playwright CLS case for "user scrolls past anchor, then manifest arrives". |
| F4 | Medium | AD-13 (Salla webhook) | Confirmed from Salla docs excerpts: the header is `X-Salla-Signature`, with a companion header `X-Salla-Security-Strategy: Signature`. Signature is the default strategy for partner apps, and Token is the alternative. **Not confirmed:** the algorithm (HMAC-SHA256) and the encoding (hex or base64, with or without a prefix). The visible excerpts say only that payloads are "hashed", and the docs page could not be fetched directly. | Change AD-13 to: "verify `X-Salla-Signature` (HMAC-SHA256 over the raw body with the app webhook secret, hex; **[ASSUMPTION until verified against a demo-store delivery]**) using a timing-safe compare; reject if `X-Salla-Security-Strategy` ≠ `signature`". Add a recorded real webhook fixture to the Epic 1 integration test. |
| F5 | Low | Stack: Node.js 24 | Node 24 moves from Active LTS to **Maintenance on 2026-10-20**, with security fixes until 2028-04-30. Node 26 becomes Active LTS on 2026-10-28. Every pinned package accepts 24: Vitest 5 `^22.12 \|\| ^24 \|\| >=26`, pg-boss `>=22.12`, Vite `>=22.12`, Next `>=20.9`, Nest `>=20`. The Nest 12 scaffolder wants 24.15+. | Keep 24 for the MVP, but pin `>=24.15`. Add a note to move to Node 26 LTS after the pilot. Make sure the hosting choice under Q-05 offers 26. |
| F6 | Low | Stack: PostgreSQL 18 | 18 is the current GA. **PG 19 GA is scheduled for 2026-10-29** (RC1 on 10-15). pg-boss 12 needs PG 13 or later. | Keep 18, since managed providers lag on new majors. Note "18 (19 when the Q-05 provider offers it GA)". No change to the ADs. |
| F7 | Low | AD-4 / AD-7: `@salla.sa/twilight` types | 2.14.590 (published 2026-10-07) ships `types/index.d.ts`, with `export default interface Salla` covering `config`, `event`, and `api.cart.addItem(): Promise`. It does **not** declare the global `salla`. It also has heavy runtime dependencies (axios, websocket, @jitsu/js, @salla.sa/analytics). | Use it as a **devDependency** with `import type Salla from '@salla.sa/twilight'`, plus a local `declare global { var salla: Salla }` in the `StorefrontPlatform` adapter. Extend the AD-7 lint rule so value imports of `@salla.sa/*` are banned from the player bundle. |
| F8 | Low | Stack: TanStack Table 9 | v9 is **stable**: 9.0.0 on 2026-08-04, now 9.2.8 `latest`, peer `react >=18`. v9 is a breaking API change from v8, and the installed `tanstack-table` agent skill and most online examples target v8. | Keep 9.2. In the dashboard story template, tell agents to use v9 APIs and to follow the v9 migration guide rather than v8 examples. |
| F9 | Low | Stack: Drizzle 0.45 / drizzle-zod 0.8 | `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11` and `drizzle-zod@0.8.3` are the current `latest`, and drizzle-zod peers `zod ^3.25 \|\| ^4`. Drizzle **1.0 is in beta (beta.22)**, and the beta line moves the Zod integration into drizzle-orm. | Keep the pins. Add to Deferred: "Drizzle 1.0 upgrade (drizzle-zod becomes `drizzle-orm/zod`); keep drizzle-zod usage confined to `packages/db` + `apps/api` (already AD-11) so the swap is local". |
| F10 | Low | AD-1 / AD-6 (pg-boss scheduling) | pg-boss 12.37.1 README confirms PG 13+, "Cron and RRULE scheduling, job deferral", and singleton jobs. It suits daily rollups and reconciliation through cron. | Say explicitly that schedule-boundary jobs use **deferred jobs** (`startAfter` + a `singletonKey` per item and boundary) and are cancelled or re-enqueued on edit, not per-item cron schedules. |

## Verified OK (no change)

| Item | Evidence |
|---|---|
| pnpm 12.11 | `latest` 12.11.2 |
| Turborepo 2.11 | `turbo` `latest` 2.11.7 |
| Next.js 16.4 / React 19.3 | `next` `latest` 16.4.0, peer `react ^18.2 \|\| ^19`; `react` `latest` 19.3.0 |
| Tailwind 4.3 / shadcn CLI 4.21 | 4.3.3 / 4.21.4 |
| TanStack Query 5.104 | 5.104.1 |
| nuqs 2.10 | 2.10.2, peer `next >=14.2` |
| RHF 7.89 / @hookform/resolvers 5.9 | 7.89.0 / 5.9.1, resolvers peer `zod ^3.25 \|\| ^4`, `react-hook-form ^7.55` |
| Zod 4.6 | 4.6.5 |
| boneyard-js 1.10 | 1.10.0, peer `react >=18` |
| NestJS 12.1 | `@nestjs/core` 12.1.2, engines `node >=20`. Nest 12 core is ESM-only with CJS interop and adds Standard Schema support in pipes. Compatible with Zod contracts (AD-11). |
| pino 10.4 | 10.4.0 (`nestjs-pino` 5.3.1 available) |
| Vite 8.3 | 8.3.4. `@preact/preset-vite@2.10.6` peer includes `8.x` |
| @salla.sa/embedded-sdk 0.2 | 0.2.6. Pre-1.0, so expect breaking minors; pin exactly. |
| Vitest 5.0 | 5.0.3 stable, peer `vite ^6.4 \|\| ^7 \|\| ^8`. Transpiles without the TS compiler API, so it is unaffected by F1. |
| Playwright 1.64 | 1.64.0 (published 2026-10-07) |
| ESLint | 10.12.0 `latest`; typescript-eslint 8.71 supports ESLint 10 (TS range is the problem, see F1) |
| Salla App Snippets auto-injection | Salla docs: JS (no raw HTML) is saved in the Partners Portal, uploaded to Salla's CDN, and **injected automatically into stores that install the app**. Works for public and private apps. Consistent with AD-7's static stub. The exact `salla.config` keys for store ID and page context could not be fetched; check them in the Story 1.2 spike. |
| CLS 500 ms rule | `hadRecentInput` excludes shifts within 500 ms of discrete input (web.dev). See F3 for the scroll caveat. |
| RFC 9457 | Current Problem Details standard (obsoletes RFC 7807). `application/problem+json` is correct. |

## Sources

- npm registry (`npm view`, run 2026-10-10) for every version, peer and engine claim above. The tarballs of `pg-boss@12.37.1` (README) and `@salla.sa/twilight@2.14.590` (`types/`) were inspected locally.
- [TypeScript 7.0 announcement (Microsoft DevBlogs)](https://devblogs.microsoft.com/typescript/?p=5246); [TS 7.0 migration playbook](https://www.digitalapplied.com/blog/typescript-7-0-ga-native-compiler-migration-playbook-2026); [Why ESLint can't upgrade to TS 7.0 yet](https://dev.to/the-modern-web/why-angular-vue-and-eslint-cant-upgrade-to-typescript-70-yet-and-why-ts-71-changes-441g); [Next.js 16.3 + TS 7 upgrade](https://www.achromatic.dev/blog/nextjs-16-3-typescript-7-upgrade)
- [NestJS 12 release notes](https://newreleases.io/project/github/nestjs/nest/release/v12.0.0); [NestJS 12 toolchain defaults](https://www.besthub.dev/articles/nestjs-12-esm-core-packages-cjs-compatibility-new-toolchain-defaults-14ba62ea8842)
- [Salla Webhooks docs](https://docs.salla.dev/421119m0.md); [Salla Intro to App Snippets](https://docs.salla.dev/2220706m0.md)
- [web.dev CLS](https://web.dev/articles/cls); [Debug layout shifts](https://web.dev/debug-layout-shifts/)
- [Node.js EOL dates](https://endoflife.date/nodejs); [PostgreSQL 19 schedule (pgsql-hackers)](https://www.postgresql.org/message-id/915517c4-d0ee-49f9-bbeb-c683ef2b9d3f%40postgresql.org)

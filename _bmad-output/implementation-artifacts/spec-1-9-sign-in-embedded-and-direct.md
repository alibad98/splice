---
title: 'Story 1.9: Sign merchants in from the Salla iframe and the direct link'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_revision: '0fb05ba5b6498d3878515de1f8aa6a6f48db1d7c'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      Verify app binding of the embedded token in Story 1.11-1.13; owner to confirm staff access (any Salla user who can open the app in the store's dashboard gets the store's merchant session).
    evidence: |-
      Security review: the documented introspection response has no app id, so only S-Source binds the app; platform_user_id is stored on the session row and logged.
  - summary: >-
      Embedded token introspection request and response shapes are taken from the embedded SDK source, not a live call (verify in Story 1.11-1.13).
    evidence: |-
      POST https://api.salla.dev/exchange-authority/v1/introspect with S-Source: <app id>, body {env, token, iss, subject}; response {success, data:{merchant_id, user_id, exp}}. Whether merchant_id equals the OAuth user/info merchant.id (the locator key), the exp format, and which status codes mean "bad token" are unconfirmed.
  - summary: >-
      Embedded iframe behaviour needs a real Salla dashboard (verify in Story 1.11-1.13): getToken() from the page URL, auth.refresh() re-rendering the iframe, Sec-Fetch-Dest: iframe on the first navigation, and that the Salla dashboard origin is exactly https://s.salla.sa for frame-ancestors.
    evidence: |-
      Desk research only. EMBED_ALLOWED_ORIGIN overrides the origin without a code change.
  - summary: >-
      No rate limit or lockout on POST /v1/session/embedded and no retention job for merchant_sessions beyond lazy deletion of a store's expired rows at its next sign-in.
    evidence: |-
      Low risk at pilot scale (a valid host token is required, introspection is paced by Salla). Add throttling and a prune job with the other retention jobs.
  - summary: >-
      Cookie sessions rely on SameSite=Lax plus a custom-header CSRF token; there is no Origin/Referer check. API and dashboard must be same-site (sibling hosts under one registrable domain, set SESSION_COOKIE_DOMAIN) for the dashboard server to receive the cookie.
    evidence: |-
      Deployment note for the runbook; the host-only cookie works on localhost ports in dev.
  - summary: >-
      A returning merchant who opens the direct link runs the full Salla OAuth install path (tokens are re-stored in place) rather than a lighter sign-in-only grant.
    evidence: |-
      AD-12 says "Salla OAuth". A sign-in-only scope or an id-token style flow would avoid rotating stored tokens on every sign-in; revisit once Easy Mode (1.10) lands.
  - summary: >-
      No end-to-end browser test of the iframe flow (no Salla host, no demo store).
    evidence: |-
      Covered by SessionClient unit tests with a fake host, SSR render tests and API composition tests; a Playwright run against a host stub can be added when the dashboard has a real API in CI.
---

<intent-contract>

## Intent

**Problem:** There is no way for a merchant to reach the dashboard: no session, no sign-in from inside Salla or by direct link, no admin guard, no framing policy, and the connection chip is a placeholder.

**Approach:** Embedded: the dashboard sends the host `getToken()` token to the API, which introspects it server-side (port method on the Salla adapter), binds a session to the located store and returns a 15-minute bearer kept in browser memory and re-minted before expiry. Direct link: the existing Salla OAuth callback also issues a first-party httpOnly Secure SameSite=Lax cookie session with a CSRF token. A global guard enforces sessions, CSRF, idle expiry (12 h) and a deny-by-default admin surface.

## Boundaries & Constraints

**Always:** identity only from introspection or OAuth, never a request parameter; Salla URLs/headers/fields only in the Salla adapter (the one dashboard file touching the embedded SDK is lib/embedded/host.ts); sessions are a tenant table (forced RLS) holding only a hash of the secret; tokens and cookies never reach logs; problem+json for every refusal; no third-party cookies.

**Never:** a bearer or token in browser storage or a cookie in embedded mode; trusting a store id from the client; merchant sessions on /v1/admin; an admin sign-in provider (deferred to Epic 7); framing of /admin.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Embedded sign-in | valid host token, installed store | 200 bearer (15 min), no cookie; GET /v1/session shows store and connection | n/a |
| Bad host token | introspection rejects | 401 invalid_token; dashboard asks the host to refresh | problem+json |
| Unknown / disconnected / uninstalled store | valid token | 403 store_not_installed with reinstall message, no session row | problem+json |
| Platform down | introspection unavailable | 503 platform_unavailable; an existing bearer stays usable | problem+json |
| Direct sign-in | OAuth callback ok | slips_session cookie (HttpOnly, Secure, SameSite=Lax); session info has csrf_token and Open in Salla URL | install_error redirect on failure |
| Cookie POST without CSRF | wrong/missing x-csrf-token | 403 csrf_invalid | problem+json |
| Idle 12 h / bearer past 15 min | next request | 401 session_expired, cookie cleared, dashboard shows friendly sign-in | problem+json |
| Sign out | either mode | row deleted at once; old credential 401 | n/a |
| Merchant calls /v1/admin/** | any merchant credential | 403 admin_forbidden; sign-in stub denies | problem+json |
| Framing | merchant page / /admin | frame-ancestors Salla origin / 'none' | n/a |

</intent-contract>

## Code Map

- `packages/db/migrations/0006_merchant_sessions.sql`, `packages/db/src/schema/integration.ts` -- merchant_sessions tenant table (owner: session); registered with the cross-tenant harness
- `packages/contracts/src/v1/session.ts` -- EmbeddedSession, SessionInfo, problem codes
- `apps/api/src/ports/commerce-platform.ts`, `adapters/salla/salla-platform.ts`, `salla-endpoints.ts` -- embedded.introspect / openUrl on the port and the Salla adapter
- `apps/api/src/ports/admin-access.ts` -- AdminAccess port, deny-all default, 30-minute admin idle constant
- `apps/api/src/modules/session/*` -- SessionService (create, authenticate, revoke, CSRF, cookie), SessionRepository, global AccessGuard, @Public()
- `apps/api/src/modules/auth/*` -- POST /v1/session/embedded, GET /v1/session, POST /v1/session/sign-out
- `apps/api/src/modules/admin/*` -- /v1/admin stub (sign-in denies, session route guarded)
- `apps/api/src/modules/integration/*` -- findStoreForSignIn (locate_store reuse); callback issues the direct session cookie
- `apps/api/src/http.ts`, `infra.module.ts`, `config/env.ts` -- SessionConfig, CORS credentials, frame-ancestors 'none' on API responses, SESSION_COOKIE_DOMAIN
- `apps/dashboard/lib/session/session-client.ts`, `server.ts`; `lib/embedded/host.ts`, `policy.ts`; `proxy.ts` -- in-memory bearer client, server cookie session, SDK shim, framing headers
- `apps/dashboard/components/session/*`, `components/shell/ConnectionChip.tsx`, `StoreName.tsx`, `lib/shell-context.ts`, `app/(merchant)/layout.tsx` -- gate, actions, live chip
- `packages/config/eslint.js` -- boundary: embedded SDK allowed only in apps/dashboard/lib/embedded

## Tasks & Acceptance

**Execution:** all items in the Code Map are done; tests: apps/api/src/composition/session.test.ts (live Postgres, real RLS role), adapter introspect tests, dashboard session-client/server/proxy/gate tests, boundaries and db tests.

**Acceptance Criteria:**
- Given the dashboard in the Salla iframe, when getToken() returns a token, then the API introspects it, binds the session to that store and returns an in-memory bearer re-minted before expiry; no cookie is used (composition + session-client tests).
- Given a direct link, when OAuth completes, then an httpOnly Secure SameSite=Lax cookie plus CSRF token is issued and Open in Salla is shown (composition + render tests).
- Given a cookie request without a valid CSRF token, then 403 application/problem+json.
- Given 12 idle hours, then the session expires with friendly sign-in copy; Sign out ends it at once in both modes.
- Given a merchant session on /v1/admin/**, then 403; admin sign-in is a deny-by-default stub.
- Given merchant pages, then frame-ancestors is the Salla origin; /admin sends 'none' (proxy tests).
- Given an unknown/uninstalled store token, then refused with a reinstall message; sessions are tenant-scoped under RLS.
- Given a signed-in store, then the dashboard connection chip shows its real ConnectionStatus; ?lang survives (existing locale handling untouched, sign-in card in ar/en).

## Spec Change Log

## Review Triage Log

### 2026-10-11 -- self-review (no subagent tool available; parent should run an independent review)
- verdicts: 5 findings -- high 0, medium 2, low 1, false 2
  - `[medium]` `[patch]` lib/shell.ts mixed server-only session code with constants used by client components (Next build failed) -- split into lib/shell.ts (pure) and lib/shell-context.ts (server).
  - `[medium]` `[patch]` a failed re-mint must not sign out a merchant still holding a valid bearer -- SessionClient keeps the session and retries in 15 s; only a first mint or a hard refusal shows an error.
  - `[low]` `[defer]` throttling and session retention job (see deferred).
  - `[false]` `[reject]` bearer accepted for direct sessions -- authenticate() requires mode embedded for Authorization and direct for the cookie (tested).
  - `[false]` `[reject]` forged store id in the credential reaches another tenant -- the lookup runs under that store's RLS context and the secret hash must match (tested).

## Implementation Notes

- DECISION: sessions are server-side rows (tenant table `merchant_sessions`, owner module `session`, added to OWNERSHIP) so Sign out and idle expiry are immediate; the credential is `<storeId>.<sessionId>.<secret>` and only sha256(secret) is stored. Embedded bearer lifetime 15 min; direct cookie absolute 30 days; both subject to the 12 h idle rule.
- DECISION: the embedded bearer only works in `Authorization` and the cookie only as a cookie (mode is checked), so a stolen cookie value is not a bearer.
- DECISION: CSRF token = HMAC(session secret key, session id), returned by GET /v1/session (cookie sessions only) and required as `x-csrf-token` on non-GET requests; bearer requests need no CSRF.
- DECISION: direct-link sign-in reuses the Story 1.8 OAuth install endpoints (GET /v1/integrations/salla/install and /callback); a successful callback additionally sets the session cookie. The sign-in button therefore runs the install path for returning merchants too.
- DECISION: global AccessGuard is default-deny for every route not marked @Public(); /v1/admin/** is routed only to the AdminAccess port (deny-all by default), so merchant credentials are never consulted there. Admin idle timeout (30 min) is a constant on the port for the future provider.
- DECISION: the embedded SDK is imported only by apps/dashboard/lib/embedded/host.ts (lint boundary widened to that folder, with a test); it is imported lazily and the token is read from the page URL.
- DECISION: framing headers are set by the dashboard proxy: merchant pages `frame-ancestors <EMBED_ALLOWED_ORIGIN, default https://s.salla.sa>`, /admin `frame-ancestors 'none'` plus X-Frame-Options DENY; merchant pages also send Referrer-Policy no-referrer so the host token in the URL never leaks. Every API response sends `frame-ancestors 'none'`.
- DECISION: the shell decides embedded vs direct from the browser (framed = window.parent differs from window), with Sec-Fetch-Dest: iframe as a server hint to avoid a sign-in flash; the chip is a client component reading the live session and falling back to the server value.
- DECISION: dashboard /admin shows only a sign-in-unavailable placeholder (no data); the browser-reachable API URL is PUBLIC_API_URL (defaults to API_URL), sibling-host cookie sharing uses SESSION_COOKIE_DOMAIN.

- DECISION (security review): staff access -- any Salla user who can open the app inside a store's Salla dashboard gets that store's merchant session (Salla controls who sees the app; one merchant account per store, no team roles). The platform user id is stored on merchant_sessions.platform_user_id (migration 0007) and logged at sign-in.
- DECISION (security review): routing is case-sensitive and the access guard lower-cases the path for the admin check; a missing or expired introspection `exp` is rejected; the introspected app id/aud/client_id must equal the configured app when present; the session secret is compared before the mode; a new cookie sign-in revokes the session named by an existing cookie.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm turbo run lint typecheck test build` -- expected: all tasks successful, against local Postgres 16 at 127.0.0.1:5433.

## Auto Run Result

Status: done. Planning, implementation and review were performed by me in one pass (no subagent tool was available); the parent should run an independent review.

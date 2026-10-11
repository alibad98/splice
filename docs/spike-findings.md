# Salla spike findings (Epic 1 gate G1 to G8)

**Status: awaiting hands-on verification.** Nothing below has been confirmed on a real Salla store. "Desk verdict" comes from `docs/salla-desk-research.md` (2026-10-10). Hands-on results are all PENDING. Follow `docs/runbooks/salla-gate-testing.md`; tools are in `tools/salla-gate/`.

Demo store: _(name / id)_  Partners app id: _(id)_  Themes tested: _(1)_, _(2)_, _(3)_  Date: _(date)_  Tester: _(name)_

## Gate results

| Gate | Capability | Desk verdict | Hands-on result | Evidence | Fallback if failed | Affected FRs |
|---|---|---|---|---|---|---|
| G1 | Storefront injection (App Snippet, page type, ids, CSP, reserved space) | Likely pass | PENDING | _theme names, `g1-page-context.js` JSON, screenshots_ | Guided manual snippet (FR17 guide); if neither works: no-go on storefront | FR1, FR2, FR17 |
| G2 | Add to cart, simple products (guest and signed in) | Likely pass | PENDING | _`g2-g3` JSON (guest and signed in)_ | Open the product page, CTA "View product"; no reliable cart path: no-go on in-content purchase | FR11, FR23 |
| G3 | Add to cart, products with required options | Likely pass (needs Slips option picker) | PENDING | _fetchOptions and add responses_ | Keep FR23: "View options" opens the product page | FR23 |
| G4 | Cart tagging echoed in orders | Unclear | PENDING | _order.created fixture, thank-you page id, cart id vs checkout id_ | Order note or thank-you beacon with documented accuracy loss; else FR13 demoted to "assisted orders" and E3 re-decided | FR13 |
| G5 | Install and billing events and plan structure | Likely pass, with gaps | PENDING | _event files in order with times; plan change behaviour_ | Manual plan assignment by Slips Admin for the pilot | FR28 and billing (Story 7.2a) |
| G6 | Webhook lifecycle (signature, retries, ordering) | Likely pass | PENDING | _recorded fixtures, retry timings, header names_ | Periodic reconciliation polling (FR25); FR24 bounds relaxed | FR24, FR25 |
| G7 | Store time zone from Salla | Likely fallback | PENDING | _`/admin/v2/store/info` response (PII removed)_ | Asia/Riyadh default with a merchant setting | FR8 |
| G8 | Dashboard re-entry and consent signal | Re-entry likely pass; consent unclear | PENDING | _embedded load and introspection result; `cookies-consent` values_ | Separate OAuth login link; consent default per Q-18 | FR28, Q-18 |

## Items to verify (from `_bmad-output/implementation-artifacts/deferred-work.md` and specs, tagged "verify in Story 1.11-1.13")

- [ ] Salla OAuth, user-info and Admin API response shapes, refresh-failure semantics and webhook signature match the adapter fixtures (Story 1.8).
- [ ] Embedded introspection shape (exchange-authority endpoint, `S-Source`, `merchant_id`/`exp`) and iframe behaviour (`getToken` from the URL, `auth.refresh`, `Sec-Fetch-Dest`, `s.salla.sa` framing origin; `EMBED_ALLOWED_ORIGIN` overrides) (Story 1.9).
- [ ] App binding of the embedded token: the documented introspection response has no app id or audience; the adapter checks `app_id`/`aud`/`client_id` only if present, otherwise relies on the `S-Source` header (Story 1.9, security review).
- [ ] Webhook signature header and encoding (hex HMAC-SHA256 of the raw body), absence of an event id (we hash the raw body, so a retry resends the same bytes), authorize payload fields (`data.access_token`, `refresh_token`, `expires`, `scope`), and presence and format of `created_at` (Story 1.10).
- [ ] Real event ordering and timestamps (worst case a stale event is applied once) (Story 1.10).
- [ ] Owner to confirm staff access: any Salla user who can open the app in a store's dashboard gets that store's merchant session (not a hands-on check; a decision).

## Other open questions to settle on the way

- [ ] `page.slug` values for home and category pages, and the category id source (spike assumes `index`, `product.index` and the `/c<id>` URL segment).
- [ ] Does `notes` survive checkout into `order.created` `items[].notes`; is it visible or editable by the shopper.
- [ ] Do plan upgrade and downgrade fire their own events.

## Go / no-go decision

Rules (Story 1.14):

- List G1 to G8 each with pass or fail, evidence links and the fallback chosen for each fail.
- If any gate failed, list the affected requirements (for example FR11, FR13, FR17, FR23, FR24) with the proposed PRD change, and mark Epics 2 to 7 as **not to be sharded** until the PRD is updated.
- If G1 fails and the manual-snippet fallback does not work: state **no-go for the storefront scope**.
- If G2 has no reliable cart path: state **no-go for in-content purchase**.
- Propose closing **Q-01** and **Q-11** with the evidence, and record the Q-18 consent default from G8.

**Decision:** _PENDING (go / conditional go / no-go)_

**Affected requirements and proposed PRD changes:** _none recorded yet_

**Q-01 / Q-11 / Q-18 proposals:** _pending_

**Product owner sign-off:** _name, date: ____________________  (not signed)_

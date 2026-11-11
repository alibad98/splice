---
title: 'Story 3.3: create a Story or Reel with title, format and CTA'
type: 'feature'
created: '2026-11-05'
status: 'in-review'
route: 'dispatch'
baseline_commit: '9d95db199d1a4dd22f891c8d56b98165c3099592'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-ui-kit-global-components.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/content/new` and `/content/[id]` are placeholders. Merchants cannot create or edit a Story or Reel, and there is no API to update one.

**Approach:** Replace the placeholders with one `ContentEditor` (RHF + contract Zod) that has a format/title card and a CTA card beside a preview placeholder. Drafts are created on first save and autosaved; edits go through a new `PATCH /v1/content/:id` in `content-lifecycle.ts` that emits `content.item.edited`. Open-link URLs are checked against the store's synced domains on both client and API.

## Boundaries & Constraints

**Always:**
- Layout per mockup `key-content-editor.html`: header (back link to list, title `dir="auto"`, status chip, "Saved" indicator); form on the start side and the preview placeholder on the end side from `lg`; single column with a sticky "Preview" button on `md`; stacked with a preview toggle on `sm`.
- Format is the kit `Tabs` segmented control (Story/Reel). Title is 1–80 characters. CTA label is 1–40 characters, with quick-pick chips ("Add to cart", "Shop now"). CTA action is a Select (add to cart / open product / open link); the URL field shows only for open link.
- Open-link URL: `https`/`http` only, and the host must equal one of `stores.synced_domains` or be a subdomain of one. On failure the field shows an error naming the rule ("Use a link on your store's domain: {domain}"). The API repeats the check and returns a 422 problem with type `cta-url-not-store-domain`. The dashboard reads the domains from a new `store.domains` field on `SessionInfo`.
- Drafts autosave 1 s after the last valid change and show "Saving…" → "Saved". An invalid form never saves. Non-draft items use an explicit "Save changes" button and the "Changes saved" toast.
- Errors appear on blur and on submit. Submitting shows an error summary (`role="alert"`, focused, links that focus each field) in the active language. Fields get `aria-invalid` and `aria-describedby`.
- Leaving with unsaved or failed changes asks first: in-app link clicks use `dialog.confirm()`, and reload/close uses `beforeunload`.
- Merchant text is stored as-is and rendered as escaped React text with `dir="auto"`. All copy is in `ar`/`en`, Arabic first, with logical CSS only.
- Only `content-lifecycle.ts` writes `content_items` (guard test). An edit keeps the status and emits `content.item.edited` in the same transaction. Reads of another store's item return 404.

- Decisions (2026-11-05, Ali):
  - **CTA styles = `ink` (default), `light`, `outline`.** Shown as three swatches; contracts `CTA_STYLES` enum validates `cta_style` (null = ink).
  - **Draft created once a title is typed.** Defaults: format Story, action Add to cart, label in the UI language. Format-only changes before a title save nothing.
  - **Edit every non-archived status.** Non-drafts use "Save changes"; Archived opens read-only with a note.

**Never:** Build slides, media, the product picker, placements, schedule, publish or the live preview (3.4–3.12, Epic 4). Recompute status on the client. Read `stores` from the content module's SQL; use an integration service read.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| First save | `/content/new`, title typed | after 1 s `POST /v1/content` → Draft; URL becomes `/content/{id}` with no remount; "Saved" | POST fails → "Couldn't save. Retry" inline, form kept |
| Autosave | Draft, CTA label edited | one `PATCH` after 1 s; "Saved" | 409/404 → error toast, refetch |
| Open link off-domain | domains `[demo.salla.sa]`, URL `https://evil.com/x` | inline rule error, no save | API: 422 `cta-url-not-store-domain` |
| Open link subdomain | `https://www.demo.salla.sa/p` | accepted | — |
| Switch action | open_link → add_to_cart | URL cleared and saved as null | — |
| Published edit | status published | no autosave; "Save changes" → PATCH → toast | — |
| Archived | status archived | PATCH → 409 `invalid-transition`; editor read-only with a note | — |
| Cross-store | store B session, A's id | GET/PATCH 404 | — |
| XSS | title `<img onerror>` | stored verbatim, shown as text | — |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/v1/content.ts` -- `ContentCreateInput` (~l.98) has a strict object and an open_link refine; split it into a `ContentFields` base. Add `ContentUpdateInput` (partial, strict, same refine applied to the merged result in the API), `content.item.edited` in `CONTENT_EVENT_NAMES`, `CTA_STYLES` (replace the free-string `cta_style`) and `CONTENT_CTA_URL_NOT_STORE_DOMAIN`, plus a pure `isStoreDomainUrl(url, domains)` shared by the API and the dashboard. Tests next to it.
- `packages/contracts/src/v1/session.ts` -- `store: { name, domains: string[] }`; `auth.service.ts:51 describe()` fills it from the store row (integration repository read).
- `apps/api/src/modules/content/content-lifecycle.ts` -- add `edit(tx, storeId, id, patch)`: load the row FOR UPDATE, 404 if missing/deleted, `InvalidTransitionError` if archived, merge, re-validate the refine, update the columns and `updated_at`, then `publishEvent('content.item.edited')`. Model it on `create` (l.49).
- `apps/api/src/modules/content/content.controller.ts` -- `@Patch('content/:id')`. Before creating or editing, check `cta_url` with `isStoreDomainUrl` against the domains read through `IntegrationService` (or a small exported reader) → 422 problem. Also cover `POST` (l.61). Update `docs/openapi.ts` and its test.
- `status-guard.test.ts` -- must stay green; edit lives in `content-lifecycle.ts`.
- `apps/dashboard/lib/api/fetch.ts` -- `postJson` takes no body; add `sendJson(client, method, path, body, schema)`. `lib/api/content.ts` -- `useContentItem(id)`, `useCreateContent`, `useUpdateContent` (set the item cache, invalidate lists).
- `apps/dashboard/components/content/editor/` (new) -- `ContentEditor.tsx`, `FormatTitleCard.tsx`, `CtaCard.tsx`, `PreviewPlaceholder.tsx` (9:16 ink frame with title and CTA pill, note "Live preview arrives soon"), `use-autosave.ts`, `use-leave-guard.ts`, `editor.test.tsx`. Add `react-hook-form` and `@hookform/resolvers` (v5, zod 4) to the dashboard.
- `app/(merchant)/content/new/page.tsx`, `content/[id]/page.tsx` -- render the editor (`[id]` loads the item with skeleton/404/error states). After the first create, use `window.history.replaceState` so the form doesn't remount.
- `packages/ui/src/error-summary.tsx` (new) -- `ErrorSummary` (title, items `{id,label}`, focuses itself on mount, links focus the field). Add tests, a gallery entry, and a registry row in `spec-ui-kit-global-components.md`. Reuse `Field`, `Input`, `Select`, `Tabs`, `Button`, `Alert`, `toast`, `dialog.confirm`.
- `i18n/messages/{en,ar}.ts` -- `content.editor` group; parity test.
- `apps/api/src/composition/content.test.ts` -- PATCH, domain, cross-store and archived rows (live DB on 5436).

## Tasks & Acceptance

**Execution:**
- [x] contracts: update input, edited event, domain helper, session domains (+ tests).
- [x] API: lifecycle `edit`, PATCH route, domain check on POST/PATCH, session domains, OpenAPI (+ unit and composition tests).
- [x] `packages/ui` ErrorSummary (+ test, gallery, registry row).
- [x] dashboard: fetch helper, hooks, editor components, pages, i18n, deps.
- [x] `editor.test.tsx` -- matrix UI rows, autosave debounce, summary focus/links, leave confirm, responsive preview toggle.

**Acceptance Criteria:**
- Given "Create your first story" on the list, when clicked, then the editor opens at `/content/new` with the title focused.
- Given a Draft saved, when the list is reopened, then the item shows with its title and Draft chip.
- Given `pnpm turbo run lint typecheck test build`, then all pass (except the known Windows-only `@slips/player#build`).

## Implementation Notes

- `content.item.edited` payload: `{ v, store_id, content_id, status, changed: field[] }` (strict). A PATCH that changes nothing writes nothing and emits nothing (200 with the current item).
- `ContentLifecycle.edit` clears `cta_url` when the merged action is not `open_link` and the patch did not send one; a merged item that breaks the open-link rule is 400 `invalid_body`. Archived -> `InvalidTransitionError(.., 'edit')` -> 409 `invalid-transition`.
- Domain check runs in the controller before the write (`IntegrationService.getSyncedDomains`), so an off-domain URL answers 422 even for an unknown id. Problem `code` is `cta_url_not_store_domain`.
- `ContentItem.cta_style` is now the `CTA_STYLES` enum; a legacy stored value outside it reads as `null` (ink).
- `SessionInfo.store.domains` defaults to `[]`; dashboard session state carries it as `storeDomains`.
- `isStoreDomainUrl` also rejects URLs with credentials and accepts a domain list entry stored as a URL.
- Drafts also get an explicit "Save draft" button (mockup), which is the submit path for the error summary on drafts.
- The content list header now shows a "New story" link once the store has content (otherwise the empty state's "Create your first story" is the only way in).
- `ApiError` gained the problem `type` (4th arg); `postJson` is now `sendJson('POST', no body)`.

- 2026-11-05 (`/code-review medium`): an edit that does not send `cta_style` keeps a stored legacy style outside the presets (it read as null and was erased before). The content write guard now lets `composition/*.test.ts` seed `content_items` through admin SQL, which is needed to create pre-3.3 legacy rows. Production paths stay guarded, and a guard fixture covers this.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm -C packages/contracts test`, `pnpm -C packages/ui test`, `pnpm -C apps/dashboard test` -- pass.
- `pnpm -C apps/api exec vitest run src/composition/content.test.ts src/modules/content src/modules/auth src/docs` (live DB on 5436) -- pass.
- `pnpm turbo run lint typecheck` -- pass.


### Pilot review closeout — 2026-11-11

Closed: current content API/editor suites and browser checks pass for validation, CTA/store-domain rules, explicit Published saves, localized recovery and unsaved navigation.

Actual shared verification: API 677, dashboard 367, contracts 92, DB 62, UI 102 and player 62 unit tests passed; dashboard 16 and player 33 browser tests passed. All 26 repository lint/typecheck/test/build tasks succeeded. See [review-gap closeout](review-gap-closeout-2026-11-11.md) for commands, environment, initial failures, cache use and remaining acceptance/launch gates. These are executed results; older expected-only commands above remain historical.

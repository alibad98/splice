# Production pilot preparation

Status: preparation only, scope approved 2026-11-11. Provider/region, merchant, named support/operations owner and numeric caps are not selected. Record decisions and dated evidence in [pilot readiness](../../_bmad-output/implementation-artifacts/pilot-readiness.md). This runbook is a release checklist, not evidence that deployment controls already exist. Staging stays synthetic/demo-only.

## Environment and media

- Select a production environment suitable for real merchant data, with isolated secrets, database, buckets and HTTPS domains. Record provider/region, storage/CDN and backup/monitoring choices.
- Validate actual supported same-site/iframe and direct-link session configuration against deployed origins. Protect source media; expose only processed immutable outputs. Confirm storage access and signed-link expiry.
- `apps/api/src/http.ts` already wires `FfmpegMediaProcessor` for workers; verify runtime FFmpeg, representative inputs, limits, rendition playback and shared asset reference safety. Do not rebuild transcoding.
- The current default `EicarMalwareScanner` is insufficient for production. Require real scanning or a separately approved and verified safe ingestion restriction before live media. Scope approval does not approve such a restriction.
- Set numeric upload/storage/queue/cost caps, enforcement and alert thresholds. Verify tenant isolation, authenticated access, export/deletion audit and media/CDN purge. Resolve all high/critical security findings.

## Release order and rollback

1. Before release, record image/artifact revisions, migration compatibility, backups and restore evidence, approved configuration, named owners and separate deployment authorization.
2. Run expand/contract migrations as a separate step; verify compatibility with the previous release.
3. Roll out workers and verify queue registration, processing and retries before new HTTP producers.
4. Roll out HTTP, check health/auth/tenant behavior, then deploy dashboard and verify re-entry and the complete editor-to-storefront journey. Each stage must remain compatible with the previous release.
5. Verify enrolled-store restriction, immutable player release/channel compatibility, kill switch and rollback by channel repoint/previous application image. Record the rehearsal. Use compatible forward migration repair when needed; do not assume destructive schema rollback.

## Acceptance and operations

Route real error-rate, webhook, queue depth/age, compile-lag, player and resource alerts to a named owner. Restore an encrypted database backup in isolation and record outcomes. Rehearse stopping enrollment/player and withdrawing content, including CDN behavior.

Verify Home Story publish/playback, guest/signed-in cart, View options, deleted/out-of-stock states, Arabic/English, keyboard/reduced motion, three themes and added CLS/CWV. Archive/delete must withdraw within one minute; product freshness must satisfy the existing budget. Disconnected stores keep the last good manifest while sync pauses; uninstalled/purged/unknown stores return empty. Check reinstall and stale-epoch protection.

Obtain merchant permission and owner acceptance before enrollment; begin with one merchant and expand to at most three after acceptance. Provide real support and a tested audited export/delete route. Keep shopper tracking and analytics unavailable. Disable enrollment/player on cross-store exposure, broken cart/theme, high/critical findings, excessive resources or inability to withdraw content.

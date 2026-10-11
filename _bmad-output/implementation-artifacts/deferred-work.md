- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-monorepo-ci.md`
  summary: CI should smoke-run both Docker images (http health check, worker against a Postgres service).
  evidence: Images are built but never started; severity medium (unverified until CI runs once).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-monorepo-ci.md`
  summary: Pin the MinIO image to a verified release tag or digest.
  evidence: docker-compose.yml uses minio/minio:latest; the tag couldn't be verified from the sandbox.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-observability-baseline.md`
  summary: Error tracking has no vendor sink; captured errors are only logged (redacted) at error level.
  evidence: Observability vendor is deferred (Q-05). Add an adapter behind Telemetry.captureError when chosen.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-observability-baseline.md`
  summary: Alert rules in ops/alert-rules.json are not loaded by any alerting backend yet.
  evidence: No hosting or monitoring vendor exists; wire the file into the chosen backend and route owners to real on-call contacts.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-observability-baseline.md`
  summary: Queue age metric depends on pg-boss readyOldestSeconds, which is null until a monitor pass counts the queue.
  evidence: Reported as 0 meanwhile; verify against a real backlog when the first queue lands.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-observability-baseline.md`
  summary: Feature flags are env-backed; AD-22 names a config table.
  evidence: Move to a DB table behind the FeatureFlags port once the schema and tenancy stories land (1.6).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-observability-baseline.md`
  summary: Dashboard SLI counting trusts an x-slips-client header or /v1/dashboard path prefix.
  evidence: Fine for metrics; revisit when dashboard auth (1.9) defines the dashboard API surface.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-transactional-domain-event-transport.md`
  summary: The http role has no pg-boss producer yet; publishEvent needs a send-only PgBoss in the http infra when the first module publishes.
  evidence: events.dispatch is created by the worker at boot, so publishing before the first worker boot fails on the queue foreign key.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-transactional-domain-event-transport.md`
  summary: event_deliveries is never pruned; slips_app has no DELETE on it.
  evidence: Add a retention job (owner role or a granted function) deleting rows older than the pg-boss archive window (7 days) plus margin.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-salla-oauth-install-secure-tokens.md`
  summary: Salla OAuth/user-info/Admin API shapes, refresh-failure semantics and webhook signature are fixture-only (verify in Story 1.11-1.13).
  evidence: Desk research only; no Salla credentials or demo store exist.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-salla-oauth-install-secure-tokens.md`
  summary: Dashboard connection chip still shows the not-connected placeholder.
  evidence: Needs the merchant session of Story 1.9; connectionFromStatus and IntegrationService.getConnection are ready.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-salla-oauth-install-secure-tokens.md`
  summary: Reinstall restore of uninstalled stores and install_epoch increments are not implemented (Story 1.10).
  evidence: installFromTokens throws StoreLifecycleConflictError for uninstalled/purged stores.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-salla-oauth-install-secure-tokens.md`
  summary: Master key rotation is not wired in env config, and token_access_log has no retention job.
  evidence: See docs/runbooks/token-encryption-key.md.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-salla-oauth-install-secure-tokens.md`
  summary: http-role event publishing needs the worker to have booted once (pg-boss schema, queue, app-role grants).
  evidence: grantEventPublishing runs at worker boot; deploy order must be migrate, worker, http.

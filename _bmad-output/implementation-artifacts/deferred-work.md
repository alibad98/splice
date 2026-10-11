- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-monorepo-ci.md`
  summary: Health endpoint should check DB connectivity and the worker role needs a liveness signal.
  evidence: GET /v1/health always returns ok; no DB access exists yet. Belongs with Story 1.3 observability.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-monorepo-ci.md`
  summary: CI should smoke-run both Docker images (http health check, worker against a Postgres service).
  evidence: Images are built but never started; severity medium (unverified until CI runs once).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-monorepo-ci.md`
  summary: Pin the MinIO image to a verified release tag or digest.
  evidence: docker-compose.yml uses minio/minio:latest; the tag couldn't be verified from the sandbox.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-monorepo-ci.md`
  summary: Make startWorker take the queue list as a parameter and test queue registration, options and concurrency.
  evidence: QUEUES is empty, so the registration loop has never run; add this when the first queue lands.

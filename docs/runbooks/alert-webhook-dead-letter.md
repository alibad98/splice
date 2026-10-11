# Alert: webhook job dead-lettered

- **Alert id:** `webhook-dead-lettered` (see `ops/alert-rules.json`)
- **Owner:** integration-owner
- **Fires when:** a queue named `integration.webhook*` has jobs in its dead-letter queue (`<queue>.dead_letter`), meaning a job failed all its attempts.

## First checks

1. In the worker logs, find `error captured` lines for the queue. Each carries `job_id`, `trace_id` and, when known, `store_id`.
2. Read the error. Common causes: an unknown store (events for a store not yet installed are parked, then dead-lettered after 15 minutes), a Salla API failure, or a bug in the handler.
3. Check `slips_webhook_failures_total` and `slips_queue_oldest_age_seconds` for a backlog.
4. Fix the cause, then replay the dead-lettered jobs by re-sending them to the original queue. Handlers are idempotent on the event ID, so replay is safe.
5. The alert clears when the dead-letter queue is empty.

Webhook raw bodies are never logged; use the `webhook_inbox` record for the canonical payload.

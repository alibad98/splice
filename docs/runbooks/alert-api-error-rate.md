# Alert: API error rate

- **Alert id:** `api-error-rate-5m` (see `ops/alert-rules.json`)
- **Owner:** platform-oncall
- **Fires when:** the share of API responses with a 5xx status exceeds the configured threshold (5% by default) over 5 minutes.

## First checks

1. Open `GET /v1/health` on the API. A `503` with `checks.database: down` means the database is unreachable; go to step 4.
2. Search the structured logs for `"level":50` in the alert window. Group by `request_id` or `trace_id` to follow one failing request into the jobs it caused.
3. Compare with the last deploy. If the errors began right after a release, redeploy the previous image (rollback is a redeploy, AD-22).
4. Database down: check the database host and connection limits, then restart the `http` role once the database answers.
5. Salla outage: the metric `slips_salla_api_failures_total` rising together with 5xx points to Salla. Sync pauses by design; manifests keep serving.

## Escalate

If errors persist 30 minutes after rollback or database recovery, escalate to the product owner and record the incident.

Logs never contain tokens or shopper PII; if you find either, treat it as a security incident.

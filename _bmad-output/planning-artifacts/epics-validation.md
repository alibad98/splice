# Epics Validation (Step 4)

| Check | Result |
|---|---|
| 1. FR coverage (FR1-FR30) | PASS - every FR in >=1 Requirements line; spot-checked FR9, FR11, FR13, FR17, FR19, FR22, FR24, FR25, FR26 ACs cover key rules |
| 2. Starter template / table creation | PASS - Story 1.1 scaffolds Turborepo monorepo; no table used before creation or created twice |
| 3. Story quality | PASS - all 80 stories have Requirements line and Given/When/Then ACs; sized for one dev agent |
| 4. Forward dependencies | PASS after fixes |
| 5. Epic independence | PASS - later-epic data shown as "—"/stub fallbacks (2.2, 3.2, 3.9) |

## Tables and creating story
stores, merchant_accounts, platform_tokens (1.8); webhook_inbox (1.10); products, categories (2.1); content_items (3.1); content_product_links (3.4); media_assets (3.5); slides (3.6); renditions (3.8); placements (4.1); store_settings (4.2); schedules (4.3); store_manifests (4.4); store_keys (5.1); events_raw (6.1); orders, order_lines (6.3); cart_adds (6.4); store_settings_history, attributed_lines (6.5); daily_rollups (6.7); subscriptions (7.3); usage_meters (7.4); admin_users, admin_audit_log (7.9); store_data_jobs (7.12); reconciliation_runs (7.17).

## Fixes applied
- Story 1.10: storefront empty-result AC reworded to an `integration` active-store check consumed by the Epic 4 endpoint (endpoint did not yet exist).
- Story 7.3: `manual_override` settable via billing service method/seed; admin UI in Story 7.10 extends it.
- Story 7.12: purge reference changed from later Story 7.13 to Story 1.10 `StoreDataLifecycle`.
- Frontmatter stepsCompleted set to [1, 2, 3, 4].

## Open issues
- Story 1.10 "billing-related processing skipped" relies on a flag that billing (Epic 7) must honor; acceptable as a later consumer.
- stores/merchant_accounts/platform_tokens/webhook_inbox are created implicitly (no "created here" note) in 1.8/1.10; minor wording only.

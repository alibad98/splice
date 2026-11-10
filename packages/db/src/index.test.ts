import { describe, expect, it } from 'vitest';
import * as db from './index.js';

describe('@slips/db', () => {
  it('exports the integration, auth, catalog, content and media tables in the schema namespace', () => {
    expect(Object.keys(db.schema).sort()).toEqual(
      [
        'LIFECYCLE_STATES',
        'OTP_PURPOSES',
        'SESSION_MODES',
        'STORE_PLATFORMS',
        'WEBHOOK_STATUSES',
        'AVAILABILITY_BUCKETS',
        'CATALOG_SYNC_REASONS',
        'CATALOG_SYNC_STATUSES',
        'CONTENT_FORMATS',
        'CONTENT_STATUSES',
        'CTA_ACTIONS',
        'catalogSyncState',
        'categories',
        'contentItems',
        'contentProductLinks',
        'slides',
        'MEDIA_ASSET_STATUSES',
        'MEDIA_KINDS',
        'RENDITION_CONTENT_TYPES',
        'RENDITION_PROFILES',
        'mediaAssets',
        'mediaUploadGrants',
        'renditions',
        'products',
        'lifecycleAudit',
        'lifecycleEventLedger',
        'loginOtps',
        'merchantAccounts',
        'merchantLoginStores',
        'merchantLogins',
        'merchantSessions',
        'platformTokens',
        'storeDataJobs',
        'storeLocator',
        'storePurgeSchedule',
        'stores',
        'tokenAccessLog',
        'webhookInbox',
      ].sort(),
    );
  });
});

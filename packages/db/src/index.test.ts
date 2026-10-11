import { describe, expect, it } from 'vitest';
import * as db from './index.js';

describe('@slips/db', () => {
  it('exports the integration tables in the schema namespace', () => {
    expect(Object.keys(db.schema).sort()).toEqual(
      ['LIFECYCLE_STATES', 'SESSION_MODES', 'STORE_PLATFORMS', 'merchantAccounts', 'merchantSessions', 'platformTokens', 'storeLocator', 'stores', 'tokenAccessLog'].sort(),
    );
  });
});

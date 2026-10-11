import { describe, expect, it } from 'vitest';
import * as db from './index.js';

describe('@slips/db', () => {
  it('exports the integration tables in the schema namespace', () => {
    expect(Object.keys(db.schema).sort()).toEqual(
      ['LIFECYCLE_STATES', 'STORE_PLATFORMS', 'merchantAccounts', 'platformTokens', 'storeLocator', 'stores', 'tokenAccessLog'].sort(),
    );
  });
});

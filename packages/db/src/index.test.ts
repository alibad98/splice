import { describe, expect, it } from 'vitest';
import * as db from './index.js';

describe('@slips/db', () => {
  it('exports an (empty) schema namespace', () => {
    expect(Object.keys(db.schema)).toEqual([]);
  });
});

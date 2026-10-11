import { describe, expect, it } from 'vitest';
import { PLAYER_VERSION } from './index.js';

describe('@slips/player', () => {
  it('exposes a version', () => {
    expect(PLAYER_VERSION).toBe('0.0.0');
  });
});

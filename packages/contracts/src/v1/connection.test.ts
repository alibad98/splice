import { describe, expect, it } from 'vitest';
import { ConnectionStatus } from './connection.js';

describe('ConnectionStatus', () => {
  it('parses connected with a store name and not_connected without', () => {
    expect(ConnectionStatus.parse({ state: 'connected', store_name: 'متجر' })).toMatchObject({ v: 1, state: 'connected', store_name: 'متجر' });
    expect(ConnectionStatus.parse({ state: 'not_connected' }).store_name).toBeUndefined();
    expect(ConnectionStatus.safeParse({ state: 'weird' }).success).toBe(false);
  });
});

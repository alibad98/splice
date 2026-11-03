import { describe, expect, it } from 'vitest';
import { connectionFromStatus } from './shell';

describe('connectionFromStatus', () => {
  it('maps a connected store to the chip with its name', () => {
    expect(connectionFromStatus({ v: 1, state: 'connected', store_name: 'متجر تجريبي' })).toEqual({ state: 'connected', storeName: 'متجر تجريبي' });
  });
  it('keeps a disconnected store apart, with its name when known', () => {
    expect(connectionFromStatus({ v: 1, state: 'disconnected', store_name: 'X' })).toEqual({ state: 'disconnected', storeName: 'X' });
    expect(connectionFromStatus({ v: 1, state: 'disconnected' })).toEqual({ state: 'disconnected' });
  });
  it('shows a missing store as not connected', () => {
    expect(connectionFromStatus({ v: 1, state: 'not_connected' })).toEqual({ state: 'not-connected' });
    expect(connectionFromStatus({ v: 1, state: 'connected' })).toEqual({ state: 'not-connected' });
  });
});

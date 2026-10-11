import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../config/env.js';
import { ConfigFeatureFlags } from './config-flags.js';

const base = { ROLE: 'http', DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('feature flags', () => {
  it('returns the safe default when a flag is unset', () => {
    expect(new ConfigFeatureFlags().isEnabled('telemetry.verbose_requests')).toBe(false);
  });
  it('returns the configured value when set', () => {
    const env = parseEnv({ ...base, FEATURE_FLAGS: 'telemetry.verbose_requests=true' });
    expect(new ConfigFeatureFlags(env.FEATURE_FLAGS).isEnabled('telemetry.verbose_requests')).toBe(true);
  });
  it('defaults to empty overrides when FEATURE_FLAGS is unset', () => {
    expect(parseEnv(base).FEATURE_FLAGS).toEqual({});
  });
  it('fails boot naming FEATURE_FLAGS on an unknown flag or bad value', () => {
    expect(() => parseEnv({ ...base, FEATURE_FLAGS: 'nope=true' })).toThrow(/FEATURE_FLAGS/);
    expect(() => parseEnv({ ...base, FEATURE_FLAGS: 'telemetry.verbose_requests=maybe' })).toThrow(/FEATURE_FLAGS/);
  });
});

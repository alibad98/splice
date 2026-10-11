import { FLAG_DEFAULTS, type FeatureFlags, type FlagName } from '../../ports/feature-flags.js';

/** Flags from configuration (`FEATURE_FLAGS=a=true,b=false`); anything unset returns its safe default. */
export class ConfigFeatureFlags implements FeatureFlags {
  constructor(private readonly overrides: Partial<Record<FlagName, boolean>> = {}) {}

  isEnabled(flag: FlagName): boolean {
    return this.overrides[flag] ?? FLAG_DEFAULTS[flag];
  }
}

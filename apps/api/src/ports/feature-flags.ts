// Feature flag port (AD-22): risky features ship behind flags with safe defaults.

/** Known flags and their safe defaults. Add a flag here before reading it. */
export const FLAG_DEFAULTS = {
  // Placeholder to exercise the mechanism; real flags land with their features.
  'telemetry.verbose_requests': false,
} as const satisfies Record<string, boolean>;

export type FlagName = keyof typeof FLAG_DEFAULTS;

export interface FeatureFlags {
  /** The configured value, or the flag's safe default when unset. */
  isEnabled(flag: FlagName): boolean;
}

export const FEATURE_FLAGS = Symbol('FEATURE_FLAGS');

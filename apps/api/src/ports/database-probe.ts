// Database connectivity probe port, used by health and worker liveness.

export interface DatabaseProbe {
  /** True when the database answered a trivial query within the timeout. Never throws. */
  isReachable(): Promise<boolean>;
  close(): Promise<void>;
}

export const DATABASE_PROBE = Symbol('DATABASE_PROBE');

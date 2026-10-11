// Storefront player skeleton. The stub (src/stub/) and viewer arrive in Story 1.2 / Epic 5.
// @slips/contracts is imported type-only; preact is the only runtime dependency.
import type { HealthResponse } from '@slips/contracts';

export type PlayerHealth = HealthResponse['status'];

export const PLAYER_VERSION = '0.0.0';

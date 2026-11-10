// Core loader entry (initial payload). The lazy viewer and analytics batcher are separate entries.
// @slips/contracts is imported type-only; preact is the only runtime dependency.
import type { HealthResponse } from '@slips/contracts';

export type PlayerHealth = HealthResponse['status'];

export const PLAYER_VERSION = '0.0.0';

export { boot } from './loader.js';

// Declaration-only exports keep preview/viewer runtime code outside the loader closure.
export type { PreviewOptions } from './preview/index.js';
export type { PreviewLocale, PreviewReady, PreviewUpdate } from './preview/protocol.js';
export type { Viewer, ViewerOptions } from './viewer/index.js';

import type { ViteUserConfig } from 'vitest/config';
export declare const vitestPreset: ViteUserConfig & { test: NonNullable<ViteUserConfig['test']> };
export default vitestPreset;

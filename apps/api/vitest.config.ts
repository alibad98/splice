import { defineConfig } from 'vitest/config';
import { vitestPreset } from '@slips/config/vitest';

// The live-DB composition tests share global tables (e.g. `webhook_inbox`, whose sweep claims any due row), so test
// files run one at a time; tests inside a file still run in order.
export default defineConfig({ ...vitestPreset, test: { ...vitestPreset.test, fileParallelism: false } });

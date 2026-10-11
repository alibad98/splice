/* eslint-disable no-restricted-syntax -- this file defines the tenant-context rule and its test fixtures */
// Covers the spec's I/O matrix rows for import boundaries by linting virtual files
// at real repo paths with the shared config.
import { ESLint } from 'eslint';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfig, repoRoot } from '../eslint.js';

async function lint(repoPath: string, code: string): Promise<string[]> {
  const dir = path.join(repoRoot, repoPath.split('/').slice(0, 2).join('/'));
  const eslint = new ESLint({ cwd: dir, overrideConfigFile: true, overrideConfig: createConfig({ dir }) });
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, repoPath) });
  return (result?.messages ?? []).map((m) => m.message);
}

describe('import boundaries', () => {
  it('fails when apps/dashboard imports @slips/db', async () => {
    const msgs = await lint('apps/dashboard/lib/breach.ts', "import { schema } from '@slips/db';\nexport const s = schema;\n");
    expect(msgs.some((m) => m.includes('boundary app-api-only-db'))).toBe(true);
  });

  it('allows apps/api to import @slips/db', async () => {
    const msgs = await lint('apps/api/src/ok.ts', "import { schema } from '@slips/db';\nexport const s = schema;\n");
    expect(msgs.filter((m) => m.startsWith('boundary'))).toEqual([]);
  });

  it('fails when packages/player value-imports @slips/contracts', async () => {
    const msgs = await lint('packages/player/src/breach.ts', "import { HealthResponse } from '@slips/contracts';\nexport const h = HealthResponse;\n");
    expect(msgs.some((m) => m.includes('boundary player-contracts-type-only'))).toBe(true);
  });

  it('allows a type-only contracts import in packages/player', async () => {
    const msgs = await lint('packages/player/src/ok.ts', "import type { HealthResponse } from '@slips/contracts';\nexport type H = HealthResponse;\n");
    expect(msgs.filter((m) => m.startsWith('boundary'))).toEqual([]);
  });

  it('fails when an api module imports an adapter', async () => {
    const msgs = await lint('apps/api/src/modules/x.ts', "import { y } from '../../adapters/salla/y.js';\nexport const z = y;\n");
    expect(msgs.some((m) => m.includes('boundary api-module-no-adapter'))).toBe(true);
  });

  it.each(['apps/dashboard/lib/x.ts', 'apps/api/src/adapters/other/x.ts'])('fails when %s imports a Salla package', async (file) => {
    const msgs = await lint(file, "import '@salla.sa/embedded-sdk';\n");
    expect(msgs.some((m) => m.includes('boundary salla-adapter-only'))).toBe(true);
  });

  it('allows Salla packages under apps/api/src/adapters/salla', async () => {
    const msgs = await lint('apps/api/src/adapters/salla/x.ts', "import '@salla.sa/embedded-sdk';\n");
    expect(msgs.filter((m) => m.includes('boundary'))).toEqual([]);
  });

  it('fails when packages/player imports another @slips package', async () => {
    const msgs = await lint('packages/player/src/x.ts', "import '@slips/ui';\n");
    expect(msgs.some((m) => m.includes('boundary player-preact-only'))).toBe(true);
  });

  it.each(['zod', 'drizzle-orm', 'drizzle-orm/pg-core', '@salla.sa/twilight', 'lodash'])(
    'fails when packages/player runtime-imports %s',
    async (pkg) => {
      const msgs = await lint('packages/player/src/y.ts', `import '${pkg}';\n`);
      expect(msgs.some((m) => m.includes('boundary player-preact-only'))).toBe(true);
    },
  );

  it('allows preact, preact subpaths and relative imports in packages/player', async () => {
    const msgs = await lint('packages/player/src/z.ts', "import 'preact';\nimport 'preact/hooks';\nimport './a.js';\nimport '../b.js';\n");
    expect(msgs.filter((m) => m.includes('boundary'))).toEqual([]);
  });
});

describe('tenant context helper', () => {
  const sets = ["await c.query(\"select set_config('app.store_id', $1, false)\", [id]);", 'await c.query("RESET ALL");', 'await c.query("DISCARD ALL");', 'await c.query("SET ROLE postgres");', 'await c.query(`SET LOCAL app.store_id = ${id}`);', "await c.query('SET app.store_id = 1');"];
  for (const code of sets) {
    it(`fails on: ${code}`, async () => {
      const msgs = await lint('apps/api/src/breach.ts', `export async function f(c: any, id: string) {\n  ${code}\n}\n`);
      expect(msgs.some((m) => m.includes('tenant-context-helper-only'))).toBe(true);
    });
  }

  it('allows the helper itself and ordinary queries', async () => {
    const helper = await lint('packages/db/src/tenant/context.ts', "export const q = \"select set_config('app.store_id', $1, true)\";\n");
    expect(helper.filter((m) => m.includes('tenant-context-helper-only'))).toEqual([]);
    const ok = await lint('apps/api/src/ok.ts', "export const q = \"select current_setting('app.store_id')\";\n");
    expect(ok.filter((m) => m.includes('tenant-context-helper-only'))).toEqual([]);
  });
});

describe('no in-process emitters (AD-17)', () => {
  it.each([
    "import { EventEmitter } from 'node:events';\nexport const e = new EventEmitter();\n",
    "import EventEmitter from 'events';\nexport const e = new EventEmitter();\n",
    "import { EventEmitter2 } from '@nestjs/event-emitter';\nexport const e = EventEmitter2;\n",
    "import mitt from 'mitt';\nexport const e = mitt;\n",
  ])('fails in an api module: %s', async (code) => {
    const msgs = await lint('apps/api/src/modules/catalog/x.ts', code);
    expect(msgs.some((m) => m.includes('no-in-process-emitter'))).toBe(true);
  });

  it('allows node:events helpers that are not emitters', async () => {
    const msgs = await lint('apps/api/src/modules/catalog/x.ts', "import { once } from 'node:events';\nexport const o = once;\n");
    expect(msgs.filter((m) => m.includes('no-in-process-emitter'))).toEqual([]);
  });
});

describe('event consumer is worker-only (AD-17)', () => {
  it.each(['apps/api/src/http.ts', 'apps/api/src/modules/catalog/x.ts', 'apps/api/src/events/outbox.ts'])('fails when %s imports the dispatcher', async (file) => {
    const msgs = await lint(file, "import { eventDispatcher } from '../events/dispatcher.js';\nexport const d = eventDispatcher;\n");
    expect(msgs.some((m) => m.includes('event-consumer-worker-only'))).toBe(true);
  });

  it.each(['apps/api/src/worker/worker.ts', 'apps/api/src/events/dispatcher.ts'])('allows %s', async (file) => {
    const msgs = await lint(file, "import { eventDispatcher } from '../events/dispatcher.js';\nexport const d = eventDispatcher;\n");
    expect(msgs.filter((m) => m.includes('event-consumer-worker-only'))).toEqual([]);
  });
});

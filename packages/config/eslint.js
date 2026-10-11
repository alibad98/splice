// Shared ESLint flat config for the Slips monorepo, including the
// architecture import-boundary rules (ARCHITECTURE-SPINE: Import boundaries).
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));


/** SQL that sets or changes a session setting: set_config(...), SET LOCAL/SESSION, SET app.*, RESET app.* */
const STORE_CONTEXT_SQL = String.raw`/\bset_config\b|\bset\s+(local|session)\b|\b(set|reset)\s+app\.|\b(reset|discard)\s+all\b|\bset\s+(session\s+authorization|role)\b/i`;
// eslint-disable-next-line no-restricted-syntax -- defines the rule message
const STORE_CONTEXT_MESSAGE = 'tenant-context-helper-only: set the store context only through withStoreContext() from @slips/db (SET LOCAL app.store_id)';

const EMITTER_MESSAGE = 'no-in-process-emitter: cross-module reactions go through publishEvent() domain events (AD-17), not an in-process emitter';

const EMITTER_PATHS = [
  { name: 'node:events', importNames: ['EventEmitter', 'default'], message: EMITTER_MESSAGE },
  { name: 'events', importNames: ['EventEmitter', 'default'], message: EMITTER_MESSAGE },
  { name: 'eventemitter3', message: EMITTER_MESSAGE },
  { name: 'mitt', message: EMITTER_MESSAGE },
];
const EMITTER_PATTERNS = [{ group: ['@nestjs/event-emitter', '@nestjs/event-emitter/*'], message: EMITTER_MESSAGE }];
const DISPATCHER_PATTERN = { group: ['**/events/dispatcher*', '**/dispatcher', '**/dispatcher.js'], message: 'event-consumer-worker-only: only apps/api/src/worker may import the event dispatcher (AD-17: the http role never consumes events)' };

/** Element types used by the boundary policies. Order matters: first match wins. */
export const boundaryElements = [
  { type: 'api-adapter', pattern: 'apps/api/src/adapters/**' },
  { type: 'api-module', pattern: 'apps/api/src/modules/**' },
  { type: 'app-api', pattern: 'apps/api/**' },
  { type: 'app-dashboard', pattern: 'apps/dashboard/**' },
  { type: 'pkg-db', pattern: 'packages/db/**' },
  { type: 'pkg-contracts', pattern: 'packages/contracts/**' },
  { type: 'pkg-player', pattern: 'packages/player/**' },
  { type: 'pkg-ui', pattern: 'packages/ui/**' },
];

/**
 * Flat-config `files` globs are relative to the package's config file, so repo-relative
 * globs are rebased onto the package dir (or dropped when they point elsewhere).
 */
function scoped(pkgDir, repoGlobs) {
  const rel = path.relative(repoRoot, pkgDir).split(path.sep).join('/');
  if (rel === '') return repoGlobs;
  return repoGlobs.filter((g) => g.startsWith(`${rel}/`)).map((g) => g.slice(rel.length + 1));
}

/** Wrap a config block so it only applies when its files live in this package. */
function inPackage(pkgDir, repoGlobs, block) {
  const files = scoped(pkgDir, repoGlobs);
  return files.length > 0 ? [{ ...block, files }] : [];
}

/**
 * @param {{ dir?: string, extra?: import('eslint').Linter.Config[] }} [options]
 *   dir: the package directory (pass `import.meta.dirname`); defaults to cwd.
 */
export function createConfig(options = {}) {
  const pkgDir = options.dir ?? process.cwd();
  return tseslint.config(
    { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/coverage/**', '**/next-env.d.ts'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: { globals: { ...globals.node, ...globals.browser } },
      rules: {
        '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'separate-type-imports' }],
      },
    },
    {
      plugins: { boundaries },
      settings: {
        'boundaries/root-path': repoRoot,
        'boundaries/elements': boundaryElements,
        'boundaries/include': ['apps/**', 'packages/**'],
        'import/resolver': { typescript: { alwaysTryTypes: true, noWarnOnMultipleProjects: true, project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'].map((g) => repoRoot + g) } },
      },
      rules: {
        'boundaries/dependencies': [
          'error',
          {
            default: 'allow',
            checkAllOrigins: true,
            policies: [
              {
                // Only apps/api may import @slips/db.
                from: { element: { types: { noneOf: ['app-api', 'api-module', 'api-adapter', 'pkg-db'] } } },
                disallow: [{ to: { element: { type: 'pkg-db' } } }, { to: { module: { source: '@slips/db{,/**}' } } }],
                message: 'boundary app-api-only-db: only apps/api may import @slips/db',
              },
              {
                // Domain modules never import adapters.
                from: { element: { type: 'api-module' } },
                disallow: { to: { element: { type: 'api-adapter' } } },
                message: 'boundary api-module-no-adapter: apps/api/src/modules must not import apps/api/src/adapters',
              },
              {
                // Salla packages only inside apps/api/src/adapters/salla.
                from: { element: { types: { noneOf: ['api-adapter'] } } },
                disallow: { to: { module: { source: '@salla.sa/**' } } },
                message: 'boundary salla-adapter-only: Salla packages may only be imported under apps/api/src/adapters/salla',
              },
            ],
          },
        ],
      },
    },
    // AD-3: the tenant context is set only by withStoreContext() in packages/db/src/tenant/context.ts.
    {
      files: ['**/*.{ts,tsx,js,mjs,cjs}'],
      ignores: scoped(pkgDir, ['packages/db/src/tenant/context.ts']),
      rules: {
        'no-restricted-syntax': [
          'error',
          { selector: `Literal[value=${STORE_CONTEXT_SQL}]`, message: STORE_CONTEXT_MESSAGE },
          { selector: `TemplateElement[value.raw=${STORE_CONTEXT_SQL}]`, message: STORE_CONTEXT_MESSAGE },
        ],
      },
    },
    // Backstop for api-module-no-adapter when the adapter path does not resolve (yet).
    ...inPackage(pkgDir, ['apps/api/src/modules/**'], {
      rules: {
        'no-restricted-imports': ['error', { patterns: [{ group: ['**/adapters', '**/adapters/**'], message: 'boundary api-module-no-adapter: apps/api/src/modules must not import apps/api/src/adapters' }] }],
      },
    }),
    // AD-17: modules react to each other through transactional domain events, never an in-process emitter.
    // Only the worker and the dispatcher itself may import the event consumer (the http role never consumes events).
    ...inPackage(pkgDir, ['apps/api/src/**/*.ts'], {
      ignores: scoped(pkgDir, ['apps/api/src/adapters/**', 'apps/api/src/worker/**', 'apps/api/src/events/dispatcher*', 'apps/api/src/**/*.test.ts']),
      rules: { '@typescript-eslint/no-restricted-imports': ['error', { paths: EMITTER_PATHS, patterns: [...EMITTER_PATTERNS, DISPATCHER_PATTERN] }] },
    }),
    ...inPackage(pkgDir, ['apps/api/src/worker/**/*.ts', 'apps/api/src/events/dispatcher*.ts'], {
      rules: { '@typescript-eslint/no-restricted-imports': ['error', { paths: EMITTER_PATHS, patterns: EMITTER_PATTERNS }] },
    }),
    // Salla is allowed in the salla adapter only, not in other adapters.
    ...inPackage(pkgDir, ['apps/api/src/adapters/!(salla)/**'], {
      rules: {
        'no-restricted-imports': ['error', { patterns: [{ group: ['@salla.sa/*'], message: 'boundary salla-adapter-only: Salla packages may only be imported under apps/api/src/adapters/salla' }] }],
      },
    }),
    // The player imports @slips/contracts type-only; preact is its only runtime dependency.
    ...inPackage(pkgDir, ['packages/player/src/**/*.{ts,tsx}'], {
      ignores: ['**/*.test.{ts,tsx}'], // tests may import vitest
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            paths: [{ name: '@slips/contracts', allowTypeImports: true, message: 'boundary player-contracts-type-only: packages/player may import @slips/contracts with `import type` only' }],
            patterns: [
              { group: ['@slips/*', '!@slips/contracts'], message: 'boundary player-preact-only: packages/player may only depend on preact at runtime' },
              // Any other bare specifier (zod, drizzle-orm, @salla.sa/*, ...) is a forbidden runtime dependency.
              { regex: '^(?!preact(/|$)|\\.{1,2}(/|$)|@slips/contracts$)', message: 'boundary player-preact-only: packages/player may only depend on preact at runtime' },
            ],
          },
        ],
      },
    }),
    ...(options.extra ?? []),
  );
}

export default createConfig;

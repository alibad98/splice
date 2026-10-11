// Shared ESLint flat config for the Slips monorepo, including the
// architecture import-boundary rules (ARCHITECTURE-SPINE: Import boundaries).
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));


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
    // Backstop for api-module-no-adapter when the adapter path does not resolve (yet).
    ...inPackage(pkgDir, ['apps/api/src/modules/**'], {
      rules: {
        'no-restricted-imports': ['error', { patterns: [{ group: ['**/adapters', '**/adapters/**'], message: 'boundary api-module-no-adapter: apps/api/src/modules must not import apps/api/src/adapters' }] }],
      },
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

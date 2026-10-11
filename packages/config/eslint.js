// Shared ESLint flat config for the Slips monorepo, including the
// architecture import-boundary rules (ARCHITECTURE-SPINE: Import boundaries).
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const SALLA = ['@salla.sa/embedded-sdk', '@salla.sa/twilight', '@salla.sa/*'];

/** Element types used by the boundary policies. Order matters: first match wins. */
export const boundaryElements = [
  { type: 'api-adapter', pattern: 'apps/api/src/adapters/**', mode: 'full' },
  { type: 'api-module', pattern: 'apps/api/src/modules/**', mode: 'full' },
  { type: 'app-api', pattern: 'apps/api/**', mode: 'full' },
  { type: 'app-dashboard', pattern: 'apps/dashboard/**', mode: 'full' },
  { type: 'pkg-db', pattern: 'packages/db/**', mode: 'full' },
  { type: 'pkg-contracts', pattern: 'packages/contracts/**', mode: 'full' },
  { type: 'pkg-player', pattern: 'packages/player/**', mode: 'full' },
  { type: 'pkg-ui', pattern: 'packages/ui/**', mode: 'full' },
];

/**
 * @param {{ extra?: import('eslint').Linter.Config[] }} [options]
 */
export function createConfig(options = {}) {
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
      },
      rules: {
        'boundaries/dependencies': [
          'error',
          {
            default: 'allow',
            policies: [
              {
                // Only apps/api may import @slips/db.
                from: { element: { types: { noneOf: ['app-api', 'api-module', 'api-adapter', 'pkg-db'] } } },
                disallow: { to: { module: { source: '@slips/db' } } },
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
                disallow: { to: { module: { source: { anyOf: SALLA } } } },
                message: 'boundary salla-adapter-only: Salla packages may only be imported under apps/api/src/adapters/salla',
              },
            ],
          },
        ],
      },
    },
    {
      // Salla is allowed in the salla adapter only, not in other adapters.
      files: ['**/apps/api/src/adapters/!(salla)/**'],
      rules: {
        'no-restricted-imports': ['error', { patterns: [{ group: ['@salla.sa/*'], message: 'boundary salla-adapter-only: Salla packages may only be imported under apps/api/src/adapters/salla' }] }],
      },
    },
    {
      // The player imports @slips/contracts type-only; preact is its only runtime dependency.
      files: ['**/packages/player/**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            paths: [{ name: '@slips/contracts', allowTypeImports: true, message: 'boundary player-contracts-type-only: packages/player may import @slips/contracts with `import type` only' }],
            patterns: [
              { group: ['@slips/*', '!@slips/contracts'], message: 'boundary player-preact-only: packages/player may only depend on preact at runtime' },
            ],
          },
        ],
      },
    },
    ...(options.extra ?? []),
  );
}

export default createConfig;

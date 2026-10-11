// Shared Vitest preset. Packages spread it into their own defineConfig.
/** @type {import('vitest/config').ViteUserConfig} */
export const vitestPreset = {
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts', 'test/**/*.test.tsx'],
    passWithNoTests: false,
    restoreMocks: true,
  },
};
export default vitestPreset;

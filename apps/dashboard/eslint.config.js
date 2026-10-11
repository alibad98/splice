import { createConfig } from '@slips/config/eslint';
import { noPhysicalDirection } from './eslint-rules/direction.js';

export default createConfig({
  dir: import.meta.dirname,
  extra: [
    {
      files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
      ignores: ['**/*.test.{ts,tsx}'],
      plugins: { slips: { rules: { 'no-physical-direction': noPhysicalDirection } } },
      rules: {
        'slips/no-physical-direction': 'error',
        'no-restricted-syntax': [
          'error',
          // Iframe rules: never navigate or inspect the top window (AD-12).
          { selector: "MemberExpression[object.name='window'][property.name='top']", message: 'window.top is forbidden: the app runs inside the Salla iframe.' },
          { selector: "MemberExpression[object.name='top'][property.name='location']", message: 'top.location is forbidden: the app runs inside the Salla iframe.' },
          { selector: "JSXAttribute[name.name='target'][value.value='_top']", message: 'target="_top" is forbidden inside the Salla iframe.' },
          { selector: "JSXAttribute[name.name='target'][value.value='_parent']", message: 'target="_parent" is forbidden inside the Salla iframe.' },
        ],
      },
    },
  ],
});

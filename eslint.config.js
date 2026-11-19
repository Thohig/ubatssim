import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The physics layer must stay free of rendering, DOM and control code.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*'], message: 'src/sim must not depend on Three.js.' },
            { group: ['**/render/**', '**/ui/**', '**/control/**'], message: 'src/sim must not import from other layers.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'performance', 'requestAnimationFrame'],
    },
  },
);

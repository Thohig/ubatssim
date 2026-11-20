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
            { group: ['**/render/**', '**/ui/**', '**/control/**', '**/audio/**'], message: 'src/sim must not import from other layers.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'performance', 'requestAnimationFrame'],
    },
  },
  {
    // Deterministic: the same start and orders give the same result (tests/long/determinism.long.test.ts).
    files: ['src/sim/**/*.ts', 'src/control/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'The simulation is deterministic: no random numbers in src/sim or src/control.' },
        { object: 'Date', property: 'now', message: 'The simulation is deterministic: use simulation time, not the wall clock.' },
        { object: 'performance', property: 'now', message: 'The simulation is deterministic: use simulation time, not the wall clock.' },
      ],
      'no-restricted-syntax': ['error', { selector: "NewExpression[callee.name='Date']", message: 'The simulation is deterministic: use simulation time, not the wall clock.' }],
    },
  },
);

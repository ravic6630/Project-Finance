// Correctness-focused lint: the goal is catching real runtime crashes
// (undefined references, broken hook usage), not style. Run with `npm run lint`.
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['web/src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      // The rule that would have caught "profileId is not defined".
      'no-undef': 'error',
      'react/jsx-uses-vars': 'error',
      'react/jsx-no-undef': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-constant-binary-expression': 'error',
      'valid-typeof': 'error',
      'no-async-promise-executor': 'error',
    },
  },
  {
    files: ['server/src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-constant-binary-expression': 'error',
      'valid-typeof': 'error',
      'no-async-promise-executor': 'error',
    },
  },
];

import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'client/dist/', 'coverage/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    files: ['server/**/*.js', '*.config.js', 'client/vite.config.js'],
    languageOptions: { globals: globals.node },
  },
  { files: ['client/src/**/*.js'], languageOptions: { globals: globals.browser } },
  {
    files: ['shared/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
];

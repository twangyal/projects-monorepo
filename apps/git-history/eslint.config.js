import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'build/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  {
    files: ['git_history/web/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.browser },
  },
];

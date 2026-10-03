import js from '@eslint/js';
import ts from 'typescript-eslint';

export default ts.config(
  { ignores: ['dist/**', 'public/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ['scripts/*.mjs'], languageOptions: { globals: { console: 'readonly' } } },
);

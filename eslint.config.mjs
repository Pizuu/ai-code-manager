// ESLint 扁平配置（共享热点文件，见 ADR 0004）。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'node_modules/**', '.specify/**', '.agents/**', 'uploads/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/backend/**/*.{ts,cts}', 'tests/**/*.ts', 'contracts/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/frontend/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);

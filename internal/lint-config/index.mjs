import js from '@eslint/js';
import ts from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/build/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/essential'],
  { files: ['**/*.vue'], languageOptions: { parserOptions: { parser: ts.parser } } },
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/ui/src/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'node:*',
            'electron',
            'better-sqlite3',
            '@browser-2d/contracts/host',
            '@browser-2d/worker-runtime*',
            '**/desktop/**',
            '**/worker/**',
          ],
        },
      ],
    },
  },
];

import js from '@eslint/js';
import tsparser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'semi': ['error', 'always'],
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['src/test/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.mocha,
      },
    },
  },
];
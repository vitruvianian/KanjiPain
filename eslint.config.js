import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-e2e/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'data/raw/**',
      'src/data/kanji.generated.json',
      'src/data/strokes.generated.json',
      'public/licenses/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...js.configs.recommended,
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...reactRefresh.configs.vite.rules,
    },
  },
  {
    // Numeric loops index arrays whose bounds are known by construction. Under
    // noUncheckedIndexedAccess each read needs a cast; `!` is banned by the strict preset.
    files: ['src/recognition/geometry.ts', 'src/recognition/check.ts', 'src/components/brush.ts'],
    rules: {
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
    },
  },
);

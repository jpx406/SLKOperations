// Lint (6z.73): the React hook rules only. The type check (tsc) already covers types and unused code; these catch what
// it can't: hooks called conditionally, and effects that miss a value they read. The Competency module (plain JS) is
// checked with the same rules.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'design/**', 'replica/**', 'export/**', '.wrangler/**', 'src/client/competency/packageSources.js'] },
  {
    files: ['src/client/**/*.{ts,tsx,js,jsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins: { 'react-hooks': reactHooks, '@typescript-eslint': tseslint.plugin },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);

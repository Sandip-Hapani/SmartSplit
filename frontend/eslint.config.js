import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import react from 'eslint-plugin-react'

/**
 * Deliberately minimal: this exists to catch the mistakes a Vite build can't,
 * above all `no-undef` — a stale identifier is valid JavaScript, so it builds
 * fine and only explodes when the user clicks the button.
 */
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['**/*.js', '**/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks, react },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'react-hooks/rules-of-hooks': 'error',
      // without this, every component imported for JSX looks unused
      'react/jsx-uses-vars': 'error',
    },
  },
]

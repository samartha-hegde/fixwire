import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Intentional: class + interface merging is the idiomatic way to give
      // EventEmitter a typed on/emit surface (see Session in src/session.ts).
      '@typescript-eslint/no-unsafe-declaration-merging': 'off',
    },
  },
);

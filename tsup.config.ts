import { defineConfig } from 'tsup';

// Dual-publish: emit ESM (index.js) + CommonJS (index.cjs) and matching type
// declarations (index.d.ts / index.d.cts), so both `import` and `require`
// consumers get first-class types. Source stays pure ESM; esbuild handles the
// CJS transform that tsc (with verbatimModuleSyntax) cannot.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  outDir: 'dist',
});

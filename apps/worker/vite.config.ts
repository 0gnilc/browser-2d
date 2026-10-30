import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __WORKER_MIGRATION__: '__dirname + "/migrations/001-runs.sql"',
    'import.meta.url': 'undefined',
  },
  build: {
    target: 'node22',
    ssr: 'src/entry.ts',
    outDir: 'dist',
    rollupOptions: {
      external: ['better-sqlite3'],
      output: { format: 'cjs', entryFileNames: 'entry.cjs', inlineDynamicImports: true },
    },
  },
  ssr: { noExternal: ['@browser-2d/contracts', 'zod'] },
  plugins: [{
    name: 'worker-migrations',
    closeBundle() {
      cpSync(fileURLToPath(new URL('migrations', import.meta.url)), fileURLToPath(new URL('dist/migrations', import.meta.url)), { recursive: true });
    },
  }],
});

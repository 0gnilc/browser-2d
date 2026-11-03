import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __BUSINESS_MIGRATIONS__: '__dirname + "/migrations/business"',
    'import.meta.url': 'undefined',
  },
  build: {
    target: 'node22',
    ssr: true,
    outDir: 'dist',
    rollupOptions: {
      input: {
        entry: 'src/entry.ts',
        'browser-worker': 'src/browser-worker/entry.ts',
        'verification/browser-worker': 'tests/process/browser-worker.ts',
        'verification/data-service': 'tests/process/data-service.ts',
      },
      external: ['better-sqlite3', 'puppeteer-core'],
      output: { format: 'cjs', entryFileNames: '[name].cjs', chunkFileNames: '[name]-[hash].cjs' },
    },
  },
  ssr: { noExternal: ['@browser-2d/contracts', 'zod'] },
  plugins: [
    {
      name: 'worker-migrations',
      closeBundle() {
        cpSync(
          fileURLToPath(new URL('migrations', import.meta.url)),
          fileURLToPath(new URL('dist/migrations', import.meta.url)),
          { recursive: true },
        );
      },
    },
  ],
});

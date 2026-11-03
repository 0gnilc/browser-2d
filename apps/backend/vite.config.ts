import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __APPLICATION_MIGRATIONS__: '__dirname + "/migrations/application"',
    'import.meta.url': 'undefined',
  },
  build: {
    target: 'node22',
    ssr: true,
    manifest: true,
    outDir: 'dist',
    rollupOptions: {
      input: {
        'data-service': 'src/data-service/entry.ts',
        'browser-worker': 'src/browser-worker/entry.ts',
        'verification/card-worker': 'tests/process/card-worker.ts',
        'verification/application-data-service': 'tests/process/application-data-service.ts',
        'verification/browser-worker': 'tests/process/browser-worker.ts',
        'verification/data-service': 'tests/process/data-service.ts',
        'verification/browser-platform': 'tests/process/browser-platform.ts',
      },
      external: ['better-sqlite3', 'puppeteer-core'],
      output: { format: 'cjs', entryFileNames: '[name].cjs', chunkFileNames: '[name]-[hash].cjs' },
    },
  },
  ssr: { noExternal: ['@browser-2d/contracts', '@browser-2d/amount', 'zod'] },
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

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
    ssr: 'src/entry.ts',
    outDir: 'dist',
    rollupOptions: {
      external: ['better-sqlite3', 'puppeteer-core'],
      output: { format: 'cjs', entryFileNames: 'entry.cjs', inlineDynamicImports: true },
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

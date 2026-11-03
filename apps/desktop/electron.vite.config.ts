import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import { rendererConfig } from '@browser-2d/build-config';
import { identity } from '@browser-2d/build-config/release';

export default defineConfig({
  main: {
    define: { __PRODUCT_IDENTITY__: JSON.stringify(identity) },
    build: {
      outDir: 'dist/main',
      externalizeDeps: { exclude: ['@browser-2d/contracts', '@browser-2d/amount', 'zod'] },
      rollupOptions: {
        input: resolve('src/main/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      externalizeDeps: false,
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    ...rendererConfig(resolve('../ui')),
    build: {
      outDir: resolve('dist/renderer'),
      emptyOutDir: true,
      rolldownOptions: { input: resolve('../ui/index.html') },
    },
  },
});

import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import { rendererConfig } from '@browser-2d/build-config';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      externalizeDeps: { exclude: ['@browser-2d/contracts', 'zod'] },
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

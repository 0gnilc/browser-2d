import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { rendererConfig } from '@browser-2d/build-config';
export default defineConfig({
  ...rendererConfig(fileURLToPath(new URL('.', import.meta.url))),
  define: { 'import.meta.env.VITE_FIXTURE_MODE': JSON.stringify('1') },
});

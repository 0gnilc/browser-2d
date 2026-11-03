import { defineConfig } from 'vitest/config';
import { rendererConfig } from '@browser-2d/build-config';
export default defineConfig({
  ...rendererConfig(process.cwd()),
  test: { include: ['tests/**/*.test.ts'], environment: 'jsdom' },
});

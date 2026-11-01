import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  plugins: [vue()],
  test: { include: ['packages/**/*.test.ts', 'apps/ui/**/*.test.ts'], environment: 'jsdom' },
});

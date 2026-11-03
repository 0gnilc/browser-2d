import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['tests/adspower.test.ts'], testTimeout: 15_000 },
});

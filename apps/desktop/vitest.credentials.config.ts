import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/credentials.test.ts', 'tests/worker-ownership.test.ts'],
  },
});

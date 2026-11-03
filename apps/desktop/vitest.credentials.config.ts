import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/credentials.test.ts', 'tests/data-service-ownership.test.ts'],
  },
});

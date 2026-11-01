import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: [
      'tests/updates.test.ts',
      'tests/lifecycle.test.ts',
      'tests/update-feed.test.ts',
      'tests/update-subscription.test.ts',
      'tests/update-driver.test.ts',
    ],
    environment: 'node',
  },
});

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 60_000,
  reporter: [['list'], ['html', { outputFolder: 'artifacts/playwright', open: 'never' }]],
  use: { trace: 'retain-on-failure' },
  outputDir: 'artifacts/test-results',
});

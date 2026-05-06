import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    browserName: 'chromium',
    headless: true,
  },
  webServer: {
    command: 'npx serve . -p 3999 --no-clipboard',
    port: 3999,
    reuseExistingServer: true,
  },
});

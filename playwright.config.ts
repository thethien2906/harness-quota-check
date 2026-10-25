import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui',
  use: { baseURL: process.env.QUOTA_PEEK_TEST_URL || 'http://127.0.0.1:1420', headless: true, channel: 'chrome', viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure' },
});

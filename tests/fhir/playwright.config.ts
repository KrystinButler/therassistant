import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'practitioner-role.browser.spec.ts',
  workers: 1, reporter: 'list', use: { browserName: 'chromium' },
});

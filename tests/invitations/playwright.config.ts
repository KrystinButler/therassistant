import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: '*.browser.spec.ts', workers: 1, reporter: 'list',
  use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:5187' },
  webServer: {
    cwd: require('node:path').resolve(__dirname, '../..'),
    command: 'node artifacts/therassistant-inventory/node_modules/vite/bin/vite.js --config artifacts/therassistant-inventory/vite.config.ts --host 127.0.0.1 --port 5187',
    url: 'http://127.0.0.1:5187', reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54399', VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-test-key' },
  },
});

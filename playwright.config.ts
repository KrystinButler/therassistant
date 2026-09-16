import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const localBaseURL = "http://127.0.0.1:4173";
const apiEnv = {
  ...process.env,
  PORT: "8080",
  NODE_ENV: "development",
} as Record<string, string>;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL: externalBaseURL ?? localBaseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: externalBaseURL
    ? undefined
    : [
        {
          command: "pnpm --filter @workspace/api-server run dev",
          url: "http://127.0.0.1:8080/api/dashboard",
          env: apiEnv,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command:
            "pnpm --filter @workspace/therassistant-inventory exec vite --config vite.config.ts --host 127.0.0.1 --port 4173",
          url: localBaseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});

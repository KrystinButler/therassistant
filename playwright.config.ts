import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const localBaseURL = "http://127.0.0.1:4173";
const staffStorageState = ".playwright/auth/staff.json";
const providerStorageState = ".playwright/auth/provider.json";
const patientStorageState = ".playwright/auth/patient.json";

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
      name: "auth-gate",
      testMatch: /auth-gate\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "staff-setup",
      testMatch: /staff-auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "staff-chromium",
      testIgnore: [
        /auth-gate\.spec\.ts/,
        /-auth\.setup\.ts$/,
        /provider-role\.spec\.ts/,
        /patient-role\.spec\.ts/,
      ],
      dependencies: ["staff-setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: staffStorageState,
      },
    },
    {
      name: "provider-setup",
      testMatch: /provider-auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "provider-chromium",
      testMatch: /provider-role\.spec\.ts/,
      dependencies: ["provider-setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: providerStorageState,
      },
    },
    {
      name: "patient-setup",
      testMatch: /patient-auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "patient-chromium",
      testMatch: /patient-role\.spec\.ts/,
      dependencies: ["patient-setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: patientStorageState,
      },
    },
  ],
  webServer: externalBaseURL
    ? undefined
    : {
        command:
          "pnpm --filter @workspace/therassistant-inventory exec vite --config vite.config.ts --host 127.0.0.1 --port 4173",
        url: localBaseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});

export { patientStorageState, providerStorageState, staffStorageState };

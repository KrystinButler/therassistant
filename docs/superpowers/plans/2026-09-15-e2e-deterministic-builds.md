# E2E Workflow Coverage and Deterministic Builds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Playwright browser-test layer for THERASSISTANT's critical workspaces and pin the repository to the pnpm version already proven in Vercel production builds.

**Architecture:** Browser tests live at the repository root and exercise the existing Vite frontend against the existing Express API server; they do not add a mock backend or modify production components. Local Playwright runs start the API on port 8080 to match the Vite `/api` proxy and start Vite on port 4173; `PLAYWRIGHT_BASE_URL` bypasses local servers so the same suite can run against a Vercel deployment. The first suite uses Chromium, one worker, stable accessible selectors, and non-persistent action checks.

**Tech Stack:** Node.js 24, pnpm 10.28.0, TypeScript 5.9, Vite 7, Express 5, Playwright Test 1.63.0, React 19, Wouter.

**Spec:** `docs/superpowers/specs/2026-09-15-e2e-deterministic-builds-design.md`

## Global Constraints

- Do not change production feature behavior, business logic, workspace UI, Vercel framework detection, or Vercel project settings in this slice.
- Do not introduce bundle splitting or sourcemap cleanup in this slice.
- Use the existing `@workspace/api-server`; do not create a second backend or API mock layer.
- Use synthetic/demo data only; never use production PHI or production credentials.
- Browser tests must not leave persistent mutations. Interactive smoke tests open drawers, exercise controls, and cancel without saving.
- Use stable role, label, text, or explicit test-id selectors; do not select generated CSS classes.
- Run browser tests serially with one worker because the existing demo backend is shared state.
- Preserve the existing unit/domain test, typecheck, build, supply-chain, and secret-scan protections.
- Keep `minimumReleaseAge: 1440` unchanged.
- Pin pnpm exactly to `10.28.0`, matching the successful Vercel production build and existing CI workflows.

---

### Task 1: Pin Tooling and Add the Browser-Test Dependency

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: existing pnpm workspace configuration and Vercel's proven pnpm 10.28.0 runtime.
- Produces: root commands `pnpm test:e2e` and `pnpm test:e2e:headed`; exact `packageManager` metadata; Playwright Test available from the root workspace.

- [ ] **Step 1: Prove the repository is missing the required browser-test metadata**

Run:

```bash
node -e 'const p=require("./package.json"); if (p.packageManager || p.scripts?.["test:e2e"] || p.devDependencies?.["@playwright/test"]) process.exit(0); console.error("missing deterministic pnpm and Playwright metadata"); process.exit(1)'
```

Expected: FAIL with `missing deterministic pnpm and Playwright metadata`.

- [ ] **Step 2: Add the exact pnpm version, browser-test scripts, and Playwright dependency**

Update the root `package.json` so the relevant fields are:

```json
{
  "name": "workspace",
  "version": "0.0.0",
  "license": "MIT",
  "packageManager": "pnpm@10.28.0",
  "scripts": {
    "preinstall": "sh -c 'rm -f package-lock.json yarn.lock; case \"$npm_config_user_agent\" in pnpm/*) ;; *) echo \"Use pnpm instead\" >&2; exit 1 ;; esac'",
    "build": "pnpm run typecheck && pnpm -r --if-present run build",
    "typecheck:libs": "tsc --build",
    "typecheck": "pnpm run typecheck:libs && pnpm -r --filter \"./artifacts/**\" --filter \"./scripts\" --if-present run typecheck",
    "test:e2e": "playwright test",
    "test:e2e:headed": "playwright test --headed"
  },
  "private": true,
  "dependencies": {
    "@replit/connectors-sdk": "^0.4.3"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "prettier": "^3.9.6",
    "typescript": "~5.9.3"
  }
}
```

- [ ] **Step 3: Ignore Playwright runtime output**

Append to `.gitignore`:

```gitignore
# Playwright
/playwright-report/
/test-results/
```

- [ ] **Step 4: Regenerate the lockfile with pnpm 10.28.0**

Run:

```bash
corepack prepare pnpm@10.28.0 --activate
pnpm install --lockfile-only
```

Expected: `pnpm-lock.yaml` records `@playwright/test` in the root importer and resolves its Playwright packages without changing `minimumReleaseAge: 1440`.

- [ ] **Step 5: Verify the tooling metadata**

Run:

```bash
node -e 'const p=require("./package.json"); if (p.packageManager!=="pnpm@10.28.0") throw new Error("pnpm pin missing"); if (p.devDependencies?.["@playwright/test"]!=="1.63.0") throw new Error("Playwright pin missing"); if (!p.scripts?.["test:e2e"]) throw new Error("e2e script missing")'
pnpm install --frozen-lockfile
```

Expected: PASS; frozen install succeeds.

- [ ] **Step 6: Commit the tooling slice**

```bash
git add package.json pnpm-lock.yaml .gitignore
git commit -m "chore: pin pnpm and add playwright tooling"
```

---

### Task 2: Configure Playwright Against the Existing THERASSISTANT Stack

**Files:**
- Create: `playwright.config.ts`

**Interfaces:**
- Consumes: `@workspace/api-server`, `@workspace/therassistant-inventory`, environment variable `PLAYWRIGHT_BASE_URL`.
- Produces: local base URL `http://127.0.0.1:4173`; local API server on port 8080; retained trace/screenshot/video evidence on browser failure.

- [ ] **Step 1: Write the Playwright configuration**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const localBaseURL = "http://127.0.0.1:4173";
const apiEnv = { ...process.env, PORT: "8080", NODE_ENV: "development" } as Record<string, string>;

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
          command: "pnpm --filter @workspace/therassistant-inventory exec vite --config vite.config.ts --host 127.0.0.1 --port 4173",
          url: localBaseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
```

- [ ] **Step 2: Verify Playwright can load the config**

Run:

```bash
pnpm exec playwright test --list
```

Expected: config loads successfully. Before Task 3 creates tests, Playwright may report that no tests were found; it must not report a configuration or TypeScript error.

- [ ] **Step 3: Commit the runner configuration**

```bash
git add playwright.config.ts
git commit -m "test: configure playwright browser runner"
```

---

### Task 3: Add Critical Workspace Route Smoke Coverage

**Files:**
- Create: `e2e/workspaces.spec.ts`

**Interfaces:**
- Consumes: the app routes defined in `artifacts/therassistant-inventory/src/App.tsx` and the Playwright `baseURL` from Task 2.
- Produces: one browser smoke assertion for each critical workspace route and heading.

- [ ] **Step 1: Write the route smoke tests**

Create `e2e/workspaces.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const workspaces = [
  { path: "/", heading: "Revenue Cycle Command Center" },
  { path: "/clients", heading: "Patients" },
  { path: "/schedule", heading: "Schedule" },
  { path: "/claims", heading: "Claims" },
  { path: "/payments", heading: "Payments" },
  { path: "/eligibility", heading: "Eligibility" },
  { path: "/authorizations", heading: "Authorizations" },
  { path: "/credentialing", heading: "Credentialing" },
  { path: "/mailroom", heading: "Mailroom" },
  { path: "/providers", heading: "Providers" },
  { path: "/payers-contracts", heading: "Payers & Contracts" },
] as const;

for (const workspace of workspaces) {
  test(`${workspace.heading} workspace renders`, async ({ page }) => {
    await page.goto(workspace.path);
    expect(new URL(page.url()).pathname).toBe(workspace.path);
    await expect(
      page.getByRole("heading", { level: 1, name: workspace.heading }),
    ).toBeVisible();
  });
}
```

- [ ] **Step 2: Install the Chromium browser binary used by the suite**

Run:

```bash
pnpm exec playwright install chromium
```

Expected: Chromium installs successfully.

- [ ] **Step 3: Run the route suite against the current public deployment**

Run:

```bash
PLAYWRIGHT_BASE_URL=https://therassistant.vercel.app pnpm test:e2e -- e2e/workspaces.spec.ts
```

Expected: all 11 workspace routes reach their expected level-1 headings. Any failure is treated as a real browser integration finding rather than being hidden with a skip.

- [ ] **Step 4: Commit route coverage**

```bash
git add e2e/workspaces.spec.ts
git commit -m "test: cover critical workspace routes"
```

---

### Task 4: Add Non-Persistent Browser Action Coverage

**Files:**
- Create: `e2e/workspace-actions.spec.ts`

**Interfaces:**
- Consumes: existing WorkDrawer behavior and user-facing controls already present in Patients, Schedule, Claims, Payments, Credentialing, Mailroom, Providers, Eligibility, and Authorizations.
- Produces: browser evidence that buttons open their intended work surfaces, editable controls respond, action buttons enable where applicable, and cancel/close returns to the original workspace without saving.

- [ ] **Step 1: Write the patient, schedule, payment, mailroom, and provider drawer tests**

Create the beginning of `e2e/workspace-actions.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

async function expectWorkspace(page: import("@playwright/test").Page, heading: string) {
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

test("Patients opens an add-patient drawer and preserves the workspace on cancel", async ({ page }) => {
  await page.goto("/clients");
  await page.getByRole("button", { name: "+ Add Patient" }).click();
  await expect(page.getByRole("heading", { name: "Add Patient" })).toBeVisible();
  await page.getByLabel("First Name").fill("E2E");
  await page.getByLabel("Last Name").fill("Patient");
  await expect(page.getByRole("button", { name: "Save Patient" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Add Patient" })).toBeHidden();
  await expectWorkspace(page, "Patients");
  expect(new URL(page.url()).pathname).toBe("/clients");
});

test("Schedule opens a new-appointment drawer and returns to the schedule", async ({ page }) => {
  await page.goto("/schedule");
  await page.getByRole("button", { name: "+ New Appointment" }).click();
  await expect(page.getByRole("heading", { name: "New Appointment" })).toBeVisible();
  await expect(page.getByLabel("Patient")).toBeVisible();
  await expect(page.getByLabel("Provider")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expectWorkspace(page, "Schedule");
  expect(new URL(page.url()).pathname).toBe("/schedule");
});

test("Payments opens the post-payment drawer without posting", async ({ page }) => {
  await page.goto("/payments");
  await page.getByRole("button", { name: "+ Post Payment" }).click();
  await expect(page.getByRole("heading", { name: "Post Payment" })).toBeVisible();
  await page.getByLabel("Amount").fill("10.00");
  await expect(page.getByRole("button", { name: "Post Payment" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expectWorkspace(page, "Payments");
});

test("Mailroom opens add-correspondence work without saving", async ({ page }) => {
  await page.goto("/mailroom");
  await page.getByRole("button", { name: "+ Add Correspondence" }).click();
  await expect(page.getByRole("heading", { name: "Add Correspondence" })).toBeVisible();
  await page.getByLabel("Subject").fill("E2E correspondence check");
  await expect(page.getByRole("button", { name: "Save Correspondence" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expectWorkspace(page, "Mailroom");
});

test("Providers opens an add-provider drawer without saving", async ({ page }) => {
  await page.goto("/providers");
  await page.getByRole("button", { name: "+ Add Provider" }).click();
  await expect(page.getByRole("heading", { name: "Add Provider" })).toBeVisible();
  await page.getByLabel("First Name").fill("E2E");
  await page.getByLabel("Last Name").fill("Provider");
  await expect(page.getByRole("button", { name: "Save Provider" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expectWorkspace(page, "Providers");
});
```

- [ ] **Step 2: Add existing-record drawer checks for Claims and Credentialing**

Append:

```ts
test("Claims opens claim work from the claims list and returns to the queue", async ({ page }) => {
  await page.goto("/claims");
  await page.getByRole("button", { name: "Claims List" }).click();
  const firstRow = page.getByRole("table").locator("tbody tr").first();
  await expect(firstRow).toBeVisible();
  await firstRow.getByRole("button").first().click();
  await expect(page.getByRole("tab", { name: "Claim Fields" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save & Revalidate" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("tab", { name: "Claim Fields" })).toBeHidden();
  await expectWorkspace(page, "Claims");
});

test("Credentialing opens enrollment work and returns without changing the enrollment", async ({ page }) => {
  await page.goto("/credentialing");
  const edit = page.getByRole("button", { name: "Edit Enrollment" }).first();
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(page.getByRole("heading", { name: "Edit Enrollment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Enrollment" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expectWorkspace(page, "Credentialing");
});
```

- [ ] **Step 3: Add non-mutating readiness-filter checks**

Append:

```ts
for (const workspace of [
  { path: "/eligibility", heading: "Eligibility" },
  { path: "/authorizations", heading: "Authorizations" },
] as const) {
  test(`${workspace.heading} attention filter toggles without navigation`, async ({ page }) => {
    await page.goto(workspace.path);
    const needsAttention = page.getByRole("button", { name: /^Needs Attention \(\d+\)$/ });
    await expect(needsAttention).toBeVisible();
    await needsAttention.click();
    await expect(page.getByRole("button", { name: "Show All" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(workspace.path);
    await expectWorkspace(page, workspace.heading);
  });
}
```

- [ ] **Step 4: Run all browser tests against the public deployment**

Run:

```bash
PLAYWRIGHT_BASE_URL=https://therassistant.vercel.app pnpm test:e2e
```

Expected: route tests and action tests pass without creating or updating records.

- [ ] **Step 5: Run the browser suite locally against the actual Vite + Express stack**

Run:

```bash
pnpm test:e2e
```

Expected: Playwright starts the existing API server on port 8080 and Vite on port 4173, then the same suite passes. If required environment variables such as `DATABASE_URL` are unavailable in the execution environment, record that local-server limitation explicitly and validate the suite against a branch Vercel preview instead; do not introduce fake production data or a mock backend to bypass the missing environment.

- [ ] **Step 6: Commit action coverage**

```bash
git add e2e/workspace-actions.spec.ts
git commit -m "test: exercise workspace browser actions"
```

---

### Task 5: Run the Existing Quality Gates and Verify the Branch Deployment

**Files:**
- No planned production source changes.
- Modify test/config files only if verification exposes a real defect in this slice.

**Interfaces:**
- Consumes: existing 160-test domain suite, Phase 3 TypeScript gate, Vite production build, browser source secret scan, Vercel preview deployment.
- Produces: evidence that the new test infrastructure did not regress existing THERASSISTANT behavior or build health.

- [ ] **Step 1: Run the existing unit/domain suite**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/**/*.test.ts
```

Expected: all existing tests pass; baseline from the audited production build is 160/160.

- [ ] **Step 2: Run the production TypeScript gate**

```bash
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run the browser-source secret scan**

```bash
if grep -R -n -E 'SUPABASE_SERVICE_ROLE_KEY|sb_secret_' artifacts/therassistant-inventory/src; then
  echo "Forbidden Supabase server secret marker found in browser source."
  exit 1
fi
```

Expected: no forbidden markers.

- [ ] **Step 4: Run the production frontend build**

```bash
pnpm --filter @workspace/therassistant-inventory run build
```

Expected: Vite build succeeds. The existing large-chunk and sourcemap warnings may remain because their remediation is explicitly deferred from this slice.

- [ ] **Step 5: Compare the branch against main**

```bash
git diff --stat main...HEAD
git diff main...HEAD -- package.json .gitignore playwright.config.ts e2e/
```

Expected: changes are limited to the approved design/plan and browser-test/build-determinism files; no production component or business-logic source file is changed.

- [ ] **Step 6: Verify the Vercel preview build**

After the branch commits trigger Vercel, inspect the latest deployment for `chore/e2e-deterministic-builds`.

Expected: deployment state `READY`; install log reports pnpm 10.28.0 from `packageManager`; existing unit tests, TypeScript gate, and Vite build remain successful.

- [ ] **Step 7: Run Playwright against the branch preview URL**

```bash
PLAYWRIGHT_BASE_URL=https://<branch-preview-host> pnpm test:e2e
```

Expected: all browser smoke/action tests pass against the exact branch artifact. Replace `<branch-preview-host>` with the actual Vercel preview hostname returned for this branch; do not hard-code a guessed hostname.

- [ ] **Step 8: Final verification commit only if verification required test/config corrections**

If no corrections were required, do not create an empty commit. If corrections were required:

```bash
git add package.json pnpm-lock.yaml .gitignore playwright.config.ts e2e/
git commit -m "test: stabilize browser verification"
```

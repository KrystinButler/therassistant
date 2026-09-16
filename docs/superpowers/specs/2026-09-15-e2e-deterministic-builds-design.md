# E2E Workflow Coverage and Deterministic Builds Design

## Purpose

Add browser-level protection for the THERASSISTANT workspace flows identified in the Vercel audit, while making the build environment deterministic. This first slice changes test/build infrastructure only and does not change production feature behavior.

## Scope

This work will:

- add Playwright-based end-to-end tests for critical workspaces;
- verify user-visible workflow behavior instead of only page rendering;
- pin the repository package-manager version used by Vercel;
- keep all changes isolated from the active integrated workspace feature branch.

This work will not:

- refactor production business logic;
- introduce bundle splitting yet;
- change Vercel framework detection or project settings yet;
- redesign workspace UI;
- expand application functionality.

## Architecture

Playwright will live as a dedicated browser-test layer alongside the existing domain/unit test suite. The existing unit/domain tests remain responsible for business rules and data transformations. Playwright will verify that the browser exposes those capabilities correctly through routes, controls, drawers, and save/close behavior.

The test runner will start the existing Vite application and drive it as a user would. Tests will use stable role-, label-, text-, or explicit test-id-based selectors. They will avoid implementation-detail selectors such as generated class names.

## Initial Workflow Coverage

The first browser smoke suite will cover these workspaces:

- Dashboard
- Clients
- Schedule
- Claims
- Payments
- Eligibility
- Authorizations
- Credentialing
- Mailroom
- Providers
- Payers

For each workspace, the suite will first prove that the route loads and the expected workspace heading or primary control is present. Where the current application already exposes a user action, the test will exercise the action rather than stop at navigation.

Priority interactive checks are:

- opening a work drawer from a queue or workspace;
- editing or selecting a supported field;
- saving when a supported save action exists;
- confirming the drawer closes or reflects the saved state;
- confirming the underlying workspace remains available after the action;
- confirming route context, filters, tabs, or list state are preserved where the current implementation supports that behavior.

A test will not invent unsupported behavior. If a workspace does not yet expose a completed action path on the branch under test, its first test will remain a route/workspace smoke check and be strengthened when that behavior lands.

## Test Data and Environment

The browser suite will target the repository's existing development/demo behavior and synthetic data. It will not use production PHI or production credentials.

Tests must be deterministic and independent. They should not depend on execution order or leave persistent state that changes later tests.

If API dependencies are required to render an existing workspace, the test setup will use the application's existing local/demo mechanism rather than introducing a second application backend solely for Playwright.

## Build Determinism

The root `package.json` will declare the exact pnpm version currently used successfully by Vercel. This prevents Vercel and local tooling from selecting pnpm based only on lockfile inference.

The existing preinstall guard that requires pnpm remains in place.

## Scripts

Repository scripts will expose a clear browser-test entry point, with separate commands for normal execution and optional interactive/debug execution if Playwright supports that without extra application changes.

The existing unit/domain test, typecheck, and build commands remain intact.

## CI and Deployment Behavior

This slice will make the Playwright suite runnable and suitable for a deployment gate, but it will not make unrelated Vercel project-setting changes at the same time.

A later follow-up may wire the suite into the preferred CI/deployment gate once the smoke suite is stable and the active workspace branches are merged.

## Error Handling

Browser tests should fail with evidence that identifies the broken user flow. Playwright trace/screenshot capture will be enabled for failures where practical so a failed deployment preview can be diagnosed without reproducing the issue manually first.

Tests will prefer explicit assertions about visible behavior and URL/route state over arbitrary waits.

## Verification

The change is complete only when:

1. Playwright configuration is present and valid.
2. The browser-test script starts the existing Vite application correctly.
3. The initial critical-workspace smoke suite exists.
4. Interactive checks are included for workflows already available on the target branch.
5. Existing unit/domain tests continue to pass.
6. TypeScript checks continue to pass.
7. The production build continues to pass.
8. pnpm is explicitly pinned.

## Follow-up Work

After this slice is stable:

1. strengthen each smoke test into a full drawer action flow as workspace implementations merge;
2. add the browser suite as a required deployment/PR gate;
3. address Vite bundle-size warnings with route-level lazy loading/dynamic imports;
4. review the Vercel `framework: null` setting separately;
5. resolve the non-blocking sourcemap warnings if they remain after dependency/config cleanup.

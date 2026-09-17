# Production Authentication and Tenant Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the staff application's anonymous demo runtime with Supabase Auth sessions and active tenant membership while preserving existing workspace interfaces.

**Architecture:** Add a supported Supabase JavaScript client for session lifecycle, gate staff routes behind an auth provider, and resolve tenant context from `tenant_users` under RLS. Refactor the two existing low-level data adapters to attach the signed-in access token and resolved tenant ID, allowing current pages/hooks to continue working with minimal UI churn. Patient portal routes remain outside the staff auth gate in this phase.

**Tech Stack:** React 19, TypeScript, Vite, Wouter, Supabase Auth/PostgREST, `@supabase/supabase-js`, pnpm 10.28.0, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-production-auth-tenant-context.md`

## Global Constraints

- Staff routes require a valid Supabase Auth session.
- No public staff self-registration UI.
- No service-role or secret key in browser code.
- Tenant context comes only from active `tenant_users` membership for the signed-in user.
- Existing PostgreSQL RLS remains the authorization boundary.
- `/patient-portal/*` is not gated by staff auth in this phase.
- A signed-in user without an active tenant membership receives an access/setup error; there is no demo fallback.
- Keep existing staff workspace component APIs stable where practical.

---

### Task 1: Add supported Supabase client and auth contract tests

**Files:**
- Modify: `artifacts/therassistant-inventory/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `artifacts/therassistant-inventory/src/lib/supabase-client.ts`
- Create: `scripts/check-production-auth.mjs`
- Modify: `.github/workflows/ci.yml` or the existing contract-test workflow that runs repository checks

**Interfaces:**
- Produces: `supabase` browser client with persisted/auto-refreshed sessions.
- Produces: `getAccessToken(): Promise<string | null>` for low-level REST adapters.

- [ ] **Step 1: Write the failing production-auth contract test**

Create `scripts/check-production-auth.mjs` that fails while any of these production anti-patterns remain in the staff runtime: `DEMO_TENANT_NAME`, `getDemoTenantId`, `/demo` route import, `SYNTHETIC DEMO DATA`, or `DEMO PRACTICE`. It must also require a `supabase-client.ts` module and an auth provider module.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `node scripts/check-production-auth.mjs`
Expected: FAIL because current staff runtime still contains demo tenant selection and no production auth client/provider.

- [ ] **Step 3: Add `@supabase/supabase-js` and the browser client**

`supabase-client.ts` must create one client using the current project URL and publishable key, with:

```ts
auth: {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
}
```

Export:

```ts
export const supabase: SupabaseClient;
export async function getAccessToken(): Promise<string | null>;
```

`getAccessToken()` calls `supabase.auth.getSession()` and returns `session?.access_token ?? null`.

- [ ] **Step 4: Run typecheck and the contract test**

Run: `pnpm --filter @workspace/therassistant-inventory typecheck && node scripts/check-production-auth.mjs`
Expected: contract remains RED until the later demo runtime removal tasks; TypeScript passes.

- [ ] **Step 5: Commit**

Commit message: `feat: add production Supabase auth client`

---

### Task 2: Add staff AuthProvider and login gate

**Files:**
- Create: `artifacts/therassistant-inventory/src/auth/auth-context.tsx`
- Create: `artifacts/therassistant-inventory/src/auth/LoginPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Test: `e2e/auth-gate.spec.ts`

**Interfaces:**
- Produces: `AuthProvider`, `useAuth()`.
- `useAuth()` returns `{ session, user, loading, error, signIn(email, password), signOut() }`.

- [ ] **Step 1: Write failing E2E assertions**

`e2e/auth-gate.spec.ts` must assert that a fresh unauthenticated staff navigation shows the Therassistant sign-in form and does not render the staff sidebar. It must separately assert that a `/patient-portal/...` route is not redirected to staff login.

- [ ] **Step 2: Run the focused E2E test and verify RED**

Run: `pnpm exec playwright test e2e/auth-gate.spec.ts`
Expected: FAIL because staff routes currently render without authentication.

- [ ] **Step 3: Implement `AuthProvider`**

On mount, load `supabase.auth.getSession()` and subscribe to `supabase.auth.onAuthStateChange`. `signIn` uses `signInWithPassword`; `signOut` uses `supabase.auth.signOut`. No sign-up method is exposed.

- [ ] **Step 4: Implement staff route gate**

Keep `/patient-portal/*` routing before the staff gate. Wrap staff routes in `AuthProvider`; while loading show a neutral loading state, while unauthenticated show `LoginPage`, and only render `AppShell` when authenticated.

- [ ] **Step 5: Run focused test and typecheck**

Run: `pnpm exec playwright test e2e/auth-gate.spec.ts && pnpm --filter @workspace/therassistant-inventory typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: require Supabase auth for staff app`

---

### Task 3: Resolve tenant membership under RLS

**Files:**
- Create: `artifacts/therassistant-inventory/src/auth/tenant-context.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Test: `scripts/check-production-auth.mjs`

**Interfaces:**
- Produces: `TenantProvider`, `useTenant()`.
- `useTenant()` returns `{ tenantId, tenantName, timezone, roles, loading, error }`.

- [ ] **Step 1: Extend the contract test**

Require `tenant-context.tsx` and reject any tenant lookup by `name=eq.Therassistant Demo` or any hard-coded tenant UUID in staff data code.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/check-production-auth.mjs`
Expected: FAIL because existing adapters still resolve the demo tenant by name.

- [ ] **Step 3: Implement tenant resolution**

For the authenticated `user.id`, query active `tenant_users` memberships through the authenticated Supabase client, order deterministically, select one membership, load the corresponding `tenants` row, and load `tenant_user_roles` for that user/tenant. A missing membership returns a setup/access error and never falls back to anonymous data.

- [ ] **Step 4: Gate staff workspaces on tenant readiness**

Nest `TenantProvider` inside the authenticated branch. Render the application shell only after tenant resolution succeeds.

- [ ] **Step 5: Run typecheck and contract test**

Run: `pnpm --filter @workspace/therassistant-inventory typecheck && node scripts/check-production-auth.mjs`
Expected: contract may remain RED until legacy adapter names are removed in Task 4; provider/typecheck passes.

- [ ] **Step 6: Commit**

Commit message: `feat: resolve authenticated tenant context`

---

### Task 4: Convert both low-level data adapters from demo to authenticated tenant access

**Files:**
- Replace: `artifacts/therassistant-inventory/src/lib/supabase-demo-client.ts` with `artifacts/therassistant-inventory/src/lib/tenant-data-client.ts`
- Modify: all imports of `supabase-demo-client.ts`
- Modify: `artifacts/therassistant-inventory/src/lib/therassistant-api.ts`
- Modify: `artifacts/therassistant-inventory/src/lib/supabase-demo-storage.ts` if it still performs tenant-scoped storage/database access
- Test: `scripts/check-production-auth.mjs`

**Interfaces:**
- Produces: tenant-scoped helpers `tenantSelect`, `tenantInsert`, `tenantUpdate`, `tenantUpdateExact`, `tenantRpc`.
- Consumes: current Supabase session access token and tenant ID resolved from authenticated membership.

- [ ] **Step 1: Add RED assertions**

The contract test rejects imports/exports named `demoSelect`, `demoInsert`, `demoUpdate`, `demoRpc`, `createDemoClient`, `getDemoTenantId`, `demoTenant`, and `DEMO_TENANT_NAME` in production staff source.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/check-production-auth.mjs`
Expected: FAIL on current demo adapters.

- [ ] **Step 3: Implement authenticated REST request headers**

Every PostgREST call made by the adapters must include both the publishable `apikey` and `Authorization: Bearer <current access token>`. If no session token exists, throw an authentication-required error instead of falling back to anonymous access.

- [ ] **Step 4: Replace tenant-name resolution**

Resolve the active tenant from `tenant_users` for the authenticated user. Cache only for the active session/user and clear/re-resolve when auth state changes. Tenant-scoped insert/update/select operations use that resolved tenant ID.

- [ ] **Step 5: Preserve existing page-facing payload shapes**

Do not alter the API-shaped data returned to workspace components except where a field was explicitly demo-only.

- [ ] **Step 6: Run contract, typecheck, build**

Run: `node scripts/check-production-auth.mjs && pnpm run typecheck && pnpm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `refactor: use authenticated tenant data access`

---

### Task 5: Remove staff demo runtime and make shell identity dynamic

**Files:**
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Modify: `artifacts/therassistant-inventory/src/components/app-shell.tsx`
- Modify: `artifacts/therassistant-inventory/src/navigation/sections.ts` if Demo navigation remains
- Delete: `artifacts/therassistant-inventory/src/pages/demo-control.tsx`
- Delete or detach from production: `artifacts/therassistant-inventory/src/lib/demo-data.ts`
- Modify: `artifacts/therassistant-inventory/index.html` if title still says demo
- Test: `scripts/check-production-auth.mjs`

**Interfaces:**
- `AppShell` consumes authenticated tenant/user context.

- [ ] **Step 1: Ensure RED checks cover all demo runtime labels/routes**

Run: `node scripts/check-production-auth.mjs`
Expected: FAIL until `/demo`, demo badges, and hard-coded practice names are removed.

- [ ] **Step 2: Remove `/demo` route and demo navigation**

Delete the Demo Control Center import/route and any primary navigation entry pointing to it.

- [ ] **Step 3: Make shell identity dynamic**

Show the resolved `tenantName` in sidebar/topbar and the signed-in user's display name/email. Add a sign-out control. Remove `DEMO PRACTICE`, `SYNTHETIC DEMO DATA`, `Front Range Behavioral Health`, and `Therassistant Billing Services` hard-coding from the staff shell.

- [ ] **Step 4: Update page title/metadata**

Use `Therassistant` or `Therassistant EHR`, not `EHR Demo`.

- [ ] **Step 5: Run contract, typecheck, build**

Run: `node scripts/check-production-auth.mjs && pnpm run typecheck && pnpm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `refactor: remove staff demo runtime`

---

### Task 6: Verify preview safely before production cutover

**Files:**
- Test: existing `.github/workflows/*`
- Test: `e2e/auth-gate.spec.ts`
- Test: `scripts/check-production-auth.mjs`

**Interfaces:**
- Consumes all prior tasks.
- Produces a merge-ready PR but does not merge until a real authorized staff Auth user and `tenant_users` membership exist.

- [ ] **Step 1: Run complete verification**

Run: `node scripts/check-production-auth.mjs && pnpm run typecheck && pnpm run build && pnpm run test:e2e`
Expected: all PASS.

- [ ] **Step 2: Run Supabase security checks**

Verify RLS remains enabled on all public tables, tenant helper policies still reference the private helper functions, and Supabase Security Advisor reports zero findings.

- [ ] **Step 3: Confirm account provisioning precondition**

Query `auth.users` and active `tenant_users`. If there is no authorized staff account/membership, leave the PR unmerged and report the exact provisioning blocker rather than exposing public signup or merging a lockout.

- [ ] **Step 4: Preview verification**

Confirm Vercel preview builds successfully. Verify unauthenticated staff routes show login and patient portal routes retain their existing behavior.

- [ ] **Step 5: Merge only when the provisioning precondition is satisfied**

After a real authorized staff account exists and is assigned to the correct tenant, merge the PR, verify Vercel production SHA, HTTP 200, and runtime error logs.

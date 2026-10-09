# Office Ally Tenant Credentials and Payment/Denial Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Office Ally credential ownership to each tenant, preserve a no-network test environment, and prove 835 payment posting and denial routing through the existing THERASSISTANT workflows.

**Architecture:** Store tenant Office Ally secrets in Supabase Vault behind tenant/admin authorization, while exposing only non-secret connection status to the browser. Keep `office-ally-edi` as the single transaction gateway: `test` mode returns deterministic synthetic EDI fixtures without external network calls; `production` mode loads only the requesting tenant's encrypted credential and centrally maintained transaction route. Reuse `parse835` and `import835Workflow` unchanged as the financial-routing boundary, adding deterministic fixtures and end-to-end workflow tests rather than a parallel payment engine.

**Tech Stack:** TypeScript, React/Vite, Supabase Postgres/RLS/Vault, Supabase Edge Functions (Deno), Node test runner, existing THERASSISTANT payment/denial workflows.

**Spec:** `docs/superpowers/specs/2026-10-09-office-ally-tenant-credentials-payment-denial-testing-design.md`

## Global Constraints

- Active repository only: `KrystinButler/therassistant`; do not modify frozen EHR repositories.
- Office Ally remains the default clearinghouse for `837P`, `270/271`, `276/277`, and `835`.
- Each practice owns and pays for its own Office Ally account.
- Practices do not configure Office Ally endpoints, HTTP methods, receiver IDs, transaction families, or payer routing.
- No plaintext Office Ally secret may be stored in tenant settings, browser storage, logs, Git, or ordinary application tables.
- Test mode must never transmit data to Office Ally or any other external clearinghouse.
- Production mode must fail closed when tenant credentials, central route configuration, or an approved credential profile are missing.
- Do not invent an Office Ally authentication format. The active credential profile is a centrally configured server concern.
- Existing payer-specific enrollment requirements remain outside the credential layer.
- 835 testing must use the existing `parse835` and `import835Workflow` paths.
- Preserve duplicate, payer-identity, reconciliation, negative-adjustment, unmatched, ambiguous-match, and denial guardrails already present in payment posting.
- After implementation: run targeted tests, full TypeScript checks, build, Supabase compatibility verification, and dead-code/search checks before production release.

## Review Focus

- A non-admin tenant member attempting to save, replace, or disconnect Office Ally credentials must receive a permission failure and must not mutate Vault or connection metadata.
- A valid user from tenant A must never resolve tenant B's credential, even if tenant B's ID is supplied manually.
- A request marked `test` must never execute `fetch()` against Office Ally, even when production credentials exist for the tenant.
- A production request with a missing/unknown credential profile must fail closed without exposing secret material or silently falling back to platform credentials.
- Re-importing the same synthetic 835 trace must create no second payment, allocation, adjustment, denial, or work item.

---

## File Structure

**Create**
- `supabase/migrations/20261009080000_tenant_office_ally_connections.sql` — tenant connection metadata, Vault-backed credential RPCs, authorization, and RLS.
- `supabase/functions/_shared/office-ally-connection.ts` — server-only connection status/credential resolution helpers and credential-profile validation.
- `artifacts/therassistant-inventory/src/domains/edi/office-ally-connection.ts` — browser-safe connection-status and credential-management client.
- `artifacts/therassistant-inventory/src/domains/edi/OfficeAllyConnectionPanel.tsx` — Practice Configuration UI for connection state/actions without EDI routing fields.
- `artifacts/therassistant-inventory/src/domains/payments/era-835-test-fixtures.ts` — deterministic synthetic 835 builders/fixtures.
- `artifacts/therassistant-inventory/tests/office-ally-tenant-connection.test.ts` — tenant-connection contract tests.
- `artifacts/therassistant-inventory/tests/era-835-routing.test.ts` — payment/denial workflow tests using an in-memory repository.

**Modify**
- `supabase/functions/office-ally-edi/index.ts` — explicit `test`/`production` routing, tenant credential resolution, redaction, and zero-network test branch.
- `artifacts/therassistant-inventory/src/domains/edi/office-ally.ts` — tenant-owned connection model and explicit environment on transactions.
- `artifacts/therassistant-inventory/src/pages/practice-configuration.tsx` — show Office Ally connection panel; do not restore technical clearinghouse settings.
- `artifacts/therassistant-inventory/src/domains/payments/workflow.ts` — only if a failing fixture exposes a defect; otherwise preserve current workflow unchanged.
- `.github/workflows/production-ci.yml` — add targeted Office Ally/835 contract tests only if existing generic test discovery does not already run them.

### Task 1: Tenant-scoped Office Ally connection metadata and Vault storage

**Files:**
- Create: `supabase/migrations/20261009080000_tenant_office_ally_connections.sql`
- Create/Test: `artifacts/therassistant-inventory/tests/office-ally-tenant-connection.test.ts`

**Interfaces:**
- Produces RPC `get_office_ally_connection_status()` returning `{ provider, environment, status, account_label, credential_profile, last_verified_at, last_error }` with no secret ID/value.
- Produces RPC `save_office_ally_connection(p_environment text, p_account_label text, p_credential_profile text, p_credentials jsonb)` returning the same browser-safe status shape.
- Produces RPC `disconnect_office_ally_connection()` returning browser-safe disconnected status.
- Produces table `public.tenant_edi_connections` with unique `(tenant_id, provider)` and a server-only Vault secret reference.
- Consumes existing tenant membership/role model; only Practice Admin/Platform Admin-equivalent roles may mutate credentials.

- [ ] **Step 1: Write the failing migration contract tests**

Add tests asserting the SQL contains: one Office Ally connection per tenant, Vault creation/update, no plaintext credential column, admin-role enforcement on save/disconnect, no direct tenant write policy, and browser-safe status that omits the Vault secret reference.

- [ ] **Step 2: Run the targeted test and verify failure**

Run: `node --experimental-strip-types --test artifacts/therassistant-inventory/tests/office-ally-tenant-connection.test.ts`

Expected: FAIL because the migration/RPC contract does not exist.

- [ ] **Step 3: Implement the migration**

Create the metadata table and the three RPCs above. `save_office_ally_connection` must replace the prior Vault secret rather than accumulating active credentials, set provider to `office_ally`, and reject unsupported environments outside `test|production`. No RPC may return the credential JSON or decrypted Vault value.

- [ ] **Step 4: Run the targeted test and verify pass**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Verify migration compatibility in an isolated Supabase stack**

Run the repository's existing isolated Supabase migration/start workflow used by Production CI and verify the new migration applies cleanly after the production migration ledger.

Expected: migration succeeds; no duplicate version; Vault functions resolve.

- [ ] **Step 6: Commit**

Commit message: `feat: add tenant Office Ally credential storage`

### Task 2: Server gateway separation for test and production

**Files:**
- Create: `supabase/functions/_shared/office-ally-connection.ts`
- Modify: `supabase/functions/office-ally-edi/index.ts`
- Modify/Test: `artifacts/therassistant-inventory/tests/office-ally-tenant-connection.test.ts`

**Interfaces:**
- Consumes `tenant_edi_connections` and its Vault secret reference from Task 1 through service-role access only.
- Produces `resolveOfficeAllyConnection(ctx, tenantId, environment)` returning server-only `{ environment, credentialProfile, credentials }` for production and `{ environment: "test" }` for test.
- `office-ally-edi` request body becomes `{ tenantId, environment: "test" | "production", transaction, payload }`.
- Test response carries `{ ok, transaction, environment: "test", synthetic: true, data }`.
- Production response carries `synthetic: false` and never returns credential data.

- [ ] **Step 1: Extend failing contract tests**

Assert that test mode has an explicit branch before any credential load or upstream `fetch`, production resolves a tenant-specific secret, no platform-wide `OFFICE_ALLY_AUTH_VALUE` fallback remains, cross-tenant membership is rejected, and error serialization redacts credential values.

- [ ] **Step 2: Run targeted tests and verify failure**

Run: `node --experimental-strip-types --test artifacts/therassistant-inventory/tests/office-ally-tenant-connection.test.ts`

Expected: FAIL on current platform-managed credential behavior.

- [ ] **Step 3: Implement server-only connection resolver**

The resolver must read the current tenant's enabled Office Ally metadata and decrypt its Vault secret only in production. The credential payload is an opaque JSON object validated against the centrally configured `OFFICE_ALLY_CREDENTIAL_PROFILE`; unknown or missing profiles fail closed. Do not add browser-configurable endpoint/header fields.

- [ ] **Step 4: Refactor `office-ally-edi`**

Add the explicit environment field. In `test`, return deterministic synthetic transaction output and never execute the Office Ally upstream branch. In `production`, use the tenant credential resolver plus the existing centrally configured transaction routes. Remove platform-wide Office Ally credential fallback.

- [ ] **Step 5: Run targeted tests and secret scan**

Run targeted test plus the existing browser secret scan used by Production CI.

Expected: PASS; no Office Ally credential material appears in browser source.

- [ ] **Step 6: Commit**

Commit message: `feat: isolate Office Ally transport by tenant and environment`

### Task 3: Browser-safe Office Ally connection UI

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/edi/office-ally-connection.ts`
- Create: `artifacts/therassistant-inventory/src/domains/edi/OfficeAllyConnectionPanel.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/edi/office-ally.ts`
- Modify: `artifacts/therassistant-inventory/src/pages/practice-configuration.tsx`
- Modify/Test: `artifacts/therassistant-inventory/tests/office-ally-tenant-connection.test.ts`

**Interfaces:**
- `getOfficeAllyConnectionStatus(): Promise<OfficeAllyConnectionStatus>`.
- `saveOfficeAllyConnection(input: { environment: "test" | "production"; accountLabel: string; credentialProfile: string; credentials: Record<string,string> }): Promise<OfficeAllyConnectionStatus>`.
- `disconnectOfficeAllyConnection(): Promise<OfficeAllyConnectionStatus>`.
- `sendOfficeAllyTransaction` requires `environment` and cannot infer production.

- [ ] **Step 1: Add failing UI/client contract tests**

Assert Practice Configuration contains Office Ally connection states/actions, does not contain the removed technical clearinghouse fields, never renders stored secret values, and transaction calls include explicit environment.

- [ ] **Step 2: Run targeted tests and verify failure**

Run the targeted Office Ally test file.

Expected: FAIL because the connection panel/client do not exist.

- [ ] **Step 3: Implement browser-safe connection client**

Use authenticated server/RPC calls only. After save, discard credential values from React state and refetch status. Never persist credentials in local/session storage.

- [ ] **Step 4: Implement `OfficeAllyConnectionPanel`**

Render `Not connected`, `Test ready`, `Production connected`, or `Connection error`; actions are `Connect Office Ally`, `Test connection`, `Replace credentials`, and `Disconnect`. Credential inputs come from the centrally selected credential profile; if no production profile is configured, production connection is disabled with a non-technical message while test mode remains available.

- [ ] **Step 5: Wire into Practice Configuration**

Add the panel as the Office Ally integration surface. Do not reintroduce submitter/receiver/URL/method/transaction-type fields.

- [ ] **Step 6: Typecheck and run targeted tests**

Run: `pnpm --filter @workspace/therassistant-inventory run typecheck`

Then run the targeted Office Ally test.

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: add tenant Office Ally connection panel`

### Task 4: Deterministic synthetic 835 fixture library

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/payments/era-835-test-fixtures.ts`
- Create/Test: `artifacts/therassistant-inventory/tests/era-835-routing.test.ts`

**Interfaces:**
- Produces `buildTest835(scenario, context): string` where `scenario` is `paid | partial_patient | denied | unmatched | ambiguous | payer_mismatch | reversal`.
- Fixture context accepts exact patient control number, payer identifier, claim charge, trace number, and service line information so tests can target real workflow matching rules.
- Every fixture includes metadata values unique to test execution and deterministic trace numbers supplied by the test.

- [ ] **Step 1: Write failing parser fixture tests**

For each scenario, assert `parse835(buildTest835(...))` produces the intended CLP status, BPR amount, CAS groups/reasons, payer ID, trace, and patient responsibility without adding a second parser.

- [ ] **Step 2: Run test and verify failure**

Run: `node --experimental-strip-types --test artifacts/therassistant-inventory/tests/era-835-routing.test.ts`

Expected: FAIL because fixture builder does not exist.

- [ ] **Step 3: Implement minimal fixture builder**

Generate valid-enough 835 X12 segments for the existing parser only; no Office Ally network simulation beyond deterministic test payloads.

- [ ] **Step 4: Run parser fixture tests**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `test: add deterministic 835 routing fixtures`

### Task 5: Payment posting and denial routing workflow proof

**Files:**
- Modify/Test: `artifacts/therassistant-inventory/tests/era-835-routing.test.ts`
- Modify only if required by a failing test: `artifacts/therassistant-inventory/src/domains/payments/workflow.ts`

**Interfaces:**
- Consumes `buildTest835` from Task 4 and existing `import835Workflow`.
- Uses an in-memory `EraImportRepository` fake that records payments, allocations, adjustments, ERA matches, denials, claim updates, and work items.
- No test calls a live network or production Supabase project.

- [ ] **Step 1: Add clean paid-claim test**

Assert one payment receipt, exact allocation, contractual adjustment if present, claim `paid`, ERA claim `posted`, no denial, no posting exception.

- [ ] **Step 2: Run and verify result**

Expected: PASS with current workflow or FAIL revealing a workflow defect; do not weaken assertions.

- [ ] **Step 3: Add partial-payment/patient-responsibility test**

Assert payment and contractual adjustment post, responsibility split is stored, and claim becomes `patient_responsibility` or `partially_paid` according to remaining insurance responsibility.

- [ ] **Step 4: Add full-denial test**

Assert CLP `4` with zero payment creates a denial, claim becomes `denied`, CARC/RARC are preserved, and a workable denial creates an open `denial_followup` item. Include an auto-writeoff CARC case to assert the existing writeoff branch remains intact.

- [ ] **Step 5: Add unmatched and ambiguous tests**

Assert no financial posting and an `unmatched_era` work item for each.

- [ ] **Step 6: Add duplicate trace test**

Import the same trace twice and assert the second result is blocked with no additional payment/allocation/adjustment/denial/work item.

- [ ] **Step 7: Add payer mismatch test**

Assert financial state is unchanged and a `payment_posting_issue` work item is created.

- [ ] **Step 8: Add reversal/negative CAS test**

Assert no auto-post and a review work item is created.

- [ ] **Step 9: Add BPR/CLP reconciliation failure test**

Assert no payment receipt is created and reconciliation work is queued.

- [ ] **Step 10: Fix only demonstrated workflow defects**

If any assertion fails because `workflow.ts` violates the approved spec, make the smallest production change required; otherwise leave production payment logic untouched.

- [ ] **Step 11: Run the complete 835 routing test file**

Run: `node --experimental-strip-types --test artifacts/therassistant-inventory/tests/era-835-routing.test.ts`

Expected: all scenarios PASS.

- [ ] **Step 12: Commit**

Commit message: `test: verify ERA payment and denial routing`

### Task 6: Isolated integration verification and production release

**Files:**
- Modify if required: `.github/workflows/production-ci.yml`
- Production deploy targets: Supabase project `lpjwfdvaxobewxcklenl`, Vercel project `therassistant`.

**Interfaces:**
- Consumes all prior task outputs.
- Produces a production schema/Edge Function/frontend release only after isolated verification succeeds.

- [ ] **Step 1: Ensure CI executes both new targeted test files**

If existing test discovery already includes them, make no CI edit. Otherwise add only the minimal commands necessary.

- [ ] **Step 2: Run repository verification**

Run targeted Office Ally test, 835 routing test, `pnpm run typecheck`, `pnpm run build`, existing browser secret scan, and existing isolated Supabase E2E/revenue-cycle verification.

Expected: all pass.

- [ ] **Step 3: Verify dead-code and stale platform-credential removal**

Search the active repo for `OFFICE_ALLY_AUTH_VALUE`, `PLATFORM_CLEARINGHOUSE.platformManaged`, and practice-facing `Clearinghouse Settings`; confirm no runtime path still depends on platform-owned credentials or exposes the removed settings.

- [ ] **Step 4: Apply the migration to production Supabase**

Verify the production migration ledger before and after applying `20261009080000_tenant_office_ally_connections.sql`.

Expected: one new ledger entry matching the committed migration; no manual schema drift.

- [ ] **Step 5: Deploy `office-ally-edi`**

Deploy the exact committed Edge Function source. Verify JWT/auth is enabled and invoke test mode with an authenticated tenant context.

Expected: response includes `environment: "test"`, `synthetic: true`, and produces no Office Ally network call.

- [ ] **Step 6: Verify production fail-closed behavior before any buyer credentials exist**

Invoke a production transaction for a tenant without credentials.

Expected: controlled configuration/connection error; no platform credential fallback; no secret in logs or response.

- [ ] **Step 7: Verify Vercel deployment for the exact commit**

Confirm the production deployment is `READY` and points to the intended `main` SHA. Do not promote an unverified preview.

- [ ] **Step 8: Final verification**

Re-run status checks for GitHub Production CI, Supabase function version, migration ledger, and Vercel production alias. Record any remaining blocker specifically; do not claim buyer production connectivity until an actual tenant Office Ally credential profile is configured and tested.

- [ ] **Step 9: Commit any CI-only change**

Commit message: `ci: verify Office Ally payment routing`

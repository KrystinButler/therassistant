# Therassistant Settings System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic Administration placeholder with the approved Therassistant Settings system, backed by secure tenant-scoped configuration, clinical catalogs, staff/audit administration, branding, password management, and a safe payment-processing boundary.

**Architecture:** Settings becomes a dedicated `src/domains/settings` subsystem with one shared model and repository interface. The current unauthenticated synthetic app uses an in-memory demo repository so Settings can be exercised without granting anonymous production writes; authenticated deployments use a Supabase repository with tenant-scoped RLS. Practice identity is exposed through a React context so edits immediately update the application shell without duplicating practice-name state.

**Tech Stack:** React 19, TypeScript 5.9, Wouter, Supabase Postgres/Auth/Storage/Edge Functions, existing Therassistant CSS, Node `tsx --test`, Playwright Chromium.

**Spec:** `docs/superpowers/specs/2026-09-16-settings-system-design.md`

## Global Constraints

- Canonical Settings root is `/settings`; `/administration` redirects to `/settings`.
- Keep exactly the approved groups: Practice, Clinical, Billing, Administration, My Account.
- Keep exactly the approved pages: Practice Information & Locations, Practice Logo, Patient Records, Client Portal, Service Codes, Diagnosis Codes, Interventions, Practice Billing, Patient Billing, Payment Processing, Staff, Activity Log, Change Your Password.
- `/administration/database-inventory` remains an internal technical page and is not a normal Settings menu item.
- `/administration/imports` remains Operations-owned.
- Settings configuration never creates a second RCM workflow.
- Existing historical clinical/billing records are never deleted when a configurable catalog item is disabled.
- Payment processor secrets, service-role keys, private API keys, and staff-invitation privileges never enter browser-readable tenant settings or source code.
- All newly exposed public tables have RLS enabled.
- Production Settings mutations are admin-only; Change Your Password is available to the signed-in user.
- Authorization uses tenant role data / trusted app metadata, never user-editable `user_metadata`.
- The current anonymous synthetic demo must remain usable without adding anonymous write access to production Settings tables.
- Every Settings mutation writes an audit record in authenticated production mode.
- Use `pnpm` only.
- Create migration files with `supabase migration new <name>`; do not invent migration filenames.

---

## File Structure

### Navigation and routing
- Modify: `artifacts/therassistant-inventory/src/navigation/sections.ts`
- Modify: `artifacts/therassistant-inventory/src/components/app-shell.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Delete after redirect replacement: `artifacts/therassistant-inventory/src/pages/administration.tsx`

### Settings domain core
- Create: `artifacts/therassistant-inventory/src/domains/settings/model.ts`
- Create: `artifacts/therassistant-inventory/src/domains/settings/settings-groups.ts`
- Create: `artifacts/therassistant-inventory/src/domains/settings/settings-validation.ts`
- Create: `artifacts/therassistant-inventory/src/domains/settings/settings-repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/settings/demo-settings-repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/settings/supabase-settings-repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/settings/SettingsContext.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/PracticeIdentityContext.tsx`

### Settings pages
- Create: `artifacts/therassistant-inventory/src/domains/settings/SettingsOverviewPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/PracticeSettingsPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/PracticeLogoPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/PatientRecordsSettingsPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/ClientPortalSettingsPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/ServiceCodesPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/DiagnosisCodesPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/InterventionsPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/PracticeBillingSettingsPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/PatientBillingSettingsPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/PaymentProcessingSettingsPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/StaffSettingsPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/ActivityLogPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/PasswordSettingsPage.tsx`

### Supabase
- Create via CLI: `supabase migration new settings_configuration`
- Create via CLI: `supabase migration new settings_security_policies`
- Create via CLI: `supabase migration new practice_assets_storage`
- Create: `supabase/functions/invite-staff/index.ts`
- Create: `supabase/functions/invite-staff/deno.json`

### Tests
- Create: `artifacts/therassistant-inventory/tests/settings-navigation.test.ts`
- Create: `artifacts/therassistant-inventory/tests/settings-model.test.ts`
- Create: `artifacts/therassistant-inventory/tests/settings-repository.test.ts`
- Create: `artifacts/therassistant-inventory/tests/settings-security-source.test.ts`
- Create: `e2e/settings.spec.ts`
- Modify: `.github/workflows/phase5-ci.yml`

---

### Task 1: Lock the approved Settings navigation and route model

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/settings/settings-groups.ts`
- Modify: `artifacts/therassistant-inventory/src/navigation/sections.ts`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/SettingsOverviewPage.tsx`
- Create: `artifacts/therassistant-inventory/tests/settings-navigation.test.ts`

**Interfaces:**
- Produces `SETTINGS_GROUPS: readonly SettingsGroup[]`.
- `SettingsGroup = { id: string; label: string; items: readonly SettingsItem[] }`.
- `SettingsItem = { id: string; label: string; href: string; description: string }`.
- Navigation consumers use the same item IDs/hrefs as the overview page.

- [ ] **Step 1: Write the failing navigation test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { SETTINGS_GROUPS } from "../src/domains/settings/settings-groups";

const expected = [
  ["Practice", ["Practice Information & Locations", "Practice Logo", "Patient Records", "Client Portal"]],
  ["Clinical", ["Service Codes", "Diagnosis Codes", "Interventions"]],
  ["Billing", ["Practice Billing", "Patient Billing", "Payment Processing"]],
  ["Administration", ["Staff", "Activity Log"]],
  ["My Account", ["Change Your Password"]],
] as const;

test("settings groups exactly match the approved information architecture", () => {
  assert.deepEqual(
    SETTINGS_GROUPS.map((group) => [group.label, group.items.map((item) => item.label)]),
    expected,
  );
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:
```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/settings-navigation.test.ts
```
Expected: FAIL because `settings-groups.ts` does not exist.

- [ ] **Step 3: Implement `SETTINGS_GROUPS` and replace Settings sidebar children**

Use these exact routes:
```ts
/settings/practice
/settings/logo
/settings/patient-records
/settings/client-portal
/settings/service-codes
/settings/diagnosis-codes
/settings/interventions
/settings/practice-billing
/settings/patient-billing
/settings/payment-processing
/settings/staff
/settings/activity-log
/settings/password
```

Extend `NavigationItem` with optional `group?: string`. Give Settings children the exact group labels above. Set Settings `primaryHref` to `/settings`. Remove normal-sidebar links to `Administration` and `Database Inventory`.

- [ ] **Step 4: Add route shells and compatibility redirect**

Add `/settings` and all 13 child routes to `App.tsx`. At this task, child routes may temporarily render a shared `SettingsPlaceholderPage` local to the module, but every route must have its final H1 text. Replace `/administration` with `<Redirect to="/settings" />`. Preserve `/administration/imports` and `/administration/database-inventory` before the `/administration` redirect so Wouter resolves the specific routes first.

- [ ] **Step 5: Make the overview render from `SETTINGS_GROUPS`**

No duplicated list of Settings items is allowed in the overview page.

- [ ] **Step 6: Run targeted test + typecheck**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/settings-navigation.test.ts
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/settings/settings-groups.ts \
  artifacts/therassistant-inventory/src/domains/settings/SettingsOverviewPage.tsx \
  artifacts/therassistant-inventory/src/navigation/sections.ts \
  artifacts/therassistant-inventory/src/App.tsx \
  artifacts/therassistant-inventory/tests/settings-navigation.test.ts
git commit -m "feat: add canonical settings navigation"
```

---

### Task 2: Add Settings domain types, validation, and safe JSON merge semantics

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/settings/model.ts`
- Create: `artifacts/therassistant-inventory/src/domains/settings/settings-validation.ts`
- Create: `artifacts/therassistant-inventory/tests/settings-model.test.ts`

**Interfaces:**
- Produces `TenantSettings`, `PracticeLocation`, `ServiceCode`, `DiagnosisCode`, `Intervention`, `StaffMember`, `ActivityRow`.
- Produces `mergeTenantSettings(current, patch): TenantSettings`.
- Produces `validateServiceCode`, `validateDiagnosisCode`, `validateIntervention`, `validateLocation`.

- [ ] **Step 1: Write RED tests for namespaced merge and validation**

```ts
test("tenant settings patch preserves unrelated namespaces", () => {
  const current = { demo: true, client_portal: { enabled: true }, unrelated: { keep: 1 } };
  const next = mergeTenantSettings(current, { client_portal: { balance_limit_cents: 5000 } });
  assert.deepEqual(next.unrelated, { keep: 1 });
  assert.equal(next.client_portal.enabled, true);
  assert.equal(next.client_portal.balance_limit_cents, 5000);
});

test("service code rejects blank code and negative fee", () => {
  assert.throws(() => validateServiceCode({ code: " ", description: "Therapy", default_fee_cents: -1 }));
});
```

- [ ] **Step 2: Run and confirm RED**

Use the same `tsx --test` pattern.

- [ ] **Step 3: Implement immutable deep merge only for known Settings namespaces**

Allowed namespaces are exactly: `practice`, `patient_records`, `client_portal`, `practice_billing`, `patient_billing`, `branding`. Preserve any unknown top-level keys already present, but reject patches containing unknown top-level Settings namespaces.

- [ ] **Step 4: Implement catalog/location validation**

Rules:
- trim codes/names/descriptions;
- fees/limits cannot be negative;
- units must be greater than zero;
- duration, when present, must be positive;
- location name cannot be blank;
- postal/state strings remain text and are not over-normalized.

- [ ] **Step 5: Run targeted tests and commit**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/settings-model.test.ts
git add artifacts/therassistant-inventory/src/domains/settings/model.ts \
  artifacts/therassistant-inventory/src/domains/settings/settings-validation.ts \
  artifacts/therassistant-inventory/tests/settings-model.test.ts
git commit -m "feat: define settings domain model"
```

---

### Task 3: Create secure Settings schema and RLS foundations

**Files:**
- Create via CLI: `supabase migration new settings_configuration`
- Create via CLI: `supabase migration new settings_security_policies`

**Interfaces:**
- Produces tables `practice_locations`, `service_code_catalog`, `diagnosis_code_catalog`, `intervention_catalog`.
- Produces private helper `private.is_tenant_admin(uuid) returns boolean`.
- Existing authenticated tenant members can SELECT active tenant catalogs; only tenant admins can mutate them.

- [ ] **Step 1: Verify current Supabase CLI and current docs before DDL**

Run:
```bash
supabase --version
supabase migration new settings_configuration
supabase migration new settings_security_policies
```
Capture the two generated paths as `SETTINGS_SCHEMA_MIGRATION` and `SETTINGS_POLICY_MIGRATION` and use those exact files for all later steps in this task.

- [ ] **Step 2: Add normalized tables to `SETTINGS_SCHEMA_MIGRATION`**

Implement the exact columns and unique constraints from the approved spec. Add:
```sql
create unique index practice_locations_one_primary_per_tenant
  on public.practice_locations (tenant_id)
  where is_primary = true and status = 'active';
```
Add `updated_at` handling using the repository's existing timestamp convention; do not introduce a second global trigger framework.

- [ ] **Step 3: Add a non-exposed admin helper to `SETTINGS_POLICY_MIGRATION`**

Use a private-schema `SECURITY DEFINER` helper with `search_path = ''`, explicit `auth.uid()` check, fully qualified table names, and only these admin roles:
- `platform_admin`
- `practice_admin`
- `billing_company_admin`

Revoke execute from `PUBLIC`; grant only what is needed for authenticated policy evaluation. Do not add a new privileged helper in `public`.

- [ ] **Step 4: Add RLS policies**

For each new catalog/location table:
- enable RLS;
- authenticated active tenant members may SELECT rows for their tenant;
- `private.is_tenant_admin(tenant_id)` gates INSERT/UPDATE;
- no browser DELETE path is granted.

Tighten existing Settings-sensitive access:
- `tenants` UPDATE must be creator/admin, not every active tenant member;
- `audit_logs` SELECT becomes tenant-admin only;
- `phi_access_logs` SELECT becomes tenant-admin only;
- tenant admins may SELECT same-tenant `tenant_users`, `tenant_user_roles`, and the related `user_profiles` needed for Staff;
- tenant admins may update staff membership status and role rows within the same tenant.

Do not remove each user's existing ability to read/update their own profile/membership where already allowed.

- [ ] **Step 5: Apply to the development/test database using the project migration workflow**

Do not hand-edit production migration history. Apply using the repository's Supabase workflow, then verify with SQL:
```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('practice_locations','service_code_catalog','diagnosis_code_catalog','intervention_catalog');
```
Expected: all four `rowsecurity = true`.

- [ ] **Step 6: Run Supabase advisors**

Run security and performance advisors. Fix any issue introduced by these migrations before proceeding.

- [ ] **Step 7: Commit**

Commit the two CLI-generated migration files together:
```bash
git add "$SETTINGS_SCHEMA_MIGRATION" "$SETTINGS_POLICY_MIGRATION"
git commit -m "feat: add secure settings schema"
```

---

### Task 4: Introduce one Settings repository interface with secure demo/production adapters

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/settings/settings-repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/settings/demo-settings-repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/settings/supabase-settings-repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/settings/SettingsContext.tsx`
- Create: `artifacts/therassistant-inventory/tests/settings-repository.test.ts`
- Modify dependency manifest only if the authenticated adapter requires `@supabase/supabase-js`; pin the selected version and commit the lockfile.

**Interfaces:**

```ts
export interface SettingsRepository {
  getSnapshot(): Promise<SettingsSnapshot>;
  updatePractice(input: PracticeUpdate): Promise<PracticeIdentity>;
  saveNamespace<K extends SettingsNamespace>(namespace: K, value: TenantSettings[K]): Promise<TenantSettings>;
  listLocations(): Promise<PracticeLocation[]>;
  saveLocation(input: PracticeLocationInput): Promise<PracticeLocation>;
  deactivateLocation(id: string): Promise<void>;
  listServiceCodes(): Promise<ServiceCode[]>;
  saveServiceCode(input: ServiceCodeInput): Promise<ServiceCode>;
  listDiagnosisCodes(): Promise<DiagnosisCode[]>;
  saveDiagnosisCode(input: DiagnosisCodeInput): Promise<DiagnosisCode>;
  listInterventions(): Promise<Intervention[]>;
  saveIntervention(input: InterventionInput): Promise<Intervention>;
  listStaff(): Promise<StaffMember[]>;
  updateStaffRole(userId: string, role: SystemRole): Promise<void>;
  updateStaffStatus(userId: string, status: UserStatus): Promise<void>;
  listActivity(filters: ActivityFilters): Promise<ActivityRow[]>;
  uploadPracticeLogo(file: File): Promise<string>;
  changePassword(newPassword: string): Promise<void>;
  getPaymentProcessingStatus(): Promise<PaymentProcessingStatus>;
}
```

- [ ] **Step 1: Write RED contract tests against the demo adapter**

Test that demo updates are in-memory only, preserve settings namespaces, and return the newly saved practice name without calling network fetch.

- [ ] **Step 2: Implement `DemoSettingsRepository`**

Seed it from the current synthetic practice identity. It must support the complete Settings interface in-memory. Label its mode as `demo` in `SettingsSnapshot`. A browser reload resets it; no anonymous database writes are added.

- [ ] **Step 3: Implement authenticated Supabase adapter**

Use the publishable key only. Require an authenticated session before persisted Settings reads/writes. Do not fall back to anonymous mutation. Every production mutation calls a shared `writeAuditLog()` after the primary mutation succeeds.

- [ ] **Step 4: Implement `SettingsProvider`**

It owns one repository instance and exposes `snapshot`, `loading`, `error`, `reload`, and repository methods. Current synthetic demo selects the demo adapter; authenticated mode selects the Supabase adapter.

- [ ] **Step 5: Run repository tests, typecheck, commit**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/settings-repository.test.ts
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
git add artifacts/therassistant-inventory/src/domains/settings package.json pnpm-lock.yaml
git commit -m "feat: add settings repository adapters"
```

Only include `package.json` / `pnpm-lock.yaml` if changed.

---

### Task 5: Make practice identity dynamic and build Practice Information & Locations

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/settings/PracticeIdentityContext.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/PracticeSettingsPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/components/app-shell.tsx`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Extend: `artifacts/therassistant-inventory/tests/settings-repository.test.ts`

**Interfaces:**
- `usePracticeIdentity()` returns `{ practice, refreshPractice, setPractice }`.
- AppShell reads practice name from context, never the hard-coded `Front Range Behavioral Health` string.

- [ ] **Step 1: Add a failing source/model assertion that AppShell no longer owns a hard-coded practice name**
- [ ] **Step 2: Implement `PracticeIdentityProvider` around AppShell content**
- [ ] **Step 3: Build editable practice name, timezone, contact email/phone/website form**
- [ ] **Step 4: Build Locations table/editor with add, edit, primary, billing-location, and deactivate actions**
- [ ] **Step 5: After successful save, update PracticeIdentityContext immediately**
- [ ] **Step 6: Verify demo mode shows `Demo changes reset on reload` rather than pretending persistence**
- [ ] **Step 7: Run tests/typecheck and commit**

```bash
git commit -m "feat: add practice and location settings"
```

---

### Task 6: Implement Practice feature toggles and Client Portal settings

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/settings/PatientRecordsSettingsPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/ClientPortalSettingsPage.tsx`
- Modify user-facing feature entry points only where the approved toggles apply.
- Create/extend tests in `artifacts/therassistant-inventory/tests/settings-model.test.ts`.

**Interfaces:**
- `patient_records` and `client_portal` namespaces are saved through `saveNamespace`.

- [ ] **Step 1: Write RED tests for defaults and balance limit validation**
- [ ] **Step 2: Build Patient Records toggles**

Exact toggles:
- preferred name
- emergency contacts
- patient journal
- treatment plans
- document uploads

Disabling hides optional entry points; it does not delete records.

- [ ] **Step 3: Build Client Portal settings**

Exact controls:
- portal enabled
- balance limit in dollars, persisted as cents or null
- online payments
- journal
- documents
- appointments

- [ ] **Step 4: Wire journal/portal optional entry points to the saved config where those entry points already exist**
- [ ] **Step 5: Run tests/typecheck and commit**

```bash
git commit -m "feat: add patient and portal settings"
```

---

### Task 7: Implement Service Codes, Diagnosis Codes, and Interventions catalogs

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/settings/ServiceCodesPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/DiagnosisCodesPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/InterventionsPage.tsx`
- Modify existing service/diagnosis/intervention selection components to consume active catalog rows where applicable.
- Extend: `artifacts/therassistant-inventory/tests/settings-model.test.ts`

**Interfaces:**
- New records use repository save methods.
- “Delete” UI means `active = false`; reactivation is supported.

- [ ] **Step 1: Write RED tests for normalization, duplicate code/name behavior, and inactive filtering**
- [ ] **Step 2: Build Service Codes CRUD grid/editor**

Fields: code, description, default fee, units, duration, default POS, active, sort order.

- [ ] **Step 3: Build Diagnosis Codes CRUD grid/editor**

Fields: code, description, active, favorite, sort order.

- [ ] **Step 4: Build Interventions CRUD grid/editor**

Fields: name, category, active, sort order.

- [ ] **Step 5: Replace hard-coded new-record selectors with active catalog queries where the corresponding selector already exists**

Historical rows continue displaying their stored codes/text even if the catalog entry later becomes inactive.

- [ ] **Step 6: Run tests/typecheck and commit**

```bash
git commit -m "feat: add clinical settings catalogs"
```

---

### Task 8: Implement Practice Billing and Patient Billing configuration

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/settings/PracticeBillingSettingsPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/PatientBillingSettingsPage.tsx`
- Extend: `artifacts/therassistant-inventory/tests/settings-model.test.ts`

- [ ] **Step 1: Write RED tests for billing defaults and non-negative balance thresholds**
- [ ] **Step 2: Build Practice Billing controls**

Exact fields:
- default place of service
- default claim frequency code
- auto-create charge after signed note
- require billing readiness before charge
- statement-from name

Do not add claims, denials, fee schedules, payer contracts, or payment-posting controls here.

- [ ] **Step 3: Build Patient Billing controls**

Exact fields:
- statements enabled
- minimum statement balance
- statement due days
- show insurance-pending balance
- allow payment plans

- [ ] **Step 4: Run tests/typecheck and commit**

```bash
git commit -m "feat: add billing settings"
```

---

### Task 9: Implement Staff administration with server-side invitation

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/settings/StaffSettingsPage.tsx`
- Create: `supabase/functions/invite-staff/index.ts`
- Create: `supabase/functions/invite-staff/deno.json`
- Extend: `artifacts/therassistant-inventory/src/domains/settings/supabase-settings-repository.ts`
- Create/extend: `artifacts/therassistant-inventory/tests/settings-security-source.test.ts`

**Interfaces:**
- `inviteStaff({ email, firstName, lastName, role })` calls the authenticated Edge Function.
- Edge Function validates caller is an admin of the target tenant before calling Supabase Admin invite APIs.

- [ ] **Step 1: Before implementation, verify current Supabase Auth invite docs/changelog**

Confirm current server-side invitation method and return shape. Do not rely on memorized API signatures.

- [ ] **Step 2: Write RED source-security tests**

Tests must fail if browser source contains `SUPABASE_SERVICE_ROLE_KEY`, `sb_secret_`, or an Auth Admin invitation call.

- [ ] **Step 3: Implement authenticated `invite-staff` Edge Function**

Requirements:
- `verify_jwt = true` when deployed;
- determine caller from JWT, not request-supplied user ID;
- verify caller is `platform_admin`, `practice_admin`, or `billing_company_admin` for target tenant;
- normalize email;
- invite through server-side Auth Admin API;
- create/update `user_profiles`, `tenant_users`, and `tenant_user_roles` using server privileges;
- write `audit_logs` entry;
- return only non-sensitive user/membership fields.

- [ ] **Step 4: Build Staff page**

Columns: name, email, status, role, joined/invited date. Actions: Invite Staff, change role, activate/deactivate. Provider records are not merged into Staff.

- [ ] **Step 5: Deploy Edge Function to the development Supabase project and test with an authorized session**
- [ ] **Step 6: Run security tests/typecheck and commit**

```bash
git commit -m "feat: add secure staff administration"
```

---

### Task 10: Implement read-only Activity Log

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/settings/ActivityLogPage.tsx`
- Create/extend: `artifacts/therassistant-inventory/tests/settings-repository.test.ts`

**Interfaces:**
- `normalizeAuditActivity(auditRow): ActivityRow`
- `normalizePhiActivity(phiRow): ActivityRow`
- `listActivity(filters)` merges and sorts descending by timestamp.

- [ ] **Step 1: Write RED normalization test**

Given one `audit_logs` row and one `phi_access_logs` row, output must use the same `ActivityRow` shape and deterministic descending order.

- [ ] **Step 2: Implement normalization and filtering**

Filters: date range, user, action, target type, free text.

- [ ] **Step 3: Build Activity Log page with no mutation controls**

The page must not render Edit/Delete/Undo actions.

- [ ] **Step 4: Run tests/typecheck and commit**

```bash
git commit -m "feat: add settings activity log"
```

---

### Task 11: Implement Practice Logo storage safely

**Files:**
- Create via CLI: `supabase migration new practice_assets_storage`
- Create: `artifacts/therassistant-inventory/src/domains/settings/PracticeLogoPage.tsx`
- Extend: `artifacts/therassistant-inventory/src/domains/settings/supabase-settings-repository.ts`
- Extend: `artifacts/therassistant-inventory/tests/settings-security-source.test.ts`

- [ ] **Step 1: Verify current Supabase Storage docs/changelog**
- [ ] **Step 2: Create migration through CLI and capture the generated path as `PRACTICE_ASSETS_MIGRATION`**
- [ ] **Step 3: Create private `practice-assets` bucket and object policies**

Object path format:
```text
<tenant_id>/logo/<generated-file-name>
```

Authenticated active tenant members may read their tenant logo; tenant admins may insert/update/delete only inside their tenant prefix. Do not make the whole bucket public merely to simplify rendering.

- [ ] **Step 4: Build upload page**

Allow PNG/JPEG/WebP. Enforce a reasonable image-size ceiling before upload. On successful upload, save only the storage object path to `tenants.settings.branding.logo_path`.

- [ ] **Step 5: Run advisors + security tests + typecheck**
- [ ] **Step 6: Commit**

```bash
git add "$PRACTICE_ASSETS_MIGRATION" artifacts/therassistant-inventory/src/domains/settings
git commit -m "feat: add practice logo settings"
```

---

### Task 12: Implement Change Your Password and Payment Processing boundary

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/settings/PasswordSettingsPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/settings/PaymentProcessingSettingsPage.tsx`
- Extend: `artifacts/therassistant-inventory/tests/settings-security-source.test.ts`

- [ ] **Step 1: Write RED password-validation tests**

Require matching non-empty passwords and do not log or persist password fields.

- [ ] **Step 2: Implement authenticated password update**

Use Supabase Auth's current supported user-password update method. In demo mode, render the page but explain that password changes require a signed-in account; do not simulate a successful password change.

- [ ] **Step 3: Implement Payment Processing status page**

States:
- `Not connected`
- `Connected`
- `Action required`

The browser may show provider/status/account display metadata only. It must never provide a textbox for secret/API-key entry.

- [ ] **Step 4: Extend secret-source scan**

The existing CI scan plus unit test must reject service-role/secret-key markers in `artifacts/therassistant-inventory/src`.

- [ ] **Step 5: Run tests/typecheck and commit**

```bash
git commit -m "feat: add account and payment processing settings"
```

---

### Task 13: Finish Settings navigation grouping and remove the old Administration surface

**Files:**
- Modify: `artifacts/therassistant-inventory/src/components/app-shell.tsx`
- Modify: `artifacts/therassistant-inventory/src/navigation/sections.ts`
- Delete: `artifacts/therassistant-inventory/src/pages/administration.tsx`
- Update: `artifacts/therassistant-inventory/tests/settings-navigation.test.ts`

- [ ] **Step 1: Write RED test for grouped Settings rendering model**
- [ ] **Step 2: Render group labels only under the expanded Settings section**

Do not change grouping behavior for other navigation sections.

- [ ] **Step 3: Delete obsolete Administration page**

`/administration` must be redirect-only; Database Inventory remains reachable directly but is not advertised as normal Settings.

- [ ] **Step 4: Run navigation tests/typecheck and commit**

```bash
git commit -m "refactor: retire administration settings placeholder"
```

---

### Task 14: Add full browser coverage and CI gates

**Files:**
- Create: `e2e/settings.spec.ts`
- Modify: `.github/workflows/phase5-ci.yml`

- [ ] **Step 1: Write Playwright route/navigation tests**

Test:
- Settings sidebar expands into five labeled groups;
- `/settings` renders Settings overview;
- all 13 routes render their exact H1;
- `/administration` redirects to `/settings`;
- Database Inventory is not a normal Settings link;
- Practice name edit updates AppShell immediately in demo mode and shows demo-reset notice;
- Activity Log contains no edit/delete controls;
- password inputs use `type=password`;
- Payment Processing contains no secret-key input.

- [ ] **Step 2: Run Playwright and fix only product/test issues revealed by the new tests**

```bash
pnpm exec playwright install chromium
pnpm test:e2e -- e2e/settings.spec.ts
```

- [ ] **Step 3: Add Settings routes to Phase 5 smoke array**

At minimum:
```text
/settings
/settings/practice
/settings/activity-log
/settings/password
```

- [ ] **Step 4: Run the full local verification gate**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/**/*.test.ts
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
pnpm --filter @workspace/therassistant-inventory run build
pnpm test:e2e
```

Expected: zero failures.

- [ ] **Step 5: Run Supabase security/performance advisors again**

No newly introduced Settings finding may remain unresolved.

- [ ] **Step 6: Commit**

```bash
git add e2e/settings.spec.ts .github/workflows/phase5-ci.yml
git commit -m "test: verify settings system end to end"
```

---

### Task 15: Final review, PR, and exact-head verification

**Files:**
- No product files unless review identifies a defect.

- [ ] **Step 1: Run the complete test/type/build/E2E gate again on the exact intended head**
- [ ] **Step 2: Review the full diff for duplicate configuration surfaces, browser secrets, anonymous Settings writes, and accidental RCM changes**
- [ ] **Step 3: Open a PR from `feature/settings-system` to `main`**

PR summary must call out:
- 13 approved Settings pages;
- normalized configuration tables;
- demo vs authenticated repository split;
- admin-only production security;
- staff invitation Edge Function;
- private logo storage;
- no payment secrets in browser/client-readable settings.

- [ ] **Step 4: Wait for all required GitHub workflows to complete on the exact PR head**
- [ ] **Step 5: Do not merge until the exact head is green and final review has no unresolved blocker**

---

## Plan Self-Review

### Spec coverage
- All 13 approved Settings pages have an implementation task.
- All five approved navigation groups are represented once and reused by navigation + overview.
- Practice identity, locations, optional patient features, portal balance rules, clinical catalogs, billing settings, Staff, Activity Log, logo, password, and payment-processing boundary are covered.
- Existing Database Inventory and Imports ownership is preserved.
- Demo behavior is explicitly separated from authenticated persistence so no anonymous Settings write policy is required.
- Supabase RLS, Auth, Storage, staff invitation, audit logging, and advisor checks are included.

### Security consistency
- New privileged helper is private, not public.
- Browser code never receives service-role or payment-processor secrets.
- Staff invitation is server-side.
- Activity logs are admin-only and read-only in UI.
- Password is handled only by Supabase Auth.
- Catalog deactivation preserves historical records.

### Verification consistency
- Unit tests use the repository's existing `tsx --test` command.
- Production TypeScript uses `typecheck:phase3`.
- Build uses the artifact package build command.
- Browser acceptance uses the existing Playwright harness.
- CI remains Phase 5-compatible.

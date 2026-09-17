# Patient Registration and Nonblocking Clinical Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish production patient creation with demographics, emergency contact, primary/secondary insurance, atomic Supabase persistence, administrative workqueue routing, and a system-wide guarantee that administrative problems never block clinical care.

**Architecture:** Keep the existing Patients workspace and WorkDrawer, but move new-patient creation behind a focused registration domain and one tenant-aware Supabase RPC. Separate administrative readiness from clinical permission: schedule, check-in, encounter, treatment-plan, note, signature, and visit-completion actions remain available; insurance/eligibility/authorization/credentialing issues become warnings, work items, or downstream billing/claim holds.

**Tech Stack:** React 19, TypeScript 5.9, Vite, Wouter, Supabase Postgres/PostgREST/Auth, Node test runner via `tsx --test`, Playwright, pnpm 10.28.

**Spec:** `docs/superpowers/specs/2026-09-17-patient-registration-clinical-nonblocking-design.md`

## Global Constraints

- Administrative or revenue-cycle problems may create warnings, work items, billing holds, or claim holds, but they must never prevent scheduling, starting an encounter, documenting care, completing a treatment plan, signing a clinical note, or completing a visit.
- Clinical care and administrative readiness are separate tracks.
- Use the existing Patients workspace and right-side `WorkDrawer`; do not create a separate registration application.
- New patient state begins as `client_status = 'intake'`, `registration_status = 'in_progress'`, and a revenue-cycle-specific `billing_readiness_status`.
- Registration-required demographics are first name, last name, DOB, sex, address line 1, city, state, postal code, phone, and email. To honor the nonblocking-care rule, only first and last name are hard creation minimums; missing registration-required fields create `registration_issue` work and keep registration incomplete instead of preventing the patient record from being created.
- Initial UI presents patient/subscriber sex as M/F; the database accepts `M`, `F`, or `U` for interoperability and future imports.
- Do not store patient sex or structured subscriber demographics only in JSON metadata.
- A complete primary/secondary policy requires at minimum payer ID and member ID before a `client_insurance_policies` row is inserted; incomplete insurance remains in the registration payload only long enough to create an administrative work item and must not create a malformed policy row.
- `subscriber_name` remains populated for backward compatibility while new structured subscriber fields become canonical.
- Payer plan `name` is the plan; payer plan `plan_type` is the current product/type field. Do not add another duplicate insurance-product column.
- All new writes are tenant-scoped and authenticated. The registration RPC must validate `private.has_tenant_write_access(p_tenant_id)`.
- No browser code may contain Supabase service-role or secret keys.
- Follow TDD: failing test, confirm RED, minimal implementation, confirm GREEN, then commit.

---

### Task 1: Convert pre-session readiness from clinical blocking to administrative/billing attention

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/readiness/types.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/readiness/evaluate-pre-session.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/scheduling/PatientReviewDrawer.tsx`
- Modify: `artifacts/therassistant-inventory/tests/readiness.test.ts`
- Modify: `artifacts/therassistant-inventory/tests/pre-session-treatment-plan.test.ts`
- Modify: `artifacts/therassistant-inventory/tests/schedule-patient-review.test.ts`
- Create: `artifacts/therassistant-inventory/tests/clinical-nonblocking.test.ts`

**Interfaces:**
- Consumes: existing `PreSessionInput` from `src/domains/readiness/types.ts`.
- Produces:
  ```ts
  export type ReadinessCheck = {
    code: string;
    label: string;
    status: "pass" | "warn" | "fail";
    billingBlocking: boolean;
    message: string;
    action?: string;
  };

  export type PreSessionReadiness = {
    administrativelyReady: boolean;
    checks: ReadinessCheck[];
  };
  ```
- `administrativelyReady` is presentation/RCM state only. No clinical function may use it as a permission gate.

- [ ] **Step 1: Rewrite readiness tests to state the new rule and make them fail against current code**

Replace assertions such as “inactive coverage blocks the appointment” with administrative-hold assertions:

```ts
test("inactive coverage requires billing follow-up but does not represent a clinical stop", () => {
  const result = evaluatePreSession({
    ...readyBase,
    eligibility: { eligibility_status: "inactive" },
  });

  assert.equal(result.administrativelyReady, false);
  assert.ok(
    result.checks.some(
      (check) => check.code === "eligibility_inactive" && check.billingBlocking,
    ),
  );
});

test("missing insurance is administrative attention, not permission to start care", () => {
  const result = evaluatePreSession({ ...readyBase, policy: null });
  assert.equal(result.administrativelyReady, false);
  assert.ok(result.checks.some((check) => check.code === "insurance_missing"));
});
```

Create `clinical-nonblocking.test.ts` as a source-contract regression test:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const review = readFileSync(
  new URL("../src/domains/scheduling/PatientReviewDrawer.tsx", import.meta.url),
  "utf8",
);
const schedule = readFileSync(
  new URL("../src/domains/scheduling/SchedulePage.tsx", import.meta.url),
  "utf8",
);

test("administrative readiness never disables Start Note", () => {
  assert.match(review, /disabled=\{starting\}/);
  assert.doesNotMatch(review, /disabled=\{[^}]*readiness/);
  assert.doesNotMatch(review, /must be resolved before starting care/i);
});

test("appointment creation is not gated by administrative readiness", () => {
  assert.match(schedule, /disabled=\{saving \|\| !form\.clientId \|\| !form\.providerId \|\| !form\.date \|\| !form\.time\}/);
  assert.doesNotMatch(schedule, /billing_readiness_status|registration_status.*disabled|readiness.*disabled/);
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
pnpm --filter ./scripts exec tsx --test \
  ../artifacts/therassistant-inventory/tests/readiness.test.ts \
  ../artifacts/therassistant-inventory/tests/pre-session-treatment-plan.test.ts \
  ../artifacts/therassistant-inventory/tests/schedule-patient-review.test.ts \
  ../artifacts/therassistant-inventory/tests/clinical-nonblocking.test.ts
```

Expected: failures because `administrativelyReady` / `billingBlocking` do not exist and the current drawer says administrative items “must be resolved before starting care.”

- [ ] **Step 3: Replace ambiguous blocking semantics in the readiness model**

Update `types.ts` to remove `blocking` and `ready` from the exported readiness contract and introduce `billingBlocking` / `administrativelyReady` exactly as defined above.

Update the readiness helper signature:

```ts
function check(
  code: string,
  label: string,
  status: ReadinessCheck["status"],
  billingBlocking: boolean,
  message: string,
  action?: string,
): ReadinessCheck {
  return { code, label, status, billingBlocking, message, action };
}
```

Return:

```ts
return {
  administrativelyReady: !checks.some((item) => item.billingBlocking),
  checks,
};
```

Keep insurance, eligibility, authorization, and provider-participation failures as `billingBlocking: true`; treatment-plan clinical reminders remain `billingBlocking: false`.

- [ ] **Step 4: Rewrite administrative copy so it never instructs staff to delay care**

Use downstream wording in `evaluate-pre-session.ts`, for example:

```ts
check(
  "eligibility_pending",
  "Eligibility",
  "warn",
  true,
  "Eligibility has not been confirmed for this service.",
  "Run eligibility and resolve coverage before claim submission.",
);
```

For missing authorization use “Resolve authorization for billing follow-up.” For provider enrollment use “Resolve payer participation before billing this service.” Do not use “before starting encounter,” “before appointment,” or equivalent clinical-stop wording.

- [ ] **Step 5: Change PatientReviewDrawer to show administrative attention while keeping Start Note enabled**

Use:

```ts
const billingHolds = appointment.readiness.checks.filter(
  (check) => check.billingBlocking,
);
```

Render the visit section as administrative information:

```tsx
<ReviewSection icon={<CheckCircle2 size={15} />} title="Administrative Readiness">
  <div className={`patient-review-highlight ${appointment.readiness.administrativelyReady ? "positive" : "warning"}`}>
    <CheckCircle2 size={18} />
    <div>
      <strong>
        {appointment.readiness.administrativelyReady
          ? "Administrative checks complete"
          : "Administrative follow-up needed"}
      </strong>
      <p>
        {appointment.readiness.administrativelyReady
          ? "No current billing-readiness issues are identified."
          : `${billingHolds.length} billing item${billingHolds.length === 1 ? "" : "s"} need follow-up. Care can continue.`}
      </p>
    </div>
  </div>
</ReviewSection>
```

Keep the clinical action exactly independent:

```tsx
<button
  type="button"
  className="patient-review-primary"
  disabled={starting}
  onClick={() => void startNote()}
>
  <FileText size={16} /> {starting ? "Starting..." : "Start Note"}
</button>
```

Session Focus remains clinically focused; do not label it `RESOLVE` because of administrative status.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --filter ./scripts exec tsx --test \
  ../artifacts/therassistant-inventory/tests/readiness.test.ts \
  ../artifacts/therassistant-inventory/tests/pre-session-treatment-plan.test.ts \
  ../artifacts/therassistant-inventory/tests/schedule-patient-review.test.ts \
  ../artifacts/therassistant-inventory/tests/clinical-nonblocking.test.ts
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
```

Expected: PASS. Typecheck also identifies any missed consumers of the old `ready` / `blocking` names; update those consumers without reintroducing clinical gating.

- [ ] **Step 7: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/readiness \
  artifacts/therassistant-inventory/src/domains/scheduling/PatientReviewDrawer.tsx \
  artifacts/therassistant-inventory/tests/readiness.test.ts \
  artifacts/therassistant-inventory/tests/pre-session-treatment-plan.test.ts \
  artifacts/therassistant-inventory/tests/schedule-patient-review.test.ts \
  artifacts/therassistant-inventory/tests/clinical-nonblocking.test.ts
git commit -m "fix: keep clinical care independent of admin readiness"
```

---

### Task 2: Add structured patient/subscriber fields and one atomic registration RPC

**Files:**
- Create: `supabase/migrations/20260917160000_patient_registration_nonblocking_clinical.sql`
- Create: `artifacts/therassistant-inventory/tests/patient-registration-migration.test.ts`

**Interfaces:**
- Consumes: `private.has_tenant_write_access(uuid)`, `clients`, `client_contacts`, `client_insurance_policies`, `workqueue_items`.
- Produces:
  ```sql
  public.create_patient_registration(
    p_tenant_id uuid,
    p_patient jsonb,
    p_emergency_contact jsonb default null,
    p_primary_insurance jsonb default null,
    p_secondary_insurance jsonb default null
  ) returns jsonb
  ```
- Result shape:
  ```json
  {
    "patient_id": "uuid",
    "registration_status": "in_progress|pending_review",
    "billing_readiness_status": "not_ready|missing_insurance",
    "work_item_ids": ["uuid"]
  }
  ```

- [ ] **Step 1: Write a migration contract test before creating the migration**

Create a test that expects the migration path and key SQL contracts:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260917160000_patient_registration_nonblocking_clinical.sql", import.meta.url),
  "utf8",
);

test("patient registration migration creates structured fields and atomic RPC", () => {
  for (const fragment of [
    "add column if not exists sex",
    "subscriber_first_name",
    "subscriber_last_name",
    "subscriber_sex",
    "subscriber_address_line1",
    "subscriber_phone",
    "registration_issue",
    "create or replace function public.create_patient_registration",
    "private.has_tenant_write_access",
  ]) {
    assert.match(migration.toLowerCase(), new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
```

- [ ] **Step 2: Run the migration contract test and confirm RED**

Run:

```bash
pnpm --filter ./scripts exec tsx --test \
  ../artifacts/therassistant-inventory/tests/patient-registration-migration.test.ts
```

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Add structured columns and the registration workqueue enum**

Migration DDL must include:

```sql
alter table public.clients
  add column if not exists sex text;

alter table public.clients
  drop constraint if exists clients_sex_check;
alter table public.clients
  add constraint clients_sex_check
  check (sex is null or sex in ('M','F','U'));

alter table public.client_insurance_policies
  add column if not exists subscriber_first_name text,
  add column if not exists subscriber_last_name text,
  add column if not exists subscriber_sex text,
  add column if not exists subscriber_address_line1 text,
  add column if not exists subscriber_address_line2 text,
  add column if not exists subscriber_city text,
  add column if not exists subscriber_state text,
  add column if not exists subscriber_postal_code text,
  add column if not exists subscriber_phone text;

alter table public.client_insurance_policies
  drop constraint if exists client_insurance_policies_subscriber_sex_check;
alter table public.client_insurance_policies
  add constraint client_insurance_policies_subscriber_sex_check
  check (subscriber_sex is null or subscriber_sex in ('M','F','U'));

alter type public.workqueue_type_enum add value if not exists 'registration_issue';
```

- [ ] **Step 4: Implement the atomic RPC with explicit tenant authorization and no partial writes**

Use a normal PL/pgSQL function call transaction boundary; any raised exception rolls the statement back. The function must begin by enforcing tenant access:

```sql
if not private.has_tenant_write_access(p_tenant_id) then
  raise exception 'Tenant write access required';
end if;

if nullif(btrim(p_patient->>'first_name'), '') is null
   or nullif(btrim(p_patient->>'last_name'), '') is null then
  raise exception 'Patient first and last name are required';
end if;
```

Insert the patient with clinical-creation defaults:

```sql
insert into public.clients (
  tenant_id, first_name, middle_name, last_name, preferred_name,
  date_of_birth, sex, email, phone,
  address_line1, address_line2, city, state, postal_code,
  client_status, registration_status, billing_readiness_status
)
values (
  p_tenant_id,
  btrim(p_patient->>'first_name'),
  nullif(btrim(p_patient->>'middle_name'), ''),
  btrim(p_patient->>'last_name'),
  nullif(btrim(p_patient->>'preferred_name'), ''),
  nullif(p_patient->>'date_of_birth', '')::date,
  nullif(p_patient->>'sex', ''),
  nullif(btrim(p_patient->>'email'), ''),
  nullif(btrim(p_patient->>'phone'), ''),
  nullif(btrim(p_patient->>'address_line1'), ''),
  nullif(btrim(p_patient->>'address_line2'), ''),
  nullif(btrim(p_patient->>'city'), ''),
  nullif(btrim(p_patient->>'state'), ''),
  nullif(btrim(p_patient->>'postal_code'), ''),
  'intake', 'in_progress', 'not_ready'
)
returning id into v_patient_id;
```

Insert emergency contact only when a contact name is present.

For each insurance JSON object, insert a policy only when `payer_id` and `member_id` are both present. Populate `subscriber_name` as a compatibility value while also filling the structured subscriber columns:

```sql
concat_ws(' ',
  nullif(btrim(v_policy->>'subscriber_first_name'), ''),
  nullif(btrim(v_policy->>'subscriber_last_name'), '')
)
```

Use `payer_plan_id` for the plan. Do not duplicate `plan_type` onto the policy; it remains reference data on `payer_plans`.

- [ ] **Step 5: Calculate registration and billing state without creating a clinical permission state**

Treat these patient fields as registration-required:

```sql
v_registration_complete :=
  nullif(btrim(p_patient->>'date_of_birth'), '') is not null
  and nullif(btrim(p_patient->>'sex'), '') is not null
  and nullif(btrim(p_patient->>'address_line1'), '') is not null
  and nullif(btrim(p_patient->>'city'), '') is not null
  and nullif(btrim(p_patient->>'state'), '') is not null
  and nullif(btrim(p_patient->>'postal_code'), '') is not null
  and nullif(btrim(p_patient->>'phone'), '') is not null
  and nullif(btrim(p_patient->>'email'), '') is not null;
```

A complete patient record plus a valid primary policy produces `registration_status='pending_review'`; otherwise leave it `in_progress`. Do not automatically set `complete`.

If no insertable primary policy exists, use `billing_readiness_status='missing_insurance'`. If a primary policy exists but has not been verified, use `not_ready`. Neither state affects clinical tables or actions.

- [ ] **Step 6: Create deduplicated registration work items for missing administrative data**

For missing demographics and incomplete/missing primary insurance, insert one or more `workqueue_items` using:

```sql
insert into public.workqueue_items (
  tenant_id,
  workqueue_type,
  source_object_type,
  source_object_id,
  title,
  description,
  created_by
)
values (
  p_tenant_id,
  'registration_issue',
  'client',
  v_patient_id,
  'Registration information incomplete',
  v_registration_issue_text,
  auth.uid()
)
returning id into v_work_item_id;
```

Do not create eligibility, authorization, credentialing, or claim work during patient creation; those workflows own their own workqueue types later.

- [ ] **Step 7: Restrict RPC execution and return the result**

Use:

```sql
revoke all on function public.create_patient_registration(uuid,jsonb,jsonb,jsonb,jsonb) from public;
grant execute on function public.create_patient_registration(uuid,jsonb,jsonb,jsonb,jsonb) to authenticated;
```

Return:

```sql
return jsonb_build_object(
  'patient_id', v_patient_id,
  'registration_status', v_registration_status,
  'billing_readiness_status', v_billing_status,
  'work_item_ids', to_jsonb(v_work_item_ids)
);
```

- [ ] **Step 8: Run the migration contract test and apply the migration to Supabase**

Run the test first:

```bash
pnpm --filter ./scripts exec tsx --test \
  ../artifacts/therassistant-inventory/tests/patient-registration-migration.test.ts
```

Expected: PASS.

Then apply the same SQL through the connected Supabase migration action using migration name:

```text
patient_registration_nonblocking_clinical
```

Do not use raw `execute_sql` for DDL.

- [ ] **Step 9: Verify the live schema and security contract after migration**

Run read-only SQL equivalent to:

```sql
select table_name, column_name
from information_schema.columns
where table_schema='public'
  and (
    (table_name='clients' and column_name='sex')
    or (table_name='client_insurance_policies' and column_name like 'subscriber_%')
  )
order by table_name, column_name;

select e.enumlabel
from pg_type t
join pg_enum e on e.enumtypid=t.oid
where t.typname='workqueue_type_enum'
  and e.enumlabel='registration_issue';

select p.proname,
       pg_get_function_arguments(p.oid) as args,
       p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname='create_patient_registration';
```

Expected: structured fields exist; `registration_issue` exists; RPC exists. Run Supabase Security Advisor after migration and do not introduce new database security warnings.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20260917160000_patient_registration_nonblocking_clinical.sql \
  artifacts/therassistant-inventory/tests/patient-registration-migration.test.ts
git commit -m "feat: add atomic patient registration database workflow"
```

---

### Task 3: Add a focused TypeScript patient-registration domain and RPC client

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/patients/registration/types.ts`
- Create: `artifacts/therassistant-inventory/src/domains/patients/registration/model.ts`
- Create: `artifacts/therassistant-inventory/src/domains/patients/registration/repository.ts`
- Create: `artifacts/therassistant-inventory/tests/patient-registration.test.ts`

**Interfaces:**
- Consumes: `getCurrentTenantId`, `tenantRpc`, `referenceSelect` from `src/lib/tenant-data-client.ts`.
- Produces:
  ```ts
  export type PatientRegistrationForm = { ... };
  export type InsuranceRegistrationDraft = { ... };
  export type PatientRegistrationResult = {
    patient_id: string;
    registration_status: string;
    billing_readiness_status: string;
    work_item_ids: string[];
  };

  export function blankPatientRegistration(): PatientRegistrationForm;
  export function copyPatientToSubscriber(form: PatientRegistrationForm, order: "primary" | "secondary"): PatientRegistrationForm;
  export function buildPatientRegistrationRpcArgs(tenantId: string, form: PatientRegistrationForm): Record<string, unknown>;
  export async function getPatientRegistrationReferences(): Promise<{ payers: Row[]; plans: Row[] }>;
  export async function createPatientRegistration(form: PatientRegistrationForm): Promise<PatientRegistrationResult>;
  ```

- [ ] **Step 1: Write failing model tests**

Cover defaults and self-subscriber copy:

```ts
test("new patient registration starts intake/in progress and no insurance", () => {
  const form = blankPatientRegistration();
  assert.equal(form.patient.client_status, "intake");
  assert.equal(form.patient.registration_status, "in_progress");
  assert.equal(form.primaryInsurance.enabled, false);
  assert.equal(form.secondaryInsurance.enabled, false);
});

test("self subscriber copies patient demographics", () => {
  const form = blankPatientRegistration();
  form.patient.first_name = "Ada";
  form.patient.last_name = "Lovelace";
  form.patient.date_of_birth = "1985-01-02";
  form.patient.sex = "F";
  form.patient.address_line1 = "1 Main St";
  form.patient.city = "Denver";
  form.patient.state = "CO";
  form.patient.postal_code = "80202";
  form.patient.phone = "3035550100";
  form.primaryInsurance.enabled = true;
  form.primaryInsurance.relationship_to_subscriber = "self";

  const copied = copyPatientToSubscriber(form, "primary");
  assert.equal(copied.primaryInsurance.subscriber_first_name, "Ada");
  assert.equal(copied.primaryInsurance.subscriber_last_name, "Lovelace");
  assert.equal(copied.primaryInsurance.subscriber_sex, "F");
  assert.equal(copied.primaryInsurance.subscriber_city, "Denver");
});
```

Also test that the RPC payload converts empty strings to `null` where appropriate and omits disabled secondary insurance.

- [ ] **Step 2: Run focused test and confirm RED**

```bash
pnpm --filter ./scripts exec tsx --test \
  ../artifacts/therassistant-inventory/tests/patient-registration.test.ts
```

Expected: FAIL because the registration domain does not exist.

- [ ] **Step 3: Define focused registration types**

Use separate patient/contact/insurance structures so the UI does not become one untyped object. `InsuranceRegistrationDraft` includes:

```ts
export type InsuranceRegistrationDraft = {
  enabled: boolean;
  payer_id: string;
  payer_plan_id: string;
  member_id: string;
  group_number: string;
  relationship_to_subscriber: string;
  subscriber_first_name: string;
  subscriber_last_name: string;
  subscriber_dob: string;
  subscriber_sex: "" | "M" | "F";
  subscriber_address_line1: string;
  subscriber_address_line2: string;
  subscriber_city: string;
  subscriber_state: string;
  subscriber_postal_code: string;
  subscriber_phone: string;
};
```

Patient form sex is `"" | "M" | "F"` in the UI; imported `U` remains database-compatible but is not an initial manual-entry option.

- [ ] **Step 4: Implement pure model helpers**

`blankPatientRegistration()` must return `intake` + `in_progress`, blank contact, and disabled policies.

`copyPatientToSubscriber()` returns a new object, does not mutate the original, and copies only the selected policy.

`buildPatientRegistrationRpcArgs()` maps exactly to:

```ts
{
  p_tenant_id: tenantId,
  p_patient: form.patient,
  p_emergency_contact: contactHasName ? form.emergencyContact : null,
  p_primary_insurance: form.primaryInsurance.enabled ? form.primaryInsurance : null,
  p_secondary_insurance: form.secondaryInsurance.enabled ? form.secondaryInsurance : null,
}
```

- [ ] **Step 5: Implement the repository**

```ts
export async function getPatientRegistrationReferences() {
  const [payers, plans] = await Promise.all([
    referenceSelect<Row>("payers", { order: "name.asc" }),
    referenceSelect<Row>("payer_plans", { order: "name.asc" }),
  ]);
  return { payers, plans };
}

export async function createPatientRegistration(form: PatientRegistrationForm) {
  const tenantId = await getCurrentTenantId();
  return tenantRpc<PatientRegistrationResult>(
    "create_patient_registration",
    buildPatientRegistrationRpcArgs(tenantId, form),
  );
}
```

- [ ] **Step 6: Run focused tests and typecheck**

```bash
pnpm --filter ./scripts exec tsx --test \
  ../artifacts/therassistant-inventory/tests/patient-registration.test.ts
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/patients/registration \
  artifacts/therassistant-inventory/tests/patient-registration.test.ts
git commit -m "feat: add patient registration domain"
```

---

### Task 4: Expand the existing Add Patient drawer and route creation through the atomic RPC

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/patients/registration/PatientRegistrationDrawer.tsx`
- Modify: `artifacts/therassistant-inventory/src/pages/clients.tsx`
- Modify: `artifacts/therassistant-inventory/src/pages/clients-work-drawer.contract.test.ts`
- Modify: `e2e/workspace-actions.spec.ts`

**Interfaces:**
- Consumes: Task 3 `PatientRegistrationForm`, `blankPatientRegistration`, `copyPatientToSubscriber`, `getPatientRegistrationReferences`, `createPatientRegistration`.
- Produces:
  ```ts
  export function PatientRegistrationDrawer(props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: (result: PatientRegistrationResult) => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Extend the drawer contract test and make it fail**

Require these visible/source contracts:

```ts
for (const fragment of [
  "Patient Information",
  "Emergency Contact",
  "Primary Insurance",
  "Secondary Insurance",
  "Date of Birth",
  "Sex",
  "Address Line 1",
  "Member ID",
  "Relationship to Subscriber",
  "createPatientRegistration",
]) {
  if (!source.includes(fragment)) throw new Error(`Missing registration contract: ${fragment}`);
}
```

Update Playwright’s patient drawer test to assert the new sections and confirm **Save Patient remains enabled with first + last only**, demonstrating that missing administrative registration fields do not prevent creation:

```ts
await page.getByRole("button", { name: "+ Add Patient" }).click();
await expect(page.getByText("Patient Information", { exact: true })).toBeVisible();
await expect(page.getByText("Primary Insurance", { exact: true })).toBeVisible();
await page.getByLabel("First Name").fill("E2E");
await page.getByLabel("Last Name").fill("Patient");
await expect(page.getByRole("button", { name: "Save Patient" })).toBeEnabled();
```

Do not actually save in this generic E2E test; cancel to avoid persistent production-like test rows.

- [ ] **Step 2: Run contract test and confirm RED**

```bash
pnpm --filter ./scripts exec tsx --test \
  ../artifacts/therassistant-inventory/src/pages/clients-work-drawer.contract.test.ts
```

Expected: FAIL because the expanded drawer does not exist.

- [ ] **Step 3: Build PatientRegistrationDrawer with four sections**

Use the existing `WorkDrawer` and `thera-form-grid`. Sections:

```tsx
<section>
  <h3>Patient Information</h3>
  {/* names, DOB, sex, address, phone, email */}
</section>
<section>
  <h3>Emergency Contact</h3>
  {/* name, phone, relationship */}
</section>
<section>
  <h3>Primary Insurance</h3>
  {/* enable/add policy, payer, plan, plan type display, member/group, subscriber */}
</section>
<section>
  <h3>Secondary Insurance</h3>
  {/* optional second policy */}
</section>
```

Display a compact note near the Save action:

```tsx
<p className="thera-form-help">
  Missing registration or insurance information will be routed for administrative follow-up. Clinical care is not blocked.
</p>
```

Only first and last name are hard Save-button requirements:

```tsx
disabled={saving || !form.patient.first_name.trim() || !form.patient.last_name.trim()}
```

Visually mark DOB/sex/address/phone/email as registration-required, but do not use browser `required` attributes that prevent the Save handler from reaching the RPC.

- [ ] **Step 4: Implement payer → plan filtering and plan/product display without duplicate fields**

Filter `payer_plans` by selected `payer_id`. The plan select uses `payer_plan_id`; show `plan_type` beside the selected plan as the product/type. Do not add a free-standing duplicate product column to patient insurance.

- [ ] **Step 5: Implement relationship-to-subscriber self-copy behavior**

When the user selects `self`, call `copyPatientToSubscriber()` immediately. While relationship remains `self`, patient demographic edits should refresh the subscriber copy before save so stale subscriber data is not sent.

When relationship is not `self`, subscriber inputs remain independently editable.

- [ ] **Step 6: Replace only the creation path in ClientsPage**

Keep existing Edit Patient behavior for existing rows. Remove direct `tenantInsert("clients", ...)` from the new-patient path and open `PatientRegistrationDrawer` for `+ Add Patient`.

On creation:

```ts
function patientCreated(result: PatientRegistrationResult) {
  setRegistrationOpen(false);
  setVersion((value) => value + 1);
  navigate(`/clients/${result.patient_id}`);
}
```

This makes Patient 360 the immediate post-create destination while preserving the Patients list refresh when the user returns.

- [ ] **Step 7: Run contract/unit/type/build tests**

```bash
pnpm --filter ./scripts exec tsx --test \
  ../artifacts/therassistant-inventory/src/pages/clients-work-drawer.contract.test.ts \
  ../artifacts/therassistant-inventory/tests/patient-registration.test.ts
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
pnpm --filter @workspace/therassistant-inventory run build
```

Expected: PASS.

- [ ] **Step 8: Run the focused browser test**

```bash
pnpm test:e2e -- e2e/workspace-actions.spec.ts
```

Expected: patient drawer test and existing workspace-action tests PASS under authenticated staff setup.

- [ ] **Step 9: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/patients/registration/PatientRegistrationDrawer.tsx \
  artifacts/therassistant-inventory/src/pages/clients.tsx \
  artifacts/therassistant-inventory/src/pages/clients-work-drawer.contract.test.ts \
  e2e/workspace-actions.spec.ts
git commit -m "feat: complete patient registration drawer"
```

---

### Task 5: Make Patient 360 explicitly separate clinical status from administrative readiness

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/patients/AdministrativeAttention.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/patients/PatientChartPage.tsx`
- Create: `artifacts/therassistant-inventory/tests/patient-administrative-status.test.ts`

**Interfaces:**
- Consumes: existing `PatientChart`, `chart.patient`, `chart.summary`, and linked `workqueue_items`.
- Produces:
  ```ts
  export function AdministrativeAttention(props: {
    registrationStatus: string;
    billingReadinessStatus: string;
    workItems: Array<Record<string, unknown> & { id: string }>;
    onOpenRegistration: () => void;
    onOpenInsurance: () => void;
  }): JSX.Element | null;
  ```

- [ ] **Step 1: Write a failing source/model contract test**

Assert that Patient 360 renders three separate state concepts and nonblocking wording:

```ts
assert.match(source, /Patient Status/);
assert.match(source, /Registration/);
assert.match(source, /Billing Readiness/);
assert.match(source, /Care can continue/);
assert.doesNotMatch(source, /cannot start|block care|must resolve before care/i);
```

- [ ] **Step 2: Run focused test and confirm RED**

```bash
pnpm --filter ./scripts exec tsx --test \
  ../artifacts/therassistant-inventory/tests/patient-administrative-status.test.ts
```

Expected: FAIL because Patient 360 does not yet show billing readiness separately or the nonblocking administrative banner.

- [ ] **Step 3: Add AdministrativeAttention**

Show the banner only when registration is not `complete` or billing readiness is not `ready_for_charge` / `ready_for_claim`.

Use copy such as:

```tsx
<div className="thera-state warning">
  Administrative follow-up is needed. Care can continue; resolve these items before the applicable billing or claim step.
</div>
```

List linked open `registration_issue`, `eligibility_issue`, and `authorization_issue` work when available. Navigation actions may switch to Demographics or Insurance/Authorization tabs; they must not disable clinical tabs/actions.

- [ ] **Step 4: Update PatientChartPage status presentation**

In the header/overview show:

```tsx
<Field label="Patient Status" value={<StatusBadge value={String(patient.client_status ?? "intake")} />} />
<Field label="Registration" value={<StatusBadge value={String(patient.registration_status ?? "not_started")} />} />
<Field label="Billing Readiness" value={<StatusBadge value={String(patient.billing_readiness_status ?? "not_ready")} />} />
```

Do not combine these into a single “ready/not ready” flag.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
pnpm --filter ./scripts exec tsx --test \
  ../artifacts/therassistant-inventory/tests/patient-administrative-status.test.ts \
  ../artifacts/therassistant-inventory/tests/patient-chart-phase2.test.ts
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/patients/AdministrativeAttention.tsx \
  artifacts/therassistant-inventory/src/domains/patients/PatientChartPage.tsx \
  artifacts/therassistant-inventory/tests/patient-administrative-status.test.ts
git commit -m "feat: separate clinical and administrative patient status"
```

---

### Task 6: Verify downstream revenue-cycle holds without introducing clinical holds

**Files:**
- Review/modify only if required: `artifacts/therassistant-inventory/src/domains/encounters/EncounterPage.tsx`
- Review/modify only if required: `artifacts/therassistant-inventory/src/domains/encounters/repository.ts`
- Review/modify only if required: `artifacts/therassistant-inventory/src/domains/billing/BillingQueuePage.tsx`
- Review/modify only if required: `artifacts/therassistant-inventory/src/domains/claims/ClaimsPage.tsx`
- Modify: `artifacts/therassistant-inventory/tests/clinical-nonblocking.test.ts`
- Modify existing billing/claim tests only where the renamed readiness contract requires it.

**Interfaces:**
- Consumes: `billing_readiness_status`, encounter `billing_status`, charge/claim validation states.
- Produces: regression guarantees, not a new shared permission service.

- [ ] **Step 1: Add regression assertions for the clinical path**

Extend `clinical-nonblocking.test.ts` to assert that encounter/note/treatment-plan source does not check patient billing or registration state before clinical writes. For example:

```ts
for (const path of [
  "../src/domains/encounters/repository.ts",
  "../src/domains/treatment-plans/TreatmentPlanPanel.tsx",
]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /billing_readiness_status\s*[!=]==?|registration_status\s*[!=]==?.*(return|throw|disabled)/s,
  );
}
```

The test is intentionally narrow: it prevents a future developer from using administrative status as a clinical gate while allowing clinical validation that is genuinely clinical/safety-related.

- [ ] **Step 2: Run test before any corrective edit**

```bash
pnpm --filter ./scripts exec tsx --test \
  ../artifacts/therassistant-inventory/tests/clinical-nonblocking.test.ts
```

Expected: PASS if existing clinical repositories already respect the rule; if it fails, treat the failure as a discovered production defect and remove only the administrative gate causing it.

- [ ] **Step 3: Confirm downstream billing/claim tests still enforce financial workflow gates**

Run:

```bash
pnpm --filter ./scripts exec tsx --test \
  ../artifacts/therassistant-inventory/tests/encounter-workflow.test.ts \
  ../artifacts/therassistant-inventory/tests/billing-workflow.test.ts \
  ../artifacts/therassistant-inventory/tests/claim-workflow.test.ts \
  ../artifacts/therassistant-inventory/tests/claims-workqueues.test.ts
```

Expected: PASS. Billing/claim validation may hold downstream financial actions; no test should require those holds to disable clinical actions.

- [ ] **Step 4: Commit only if source/tests changed**

```bash
git add artifacts/therassistant-inventory/tests/clinical-nonblocking.test.ts \
  artifacts/therassistant-inventory/src/domains/encounters \
  artifacts/therassistant-inventory/src/domains/billing \
  artifacts/therassistant-inventory/src/domains/claims
git commit -m "test: enforce nonblocking clinical workflow boundary"
```

If no production source edit is required, commit the regression-test change alone.

---

### Task 7: Full verification, production-safety review, and pull request

**Files:**
- Modify only if needed for discovered defects: files from Tasks 1–6.
- PR target: `main`
- Branch: `feature/patient-registration-clinical-nonblocking`

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: one reviewable PR with verified DB migration + app behavior.

- [ ] **Step 1: Run the entire Node test suite**

```bash
pnpm --filter ./scripts exec tsx --test \
  ../artifacts/therassistant-inventory/tests/**/*.test.ts
```

Expected: all tests PASS, including rewritten readiness tests and new registration/nonblocking regressions.

- [ ] **Step 2: Run production TypeScript and browser secret gates**

```bash
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
if grep -R -n -E 'SUPABASE_SERVICE_ROLE_KEY|sb_secret_' artifacts/therassistant-inventory/src; then
  echo "Forbidden Supabase server secret marker found in browser source."
  exit 1
fi
```

Expected: typecheck PASS and grep returns no forbidden secret marker.

- [ ] **Step 3: Build the production SPA**

```bash
pnpm --filter @workspace/therassistant-inventory run build
```

Expected: PASS.

- [ ] **Step 4: Run all authenticated Playwright tests**

```bash
pnpm test:e2e
```

Expected: all browser tests PASS, including Patients drawer, Schedule, auth, workqueues, and workspace actions.

- [ ] **Step 5: Re-run Supabase advisors after the migration**

Run both security and performance advisors through the connected Supabase project. Expected: no new warning/error caused by this migration. The pre-existing leaked-password Auth warning is unrelated to this feature and should not be represented as introduced here.

- [ ] **Step 6: Inspect the branch diff for forbidden clinical gating language and duplicate insurance fields**

Search the changed files:

```bash
git diff main...HEAD -- artifacts/therassistant-inventory/src supabase/migrations \
  | grep -E -i 'before starting care|before starting the encounter|block.*care|insurance_product|primary_insurance_product'
```

Expected: no clinical-stop copy and no duplicate insurance-product persistence field. A UI label “Product” is acceptable only when it displays `payer_plans.plan_type`.

- [ ] **Step 7: Push/open PR and let exact-head CI run**

PR title:

```text
Patient registration and nonblocking clinical workflow
```

PR body must explicitly state:

```text
- expands Add Patient into the production registration workflow
- uses one tenant-aware atomic Supabase RPC for patient/contact/insurance creation
- routes incomplete registration/insurance to registration_issue work items
- separates clinical status, registration status, and billing readiness
- converts pre-session administrative failures into billing/admin attention rather than clinical blockers
- preserves downstream billing/claim validation holds
```

- [ ] **Step 8: Verify the PR head, not an earlier commit**

Require current-head success for the applicable Phase 2–5 GitHub Actions workflows. Do not mark the PR ready or merge based on an older green run.

- [ ] **Step 9: Perform final code-review check before merge decision**

Confirm:

```text
Patient can be created with minimum identity even when registration/insurance is incomplete.
Missing admin data creates registration work instead of a clinical stop.
Schedule Appointment remains available.
Start Note remains available.
Encounter/note/treatment-plan/signature workflows do not consult admin readiness as permission.
Billing and claim validation can still hold financial progression.
New database writes are tenant-scoped and authenticated.
No duplicate patient/insurance schema fields were introduced.
```

Stop at the merge decision and use the branch-finishing workflow; do not bypass CI or merge a changed/unverified head.

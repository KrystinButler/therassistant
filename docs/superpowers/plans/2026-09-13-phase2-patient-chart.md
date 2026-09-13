# Phase 2 Patient Chart + Eligibility + Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, editable Patient Chart around the Phase 1 workflow spine, including demographics/contacts, insurance, eligibility history/actions, authorizations/utilization, treatment plans/goals, documents, journal/check-in, and patient portal integration.

**Architecture:** Keep the React/Vite + Supabase foundation. New Phase 2 behavior lives in focused `src/domains/patients`, `eligibility`, `authorizations`, `treatment-plans`, `documents`, `journal`, and `portal` modules. The existing `clients`, `client_contacts`, `client_insurance_policies`, `eligibility_checks`, `authorizations`, `authorization_units`, `treatment_plans`, `treatment_plan_goals`, `documents`, and `client_checkins` tables remain the storage foundation; repository/workflow functions own mutations and Client 360 composes domain objects instead of rendering raw tables.

**Tech Stack:** React 19, Vite, TypeScript, Wouter, Supabase/PostgREST, Node `tsx --test`, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-13-therassistant-canonical-ehr-rcm-design.md`

## Global Constraints

- Synthetic demo data only; no PHI.
- Do not expose UUIDs as primary user identifiers.
- UI mutations must call workflow/repository functions, not arbitrary status updates.
- Existing Phase 1 workflow spine must continue to pass all tests.
- Demo browser writes must remain isolated to the `Therassistant Demo` tenant by RLS.
- No service-role key in the browser.
- Every new consequential mutation must have visible success/error feedback.
- Phase 2 is not complete until Vercel reaches READY and the Phase 2 strict typecheck + full Vite build pass.

---

### Task 1: Patient Chart Domain Model and Readiness Summary

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/patients/types.ts`
- Create: `artifacts/therassistant-inventory/src/domains/patients/chart.ts`
- Create: `artifacts/therassistant-inventory/src/domains/patients/repository.ts`
- Test: `artifacts/therassistant-inventory/tests/patient-chart-phase2.test.ts`

**Interfaces:**
- Produces `getPatientChart(patientId)` returning one typed aggregate with demographics, contacts, insurance policies, eligibility history, authorizations + units, appointments, encounters, treatment plans + goals, notes, charges, claims, payments, denials, documents, check-ins, journal entries when available, linked work items, next appointment, primary payer, open balance, and alert summaries.
- Produces `summarizePatientReadiness(input)` for registration, insurance, eligibility, authorization, treatment-plan and work-alert summary cards.

- [ ] **Step 1: Write the failing aggregate tests**

```ts
assert.equal(summary.primaryPayerName, "Health First Colorado");
assert.equal(summary.nextAppointmentId, "appt-1");
assert.equal(summary.authorizationAlert, "2 units remaining");
assert.equal(summary.openWorkCount, 2);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:
```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/patient-chart-phase2.test.ts
```
Expected: fail because Phase 2 patient chart modules do not exist.

- [ ] **Step 3: Implement typed aggregate/repository**

Use one repository fan-out and Maps keyed by IDs. Resolve payer/provider names before returning to UI. Never return UUIDs as display labels.

- [ ] **Step 4: Run focused and full tests**

Expected: new chart tests green; all Phase 1 tests remain green.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add Phase 2 patient chart aggregate"
```

---

### Task 2: Editable Demographics and Contacts

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/patients/workflow.ts`
- Create: `artifacts/therassistant-inventory/src/domains/patients/DemographicsPanel.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/patients/ContactsPanel.tsx`
- Modify: `artifacts/therassistant-inventory/src/pages/client-detail.tsx`
- Migration: `supabase/migrations/20260913_phase2_patient_write_policies.sql`
- Test: `artifacts/therassistant-inventory/tests/patient-demographics.test.ts`

**Interfaces:**
- `updatePatientDemographics(patientId, input)` validates required name/address/status values and updates `clients`.
- `addPatientContact(patientId, input)`, `updatePatientContact(contactId, input)` manage emergency/responsible-party contacts.

- [ ] **Step 1: RED tests**

```ts
await assert.rejects(() => validateDemographics({ firstName: "", lastName: "Reed" }), /First name/);
assert.equal(normalizePhone("3035551212"), "303-555-1212");
```

- [ ] **Step 2: Implement validation/workflow before UI**

Required patient fields in the form: first/middle/last/preferred name, DOB, email, phone, address 1/2, city, state, postal code, client status, registration status.

Contact form: name, relationship, phone, email, emergency contact, responsible party.

- [ ] **Step 3: Add demo-tenant RLS for contact INSERT/UPDATE and confirm existing `clients` write policy remains tenant-scoped**

- [ ] **Step 4: Wire panels into Client 360 tabs `Overview` and `Demographics & Contacts` with Edit/Add actions and visible save errors**

- [ ] **Step 5: Verify tests/build and commit**

```bash
git commit -m "feat: make patient demographics and contacts editable"
```

---

### Task 3: Insurance Policy Management

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/insurance/workflow.ts`
- Create: `artifacts/therassistant-inventory/src/domains/insurance/repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/insurance/InsurancePanel.tsx`
- Migration: `supabase/migrations/20260913_phase2_insurance_write_policies.sql`
- Test: `artifacts/therassistant-inventory/tests/insurance-workflow.test.ts`

**Interfaces:**
- `addInsurancePolicy(patientId, input)`
- `updateInsurancePolicy(policyId, input)`
- `terminateInsurancePolicy(policyId, terminationDate)`
- `setPrimaryInsurance(policyId)` demotes any current primary policy for the same patient before promoting the target.

- [ ] **Step 1: RED tests for primary ordering and termination**

```ts
assert.deepEqual(result.updatedOrders, ["secondary", "primary"]);
assert.equal(result.terminated.status, "inactive");
```

- [ ] **Step 2: Implement workflows with controlled payer/plan lookup**

Form fields: payer, plan/product, order, status, member ID, group number, subscriber name/DOB/relationship, effective date, termination date, authorization-required metadata.

- [ ] **Step 3: Add demo RLS INSERT/UPDATE for `client_insurance_policies`**

- [ ] **Step 4: Replace read-only Insurance tab with action-oriented cards/table**

Required actions: Add Policy, Edit, Make Primary, Terminate, Run Eligibility.

- [ ] **Step 5: Verify and commit**

```bash
git commit -m "feat: add patient insurance management"
```

---

### Task 4: Eligibility History and Patient-Level 270/271 Action

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/eligibility/workflow.ts`
- Create: `artifacts/therassistant-inventory/src/domains/eligibility/repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/eligibility/EligibilityPanel.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/scheduling/repository.ts` to reuse the shared synthetic adapter instead of owning duplicate eligibility logic.
- Migration: `supabase/migrations/20260913_phase2_eligibility_write_policy.sql`
- Test: `artifacts/therassistant-inventory/tests/eligibility-workflow-phase2.test.ts`

**Interfaces:**
- `runPatientEligibility({ patientId, policyId, serviceDate })`
- `getEligibilityHistory(patientId)`
- `parseEligibilityBenefits(rawResponse)` returns benefit rows including copay, coinsurance, deductible, deductible remaining, OOP, network status, and authorization indicator when present.

- [ ] **Step 1: RED tests for active/inactive/not-found responses and benefit parsing**

- [ ] **Step 2: Extract the current synthetic 270/271 adapter from Scheduling into the eligibility domain**

The demo response must persist `response_source="synthetic_demo_270_271"`, transaction `271`, member ID, outcome, and illustrative benefit fields.

- [ ] **Step 3: Add patient-level Run Eligibility action and history table**

Display: service date, payer/plan, member ID, status, response source, copay, deductible, OOP, network, authorization indicator, created timestamp.

- [ ] **Step 4: Keep Scheduling/Pre-Session using the same shared eligibility workflow**

- [ ] **Step 5: Verify and commit**

```bash
git commit -m "feat: add patient eligibility history and actions"
```

---

### Task 5: Authorization Management and Utilization

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/authorizations/workflow.ts`
- Create: `artifacts/therassistant-inventory/src/domains/authorizations/repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/authorizations/AuthorizationPanel.tsx`
- Migration: `supabase/migrations/20260913_phase2_authorization_write_policies.sql`
- Test: `artifacts/therassistant-inventory/tests/authorization-workflow.test.ts`

**Interfaces:**
- `createAuthorization(patientId, input)`
- `updateAuthorization(authorizationId, input)`
- `setAuthorizationUnits(authorizationId, input)`
- `recordAuthorizationUse(authorizationId, cptCode, units)` increments `used_units` only when enough units remain.
- `authorizationAlert(auth, unitRows, today)` returns missing/expired/exhausted/low-unit/ready state.

- [ ] **Step 1: RED tests for unit utilization and blocking states**

```ts
assert.equal(alert.code, "low_units");
await assert.rejects(() => recordUse(1, 2), /remaining units/i);
```

- [ ] **Step 2: Implement workflows without writing generated `remaining_units` directly**

- [ ] **Step 3: Add demo RLS writes for `authorizations` and `authorization_units`**

- [ ] **Step 4: Build Authorization tab**

Display: payer, auth number, status, dates, CPT, authorized/used/remaining units, utilization %, alerts, linked upcoming appointments. Actions: Add, Edit, Add/adjust units, Record Use.

- [ ] **Step 5: Verify and commit**

```bash
git commit -m "feat: add authorization management and utilization"
```

---

### Task 6: Treatment Plans and Goals

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/treatment-plans/workflow.ts`
- Create: `artifacts/therassistant-inventory/src/domains/treatment-plans/repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/treatment-plans/TreatmentPlanPanel.tsx`
- Migration: `supabase/migrations/20260913_phase2_treatment_plan_write_policies.sql`
- Test: `artifacts/therassistant-inventory/tests/treatment-plan.test.ts`

**Interfaces:**
- `createTreatmentPlan(patientId, input)`
- `updateTreatmentPlan(planId, input)`
- `addTreatmentGoal(planId, input)`
- `updateTreatmentGoal(goalId, input)`
- `treatmentPlanAlert(plan, today)` returns draft/review_due/active/completed state.

- [ ] **Step 1: RED tests for review-due calculation and goal ownership**

- [ ] **Step 2: Implement repository/workflow**

Plan fields: responsible provider, status, effective date, review due, plan/problem/intervention text, signature timestamp when activated. Goal fields: measurable goal, objective, status.

- [ ] **Step 3: Add demo RLS writes for plans/goals**

- [ ] **Step 4: Replace read-only Treatment Plans tab with plan cards and editable goal list**

- [ ] **Step 5: Surface active/review-due treatment plan status in Pre-Session and Encounter context**

- [ ] **Step 6: Verify and commit**

```bash
git commit -m "feat: add treatment plans and goals"
```

---

### Task 7: Documents, Journal, Check-In, and Patient Portal

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/documents/repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/documents/DocumentsPanel.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/portal/workflow.ts`
- Create: `artifacts/therassistant-inventory/src/domains/portal/repository.ts`
- Create: `artifacts/therassistant-inventory/src/domains/portal/PatientPortalPage.tsx`
- Create or adapt: `artifacts/therassistant-inventory/src/domains/journal/*`
- Modify: `artifacts/therassistant-inventory/src/App.tsx`
- Migration: `supabase/migrations/20260913_phase2_portal_write_policies.sql`
- Test: `artifacts/therassistant-inventory/tests/patient-portal.test.ts`

**Interfaces:**
- `recordCheckIn(appointmentId, patientId, step, responses?)`
- `getPatientPortalData(patientId)` deliberately excludes internal workqueue, credentialing, and claim-administration data.
- `addJournalEntry(patientId, input)` persists patient-authored content separately from signed clinical notes.

- [ ] **Step 1: RED tests prove portal scoping**

```ts
assert.equal("workItems" in portalData, false);
assert.equal("credentialing" in portalData, false);
assert.equal(portalData.patient.id, patientId);
```

- [ ] **Step 2: Implement check-in state transitions (`on_my_way`, `arrived`, `checked_in`) using `client_checkins`**

- [ ] **Step 3: Implement documents metadata display and synthetic upload placeholder records only; do not expose fake downloadable bytes**

- [ ] **Step 4: Implement patient journal as patient-authored content and keep it separate from clinical-note signing**

- [ ] **Step 5: Replace generic patient portal route with scoped patient portal workspace**

Portal displays upcoming appointment/check-in, demographic/insurance confirmation, forms/consents status, journal, balance summary, and selected documents/messages.

- [ ] **Step 6: Verify and commit**

```bash
git commit -m "feat: connect patient portal check-in journal and documents"
```

---

### Task 8: Connected Phase 2 Seed, Navigation, and Verification Gate

**Files:**
- Create: `supabase/seed/20260913_phase2_patient_chart_demo.sql`
- Create: `artifacts/therassistant-inventory/tests/phase2-scenarios.test.ts`
- Create: `artifacts/therassistant-inventory/tsconfig.phase2.json`
- Modify: `artifacts/therassistant-inventory/package.json`
- Modify: `artifacts/therassistant-inventory/src/pages/client-detail.tsx`
- Modify: `artifacts/therassistant-inventory/src/pages/dashboard.tsx`
- Modify: `vercel.json`

**Required deterministic scenarios:**

1. One patient with complete demographics and emergency/responsible contact.
2. Primary + secondary insurance with active primary policy.
3. Multiple eligibility history rows with benefits.
4. Approved authorization with low remaining units and one expired authorization.
5. Active treatment plan with measurable goals and upcoming review date.
6. Patient document metadata linked to the chart.
7. Check-in history through checked-in state.
8. Patient journal entry visible in portal/chart but not merged into signed note.

- [ ] **Step 1: Write scenario tests first**

Expected assertions include patient chart tab counts, primary policy resolution, authorization alerts, treatment-plan readiness, portal scoping, and journal separation.

- [ ] **Step 2: Add idempotent seed rows with stable synthetic IDs and no production data**

- [ ] **Step 3: Add `typecheck:phase2` script and make Vercel gate run**

```text
all tests → Phase 1 strict typecheck → Phase 2 strict typecheck → full Vite build
```

- [ ] **Step 4: Final Client 360 tabs**

```text
Overview
Demographics & Contacts
Insurance & Eligibility
Authorizations
Appointments
Encounters
Treatment Plan & Goals
Clinical Notes
Diagnoses
Charges
Claims
Payments & Balances
Denials / Appeals
Documents
Journal
Work Items
Portal / Check-In
```

- [ ] **Step 5: Verify Supabase RLS and privilege boundaries**

Anonymous demo tables may have only the operations required by the demo UI; no broad DELETE/TRUNCATE privileges.

- [ ] **Step 6: Final branch verification**

Required evidence:
- all Phase 1 + Phase 2 tests green,
- Phase 1 + Phase 2 strict TypeScript green,
- full Vite build green,
- Vercel preview READY,
- key routes return successfully,
- seeded chart relationships verified by SQL,
- no new runtime error/fatal logs.

- [ ] **Step 7: Pull request and production promotion only after verification**

```bash
git commit -m "feat: complete Phase 2 patient chart"
```

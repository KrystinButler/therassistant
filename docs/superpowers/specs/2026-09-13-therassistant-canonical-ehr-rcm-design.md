# Therassistant Canonical EHR + Revenue Cycle Design

Date: 2026-09-13
Status: Approved design direction; implementation not started from this specification
Primary repository: `KrystinButler/therassistant`
Reference repositories: `KrystinButler/therassistant-ehr`, `KrystinButler/therassistantehr`
Deployment target: Vercel
Persistence target: Supabase

## 1. Purpose

Therassistant must function as a connected behavioral-health EHR, practice-management, credentialing, and revenue-cycle system rather than a collection of independent database tables.

The current Vite/React + Supabase application is the foundation. The older Therassistant repositories are treated as a requirements and interaction library. Useful workflows and screen patterns will be ported into the current application, but older localStorage, mock-only, and framework-specific implementations will not be copied wholesale.

The system must demonstrate a realistic end-to-end operational story using synthetic data while preserving a path to production-grade authentication, authorization, auditing, and PHI controls.

## 2. Canonical Workflow Spine

The application is organized around one connected workflow:

```text
Patient
  ↓
Insurance Policy
  ↓
Eligibility 270/271
  ↓
Authorization / Benefit Requirements
  ↓
Appointment
  ↓
Pre-Session Readiness
  ↓
Encounter
  ↓
Clinical Note + Diagnoses + Service Lines
  ↓
Clinical Signature / Lock
  ↓
Billing Readiness Audit
  ↓
Charge Capture
  ↓
Claim Scrub
  ↓
837P Claim / Batch
  ↓
999 / 277CA / 276-277 Clearinghouse Events
  ↓
Payer Adjudication
  ↓
ERA 835 / Payment / Adjustments
  ↓
A/R, Denials, Appeals, Recoupments, Patient Responsibility
  ↓
Exception Workqueues and Follow-Up
```

Every major screen must either move a record forward in this workflow, resolve an exception, maintain a prerequisite, or report on the workflow. Decorative pages and raw database viewers are not acceptable as final module implementations.

## 3. Design Principles

### 3.1 Operational screens, not table dumps

No normal user-facing screen may expose UUIDs as the primary way to identify patients, providers, claims, appointments, payers, or other records. Internal IDs remain available to the application but are replaced in the UI by human identifiers and linked context.

### 3.2 Workqueues are for exceptions

The Work Center does not replace scheduling, billing, credentialing, mailroom, or claims. Primary work happens inside the domain module. Workqueue items represent exceptions, handoffs, deadlines, missing requirements, and follow-up tasks.

### 3.3 Encounter-centered clinical workflow

Appointments are the scheduling source. Encounters are the clinical and billing source of truth after a service begins. A scheduled appointment can start an encounter. The encounter owns clinical documentation, diagnoses, service lines, readiness, and routing to billing.

### 3.4 Claims are created only after billing readiness

Signing a note does not automatically submit a claim. Signing triggers a readiness audit. Ready encounters route to billing. A biller scrubs the encounter/charge before a claim is created or submitted.

### 3.5 Role-aware navigation and dashboard

The application supports role-oriented views for front desk, clinician, billing/RCM, credentialing, owner/executive, and administrator. The current demo does not need full user authentication to demonstrate role switching, but the UI and domain boundaries must support it.

### 3.6 Reuse current Supabase data where possible

The rebuild must not rename or replace working tables solely to match older code terminology. A repository layer maps domain terms to current storage names during the transition.

Examples:

- UI/domain `Patient` → current `clients`
- UI/domain `Claim` → current `professional_claims`
- UI/domain `Claim Line` → current `professional_claim_lines`
- UI/domain `Charge` → current `charge_capture_items`

New first-class concepts such as Encounter may require new tables when no safe equivalent exists.

## 4. Application Architecture

### 4.1 Frontend structure

The current React/Vite application remains the presentation layer.

Each domain receives focused components and services instead of adding more behavior to `restored-modules.tsx` or one large `operational-workspaces.tsx` file.

Target structure:

```text
src/
  domains/
    patients/
    scheduling/
    encounters/
    clinical/
    eligibility/
    authorizations/
    billing/
    claims/
    clearinghouse/
    payments/
    ar/
    credentialing/
    payers/
    mailroom/
    reports/
    imports/
    portal/
    administration/
  components/
    layout/
    forms/
    tables/
    workqueue/
    status/
  lib/
    supabase/
    repositories/
    workflow/
    format/
```

Each domain must have:

1. typed data contracts,
2. repository/data-access functions,
3. workflow actions,
4. screens/components,
5. tests for important state transitions.

### 4.2 Data access

The demo continues to use browser-safe Supabase access against synthetic demo data.

The current public demo policies are temporary. Production conversion requires Supabase Auth, tenant membership, role-based authorization, audit logs, and removal of anonymous write access.

A repository layer must replace direct arbitrary table reads inside UI components. Components should request domain objects such as `getPatientChart(patientId)` or `getClaimWorkspace(claimId)` rather than joining unrelated tables themselves.

### 4.3 Mutation model

User actions call workflow functions rather than blindly changing status columns.

Examples:

```text
scheduleAppointment()
startEncounter()
runEligibility()
signClinicalNote()
runBillingReadinessAudit()
routeEncounterToBilling()
createClaimFromEncounter()
scrubClaim()
submitClaimBatch()
recordClearinghouseResponse()
postEra()
createAppeal()
resolveWorkItem()
```

Each workflow function validates prerequisites, performs the state transition, creates related records when necessary, and emits workqueue/history/audit records when appropriate.

## 5. Navigation Model

### 5.1 Primary navigation

```text
Home
Patients
Schedule
Clinical
Billing
Work Center
Credentialing
Payers & Contracts
Mailroom
Reports
Administration
```

### 5.2 Billing hub

Billing is a routing hub rather than one mixed page.

```text
Billing
  Charge Capture
  Claims
    Overview
    Claims List
    Create Claims
    Submission / 837P
    Claim Status
    Rejections
    Denials
    Appeals
  Payments
    Insurance Payments
    Patient Payments
    ERA / 835 Posting
    Unapplied Payments
    Adjustments / Reversals
  A/R
    Insurance Aging
    Patient Aging
    Follow-Up
    Recoupments / Refunds
  Reports & Tools
```

## 6. Domain Requirements

### 6.1 Home Command Center

The home screen is role-aware and action-oriented.

Required behavior:

- role selector in demo mode,
- clickable metrics,
- today/upcoming schedule,
- unsigned notes,
- encounters waiting for billing,
- claims requiring action,
- denied claims,
- payment exceptions,
- authorization alerts,
- credentialing alerts,
- unresolved correspondence,
- overdue work items,
- recent revenue-cycle activity.

Metrics route to filtered operational workspaces rather than static cards.

### 6.2 Patients

#### Patient list

Required:

- search and filters,
- add patient,
- edit patient,
- active/inactive/intake/waitlist/discharged status,
- primary payer,
- next appointment,
- registration readiness,
- billing readiness,
- open balance,
- active alerts.

#### Patient chart

Tabs/workspaces:

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
Audit / History
```

The chart must permit appropriate create/edit actions instead of remaining read-only.

### 6.3 Scheduling

Required views:

- Day
- Week
- Month
- Provider schedule
- List

Appointment workflow:

- create appointment,
- controlled appointment type,
- controlled reason,
- select patient and provider,
- derive active insurance,
- display latest eligibility,
- display authorization status,
- confirm,
- reschedule,
- cancel,
- no-show,
- check in,
- complete,
- start encounter.

Telehealth defaults to POS 02 and in-person defaults to POS 11, subject to payer/service rules.

Appointment detail includes a Pre-Session Readiness panel.

### 6.4 Pre-Session Readiness

Shows:

- demographics completeness,
- registration status,
- insurance policy,
- latest eligibility result,
- benefit/copay information,
- authorization requirement and remaining units,
- provider enrollment status with payer,
- treatment-plan status,
- required forms/check-in,
- prior balance alerts,
- operational warnings.

Blocking vs informational warnings must be visually distinct.

### 6.5 Encounters

Encounter becomes a first-class domain object.

States:

```text
planned
in_progress
documentation_pending
ready_for_signature
signed
billing_review
ready_to_bill
billing_hold
claim_created
closed
voided
```

Actions:

- start from appointment,
- open encounter workspace,
- document note,
- add diagnoses,
- add service lines,
- link treatment plan/goals,
- route question to biller,
- sign note,
- run readiness audit,
- route to billing,
- reopen/amend under controlled conditions.

### 6.6 Clinical Documentation

Required note workspace:

- encounter context,
- note type,
- SOAP or configured structured sections,
- session summary,
- risk/safety notes,
- diagnoses,
- service lines,
- treatment goals addressed,
- start/end time where applicable,
- CPT/HCPCS,
- modifiers,
- place of service,
- units,
- rendering provider,
- draft autosave behavior,
- sign,
- lock,
- amendment history,
- signature history.

Patient journal content remains patient-authored until reviewed and deliberately incorporated into clinical documentation.

### 6.7 Treatment Plans and Goals

Required:

- create/edit treatment plan,
- active/inactive/completed status,
- effective and review dates,
- problem statements,
- measurable goals/objectives,
- interventions,
- responsible provider,
- encounter linkage,
- review-due alerts,
- treatment-plan readiness displayed in clinical workflow.

### 6.8 Eligibility

Required:

- run real-time eligibility action,
- active/inactive/not-found result,
- member information,
- effective dates,
- payer/product/plan,
- copay,
- coinsurance,
- deductible,
- deductible remaining,
- out-of-pocket information,
- network status,
- authorization indicators,
- raw transaction/history area for administrative users,
- 270/271 transaction tracking.

Eligibility is accessible from Scheduling, Patient Chart, and dedicated queue.

### 6.9 Authorizations

Required:

- create/edit authorization,
- payer and plan,
- authorization number,
- service/CPT coverage,
- date range,
- approved units,
- used units,
- remaining units,
- frequency limitations,
- status,
- expiration alerts,
- exhausted-unit alerts,
- missing-authorization alerts,
- linked appointments/encounters/claims.

Authorization failures can block billing when payer rules require it.

### 6.10 Charge Capture and Billing Readiness

Charge Capture is an exception-oriented billing workspace.

Readiness evaluates:

- signed clinical note,
- diagnosis present,
- service line present,
- CPT/HCPCS,
- units,
- POS,
- modifier requirements,
- patient coverage,
- eligibility,
- authorization,
- provider payer enrollment,
- payer contract/fee schedule where relevant.

The biller can edit coding/billing fields before claim creation.

States:

```text
captured
blocked
ready_for_claim
claim_created
patient_responsibility
voided
```

Readiness failures generate explicit reasons and work items where follow-up is needed.

### 6.11 Claims

Claims workspace structure:

```text
Overview
Claims List
Workqueues
Rejections
Denials
Appeals
Reports
```

Required list capabilities:

- search,
- payer filter,
- provider filter,
- status filter,
- clearinghouse status,
- ERA/payment status,
- date filters,
- CPT/diagnosis filters,
- workqueue filter,
- sorting,
- pagination,
- bulk selection,
- bulk workflow actions where safe.

Claim 360 includes:

- claim header,
- patient/payer/provider,
- service lines,
- diagnoses,
- total charge,
- allowed,
- paid,
- adjustments,
- balance,
- submission history,
- clearinghouse events,
- claim-status history,
- denials,
- appeals,
- notes,
- payments,
- work items,
- correction/void history.

### 6.12 837P and Clearinghouse Workflow

Required:

- scrub ready claims,
- create claim batch,
- generate/represent 837P submission,
- submit batch,
- record submission timestamp/reference,
- 999 acknowledgement,
- 277CA acceptance/rejection,
- claim-level rejection correction,
- 276 status inquiry,
- 277 status response,
- clearinghouse transaction log,
- resubmission/corrected claim path.

The demo may use a vendor-neutral synthetic clearinghouse adapter, but the data model and UI must reflect real transaction stages.

### 6.13 Payments and ERA

Payments is divided into functional workflows.

#### Insurance payments

- manual insurance payment,
- trace/check/EFT reference,
- payer,
- received date,
- posting status,
- allocations.

#### ERA / 835

- import ERA,
- parse claim/service-line remittance data,
- match claim,
- review match exceptions,
- post payment,
- post contractual adjustments,
- post patient responsibility,
- create denial/underpayment work when appropriate.

#### Patient payments

- record payment,
- allocate to balances,
- unapplied queue,
- reversal/refund when needed.

#### Payment history

- allocation history,
- adjustment history,
- reversals,
- remaining unapplied amount.

### 6.14 A/R, Denials, Appeals, Recoupments

A/R includes separate insurance and patient views.

Insurance aging buckets:

```text
0-30
31-60
61-90
91-120
120+
```

Denial workflow includes:

- CARC,
- RARC,
- denial category,
- reason,
- amount,
- workability,
- timely-filing deadline,
- assigned user,
- notes,
- action history,
- appeal creation,
- appeal level,
- appeal due date,
- appeal outcome.

Recoupments/refunds are tracked separately from ordinary denials.

Credentialing/contract-related denials can be classified according to configured business policy rather than forced through ordinary appeal workflows.

### 6.15 Work Center

Required queues include:

- documentation,
- eligibility,
- authorization,
- billing readiness,
- claim validation,
- rejection,
- denial,
- payment exception,
- underpayment,
- credentialing,
- correspondence,
- refund/recoupment,
- import validation,
- general follow-up.

Actions:

- open source record,
- start work,
- assign/reassign,
- change priority,
- pend/snooze with date,
- add note,
- complete,
- reopen,
- view history.

### 6.16 Providers and Credentialing

Provider record includes:

- demographics/contact,
- credentials,
- NPI,
- taxonomy,
- licenses,
- DEA where applicable,
- malpractice,
- CAQH,
- PECOS/Medicare identifiers,
- Medicaid identifiers,
- payer enrollments,
- group affiliations,
- effective/termination/revalidation dates,
- contract participation,
- credentialing alerts,
- claim impact.

Credentialing workspace tabs:

```text
Overview
Payer Enrollments
Licenses
Identifiers
Contracts
CAQH / PECOS
Alerts
```

Actions include add/edit enrollment, license, identifier, contract, notes/reference numbers, and status progression.

### 6.17 Payers, Plans, Contracts, Fee Schedules

Required:

- payer registry,
- aliases,
- plans/products,
- clearinghouse payer ID,
- payer type,
- contract,
- effective/termination date,
- contract status,
- fee schedule,
- fee schedule line by CPT/HCPCS,
- allowed amount,
- expected reimbursement lookup,
- underpayment variance comparison.

### 6.18 Mailroom / Correspondence

Mailroom is a correspondence work system.

Document types include:

- EOB,
- denial letter,
- appeal,
- reconsideration,
- recoupment notice,
- refund request,
- credentialing letter,
- medical-record request,
- prior-authorization notice,
- general payer correspondence.

Required actions:

- upload/add document,
- classify,
- link payer,
- link patient,
- link claim,
- link provider,
- mark reviewed,
- create work item/ticket,
- assign follow-up,
- download/open stored document,
- close.

### 6.19 Reports

Reports must be filterable, exportable, and drillable.

Core reports:

- insurance aging,
- patient aging,
- revenue/collections,
- claims by status,
- rejection rate,
- denial rate/category,
- payment posting,
- unapplied payments,
- write-offs/adjustments,
- underpayments,
- provider productivity,
- note completion,
- authorization utilization,
- credentialing status,
- workqueue performance,
- payer reimbursement.

Saved reports may be added after the core reporting views work.

### 6.20 Imports

Import workflow:

```text
Upload
  ↓
Identify file type
  ↓
Map columns
  ↓
Validate
  ↓
Review errors/warnings
  ↓
Correct / exclude rows
  ↓
Commit valid rows
  ↓
Import summary and history
```

No import should silently write invalid rows into operational tables.

### 6.21 Patient Portal and Check-In

Demo portal capabilities:

- upcoming appointments,
- check-in,
- demographic confirmation,
- insurance confirmation/upload,
- forms/consents,
- patient journal,
- balance summary,
- selected documents/messages.

Patient-facing data must be deliberately scoped and not expose internal workqueue, claim-administration, or credentialing data.

### 6.22 Administration

Required administration areas:

- practice settings,
- users,
- roles/permissions,
- locations,
- service/CPT configuration,
- payer configuration,
- notifications,
- import administration,
- audit/history viewer,
- demo data/reset controls isolated from ordinary production navigation.

## 7. Supabase Data Design

### 7.1 Preserve current working tables

The following current tables remain foundational where available:

```text
clients
client_contacts
client_insurance_policies
appointments
clinical_notes
clinical_note_signatures
treatment_plans
treatment_plan_goals
authorizations
authorization_units
charge_capture_items
professional_claims
professional_claim_lines
claim_diagnoses
claim_status_history
claim_batches
claim_batch_items
claim_submissions
submission_responses
payments
payment_allocations
payment_reversals
adjustments
adjustment_allocations
adjustment_reversals
denials
appeals
workqueue_items
workqueue_history
providers
provider_identifiers
provider_payer_enrollments
payers
payer_plans
payer_aliases
payer_contracts
fee_schedules
fee_schedule_lines
era_files
era_claims
era_service_lines
era_adjustments
era_matches
mailroom_items
documents
import_batches
import_rows
import_validation_errors
```

### 7.2 Add encounter foundation

Add a first-class encounter model rather than overloading appointments or notes.

Minimum new tables:

```text
encounters
encounter_diagnoses
encounter_service_lines
encounter_readiness_checks
```

Encounter records link patient, appointment, provider, location, payer/policy context, status, start/end times, and billing state.

Clinical notes link to encounter. Charges link to encounter/service line where possible. Claims retain source traceability back to encounter and charge.

### 7.3 History and audit

Every consequential workflow transition should create history. Production must ultimately track actor, timestamp, prior state, new state, reason, and source.

The public synthetic demo may use a simplified actor model, but its data structures must not prevent full auditing later.

## 8. Demo Data Requirements

The demo must contain at least one complete synthetic scenario for each major workflow, not empty modules.

Required scenarios:

1. **Clean claim:** scheduled → eligible → authorized if needed → encounter → signed note → charge → claim → accepted → ERA → paid → zero balance.
2. **Eligibility problem:** inactive/not-found coverage blocks readiness and creates work.
3. **Authorization problem:** insufficient/missing authorization creates an alert and billing hold.
4. **Documentation problem:** encounter completed but note unsigned or missing diagnosis/service line.
5. **Claim rejection:** clearinghouse rejection corrected and resubmitted.
6. **Denial and appeal:** CARC/RARC denial generates appeal workflow.
7. **Underpayment:** ERA posts below contracted expectation and creates variance work.
8. **Credentialing block:** provider enrollment issue blocks claim creation/submission.
9. **Mailroom item:** denial/recoupment/refund correspondence linked into operational work.
10. **Import validation:** file contains valid and invalid rows, demonstrating correction before commit.

The seed must populate supporting policies, authorizations, treatment plans, signatures, lines, diagnoses, batches, submissions, ERA records, allocations, identifiers, contracts, fee schedules, documents, and import records so those modules are visibly functional.

## 9. Status and State Integrity

Status transitions must be controlled by workflow logic.

Examples:

- An encounter cannot become `signed` without required signature data.
- A charge cannot become `ready_for_claim` if a blocking readiness check fails.
- A claim cannot become `submitted` without a submission record/batch.
- A denial cannot become `appealed` without an appeal record.
- A payment cannot become fully posted without allocations or an explicit unapplied remainder.
- A work item cannot be marked complete without a completion timestamp/history event.

UI status dropdowns may be used only where direct state editing is operationally legitimate, such as certain credentialing administrative statuses.

## 10. Error Handling

All user actions must provide visible success/error feedback.

Required patterns:

- inline validation before mutation,
- disabled submit while saving,
- server/Supabase error surfaced in plain language,
- no silent mutation failures,
- empty states explain the next action,
- blocking readiness failures show why and how to resolve them,
- failed workflow actions do not leave partially transitioned records.

## 11. Security Path

### Demo phase

- synthetic data only,
- browser-safe publishable Supabase key,
- demo-tenant RLS isolation,
- no PHI,
- no service-role key in browser.

### Production conversion

Before real patient use:

- Supabase Auth,
- tenant memberships,
- role permissions,
- authenticated RLS,
- anonymous writes removed,
- audit logs,
- secure document storage,
- secrets moved to server-side functions/routes where required,
- session controls,
- production logging and monitoring,
- HIPAA/security review before PHI use.

## 12. Testing Strategy

### 12.1 Workflow tests

Test state transitions rather than only rendering.

Minimum workflow coverage:

- appointment → encounter,
- note signing → readiness audit,
- readiness success → billing queue,
- readiness failure → hold/work item,
- charge → claim,
- claim → batch/submission,
- submission → acceptance/rejection,
- ERA → payment/adjustment/allocation,
- denial → appeal,
- credentialing issue → billing block,
- correspondence → linked work item.

### 12.2 UI smoke tests

For each major module verify:

- loads without raw-ID-first presentation,
- primary actions are available,
- create/edit forms work,
- names replace foreign keys,
- links open correct workspace,
- filters work,
- empty state is useful.

### 12.3 Deployment verification

A change is not complete until:

1. production build succeeds,
2. Vercel deployment reaches READY,
3. key production routes return successfully,
4. synthetic Supabase data can be read under the demo browser role,
5. mutations used by the tested workflow succeed under demo RLS,
6. the tested workflow is manually walked through from the live URL.

## 13. Implementation Decomposition

This system is too large to implement safely as one undifferentiated change. Work is divided into ordered sub-projects.

### Phase 1 — Workflow Spine

Build the minimum complete path:

```text
Patient → Insurance → Eligibility → Appointment → Pre-Session → Encounter
→ Clinical Note / Dx / Service Lines → Signature → Readiness Audit
→ Charge → Claim → 837P Submission → Payer Status → ERA/Payment or Denial
→ Work Item
```

Deliverables:

- encounter schema,
- connected seed data,
- schedule/calendar foundation,
- pre-session workspace,
- encounter workspace,
- clinical note composer,
- diagnoses/service lines,
- signing/readiness,
- charge scrubber,
- claim creation/submission,
- basic clearinghouse events,
- ERA/payment posting,
- denial/workqueue handoff.

### Phase 2 — Patient Chart + Eligibility + Authorization

Deliverables:

- full patient chart tabs,
- editable demographics/contacts,
- insurance management,
- eligibility history/actions,
- authorization management/utilization,
- treatment plans/goals,
- documents/journal/check-in.

### Phase 3 — Advanced Billing + A/R

Deliverables:

- full Billing routing hub,
- claims tabs/workqueues,
- bulk actions,
- rejection management,
- insurance/patient aging,
- appeals,
- recoupments/refunds,
- underpayment/contract variance,
- full payment/ERA workspaces.

### Phase 4 — Credentialing + Payers

Deliverables:

- provider 360,
- credentialing tabs,
- license/identifier/CAQH/PECOS tracking,
- payer enrollments,
- alerts/revalidation,
- payer registry/plans,
- contracts,
- fee schedules.

### Phase 5 — Mailroom + Reports + Imports + Admin

Deliverables:

- correspondence repository/workflow,
- report library with filters/export/drilldown,
- validated import workflow,
- role-aware administration,
- audit/history views,
- cleanup of remaining generic module renderers.

### Phase 6 — Portal + Production Hardening

Deliverables:

- patient portal/check-in flows,
- authenticated users,
- tenant/role RLS,
- secure documents,
- removal of anonymous write access,
- production monitoring and audit readiness.

## 14. Acceptance Criteria for the Rebuild

Therassistant is considered functionally complete as a demonstration EHR/RCM system when:

1. A user can create/edit a patient and insurance record.
2. Eligibility can be run and viewed from the patient and appointment workflows.
3. An appointment can be scheduled, changed, checked in, and started as an encounter.
4. An encounter can be documented with diagnosis/service lines and signed.
5. Signing drives a billing-readiness audit.
6. Billing can resolve holds and create a claim from a ready encounter/charge.
7. A claim can be scrubbed, batched, submitted, accepted/rejected, corrected, and status-checked.
8. ERA/payment data can be imported/entered, matched, allocated, and posted.
9. Denials can be worked and appealed.
10. Exceptions create actionable work items linked to their source records.
11. Credentialing and authorization issues can block billing and are resolvable from their own operational modules.
12. Mailroom items can be classified, linked, assigned, and resolved.
13. Reports summarize operational and financial performance and drill into source workspaces.
14. No major user-facing module is merely a generic raw-table viewer.
15. The primary demo stories contain populated linked data from beginning to end.
16. The deployed Vercel application passes build and live workflow verification.

## 15. Explicit Non-Goals During Initial Rebuild

The initial rebuild does not require:

- real clearinghouse credentials,
- live 270/271/837/835 transmission to a production vendor,
- real patient PHI,
- real payment processing,
- full e-prescribing,
- laboratory interfaces,
- inpatient/facility EHR functionality,
- replacing Supabase with another backend,
- rewriting the frontend in another framework.

Synthetic adapters may demonstrate transaction behavior until real vendor integration is intentionally undertaken.

## 16. Migration Strategy

The current production demo remains deployable during the rebuild.

Implementation should replace generic modules incrementally behind stable routes. Existing live routes are preserved where practical. New domain services and screens are introduced one workflow slice at a time. Once a purpose-built screen fully replaces a generic renderer, the old generic implementation is removed.

Database migrations must be additive and defensive. Existing synthetic records are preserved unless a deliberate demo reseed is part of the phase. Schema changes and seed changes are kept separate where practical.

## 17. Source-of-Truth Rule

When older Therassistant repositories disagree:

1. this specification controls product behavior,
2. the current Supabase schema controls existing storage unless this specification explicitly adds a new model,
3. the older repos are implementation/UX references,
4. current payer/legal requirements are not inferred from old demo logic,
5. production payer policy is not hard-coded from synthetic examples.

This rule prevents the rebuild from reproducing historical inconsistencies while preserving the best prior work.
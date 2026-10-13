# THERASSISTANT EHR Workflow-Centered UI Redesign Spec

## Goal

Redesign the staff EHR and patient portal around the actual behavioral-health workflow while preserving and verifying the underlying data and billing connections. The result must reduce empty space, make the next operational action obvious, and eliminate visual states that imply a workflow is connected when the data is not actually available downstream.

## Governing Workflow

Schedule → Patient Portal Check-In → Pre-Visit Screeners → Telehealth/Arrival → Encounter → Clinical Note → Save Draft → Sign & Lock → Billing Ready → Charge Capture → Claim Scrub → Claim Submission → Payment / Rejection / Denial Follow-Up.

Every major screen must expose where the current item is in this lifecycle and what action is next.

## Non-Negotiable Requirements

1. **No visual-only fixes.** Every redesigned control must be traced to the repository/API/database behavior it invokes.
2. **Dense clinical/operational layouts.** Full-width workflow screens such as schedule, patient chart, encounter, charge capture, and claims should use the available canvas; avoid oversized cards and decorative blank space.
3. **Portal screeners must reach clinicians.** PHQ-9, GAD-7, and C-SSRS responses completed during pre-visit check-in must be visible in the patient review and clinical encounter workspace with submitted-state provenance. Clinicians must not be told to review data that the workspace does not actually render.
4. **Pre-visit import must preserve provenance.** Patient-authored content imported into a note must be labeled as patient-reported and must not silently become clinician-authored findings.
5. **Telehealth must be an actual connected workflow.** A telehealth appointment must have a generated room/session through a configured video provider rather than depending on staff pasting an arbitrary URL. After a patient completes and submits pre-visit questions, the patient must transition directly into the visit experience when a telehealth room is available.
6. **HIPAA configuration is a deployment gate.** The initial embedded provider target is Daily. Production PHI use is allowed only after the THERASSISTANT Daily account has the required healthcare/HIPAA configuration and BAA. Until that configuration is present, the UI must show video as unavailable rather than silently falling back to a non-compliant path.
7. **Save Draft and Sign & Lock remain separate.** Save persists editable documentation. Sign & Lock may only sign the already-saved clinical record and must refuse unsaved changes.
8. **Signed clinical documentation remains immutable.** Billing corrections after signature happen through billing/claim workflow controls, not by silently editing signed clinical text.
9. **Clinical coding should not dominate the note.** Clinicians see visit coding in a compact panel; billing staff can access detailed correction workflows downstream.
10. **Patient-facing language must remain patient-facing.** Do not expose internal RCM terminology in the portal where simpler patient language is appropriate.
11. **Existing wiring should be consolidated, not duplicated.** Reuse the existing repositories, status badges, drawers, tables, route structure, treatment-plan context, and billing logic rather than creating parallel systems.

## Information Architecture

### Global staff navigation

- Home: Dashboard, Schedule, Patients, Clinical
- Revenue Cycle: Charges, Claims, Payments, Denials
- Practice: Providers, Credentialing, Messaging, Patient Portal, Reports
- Administration: Practice Setup, Users & Roles, Imports, Audit, Settings

### Patient chart

Persistent patient banner with name, DOB, pronouns/MRN where available, payer/coverage state, eligibility state, patient balance, next appointment, and primary actions.

Primary tabs: Overview, Clinical, Visits, Insurance, Billing, Documents, Portal. Demographics should be edited from a focused drawer rather than consuming a top-level workflow tab.

### Schedule

The appointment drawer is the command center for readiness: patient identity, appointment details, registration/insurance/eligibility, consent/check-in, pre-visit answers/screeners, patient focus, telehealth readiness, and Open Chart / Start Encounter actions.

### Clinical work queue

Needs Note and In Progress should be action-oriented work lists. Signed and All may remain denser history tables. Starting/resuming documentation should transition into the encounter workspace without feeling like a disconnected application.

### Encounter / clinical note

Two-column clinical workspace:
- Main column: note type, treatment goal, note editor, structured documentation tools.
- Context column: pre-visit answers and screeners, prior visit, treatment plan, journal, documents.

Persistent status/action area: Unsaved Changes → Save Draft → Saved → Sign & Lock.

### Patient portal

Portal home prioritizes the next appointment, check-in readiness, and telehealth join state. Check-in is a stepper: Demographics → Insurance → Visit Questions / Screeners → Consents → Review & Submit. For telehealth visits, successful submission transitions to the embedded visit experience when the room is ready.

### Revenue cycle

Charge Capture should read as a pipeline: Needs Review → Ready → Charges → Claims → Batches, with exceptions separated from normal work. Claims should expose lifecycle states: Draft, Scrub Failed, Ready to Submit, Submitted, Accepted, Rejected, Paid, Denied. Claim detail should place correction controls next to the error/field that needs attention.

## Design System

Consolidate around reusable workflow primitives: PageHeader, PatientBanner, StatusBadge, MetricStrip, WorkDrawer, DataTable, WorkList, DetailPanel, ActionBar, EmptyState, AlertBanner, ExceptionCard, Timeline, Stepper.

## Verification Standard

A feature is not considered complete because its component renders. Completion requires tests or direct verification that data moves through the intended workflow. The release acceptance path must include at minimum:

1. Create/open telehealth appointment.
2. Patient completes pre-visit answers and screeners.
3. Patient submits check-in and enters the configured video visit.
4. Staff appointment review shows the submitted answers/screeners.
5. Provider opens the encounter and can review/import patient-authored context.
6. Provider saves the note.
7. Sign & Lock refuses unsaved changes, then signs the saved note.
8. Signed encounter reaches billing readiness.
9. Charge is created without modifying the signed note.
10. Claim is created/scrubbed and any error links back to the correct source field/workflow.

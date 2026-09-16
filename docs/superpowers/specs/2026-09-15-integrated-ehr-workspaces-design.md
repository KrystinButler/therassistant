# THERASSISTANT Integrated EHR Workspaces Design

Date: 2026-09-15
Status: Approved design direction
Repository: `KrystinButler/therassistant`
Branch: `feature/integrated-ehr-workspaces`

## Goal

Integrate the supplied THERASSISTANT design references into the existing EHR as real, data-connected workflows rather than static mockups. Preserve the current workflow spine, routes, repositories, Supabase-backed data model, business rules, and permanent 360-degree records. Upgrade the user experience so the product feels like one coherent behavioral-health EHR from patient portal through clinical documentation and revenue cycle.

This specification extends the existing canonical EHR/RCM design and the approved Work Drawer architecture. It does not replace either specification.

## Core interaction rules

1. Pages remain persistent workspaces and permanent records.
2. Operational editing and focused review use right-side `WorkDrawer` surfaces.
3. Existing repositories and workflow functions remain authoritative.
4. Human-readable names, claim numbers, dates, statuses, payer names, CPT/ICD codes, and other operational identifiers are shown instead of UUIDs.
5. Patient-authored information is visibly distinguished from provider-authored clinical documentation.
6. Pre-submission validation is distinct from post-submission rejection handling. `Action Required` is reserved for submitted claims that receive clearinghouse/payer rejection responses.
7. The UI teaches the provider or biller why an issue matters and the exact next correction required.
8. Existing routes remain valid even where a drawer becomes the primary operational interaction.

## Visual system

Use the supplied screenshots as the layout and information-density target, not as pixel-for-pixel copies. Preserve THERASSISTANT branding and the existing design tokens/classes where practical.

Required visual character:

- navy primary text/actions,
- sage/green readiness and success states,
- restrained blue informational surfaces,
- amber warning/hold states,
- red blocking/rejection states,
- compact cards and tables with generous section spacing,
- readable status badges,
- persistent left navigation on staff workspaces,
- clean patient-facing portal navigation,
- responsive behavior that collapses multi-column layouts without hiding required actions.

Do not introduce another component library solely for this redesign.

## 1. Provider Schedule Workspace

### Existing route

`/schedule`

### Design target

Transform the current schedule into the supplied provider schedule concept while retaining Day, Week, and Month modes.

The Day view becomes the primary clinical operating view. Each row shows:

- appointment time,
- patient name and pronouns when available,
- check-in state,
- concise pre-visit insight,
- whether a journal/check-in item is available,
- session focus derived from treatment plan/goals and prior session context,
- readiness/status indicators.

The row remains backed by the same appointment records and schedule repository. Filters and view controls continue to work.

### Patient Review Drawer

Selecting a patient/appointment opens `PatientReviewDrawer` using `WorkDrawer` instead of navigating away.

The drawer shows:

- patient identity and appointment time,
- check-in summary,
- patient-reported mood and recent changes,
- most recent shared journal entry,
- session focus,
- active treatment goal,
- prior-session plan,
- safety review,
- visit readiness.

Primary actions:

- Open Chart
- Start Note / Start Encounter

The schedule remains mounted behind the drawer and retains date, mode, filters, and scroll position when the drawer closes.

## 2. Patient Portal Experience

The existing `/patient-portal/:clientId` remains the portal root and data source. Add focused portal sub-routes while retaining root compatibility:

- `/patient-portal/:clientId/journal`
- `/patient-portal/:clientId/check-in/:appointmentId`
- `/patient-portal/:clientId/access`

### 2.1 In-Between Session Journal

Create a patient-facing journal workspace based on the supplied concept.

Required fields and behavior:

- free-text reflection,
- mood selection,
- symptoms/tags,
- related treatment goal when available,
- sharing choice with provider,
- save draft where supported by current data; otherwise save as an unpublished/private entry until submitted,
- recent-entry list with visibility state.

Patient-authored journal content does not automatically become part of a signed clinical note. Shared entries become visible in provider pre-session context and can be explicitly imported into the clinical note.

### 2.2 Pre-Visit Check-In

Create a guided check-in page for a specific upcoming appointment.

Sections:

- Demographics
- Insurance
- Visit Questions
- Consents & Acknowledgments
- Review & Submit

The first two sections summarize existing data and indicate completion. Visit Questions collect patient-facing clinical context such as today's focus, mood since last visit, meaningful changes, safety concerns, goal relevance, and information the patient wants the provider to know.

Submitting check-in updates the appointment/check-in state consumed by the provider schedule and Patient Review Drawer.

### 2.3 Balance Access Restriction

Add a portal access gate using the supplied balance-restriction design.

When the patient's open balance exceeds the practice-configured threshold, restricted portal functionality requires one of three actions:

- make a payment,
- set up a payment plan,
- submit an exception request.

The restriction component must not hard-code a dollar threshold into the page. It reads the configured practice threshold and current patient responsibility balance.

Until a full payment processor/payment-plan backend is connected, the implementation must clearly separate supported record actions from unavailable external payment processing. Do not simulate successful payment transactions that did not occur.

## 3. Clinical Encounter Workspace

### Existing route

`/encounters/:id`

Refactor the current encounter page into the supplied split-screen clinical workspace without changing the encounter-centered business model.

### Workspace shell

Top context bar:

- patient,
- encounter/session state,
- DOB/age when available,
- service type,
- session date/time,
- provider.

Primary tabs:

- Progress Note
- Patient Info
- Treatment Plan
- Attachments

On wide screens, the left area is the session panel and the right area is documentation/context. On smaller screens, the layout stacks without losing access to note actions.

### Telehealth panel

This phase provides the THERASSISTANT session workspace and media container but does not introduce a new telehealth vendor. Existing appointment/encounter data drives the session shell. Demo/synthetic media may be used for the synthetic demo environment, but no UI should imply that a real video session is occurring unless a real media integration is present.

### Structured SOAP editor

Replace the single undifferentiated note editing experience with sections:

- Subjective
- Objective
- Assessment
- Plan

To preserve the existing clinical-note storage model, the first implementation may use a deterministic adapter that serializes these sections into the existing note text field. Existing unstructured notes remain readable and must not be destructively re-parsed.

Patient-submitted content appears as separate import cards. Importing content copies it into the chosen clinical section; it does not silently modify the note.

### Today's Focus

Display the current visit focus derived from active treatment goals, prior plan, check-in, and shared journal context. The clinician can edit the focus without changing the source records unless the corresponding workflow action is explicitly chosen.

## 4. Treatment Plan and Post-Session Review

Within the encounter route, the Treatment Plan tab presents:

- active diagnosis,
- plan start/review dates,
- treatment modality/frequency,
- treatment-plan summary,
- goals and measurable objectives,
- objective status,
- target dates,
- connection between today's session and active goals.

When an encounter is completed, the session panel changes to a clear `Session Ended` state while the clinical workspace remains available for final review.

The clinician can review/update the treatment plan before signing the note. Treatment-plan edits must use the existing treatment-plan repository/workflow rather than changing records locally in the component.

## 5. Documentation and Coding Readiness

Before signature, the Progress Note workspace presents a coding/readiness panel beside the note.

Required review items include:

- service type,
- CPT/HCPCS,
- units,
- time/duration,
- diagnosis,
- place of service,
- telehealth modifier when applicable,
- authorization status,
- documentation completeness,
- connection to treatment plan/goals.

Signing preserves the existing rule: the signed note is locked, the encounter completes, and billing readiness is evaluated. Signing does not directly submit a claim.

Primary actions:

- Save Draft
- Sign Note
- Sign & Ready for Charge Capture, where the workflow prerequisites are satisfied

If readiness blocks handoff, the user sees the blocking reason and correction location instead of a generic failure message.

## 6. Charge Capture Workqueue

### Existing route

`/billing/charges` and compatible `/charges`

Redesign the current billing queue into the supplied Charge Capture Workqueue concept.

Workspace requirements:

- metric cards for Ready for Claim, Validation Hold, Returned to Provider, Credentialing Hold, Authorization Hold,
- date range, payer, provider, status, and search filters,
- operational table showing patient, DOS, provider, payer, service, units, charge, and readiness,
- readable hold reasons rather than raw identifiers.

Selecting a charge opens `ChargeReviewDrawer`.

### Charge Review Drawer

Sections/tabs:

- Details
- Validation
- Authorization
- Payer
- History

Validation displays each billing-readiness check with pass/warn/fail state. Missing authorization, provider participation, coding, documentation, or payer requirements receive a specific explanation and direct remediation action.

Drawer actions reuse or extend domain workflow functions for legitimate state transitions. Do not implement status changes as arbitrary client-side assignments.

## 7. Claim Rejection Workqueue

### Existing route

`/claims`, Rejections tab

Create the supplied rejection-focused operating view while preserving the larger Claims workspace.

The Rejections tab shows:

- Action Required
- In Correction
- Ready to Resubmit
- Resolved

Each row displays patient, DOS, payer, claim/control number, rejection code, rejection reason, required correction, and current status.

Selecting a row opens the existing/planned `ClaimWorkDrawer` directly to its Rejection section.

### Rejection Resolution

For each rejection, show:

- rejection code and source,
- plain-language explanation,
- why it matters,
- exact claim field that must change,
- current value,
- editable corrected value,
- payer-rule link/context when available,
- resubmission action.

Field targeting uses stable semantic claim-field keys. Example: a missing telehealth modifier opens the claim line editor and focuses the Modifier field rather than presenting a disconnected instruction.

`Action Required` applies only after a submitted claim receives a clearinghouse/payer rejection. Validation failures before submission remain Validation Hold/Validation Failed.

## 8. Shared Components

Prefer reusable focused components rather than monolithic page files.

Planned components include:

- `WorkDrawer` (reuse approved architecture)
- `PatientReviewDrawer`
- `PortalShell`
- `JournalEntryComposer`
- `PreVisitCheckInForm`
- `PortalAccessGate`
- `EncounterWorkspaceShell`
- `SoapSectionEditor`
- `PatientSubmittedCard`
- `TreatmentPlanPanel`
- `CodingReadinessPanel`
- `ChargeReviewDrawer`
- `ClaimRejectionPanel`
- shared readiness/check cards and compact status summaries

Each component receives typed domain data and calls workflow/repository functions through its parent/domain layer. Presentation components must not directly query arbitrary Supabase tables.

## 9. Data and repository strategy

Reuse current repositories first. Add domain query functions only where the existing screen lacks aggregated context.

Likely additions:

- schedule appointment pre-visit summary aggregation,
- patient portal journal/check-in detail queries,
- portal access/threshold query,
- encounter patient-submitted-context aggregation,
- charge validation-detail aggregation,
- rejection-to-field correction metadata.

Do not create parallel copies of patient, appointment, encounter, claim, or charge data solely for the new screens.

If a required concept does not currently exist in storage, add the smallest explicit data model needed and document it before migration. Examples may include structured check-in answers, patient sharing state, balance exception requests, or practice-level balance threshold configuration.

## 10. Error handling

Operational errors appear inside the relevant workspace or drawer with actionable language.

Examples:

- failed save retains entered values,
- failed validation does not advance the queue,
- failed encounter start leaves the schedule state intact,
- failed signature does not mark documentation complete,
- failed correction does not mark a rejection ready to resubmit.

No browser `alert()` or `prompt()` interactions should be introduced.

## 11. Accessibility and responsive behavior

- keyboard-accessible drawer and tab navigation,
- visible focus indicators,
- proper labels for all form controls,
- status information conveyed by text/icon as well as color,
- sticky drawer headers/footers,
- mobile layouts that retain critical actions,
- return focus to the initiating schedule/charge/claim row when a drawer closes where possible.

## 12. Implementation sequence

Implement in connected vertical slices so every completed phase remains usable.

### Phase A — Shared layout foundation

- verify/reuse `WorkDrawer`,
- shared compact cards/status styles,
- portal shell,
- clinical workspace shell.

### Phase B — Provider Schedule + Patient Review

- redesign Schedule Day view,
- aggregate pre-visit insight,
- implement Patient Review Drawer,
- preserve existing appointment actions and filters.

### Phase C — Patient Portal

- journal page,
- guided pre-visit check-in,
- shared portal state/navigation,
- balance access gate.

### Phase D — Encounter + SOAP + Treatment Plan

- split encounter workspace,
- structured SOAP editor adapter,
- patient-submitted context/import,
- treatment-plan tab,
- session-complete state.

### Phase E — Coding Readiness

- coding details panel,
- documentation completeness,
- sign/handoff flow,
- direct correction messaging.

### Phase F — Charge Capture

- workqueue redesign,
- Charge Review Drawer,
- validation/authorization/payer context,
- workflow actions.

### Phase G — Claim Rejections

- rejection workqueue presentation,
- rejection-resolution drawer section,
- field-target corrections,
- corrected claim resubmission flow.

### Phase H — Integration verification

- role/workspace navigation,
- responsive review,
- patient-to-claim workflow smoke tests,
- no raw UUID regressions,
- no broken existing routes.

## 13. Testing requirements

Every phase must pass:

- TypeScript/typecheck,
- production build,
- affected unit/workflow tests,
- route smoke tests,
- loading/empty/error states,
- drawer open/close behavior,
- preservation of filters/search/tab/page after drawer close,
- keyboard navigation for new interactive surfaces,
- responsive checks at desktop/tablet/mobile widths.

Workflow-specific tests must cover:

- check-in data appearing in Patient Review,
- shared journal data appearing in pre-session context,
- importing patient-authored content without silently signing it,
- signature locking the note and invoking billing readiness,
- blocking readiness preventing charge handoff,
- charge validation reasons rendering correctly,
- rejection correction targeting the intended claim field,
- pre-submission validation never using the post-submission `Action Required` label.

## 14. Non-goals for this phase

- replacing Supabase,
- changing the canonical patient/encounter/claim workflow model,
- introducing a new UI framework,
- introducing a new telehealth vendor,
- implementing a payment processor without an approved integration,
- replacing permanent patient/claim/provider detail routes,
- copying screenshot-specific synthetic names/data into production records,
- exposing internal IDs to make the screenshots easier to reproduce.

## Acceptance criteria

The work is complete when the reference experiences are recognizably integrated into THERASSISTANT; they use the application's real synthetic/demo records and workflow functions; the provider can move from schedule to pre-session context to encounter documentation to billing readiness; the biller can move from charge readiness to claim/rejection correction; the patient can use the journal and check-in flows; drawer-based work does not destroy workspace state; and existing routes/build/tests remain healthy.
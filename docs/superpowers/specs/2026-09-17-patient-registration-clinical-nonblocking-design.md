# Patient Registration and Nonblocking Clinical Workflow Design

Date: 2026-09-17
Status: Approved design

## Goal

Finish Therassistant patient creation using the existing Patients work drawer and Supabase foundation while enforcing one system-wide rule:

> Administrative or revenue-cycle problems may create warnings, work items, billing holds, or claim holds, but they must never prevent scheduling, starting an encounter, documenting care, completing a treatment plan, signing a clinical note, or completing a visit.

Clinical care and administrative readiness are separate tracks.

## Existing Foundation

The existing Patients page already:

- Opens an Add Patient work drawer.
- Creates tenant-scoped records in `public.clients` through the authenticated tenant data client.
- Initializes new patients with `billing_readiness_status = 'not_ready'`.
- Provides Patient 360 with insurance, appointments, encounters, treatment plans, notes, charges, claims, payments, denials, and work items.

Supabase already provides:

- `clients` for demographics and registration/billing state.
- `client_contacts` for emergency/responsible-party contacts.
- `client_insurance_policies` for primary/secondary/tertiary coverage.
- `workqueue_items` for operational exceptions.
- Separate appointment, encounter, clinical-note, treatment-plan, charge, claim, authorization, eligibility, payment, and denial records.

## Product Rule: Clinical Work Is Never Administratively Blocked

The following actions must remain available even when registration, insurance, eligibility, authorization, credentialing, or billing information is incomplete:

- Create/schedule an appointment.
- Check in a patient.
- Start an encounter.
- Create or edit a clinical note.
- Create or update a treatment plan.
- Sign a clinical note.
- Complete the clinical encounter.

Administrative conditions may instead:

- Display a nonblocking warning to staff/clinicians.
- Set or update `billing_readiness_status`.
- Create or reopen an appropriate `workqueue_item`.
- Prevent a charge or claim from advancing beyond a revenue-cycle validation point when required data is missing.
- Prevent claim submission when claim-critical data is incomplete or invalid.

No clinical UI control may be disabled solely because `registration_status`, `billing_readiness_status`, insurance status, eligibility status, authorization status, payer participation, or credentialing status is unfavorable or incomplete.

## Patient Creation UX

The existing Add Patient drawer becomes the registration entry point. It remains one drawer rather than introducing a separate registration application.

### Patient Information

Required for the initial workflow:

- First name
- Last name
- Date of birth
- Sex
- Address line 1
- City
- State
- Postal code
- Phone
- Email

Optional:

- Middle name
- Preferred name
- Address line 2

New patients start as:

- `client_status = 'intake'`
- `registration_status = 'in_progress'`
- `billing_readiness_status = 'not_ready'`

The UI must not default a newly entered patient to `active` + `complete`.

### Emergency Contact

Optional at creation unless organizational policy later makes it required:

- Contact name
- Phone
- Relationship to patient

This creates a `client_contacts` row with `is_emergency_contact = true`.

### Primary Insurance

Primary insurance is part of the same drawer but administrative incompleteness does not prevent saving the patient.

Fields:

- Insurance company / payer
- Plan
- Product when available
- Member ID
- Group number
- Subscriber first name
- Subscriber last name
- Subscriber DOB
- Subscriber sex
- Subscriber address
- Subscriber phone
- Relationship to subscriber

When relationship is `self`, subscriber demographic fields are populated from the patient and remain synchronized at initial creation.

A completed primary policy is inserted into `client_insurance_policies` with:

- `insurance_order = 'primary'`
- `status = 'pending_verification'`

If required insurance fields are incomplete, the patient can still be saved. Therassistant keeps billing readiness non-ready and creates an administrative work item rather than blocking clinical care.

### Secondary Insurance

Secondary insurance is optional and uses the same field model. When entered, it is saved with `insurance_order = 'secondary'` and `status = 'pending_verification'`.

## Data Model Changes

### `clients`

Add a structured patient sex field. The database should support standards-compatible values while the initial UI presents the user-required M/F choices. Do not store patient sex only in JSON metadata.

### `client_insurance_policies`

Replace the current single `subscriber_name` dependence with structured subscriber demographic columns sufficient for eligibility and claim generation:

- subscriber_first_name
- subscriber_last_name
- subscriber_sex
- subscriber_address_line1
- subscriber_address_line2
- subscriber_city
- subscriber_state
- subscriber_postal_code
- subscriber_phone

Retain `subscriber_name` during migration for backward compatibility until all consumers have moved to the structured fields.

Existing `subscriber_dob` and `relationship_to_subscriber` remain.

### Work Queue

Add or use a registration-specific administrative work-item type. Preferred design: add `registration_issue` to `workqueue_type_enum` so incomplete demographics/insurance are distinguishable from generic tasks.

Examples:

- Missing primary member ID
- Missing subscriber demographics
- Patient address incomplete
- Insurance pending verification

Eligibility issues continue to use `eligibility_issue`; authorization issues use `authorization_issue`; credentialing issues use credentialing work types; claim validation remains downstream.

## Atomic Save

Patient registration must be saved through one tenant-aware database transaction/RPC rather than several unrelated browser inserts.

Input includes:

- Patient demographics
- Optional emergency contact
- Optional primary insurance
- Optional secondary insurance

The transaction must:

1. Validate tenant access from the authenticated user.
2. Insert the patient.
3. Insert optional contact rows.
4. Insert each supplied insurance policy.
5. Calculate initial registration and billing-readiness states.
6. Create administrative work items for incomplete revenue-cycle data when appropriate.
7. Return the new patient ID and resulting status values.

If a database write fails, the transaction rolls back so partial registration records are not left behind.

## Registration vs Billing Readiness

These statuses must remain independent.

`registration_status` describes completion/review of registration information.

Existing values remain:

- not_started
- in_progress
- pending_review
- complete
- needs_correction
- archived

`billing_readiness_status` is explicitly revenue-cycle state, not permission to provide care.

Existing values remain:

- not_ready
- missing_insurance
- missing_diagnosis
- missing_authorization
- missing_signed_note
- ready_for_charge
- ready_for_claim

A patient may therefore be clinically active while billing readiness is `missing_insurance`, `missing_authorization`, or another non-ready state.

## Clinical Warning Behavior

Clinical screens may show a compact administrative warning area such as:

- Insurance verification pending
- Authorization missing
- Registration needs correction
- Billing not ready

Warnings must be informational and must link to the relevant work item or patient administrative section when possible.

Warnings must not disable clinical actions.

## Revenue-Cycle Gates

Hard stops belong only at the appropriate administrative/revenue-cycle stage.

Examples:

- Missing insurance may hold payer billing.
- Missing diagnosis may prevent charge/claim advancement where diagnosis is required.
- Missing authorization may hold the affected charge/claim for review.
- Unsigned documentation may prevent billing advancement where a signed note is required.
- Claim validation errors may prevent claim submission.

These holds must not retroactively prevent the appointment, encounter, note, treatment plan, signature, or visit completion.

## Patient 360

After creation, the user may open Patient 360. The existing tabs remain the record spine:

- Overview
- Encounters
- Insurance
- Appointments
- Treatment Plans
- Clinical Notes
- Charges
- Claims
- Payments
- Denials
- Work Items

The Overview should make the separation visible by showing clinical/patient status separately from registration and billing readiness.

## Testing Requirements

Tests must prove the rule rather than rely on UI convention.

Required coverage:

- Patient creation persists demographics, contact, and insurance atomically.
- Self-subscriber copies patient demographics into structured subscriber fields.
- Incomplete insurance can still create a patient.
- Incomplete insurance creates/maintains an administrative work item and non-ready billing state.
- A patient with `billing_readiness_status = 'missing_insurance'` can still be scheduled.
- A patient with an authorization issue can still start an encounter.
- A patient with registration corrections can still create/edit/sign a clinical note.
- Clinical completion does not automatically clear administrative work.
- Claim submission remains blocked when claim-critical validation fails.
- Tenant/RLS isolation remains intact.

## Migration and Compatibility

- Apply schema changes through Supabase migrations.
- Mirror production migrations in the repository.
- Preserve old subscriber data during structured-field migration.
- Do not delete or reinterpret existing patient records.
- Do not change patient-facing portal authentication in this feature.
- Do not add broad security/refactor work unrelated to patient registration and the nonblocking clinical rule.

## Success Criteria

The feature is complete when staff can create a patient with the requested demographics, emergency contact, and primary/secondary insurance in one workflow; administrative deficiencies are surfaced as work instead of clinical blocks; Patient 360 reflects the new record; and automated tests demonstrate that administrative problems cannot disable or reject core clinical workflow actions.
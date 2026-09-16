# Therassistant RCM Workqueue Consolidation Design

Date: 2026-09-16

## Purpose

Replace the current mix of workspaces, work centers, follow-up pages, validation queues, and overlapping A/R/denial workflows with a single workqueue-based revenue-cycle model.

The product model will be:

- Records/reference pages for entities such as patients, providers, payers, schedules, reports, and administration.
- Workqueues for operational work.
- No Work Center.
- No workspace terminology in the operational RCM experience.
- One canonical workflow for each type of work.

## Core RCM Flow

Signed Note -> Charges -> Submission -> Accepted/Rejected

- Accepted claims enter Claims.
- Rejected claims enter Rejections.
- Claims remain in Claims while outstanding.
- Paid claims complete through payment posting.
- Denied claims enter Denials.

## Canonical Operational Areas

### Charges

Charges enter this area automatically after the clinical note is signed.

Charges owns all pre-submission billing activity:

- Charges waiting to be billed.
- Charges batched by payer.
- Electronic claim submission.
- 837P generation and download.
- CMS-1500 printing.
- Batch/submission status.

Canonical progression:

Signed Note -> Charge Created -> Ready -> Batched by Payer -> Submitted / 837P Downloaded / CMS-1500 Printed

There will not be a separate Claim Submission workqueue or workflow.

### Rejections

Validation and rejection are one workflow.

Any issue that prevents successful claim submission or causes a submitted claim to be rejected enters Rejections for correction.

Rejections are organized first by payer, then by the field/error category that requires attention. Categories should be generated from normalized rejection guidance rather than duplicated as payer-specific hard-coded pages.

Expected rejection categories may include:

- Patient information.
- Subscriber information.
- Provider information.
- Payer information.
- Diagnosis.
- Procedure/modifier.
- Authorization-related claim data.
- Claim format.
- Other.

A claim with multiple unresolved rejection errors may appear in more than one correction-category tab because each unresolved field/error requires work, but it still has only one operational home: Rejections.

Correction lifecycle:

Rejected -> Corrected -> Resubmitted -> Removed from Rejections

There will not be separate Claim Validation, Validation Errors, Clearinghouse Rejections, or Claim Correction workqueues.

### Claims

Claims is the primary insurance follow-up area.

There is one workqueue per payer.

Each payer workqueue contains these tabs:

- No Response.
- Deferred.
- 0-30 Days.
- 31-60 Days.
- 61-90 Days.
- 91-120 Days.
- 120+ Days.

This replaces separate Claim Follow-Up, Insurance A/R, aging, and generic claim follow-up workflows.

A claim appears in only one Claims tab at a time. Tab assignment follows this precedence:

1. Deferred, when the claim is intentionally deferred.
2. No Response, when the submitted claim has no payer/clearinghouse response state recorded.
3. Otherwise, the appropriate aging bucket using the existing Claims/A/R aging calculation.

Claim disposition:

- Paid -> payment posting / complete.
- Denied -> Denials.
- Rejected -> Rejections.
- Deferred -> Deferred tab.
- Outstanding -> appropriate aging tab.
- No payer response -> No Response tab.

### Denials

Denials contains adjudicated claims with payer denial CARC codes.

There is one workqueue per payer.

Within each payer queue, tabs are driven by mapped CARC denial reason/category. Denial categorization should come from CARC mapping logic, not arbitrary duplicated UI categories.

Examples may include:

- Eligibility.
- Authorization.
- Timely filing.
- Duplicate.
- Bundling.
- Medical necessity.
- Provider enrollment.
- Coverage.
- Coding.
- Coordination of benefits.

Every payer denial queue also includes these special tabs:

- Corrected Claims.
- Appeals.
- Deferred.

A denial appears in only one Denials tab at a time. Tab assignment follows this precedence:

1. Deferred.
2. Appeals, when formal appeal work is active.
3. Corrected Claims, when the denial is being resolved through a corrected claim.
4. Otherwise, the mapped CARC denial-reason tab.

Appeals are not a separate top-level operational area. Appeals are a denial disposition/work type inside Denials.

## Revenue Cycle Navigation

The primary operational RCM navigation becomes:

- Charges.
- Rejections.
- Claims.
- Denials.
- Payments.

Record/reference pages remain outside this operational workqueue list as appropriate.

## Removed Operational Concepts

The implementation will remove or retire these independent workflows/surfaces:

- Work Center.
- Work Center route.
- Workspace terminology in RCM navigation and page naming.
- Claim Follow-Up as an independent workflow.
- Claim Validation as an independent workflow.
- Separate Clearinghouse Rejections workflow.
- Separate Claim Correction workflow.
- Authorization Workqueue.
- Separate Appeals workflow.
- Separate Insurance A/R workflow.
- Separate Claim Submission workflow.
- Duplicate Charges route/implementation.
- Duplicate legacy generic workflow implementations that are no longer canonical.

Authorization data may remain available on patient/encounter/claim records where clinically or operationally relevant, but there is no standalone Authorization workqueue.

## Existing Functionality to Preserve

The consolidation must reuse existing working business logic where possible instead of deleting useful behavior.

Preserve and relocate as needed:

- Claim validation/correction guidance, but surface it through Rejections.
- 837P generation/submission behavior, but surface it through Charges.
- Clearinghouse response parsing.
- Denial CARC/RARC data.
- Corrected claim actions.
- Appeal creation/submission/outcome functions, but surface them under Denials > Appeals.
- Deferred state/history.
- Payment posting behavior.
- Claim and provider record detail pages.
- Existing audit/history data.

## Routing Rules

Canonical routes should represent the new workqueue model.

Expected operational routes:

- /billing/charges
- /rejections
- /claims
- /denials
- /payments

Legacy duplicate routes should either be removed or redirected to the appropriate canonical route during migration. They must not continue rendering independent workflow implementations.

Examples to retire include:

- /work-center
- /claims/follow-up
- /claims/submission as a standalone work area
- /ar-denials as the mixed A/R/denials workspace
- /charges as a second Charges implementation

Existing record-detail routes such as /claims/:id may remain.

## Queue Ownership Rules

Each claim or charge should have one primary operational home at a time.

- Pre-submission charge work -> Charges.
- Submission-blocking/correction work -> Rejections.
- Submitted and outstanding insurance follow-up -> Claims.
- Adjudicated denial work -> Denials.
- Posted remittance/payment work -> Payments.

A record may be visible from a 360/detail page in multiple contexts, but only one workqueue owns the active operational task.

## UI Rules

- Do not create a universal Work Center.
- Do not create another abstract workspace layer around queues.
- Payer is the primary grouping for Charges batching, Claims, Rejections, and Denials where applicable.
- Queue tabs represent actionable disposition/aging/reason categories.
- Detail drawers/360 pages may expose related history, but they must not duplicate queue ownership.
- Labels in navigation and page headers should use Workqueue only where the screen is actually a queue.

## Data/State Expectations

Implementation should normalize operational routing using existing claim/charge status, clearinghouse response, CARC/RARC, payer, age, and deferred/appeal state.

No duplicate database state should be introduced solely to support the new navigation.

Where an existing generic work-item record is still useful for audit/history, it may remain internally, but it must not require or recreate a separate Work Center UI.

## Migration Strategy

1. Establish the canonical queue ownership rules in code.
2. Consolidate Charges submission behavior.
3. Consolidate validation and clearinghouse correction behavior into Rejections.
4. Consolidate insurance follow-up and aging into payer-specific Claims queues.
5. Consolidate CARC-driven denial, corrected claim, appeal, and deferred behavior into Denials.
6. Update navigation and route ownership.
7. Redirect/remove legacy duplicate routes.
8. Delete dead legacy components only after imports and tests confirm they are unused.
9. Update automated tests to assert the new canonical routes and prevent duplicate workflow surfaces from returning.

## Acceptance Criteria

The consolidation is complete when:

- No Work Center is visible or routable as an independent operational surface.
- Revenue-cycle navigation exposes Charges, Rejections, Claims, Denials, and Payments as the primary operational areas.
- A signed note produces a charge that is worked and submitted from Charges.
- Charges can be batched by payer and submitted electronically, downloaded as 837P, or printed to CMS-1500 from the same area.
- Validation failures and clearinghouse rejections are corrected through one Rejections flow.
- Rejections are grouped by payer and correction field/category.
- Claims has one queue per payer with No Response, Deferred, 0-30, 31-60, 61-90, 91-120, and 120+ tabs.
- A claim appears in only one Claims tab at a time.
- Denials has one queue per payer and is organized by CARC-driven denial reasons.
- Denials includes Corrected Claims, Appeals, and Deferred tabs.
- A denial appears in only one Denials tab at a time.
- Authorization has no standalone workqueue.
- Claim Follow-Up, separate Insurance A/R, separate Appeals, separate Claim Submission, and duplicate Charges implementations no longer exist as independent workflows.
- Existing underlying claim, denial, appeal, submission, correction, payment, and audit behavior remains functional after consolidation.
- Automated tests cover the canonical workqueue routing and prevent reintroduction of duplicate workflow pages.

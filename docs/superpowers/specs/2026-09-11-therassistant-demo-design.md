# Therassistant Working Demo Design

## Purpose

Convert the existing Therassistant database-inventory viewer into a working interactive demo that demonstrates the unique clinical, revenue-cycle, payer-operations, compliance, and multi-practice capabilities of Therassistant.

The demo will use synthetic healthcare data only. No real PHI will be used.

## Existing Architecture

Keep the current Replit architecture:

- React + Vite frontend
- Express API
- Drizzle ORM
- PostgreSQL
- TanStack Query
- Wouter routing
- Existing shared API libraries

The existing inventory viewer may remain available as an Administration/Database Inventory tool, but it will no longer be the primary application.

## Demo Principle

The demo must show connected workflows rather than isolated database tables.

Synthetic records must form complete demonstration stories so a user can follow a record through the system.

Primary revenue-cycle story:

Client
→ Appointment
→ Pre-Session Review
→ Clinical Note
→ Charge
→ Claim
→ Claim Validation
→ Submission
→ Payer Response
→ ERA / Denial
→ Appeal or Payment
→ Allocation
→ Final Balance

## Main Navigation

1. Home / Work Center
2. Clients
3. Schedule
4. Clinical
5. Eligibility
6. Charges
7. Claims
8. Payments
9. A/R & Denials
10. Credentialing
11. Payers & Contracts
12. Mailroom
13. Reports
14. Administration

## 1. Home / Work Center

The Work Center is the operational hub.

Display:

- Tasks assigned to user
- Eligibility issues
- Clinical documentation issues
- Charges awaiting review
- Claim validation failures
- Rejected claims
- Denials
- Appeals
- Unmatched ERA records
- Payment exceptions
- Authorization expiration warnings
- Credentialing issues
- Mailroom items
- Import validation errors
- A/R follow-up
- Overpayment/refund issues

Each item should support:

- Priority
- Status
- Assigned user
- Due date
- Client
- Provider
- Payer
- Related entity
- Recommended next action
- Notes
- History

Clicking a work item opens the underlying business record.

## 2. Clients

Client list with:

- Search
- Filters
- Insurance status
- Eligibility indicators
- Authorization indicators
- Upcoming appointment
- Outstanding balance

Client Detail tabs:

- Overview
- Demographics
- Insurance
- Eligibility
- Appointments
- Diagnoses
- Treatment Plans
- Clinical Notes
- Journal
- Authorizations
- Charges
- Claims
- Payments
- Documents
- Account Notes
- Account Activity

## 3. Schedule and Client Check-In

Schedule displays appointments by provider and date.

Appointment detail connects to:

- Client
- Provider
- Insurance
- Eligibility
- Authorization
- Check-in
- Pre-session review
- Clinical note
- Charge

Client check-in demonstrates:

- Demographic review
- Insurance review
- Forms/questionnaires
- Appointment readiness
- Outstanding issues

## 4. Clinical System

### Pre-Session Dashboard

Show:

- Client summary
- Last session
- Diagnoses
- Treatment plan
- Active goals
- Recent journal entries
- Previous clinical note
- Eligibility warning
- Authorization warning
- Outstanding documentation
- Billing readiness alerts

### Treatment Planning

Relationships:

Treatment Plan
→ Goals
→ Clinical Notes

### Clinical Notes

Statuses:

- Draft
- Ready for Signature
- Signed

Clinical notes connect to:

- Appointment
- Client
- Provider
- Treatment plan
- Goals
- Signature
- Charge

### Patient Journal

Patient-entered content remains separate from provider-authored clinical documentation.

Provider may review journal entries and selectively reference relevant information.

## 5. Eligibility

Eligibility workqueue and client eligibility history.

Show:

- Client
- Insurance policy
- Payer
- Effective dates
- Network status
- Copay
- Coinsurance
- Deductible
- Deductible remaining
- Authorization requirement
- Benefits
- Eligibility status
- Issues
- Last checked date

Relationship:

Client Insurance Policy
→ Eligibility Check
→ Eligibility Benefits

Include a Medicaid-focused workflow where applicable.

## 6. Medicaid Tools

Demonstrate Therassistant-specific tools:

### Medicaid Coding Helper

Provide operational guidance based on demo scenarios involving:

- Service
- Provider type
- Program
- Billing requirements
- Common coding considerations

### Medicaid Program Navigator

Display:

- Medicaid program
- RAE or applicable managed-care structure
- Payer/administrator
- Eligibility context
- Authorization considerations
- Billing routing information

These are demonstration tools, not production clinical or legal decision engines.

## 7. Authorizations

Authorization workspace shows:

- Client
- Payer
- Authorization number
- Effective dates
- Approved units
- Used units
- Remaining units
- Expiration
- Status
- Service limitations

Relationship:

Authorization
→ Authorization Units

Generate Work Center warnings for:

- Low remaining units
- Expiring authorization
- Missing authorization

## 8. Charge Capture

Charge workqueue statuses:

- Captured
- Ready for Claim

Charge detail connects:

- Appointment
- Client
- Provider
- Clinical note
- Payer
- Procedure
- Units
- Charge amount
- Documentation readiness

Do not permit a demo charge to appear claim-ready when the demonstration scenario contains an unresolved required documentation issue.

## 9. Claims

Claim workqueue statuses include:

- Ready for Validation
- Validation Failed
- Ready for Batch
- Submitted
- Rejected
- Denied

Claims list should show:

- Claim number
- Client
- DOS
- Rendering provider
- Billing provider
- Payer
- Charges
- Payments
- Balance
- Status
- Submission status
- Denial indicator
- Filing deadline indicator where available

Claim detail workspace combines:

- Claim header
- Claim lines
- Diagnoses
- Validation issues
- Submission history
- Submission responses
- Status history
- Payments
- Payment allocations
- Adjustments
- ERA information
- Denials
- Appeals
- Documents
- Claim notes
- Balance

## 10. Claim Validation

Demonstrate pre-submission validation.

Examples:

- Missing provider identifier
- Missing payer enrollment
- Missing insurance information
- Missing diagnosis
- Missing signed clinical note
- Authorization issue
- Invalid claim status

Validation failures create Work Center items.

## 11. Claim Batching / 837P

Demonstrate:

Professional Claim
→ Claim Batch
→ Claim Submission
→ Submission Response

The demo does not need to transmit a real 837P.

It should visually demonstrate:

- Claims selected for batch
- Batch created
- Submission generated
- Clearinghouse response
- Accepted/rejected result

## 12. Denials and Appeals

Denial workspace:

- Claim
- Client
- Payer
- CARC/RARC or denial reason
- Category
- Received date
- Filing deadline
- Status
- Recommended operational action

Demonstrate:

Claim
→ Denial
→ Appeal
→ Resolution

Appeal workspace should include:

- Appeal level
- Reason
- Supporting documents
- Submission date
- Deadline
- Status
- Outcome

## 13. Payment Posting

Payments workspace demonstrates:

- Payer payment
- Patient payment where applicable
- ERA payment
- Manual payment
- Payment allocation
- Claim-line allocation
- Adjustments
- Reversals
- Remaining balance

Relationship:

Payment
→ Payment Allocation
→ Claim
→ Claim Line

## 14. ERA / Remittance

Relationship:

ERA File
→ ERA Claim
→ ERA Service Line
→ ERA Adjustment

And:

ERA Claim
→ ERA Match
→ Professional Claim

Demonstrate:

- Matched ERA
- Unmatched ERA
- Zero-pay claim
- CARC/RARC
- Contractual adjustment
- Patient responsibility
- Secondary balance

Unmatched records should appear in the Work Center.

## 15. Underpayment Review

Demonstrate comparison of:

- Allowed amount
- Expected contracted amount
- Paid amount
- Variance

Relationship:

Payer
→ Contract
→ Fee Schedule
→ Fee Schedule Line

Create a demo scenario where payment is below the expected contract rate and surfaces as an underpayment review item.

## 16. Overpayment / Refund Review

Demonstrate a credit-balance workflow:

- Payment received
- Allocation history
- Adjustment history
- Reversal history
- Current balance
- Potential overpayment
- Refund review status
- Payer correspondence
- Final disposition

Do not automatically assume every apparent credit is refundable.

## 17. Historical Transactions

Historical transactions should be visible without requiring every old transaction to become a current claim workflow.

Relationships:

Historical Transaction
→ Allocation
→ Claim when applicable

Use for legacy account history and migration demonstrations.

## 18. Credentialing

Provider credentialing workspace shows:

- Provider
- Payer
- Enrollment status
- Effective date
- Identifiers
- Reference number
- Required action
- Notes

Relationships:

Provider
→ Provider Payer Enrollment
→ Payer

Provider
→ Provider Identifier
→ Payer

Demonstrate a scenario where payer enrollment affects billing readiness.

## 19. Payers & Contracts

Payer detail:

- Payer
- Aliases
- Plans/products
- Contracts
- Fee schedules
- Provider enrollments
- Claims
- Payments
- Denials

Contract hierarchy:

Payer
→ Payer Contract
→ Fee Schedule
→ Fee Schedule Lines

## 20. Mailroom

Mailroom manages incoming correspondence.

Demo capabilities:

- Upload or simulate incoming document
- Categorize
- Assign
- Connect to client
- Connect to claim
- Connect to authorization
- Connect to appeal
- Due date
- Status
- Resolution

Examples:

- Denial letter
- Medical-record request
- Recoupment letter
- Authorization letter
- Credentialing correspondence

Mailroom items can create Work Center tasks.

## 21. Import Validation

Show import workflow:

Import Batch
→ Import Rows
→ Validation Errors

Display:

- File
- Import type
- Rows
- Valid rows
- Failed rows
- Validation messages
- Resolution status

The purpose is to demonstrate preventing bad imported data from silently entering production workflows.

## 22. Multi-Practice / Billing Company Model

Demonstrate:

Billing Company Tenant
→ Practice Tenant

A billing company user can switch between authorized practices.

Practice data stays logically separated.

Dashboard and reporting may aggregate authorized practices.

## 23. Users, Roles and Auditability

Demonstrate:

- Tenant users
- Tenant roles
- Assigned work
- Created-by / changed-by history
- Audit logs
- PHI access logs

The demo should visibly show that sensitive activity is auditable.

## 24. Documents

Documents can relate to:

- Client
- Claim
- Authorization
- Appeal

Show documents inside the relevant business workspace instead of forcing users to search a standalone file repository.

## 25. Reports

Demo reports:

- A/R aging
- Claims by status
- Denials by payer
- Denials by reason
- Collections/payment summary
- Underpayments
- Eligibility issues
- Authorization utilization
- Workqueue volume
- Provider enrollment status
- Multi-practice summary

## Synthetic Demo Scenarios

Create a small number of deeply connected synthetic scenarios instead of hundreds of unrelated records.

### Scenario 1 — Complete Revenue Cycle

Client:
Jordan Ellis

Flow:

Appointment
→ Pre-session dashboard
→ Signed clinical note
→ Charge
→ Claim
→ Submission
→ ERA
→ Payment
→ Allocation
→ Final balance

Purpose:
Demonstrate clean revenue-cycle workflow.

### Scenario 2 — Denial and Appeal

Client:
Morgan Reed

Flow:

Appointment
→ Note
→ Charge
→ Claim
→ Denial
→ Work Center task
→ Appeal
→ Appeal documents
→ Resolution

Purpose:
Demonstrate denial intelligence and appeal workflow.

### Scenario 3 — Medicaid / Authorization

Client:
Taylor Brooks

Flow:

Medicaid insurance
→ Eligibility
→ Medicaid program information
→ Authorization
→ Unit utilization
→ Upcoming expiration warning

Purpose:
Demonstrate Medicaid and authorization workflows.

### Scenario 4 — Underpayment

Client:
Casey Martin

Flow:

Claim
→ ERA
→ Payment
→ Contract comparison
→ Underpayment detected
→ Work Center task

Purpose:
Demonstrate contract-based payment review.

### Scenario 5 — Credentialing Impact

Provider:
Jamie Parker, LCSW

Flow:

Provider
→ Payer enrollment
→ Missing/incorrect enrollment requirement
→ Claim validation issue
→ Credentialing Work Center task
→ Corrected enrollment state

Purpose:
Show credentialing connected directly to revenue-cycle operations.

### Scenario 6 — Mailroom / Recoupment

Flow:

Incoming payer recoupment letter
→ Mailroom
→ Existing claim/payment
→ Overpayment review
→ Assigned Work Center item
→ Resolution

Purpose:
Demonstrate correspondence-driven revenue-cycle workflow.

## Data Rules

- Synthetic data only.
- Use stable IDs.
- Preserve relationships.
- Human-readable names should be shown instead of IDs.
- Null relationships must not crash the app.
- Seed data must be deterministic.
- Demo can be reset to its original state.

## UI

Visual direction:

- Navy
- Sage green
- Cream/off-white
- White cards
- Compact professional tables
- Status badges
- Left navigation
- Desktop-first layout

The visual identity should communicate healthcare operations, finance, payer management, and compliance.

Avoid a wellness/therapy marketing aesthetic.

## Existing Inventory Viewer

The existing database inventory functionality may be retained under:

Administration
→ Database Inventory

It should not remain the homepage.

## Implementation Priority

Phase 1:
- Core schema
- Synthetic connected demo data
- Navigation
- Home / Work Center
- Clients
- Providers
- Claims
- Claim detail
- Connected demo scenarios

Phase 2:
- Clinical
- Pre-Session Dashboard
- Schedule
- Check-in
- Journal
- Eligibility
- Authorizations
- Medicaid tools
- Charge Capture

Phase 3:
- Payments
- ERA
- Denials
- Appeals
- Underpayment
- Overpayment/refund
- Historical transactions

Phase 4:
- Credentialing
- Payers & Contracts
- Mailroom
- Import validation
- Multi-practice
- Audit/PHI
- Reports
- Administration

## Definition of Done

The demo is complete when a user can:

1. Open the application successfully.
2. Navigate all primary modules.
3. View connected synthetic records.
4. Follow a client from appointment through revenue-cycle resolution.
5. Demonstrate a denial and appeal.
6. Demonstrate Medicaid eligibility and authorization.
7. Demonstrate payer enrollment affecting claim readiness.
8. Demonstrate contract underpayment detection.
9. Demonstrate Mailroom correspondence creating operational work.
10. Demonstrate payment and ERA workflows.
11. Demonstrate multi-practice switching.
12. Demonstrate audit and PHI-access visibility.
13. Demonstrate Therassistant's unified Work Center.
14. Explain how clinical, payer, credentialing, and RCM data connect.
15. Run without broken routes or placeholder-only modules.

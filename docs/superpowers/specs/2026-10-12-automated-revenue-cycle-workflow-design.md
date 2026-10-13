# Automated Revenue Cycle Workflow Design

Date: 2026-10-12
Branch: `automation/revenue-cycle-workflow`

## Goal

THERASSISTANT should not require staff to manually move clean encounters and claims through internal processing states. Routine revenue-cycle transitions must run automatically in the backend. Users should see actionable work, not implementation stages.

The visible workflow should be:

`Schedule → Encounter → Clinical Note → Sign & Lock → Claims / Payments / Denials / Work Center`

The backend workflow should be:

`Signed note → billing-readiness evaluation → charge reconciliation → claim creation → claim validation → payer grouping → 837P generation → Office Ally submission → acknowledgement/status processing → payment/denial processing`

Any stage that cannot complete automatically creates or updates a Work Center exception and stops safely at that stage. Fixing the source problem automatically requeues the pipeline from the failed stage; staff should not have to return to a separate processing page and click Retry, Create Charge, Create Claim, Validate, Batch, or Submit.

## Existing Behavior to Preserve

The current code already provides several pieces of the desired automation and they should be reused rather than replaced:

- `signNoteWorkflow()` signs the note and invokes billing readiness after the signature commits.
- `createChargeFromEncounter()` evaluates billing readiness, creates or reconciles charge rows, updates service-line readiness, and preserves idempotency for existing charge rows.
- Billing readiness already creates categorized Work Center items for eligibility, credentialing, missing documentation, and charge-validation blockers.
- Claim RPCs already exist for claim creation, claim validation, payer-specific batch creation, submission recording, and acknowledgement recording.
- Office Ally transport already supports 837P, 270/271, 276/277, and 835 through the `office-ally-edi` Edge Function.
- Signed clinical notes remain immutable; downstream billing corrections do not rewrite signed documentation.

The redesign must preserve those rules.

## Architectural Decision

Use a durable backend job pipeline.

### Why

A revenue-cycle pipeline cannot depend on a clinician keeping a browser tab open. It also cannot make `Sign & Lock` wait for Office Ally, payer acknowledgements, or downstream systems. Clinical signing must complete independently and enqueue downstream work.

### New backend components

1. `rcm_pipeline_jobs` table
   - one durable row per source encounter/claim pipeline run
   - tenant-scoped
   - idempotency key
   - current stage
   - status: `queued | running | blocked | retry_wait | completed | failed`
   - attempt count
   - next-attempt timestamp
   - last error code/message
   - source encounter, claim, batch, and submission IDs when available
   - created/updated/completed timestamps

2. Database enqueue trigger/RPC
   - enqueue when a clinical note transitions to `signed` or `locked`
   - enqueue/requeue when a source correction resolves a previously blocking encounter or claim issue
   - do not enqueue duplicate active jobs for the same encounter/stage

3. `rcm-pipeline-worker` Supabase Edge Function
   - executes with server/service credentials, not an end-user browser session
   - claims queued jobs safely
   - advances one stage at a time
   - persists state after each stage
   - uses existing RCM RPCs and Office Ally gateway functions
   - retries transient failures with bounded backoff
   - converts deterministic/business-rule failures into Work Center exceptions instead of endless retries

4. Internal Office Ally transport helper
   - the existing user-authenticated `office-ally-edi` endpoint remains available for administrative/test actions
   - the pipeline worker must call a server-only shared transport path using tenant-scoped stored credentials
   - do not require an active human user session for automatic 837P or status transactions

## Pipeline Stages

### Stage 1: Encounter billing readiness

Trigger: signed/locked clinical note.

Actions:

- evaluate billing readiness
- preserve existing readiness checks
- resolve stale Work Center items
- if blocked, set encounter billing status to `held`, create/update the appropriate Work Center item, and mark the pipeline job `blocked`
- if ready, continue automatically

No user-facing `Run Audit` action is required for routine processing.

### Stage 2: Charge reconciliation

Actions:

- create or update charge rows from encounter service lines
- preserve existing idempotency and duplicate protection
- private-pay and program-billing charges route to their own downstream paths
- insurance charges advance automatically to claim creation

If a deterministic problem prevents a charge, create/update a Work Center exception with a direct correction link.

No normal `Charge Capture`, `Create Charge`, or `Ready for Billing` page/action is required.

### Stage 3: Claim creation

For insurance-path encounters with ready charges:

- group eligible charges for one encounter into the professional claim
- call the existing backend claim-creation RPC
- store the generated claim ID on the pipeline job
- advance automatically to validation

Claim creation must be idempotent. Re-running the stage must reuse the existing active claim rather than create a duplicate.

### Stage 4: Claim validation

Actions:

- call the existing backend claim-validation RPC
- if valid, advance automatically
- if invalid, expose the claim in `Claims → Needs Attention`, create/update a claim Work Center item, and mark the job blocked

There is no user-facing `Claim Scrub` page or manual scrub button in the normal workflow.

### Stage 5: Payer grouping and 837P generation

Actions:

- group validated claims by payer
- create/reuse a payer-specific batch using the existing batch RPC
- generate and archive the 837P artifact
- preserve the batch/artifact for audit and troubleshooting

Batch terminology is hidden from normal navigation. Batch records remain available inside technical claim details and administrative audit views.

### Stage 6: Office Ally submission

Precondition: the practice has a valid production Office Ally connection and the platform has a configured 837P route.

Actions:

- submit the generated 837P automatically
- create/update the submission record
- store the clearinghouse reference and transport result
- mark claims as submitted/in process

If production credentials or 837P routing are unavailable, create one actionable Work Center exception and show affected claims in `Claims → Needs Attention`. Do not expose a separate submission page as the normal recovery path.

### Stage 7: Acknowledgement and claim-status processing

Actions:

- process 999 / 277CA / Office Ally claim-status responses automatically
- update submission and claim status history
- accepted claims remain in `Claims → In Process`
- rejected claims move to `Claims → Needs Attention`
- technical response data remains available in collapsed claim details

Until a push/webhook path is proven for the connected Office Ally account, the backend worker should use scheduled polling for outstanding submissions through the existing claim-status transaction path. The implementation must not invent unsupported Office Ally endpoints.

### Stage 8: Payment and denial processing

Clean remittance/payment processing should be automatic where supported by the existing 835 pipeline:

- match remittance to claim/service lines
- post payer payment and contractual adjustments
- calculate remaining patient responsibility
- update balances/statuses

Unmatched or ambiguous remittances create `Payments → Needs Attention` work.

Denial detection is automatic, but denial resolution remains a human workflow. A payer denial creates/updates the denial record and places it in the Denials workqueue.

## Automatic Retry / Requeue Rules

Fixing a blocking source field must resume processing without requiring a second manual processing action.

Examples:

- provider taxonomy corrected → requeue affected blocked claim/encounter
- payer/insurance corrected → requeue
- fee/service line corrected → requeue
- eligibility/enrollment issue resolved → requeue
- claim rejection field corrected → revalidate and continue
- Office Ally connection restored → requeue submission-stage jobs

Transient network/5xx errors use bounded automatic retry. Business-rule failures do not spin indefinitely; they create actionable exceptions.

## User Interface Changes

### Remove from primary navigation

- Charge Capture
- Billing Hub
- Rejections
- Claim Submission
- Batch pages
- Submitted Batch pages

Existing routes may initially remain as administrative/legacy redirects while the new workflow is validated, but they are not normal user destinations.

### Claims

Claims becomes the primary claim workspace with three views:

1. `Needs Attention`
   - validation failures
   - clearinghouse/payer rejections
   - missing/invalid source data requiring a person
   - each row states the plain-language issue and provides a direct `Fix` action

2. `In Process`
   - automatically created/submitted/accepted claims still awaiting adjudication
   - read-only unless an exception occurs

3. `All Claims`
   - searchable claim history
   - filters for payer, provider, date, and status

Claim 360 remains the detail/audit screen. Technical information such as batch ID, 837P artifact, 999/277CA payload/status, and submission IDs moves into a collapsed `Technical Details` section.

### Payments

Primary views:

- `Needs Attention`
- `Posted`
- `All`

Clean remittances should not require a posting wizard.

### Denials

Denials remains a human workqueue because resolution requires judgment. Denial creation is automatic.

### Work Center

Work Center is the cross-domain exception inbox. Revenue-cycle processing errors surface here with direct correction links. Completing the correction automatically requeues the underlying pipeline.

### Clinical encounter

After successful signing, the clinician sees a non-blocking message such as:

`Clinical note signed and locked. Revenue-cycle processing will continue automatically.`

If downstream billing is blocked, the clinician does not re-sign. The exception goes to Work Center.

Remove routine `Recheck Billing`, `Reconcile Charges`, and similar workflow-advancement controls from the clinician-facing note surface. Billing/coding correction controls remain available only where a person is actually needed.

## Navigation Target

Primary navigation should converge toward:

- Dashboard
- Schedule
- Patients
- Clinical
- Claims
- Payments
- Denials
- Providers
- Credentialing
- Messaging
- Patient Portal
- Reports
- Work Center
- Settings / Administration

## State Model

Internal statuses may remain detailed for audit and processing, but normal UI labels should collapse them into user-meaningful groups.

Examples:

- `ready_for_validation`, `ready_for_batch`, batch-created, and transport-pending are backend states, not separate pages.
- claim validation/clearinghouse/payer failures map to `Needs Attention`.
- submitted/accepted/pending adjudication map to `In Process`.
- final paid/denied/closed statuses remain queryable in `All Claims` and relevant workqueues.

## Safety and Idempotency Requirements

- Signing a note is never rolled back because downstream RCM processing fails.
- The clinician is never asked to sign the same note again to restart billing.
- Every stage must be idempotent.
- Jobs are tenant-scoped and protected from cross-tenant access.
- Signed clinical note content is immutable.
- Submitted claims and posted balances are never silently rewritten by upstream corrections.
- Existing claim/charge uniqueness constraints remain authoritative.
- Pipeline job transitions and external submissions are auditable.
- Automatic resubmission after a payer/clearinghouse rejection occurs only after an explicit source correction or an approved retryable transport failure; the system must not loop rejected claims indefinitely.

## Testing Requirements

### Unit / workflow tests

- signing enqueues exactly one pipeline job
- duplicate sign/retry events do not create duplicate charges or claims
- blocked encounter creates the correct Work Center item and stops
- fixing a blocker requeues the job automatically
- valid insurance encounter advances through charge and claim validation
- private pay/program encounters do not create insurance claims
- claim validation failure maps to Needs Attention
- transient transport failure retries without duplicate submission
- production-connection failure creates an exception and stops safely
- rejected acknowledgement maps to Needs Attention
- accepted acknowledgement maps to In Process
- downstream failures never alter the signed note

### Integration tests

- signed note → charge → claim → validation → batch/artifact using synthetic/test transport
- Work Center correction → automatic resume
- Office Ally synthetic 837P path
- claim status response processing
- navigation no longer exposes removed process pages
- legacy deep links redirect to the new appropriate Claims/Work Center destination

### E2E acceptance flow

1. schedule an insurance appointment
2. complete encounter documentation
3. sign and lock
4. verify the clinician leaves the encounter without additional billing clicks
5. verify backend creates/reconciles charge and claim automatically
6. verify valid claim progresses without manual scrub/batch controls
7. introduce a deterministic claim defect and verify it appears in Needs Attention/Work Center
8. correct the defect and verify automatic resume
9. verify no duplicate charge, claim, batch item, or submission is created

## Rollout

Implement behind an organization-level feature flag initially.

During rollout:

- keep legacy processing routes accessible only to admins/support for diagnosis and rollback
- remove them from primary navigation for enabled tenants
- log pipeline stage transitions and failures
- validate idempotency against existing production-like data before enabling automatic external submission
- enable automatic Office Ally production submission only after the practice connection and platform 837P route pass a production-readiness check

After acceptance testing, retire or redirect the legacy manual workflow routes.

## Definition of Done

The redesign is complete when a clean signed encounter can reach submitted claim state without a user visiting Charge Capture, Claim Scrub, Batch, or Submission pages; exceptions appear in Claims/Payments/Denials/Work Center with direct correction actions; corrections automatically resume processing; and no clinical signature, claim, charge, or submission is duplicated.
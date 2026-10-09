# Office Ally Tenant Credentials and Payment/Denial Testing Design

Date: 2026-10-09
Repository: `KrystinButler/therassistant`
Scope: active `ehr` application only

## Purpose

THERASSISTANT will keep Office Ally as the default clearinghouse integration while shifting credential ownership from a single THERASSISTANT platform account to buyer-owned, tenant-scoped Office Ally accounts. The integration must remain preconfigured so practices do not configure EDI endpoints, transaction types, receiver IDs, or routing logic.

The same change must preserve an isolated testing path that allows THERASSISTANT to validate claim payment posting and denial routing without requiring a live Office Ally account or transmitting live payer data.

## Current State

The application already has:

- Office Ally transaction abstraction for `837P`, `270/271`, `276/277`, and `835`.
- A JWT-protected Supabase Edge Function at `office-ally-edi`.
- A complete 837P generator and archive flow.
- An 835 parser.
- An 835 import workflow that:
  - matches ERA claims by patient control number,
  - verifies inbound payer identity,
  - posts payer payments,
  - posts contractual adjustments,
  - calculates patient responsibility,
  - blocks duplicate ERAs,
  - routes unmatched/ambiguous ERAs to work queues,
  - creates denials from adjudications,
  - routes workable denials to `denial_followup`,
  - blocks reversals/negative adjustments from auto-posting.

The current Office Ally adapter assumes a single platform-managed credential, which no longer matches the product requirement.

## Goals

1. Each practice owns and pays for its own Office Ally account.
2. THERASSISTANT remains preconfigured for Office Ally.
3. Practices enter Office Ally connection credentials once; they do not configure EDI internals.
4. Credentials are isolated by tenant and never exposed to browser code after submission.
5. Test and production transaction paths remain clearly separated.
6. Test mode exercises the same downstream claim, payment, ERA, and denial business logic used in production.
7. No test transaction may mutate live payer/clearinghouse state or be transmitted externally.
8. Payment posting and denial routing must be verifiable end to end with deterministic synthetic fixtures.

## Non-Goals

- THERASSISTANT will not purchase or centrally fund Office Ally accounts for customers.
- THERASSISTANT will not bypass payer enrollment requirements.
- THERASSISTANT will not infer unverified Office Ally API endpoints or credential formats.
- Test mode will not emulate Office Ally network behavior beyond what is necessary to validate THERASSISTANT workflows.
- This change does not redesign unrelated billing, claims, or denial UI.

## Credential Ownership Model

### Tenant-scoped connection

Each tenant has at most one active Office Ally connection record.

The practice-facing UI will expose only connection fields required by the actual Office Ally account type once verified. It will not expose:

- transaction endpoint paths,
- REST methods,
- Office Ally base URLs,
- EDI transaction selection,
- receiver IDs,
- payer route configuration.

Those remain centrally maintained by THERASSISTANT.

### Secret storage

Credential material will be stored server-side using Supabase Vault or an equivalent server-only encrypted secret store available in the current Supabase project.

The tenant-visible database record stores only metadata such as:

- tenant ID,
- provider = `office_ally`,
- mode = `test` or `production`,
- connection status,
- non-secret account identifier if applicable,
- secret reference ID,
- last verified timestamp,
- last error summary with secrets removed.

No plaintext secret is stored in tenant settings or browser-local storage.

### Authorization

Only authorized practice administrators may create, replace, test, or disconnect their tenant's Office Ally connection.

The `office-ally-edi` Edge Function must:

1. authenticate the current user,
2. validate active membership in the requested tenant,
3. confirm the caller has an allowed administrative role for credential-management actions,
4. resolve the Office Ally secret for that same tenant only,
5. reject cross-tenant secret access,
6. avoid logging credentials or raw authorization headers.

Transaction execution for ordinary billing users may use an already-configured tenant connection without granting those users access to the credential itself.

## Environment Model

### Test mode

Test mode is an internal THERASSISTANT transaction environment.

It does not call Office Ally.

It supports deterministic synthetic responses and fixtures for:

- 837P submission acknowledgement simulation,
- 270/271 eligibility response simulation where needed,
- 276/277 claim-status response simulation where needed,
- 835 ERA import and posting.

Test mode must be visually and logically distinguishable from production. Test-origin records should carry metadata such as `environment: "test"` and `synthetic: true` where practical.

Test mode must not send external network requests to Office Ally.

### Production mode

Production mode uses the tenant's stored Office Ally credential through the server-side Edge Function.

Production execution is permitted only when:

- a tenant credential exists,
- the connection is marked enabled,
- the required Office Ally route for that transaction has been centrally configured,
- payer-specific enrollment requirements are satisfied outside this credential layer where applicable.

## EDI Transport Changes

The browser client keeps calling one THERASSISTANT endpoint: `office-ally-edi`.

The request adds an explicit environment value:

- `test`
- `production`

The Edge Function branches as follows:

### Test

- validates user and tenant context,
- does not load a production secret,
- does not call Office Ally,
- returns deterministic synthetic transaction output or accepts a supplied test fixture identifier.

### Production

- validates user and tenant context,
- resolves the tenant-specific secret,
- uses centrally maintained Office Ally transaction routes,
- sends the request,
- redacts sensitive values from errors and logs.

The transaction family list remains:

- `837P`
- `270/271`
- `276/277`
- `835`

## Practice UI

Practice Configuration will show an Office Ally connection section rather than clearinghouse settings.

Expected states:

- Not connected
- Test ready
- Production connected
- Connection error

Actions:

- Connect Office Ally
- Test connection
- Replace credentials
- Disconnect

The screen must not expose technical routing fields already managed centrally.

## Payment Posting and Denial Test Harness

The test harness must feed 835 content through the existing `parse835` and `import835Workflow` logic rather than bypassing those functions.

### Required scenarios

#### 1. Clean paid claim

Fixture:
- one known claim,
- exact patient control number match,
- verified payer identifier,
- reconciled charge/payment/adjustment totals.

Expected:
- ERA matched,
- payment receipt created,
- payment allocated,
- contractual adjustment posted if present,
- claim moves to `paid` when balance reaches zero,
- no denial created,
- no payment-posting exception created.

#### 2. Partial payment with contractual adjustment and patient responsibility

Expected:
- payer payment posts,
- contractual adjustment posts,
- remaining patient responsibility is calculated,
- claim moves to `patient_responsibility` or `partially_paid` according to remaining insurance responsibility,
- metadata records responsibility split and last 835 trace.

#### 3. Full denial

Fixture:
- CLP status `4`,
- zero payer payment,
- CARC and optional RARC.

Expected:
- denial record created,
- claim moves to `denied`,
- denial is classified by existing policy logic,
- workable denial creates/open updates a `denial_followup` work item,
- configured auto-writeoff categories continue to use the existing writeoff path.

#### 4. Unmatched claim

Expected:
- no financial posting,
- ERA claim remains unmatched,
- `unmatched_era` work item created.

#### 5. Ambiguous claim

Expected:
- no financial posting,
- ambiguous match recorded,
- `unmatched_era` work item created.

#### 6. Duplicate ERA

Expected:
- second import blocked by trace number,
- no duplicate payment, allocation, adjustment, or denial.

#### 7. Payer identity mismatch

Expected:
- financial posting blocked,
- payment-posting work item created,
- claim financial state unchanged.

#### 8. Reversal or negative CAS adjustment

Expected:
- no automatic financial posting,
- payment-posting review work item created.

#### 9. Deposit reconciliation failure

Expected:
- BPR amount mismatch blocks financial posting,
- ERA review work item created,
- no payment receipt created.

## Historical Payment Posting

Historical 835 files may be imported through the same ERA workflow.

Historical import must preserve:

- original ERA trace number,
- original payment date,
- original payer identifier,
- raw 835 payload/archive metadata,
- claim and service-line match results,
- payment and adjustment ledger integrity.

The workflow must not silently overwrite current claim financial state when reconciliation or identity checks fail. Exceptions are routed for review instead.

## Data Changes

Expected schema additions may include a tenant-scoped clearinghouse connection table containing only metadata and secret references.

The exact migration will be based on the production schema at implementation time. Production migration ledger remains the source of truth.

No migration may copy Office Ally secrets into ordinary tenant settings JSON.

## Security Requirements

- Secrets are server-side only.
- Secrets are tenant-scoped.
- No credential values in frontend bundles.
- No credential values in Git.
- No credential values in audit descriptions, errors, or logs.
- Test mode cannot accidentally fall through to production transport.
- Production mode cannot use another tenant's secret.
- Cross-tenant credential reads/writes must be blocked at both application and database boundaries where practical.

## Verification Strategy

Implementation will use TDD and include automated tests for:

- tenant credential isolation,
- admin-only credential management,
- test-mode no-network behavior,
- production-mode tenant secret resolution,
- clean payment posting,
- partial payment responsibility split,
- denial routing,
- unmatched and ambiguous ERA handling,
- duplicate ERA protection,
- payer mismatch blocking,
- negative adjustment blocking,
- deposit reconciliation blocking.

After code changes:

1. run targeted tests,
2. run production TypeScript gate,
3. run build,
4. verify Supabase compatibility,
5. run existing revenue-cycle E2E coverage,
6. verify no browser secret exposure,
7. confirm production deployment status before declaring completion.

## Rollout

1. Add tenant connection metadata and secure secret-management path.
2. Update Office Ally Edge Function for tenant credential resolution and explicit test/production mode.
3. Update browser Office Ally client contract.
4. Add Practice Admin connection UI.
5. Add synthetic transaction fixtures and test harness.
6. Run payment and denial scenarios against the existing production workflows in isolated test data.
7. Deploy only after tests and build pass.

## Acceptance Criteria

The change is complete when:

- a practice can connect its own Office Ally account once,
- no clearinghouse technical setup is required from the practice,
- credentials are not visible after submission,
- test mode works without Office Ally credentials,
- test mode never calls Office Ally,
- production transport resolves only the current tenant's credential,
- a synthetic clean 835 posts a payment correctly,
- a synthetic partial 835 produces correct contractual and patient balances,
- a synthetic denied 835 creates a denial and routes it to the denial queue,
- unsafe or unreconciled 835s remain unposted and create review work items,
- duplicate imports do not duplicate financial transactions,
- existing claim/payment/denial workflows remain the system of record rather than being duplicated by the Office Ally integration layer.

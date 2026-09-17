# Secure Patient Portal Authentication — Design

Date: 2026-09-17
Status: Approved design, pending implementation-plan review

## Goal

Replace the current patient portal's public-key + `clientId` access model with a production-safe authenticated patient portal. Staff enrollment must create a real Supabase Auth invitation, and every patient-facing read/write must be authorized to the authenticated patient's mapped client record.

## Current State

- Patient portal routes are outside `AuthProvider`.
- Routes trust `/patient-portal/:clientId` and pass that ID into a public REST client.
- The portal public client uses the project publishable key without a patient access token.
- Existing anonymous RLS policies are limited to the disabled Therassistant Demo tenant.
- The production staff access helpers intentionally exclude the `client` role.
- There is no persistent mapping between `auth.users.id` and `clients.id`.

The current "Enroll in Patient Portal" action therefore does not provision a login. It only records metadata and opens the portal route.

## Design Principles

1. A URL or client ID never grants patient access.
2. Patient identity comes from Supabase Auth and `auth.uid()`.
3. Patient access is explicitly mapped to a client record.
4. Staff authorization and patient authorization remain separate.
5. Secret/admin credentials never enter the Vite/browser bundle.
6. Patient writes use narrow RPCs rather than broad table UPDATE privileges.
7. Failed invitation delivery must never cause duplicate patient creation.
8. Portal access can be revoked independently of the clinical patient record.
9. The design must support guardian/proxy access later without changing the `clients` table.

## Architecture

### Staff application

The existing staff application remains protected by the current `AuthProvider`, tenant context, and staff RLS helpers.

After patient creation, "Enroll in Patient Portal" will call a JWT-protected Supabase Edge Function with the new patient ID. The Edge Function validates that the caller is authorized staff for the patient's tenant before performing any Auth Admin action.

The patient record is saved first. Portal invitation is a separate lifecycle step because Supabase Auth and Postgres cannot participate in one cross-system transaction. If the invitation fails, the saved patient remains intact and staff are shown a retryable portal-access error rather than being encouraged to recreate the patient.

### Invitation service

Add a Supabase Edge Function:

`supabase/functions/invite-patient-portal/index.ts`

Responsibilities:

1. Require a valid staff JWT.
2. Resolve the target patient from `client_id`.
3. Verify the caller has tenant write access.
4. Require a non-empty patient email.
5. Refuse to invite a client already linked to a different active portal identity.
6. Call Supabase Auth Admin `inviteUserByEmail()` using the server-side secret key.
7. Create/update the portal access mapping with the returned Auth user ID.
8. Return a narrow result: client ID, portal status, invited email, invited timestamp.

Supabase documentation requires `inviteUserByEmail()` to run in a trusted server environment with a secret key. The invite redirect URL must be on Supabase Auth's allowed redirect list. Confirmed existing Auth users are not silently auto-linked by email; v1 returns an actionable staff error instead. This avoids accidentally connecting a patient chart to the wrong pre-existing account.

The Edge Function uses a configured `PORTAL_BASE_URL` to generate the activation redirect:

`${PORTAL_BASE_URL}/patient-portal/activate`

### Patient portal authentication

All patient portal routes move under `AuthProvider`.

New route structure:

- `/patient-portal/login`
- `/patient-portal/activate`
- `/patient-portal`
- `/patient-portal/journal`
- `/patient-portal/check-in/:appointmentId`
- `/patient-portal/recover`

The portal no longer includes `:clientId` in public navigation.

A `PatientPortalGate` resolves the signed-in user's portal mapping and produces the authorized client context. Child portal pages receive or resolve that context; they do not trust URL patient identifiers.

Unauthenticated portal visitors are sent to the patient login page. Authenticated users with no active/invited patient mapping receive an access-unavailable screen and cannot fall through to staff routes.

## Data Model

Add `public.client_portal_access`.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references tenants(id)`
- `client_id uuid not null references clients(id) on delete cascade`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `relationship text not null default 'self'`
- `status text not null check in ('invited','active','revoked')`
- `invited_email citext not null`
- `invited_at timestamptz`
- `activated_at timestamptz`
- `revoked_at timestamptz`
- `created_by uuid references auth.users(id)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints/indexes:

- unique active identity mapping for `(client_id, user_id)`
- index `(user_id, status)`
- index `(tenant_id, client_id, status)`
- first release supports one non-revoked portal identity per client
- `relationship='self'` is the only enrollment relationship exposed in UI in v1; the column preserves a future guardian/proxy path

The existing `tenant_users` / `tenant_user_roles` staff-membership model is not reused for patient login. This prevents patient identities from leaking into staff tenant selection and preserves the existing helpers that intentionally exclude `client`.

## Database Authorization

### Helper

Add private helper:

`private.has_client_portal_access(p_tenant_id uuid, p_client_id uuid)`

It returns true only when:

- `auth.uid()` is not null
- a matching `client_portal_access.user_id = auth.uid()` exists
- tenant and client match
- status is `active`

The helper is used only by RLS and narrow portal RPCs. It must use a fixed search path and must not be exposed as a general public endpoint.

### Read policies

Add authenticated patient-specific SELECT policies without weakening existing staff policies.

Patient users may read only:

- `clients`: their mapped client row
- `appointments`: rows where `client_id` is theirs
- `client_insurance_policies`: their rows
- `documents`: their rows and only patient-facing document types/statuses
- `client_checkins`: their rows
- `patient_journal_entries`: their rows
- `client_balance_summaries`: their row
- `treatment_plans`: their rows
- `treatment_plan_goals`: goals attached to their treatment plans
- `providers`: only providers related to their appointments or treatment plans, if the current portal still needs provider display data

No claims, denial, credentialing, internal workqueue, internal correspondence, or clinical-note tables become patient-readable.

### Write surface

Do not grant broad patient UPDATE access to clinical/operational tables.

Create narrow authenticated RPCs that derive the patient identity from `auth.uid()`:

- `portal_record_checkin(p_appointment_id, p_step)`
- `portal_save_previsit_checkin(p_appointment_id, p_update jsonb)`
- `portal_add_journal_entry(...)`
- `activate_my_client_portal_access()`

These RPCs validate that the appointment/treatment references belong to the authenticated client's mapping and only write the allowed columns.

Journal entries remain separate from clinical notes.

## Portal Access Lifecycle

### Staff invite

States:

- no row: not enrolled
- `invited`: Auth invitation sent; patient has not completed activation
- `active`: patient completed activation
- `revoked`: portal access disabled

Staff patient chart gains a "Portal Access" section showing status and email with actions:

- Send Invite
- Resend Invite when supported and safe
- Revoke Access

For v1, if Supabase reports the email already belongs to a confirmed Auth user and no matching portal mapping exists, the workflow stops with a clear error rather than auto-linking that account.

### Patient activation

The invite redirects to `/patient-portal/activate` with a Supabase Auth session.

The app:

1. consumes/validates the Auth session
2. allows the patient to set a password
3. calls `activate_my_client_portal_access()`
4. records `status='active'` and `activated_at`
5. navigates to `/patient-portal`

If password creation succeeds but activation fails, the mapping remains `invited`; on the next authenticated portal visit the gate routes the user back through activation rather than exposing patient data.

### Sign-in and password recovery

Add a patient-specific login screen using the existing auth session plumbing.

Password recovery must redirect back to a portal-specific recovery route. Patient reset/recovery must not drop the user into the staff tenant gate.

A signed-in patient who visits staff routes still has no staff tenant membership and receives no staff data.

## Frontend Data Layer

Replace `portal-public-client.ts` with an authenticated portal client that uses the existing publishable key plus the signed-in user's Bearer token.

Remove `portalTenantId(patientId)` and all logic that discovers tenant context from a public patient ID.

Portal repository methods resolve the authorized client from the portal context, not from route parameters.

Update all portal navigation links to patient-ID-free routes.

## Add Patient Integration

The atomic `create_patient_intake` RPC remains responsible only for patient/contact/insurance creation.

For "Save Patient":

- create patient
- close/refresh normally

For "Enroll in Patient Portal":

1. create patient through the existing atomic intake RPC
2. invoke the secure invitation Edge Function for the returned client ID
3. on success, show "Patient saved. Portal invitation sent to <email>."
4. on invitation failure, preserve the created patient and show "Patient saved, but portal invitation failed" with a path to retry from Patient 360

Do not retry patient creation to retry an invitation.

The existing `portal_enrolled` metadata flag is no longer authoritative. Portal status comes from `client_portal_access`. Legacy metadata can remain temporarily for compatibility but must not be used for authorization.

## Security Requirements

- No service-role/secret key in Vite code, repository browser code, or client-visible environment variables.
- Edge Function keeps `verify_jwt=true`.
- Edge Function validates staff tenant write access before Auth Admin use.
- Patient authorization is based on database mapping, never `user_metadata`.
- RLS remains enabled on every patient-readable public table.
- New public-schema tables receive explicit Data API grants only where needed; do not depend on automatic exposure.
- New functions use fixed `search_path`.
- Any SECURITY DEFINER helper must perform explicit identity checks, be minimally exposed, and have PUBLIC/anon EXECUTE revoked.
- Revoked portal users immediately fail patient RLS checks on subsequent requests.
- URL manipulation cannot expose another client's data.
- No patient can set `client_id`, `tenant_id`, provider review fields, or clinical-note fields through portal writes.

## Error Handling

Staff:

- missing patient email: do not call Auth Admin; show actionable error
- already active: do not create duplicate access
- pending invite: provide status and safe resend path
- existing confirmed Auth account with same email but no mapping: stop and require explicit account-link workflow later
- Edge Function/network failure after patient creation: patient remains saved; retry invitation only

Patient:

- expired invite: show "Invitation expired. Contact the practice for a new invitation."
- revoked mapping: sign-in may succeed, but portal gate denies portal data
- no mapping: access-unavailable screen
- invalid appointment ID: check-in RPC rejects it
- cross-client route/API manipulation: RLS/RPC returns no data or authorization error

## Tests

### Unit/contract tests

- portal routes no longer contain `:clientId`
- public portal client is no longer used
- patient portal gate requires Auth session
- activation route recognizes invite session
- staff invitation UI does not recreate patient on invite retry
- patient navigation generates ID-free portal URLs

### Database tests

Using synthetic users/client rows inside rollbackable transactions:

- active mapped patient can SELECT own patient data
- patient cannot SELECT another client's data in the same tenant
- patient cannot SELECT another tenant
- invited mapping cannot read patient data
- revoked mapping cannot read patient data
- patient check-in RPC accepts own appointment and rejects another client's appointment
- journal RPC always derives client ID from auth identity
- patient cannot directly update protected administrative/clinical columns
- staff RLS continues to work unchanged

### Edge Function tests

With Auth Admin calls mocked where practical:

- missing/invalid JWT rejected
- staff without tenant write permission rejected
- missing client email rejected before invite
- successful invite creates `invited` mapping
- existing active mapping is idempotent
- existing confirmed unrelated Auth email is not auto-linked
- function never returns or logs secret credentials

### Browser E2E

- patient invite activation path
- patient login path
- own portal loads
- manipulated client/appointment URLs cannot reveal another patient's data
- check-in and journal creation still work
- sign-out returns to patient login
- staff Add Patient + portal invite success path
- staff Add Patient + portal invite failure preserves one patient record only

## Deployment / Configuration

Implementation requires:

1. database migration(s)
2. Edge Function deployment with JWT verification enabled
3. `PORTAL_BASE_URL` Edge Function secret/configuration
4. Supabase Auth allowed redirect URL for `/patient-portal/activate` and portal recovery
5. frontend deployment
6. post-deploy RLS and portal smoke tests
7. Supabase security/performance advisor review

No production invitation will be sent during automated tests.

## Non-Goals for This Release

- guardian/proxy account UI
- multiple active portal users per client
- patient self-registration without staff enrollment
- automatic linking to an existing confirmed Auth account by email
- portal messaging implementation
- online patient payments
- exposing clinical notes or claims
- patient editing of core demographics/insurance beyond the existing confirmation workflow

## Success Criteria

The feature is complete when:

1. staff can save a patient and send a real portal invitation
2. the patient can accept the invitation, set a password, and sign in
3. portal routes contain no authoritative patient ID
4. database policies prevent the patient from accessing any other client's data
5. check-in and journaling continue to work through patient-scoped RPCs
6. staff access remains unaffected
7. portal access can be revoked
8. all tests, Supabase advisor checks, CI, and production deployment verification pass

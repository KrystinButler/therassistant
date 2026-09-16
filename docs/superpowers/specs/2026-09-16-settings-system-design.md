# Therassistant Settings System Design

## Status

Approved navigation and scope. This spec defines how the approved Settings areas fit into the existing Therassistant application, Supabase schema, auth model, and audit model.

## Goal

Replace the current generic Administration placeholder with a real Settings subsystem that supports practice configuration, clinical catalogs, billing configuration, staff administration, security, and audit review without creating duplicate configuration surfaces.

## Approved Settings Navigation

### Practice
- Practice Information & Locations
- Practice Logo
- Patient Records
- Client Portal

### Clinical
- Service Codes
- Diagnosis Codes
- Interventions

### Billing
- Practice Billing
- Patient Billing
- Payment Processing

### Administration
- Staff
- Activity Log

### My Account
- Change Your Password

## Route Model

`/settings` is the canonical Settings root.

Canonical child routes:
- `/settings/practice`
- `/settings/logo`
- `/settings/patient-records`
- `/settings/client-portal`
- `/settings/service-codes`
- `/settings/diagnosis-codes`
- `/settings/interventions`
- `/settings/practice-billing`
- `/settings/patient-billing`
- `/settings/payment-processing`
- `/settings/staff`
- `/settings/activity-log`
- `/settings/password`

Compatibility routes:
- `/administration` redirects to `/settings`.
- `/administration/database-inventory` remains available as an internal technical page but is not part of the normal Settings menu.
- `/administration/imports` remains owned by Operations > Imports / Migration.

## Navigation Behavior

The existing `Settings` top-level sidebar section remains. Its child links are the approved Settings pages rather than the current generic `Administration` and `Database Inventory` items.

Settings child links carry a `group` value (`Practice`, `Clinical`, `Billing`, `Administration`, or `My Account`). The AppShell renders group labels only inside the expanded Settings section. Other navigation sections continue rendering exactly as they do today.

The `/settings` root renders a Settings overview page with the same five groups and cards linking to each child page.

## Persistence Strategy

Use a hybrid persistence model rather than putting all settings into one JSON object.

### Existing schema reused

- `tenants.name`, `tenants.timezone`, and `tenants.settings` for tenant-level scalar configuration.
- `user_profiles`, `tenant_users`, and `tenant_user_roles` for Staff.
- `audit_logs` for create/update/delete activity.
- `phi_access_logs` for patient-record access activity.
- `portal_balance_exception_requests` and `patient_payment_plans` remain operational portal/billing data, not Settings configuration.
- Supabase Auth manages password changes and authentication.

### New normalized configuration tables

#### `practice_locations`
Purpose: reusable physical/telehealth/service locations.

Columns:
- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references tenants(id)`
- `name text not null`
- `status text not null default 'active'` with allowed values `active`, `inactive`
- `address_line1 text`
- `address_line2 text`
- `city text`
- `state text`
- `postal_code text`
- `phone text`
- `email citext`
- `place_of_service_code text`
- `is_billing_location boolean not null default false`
- `is_primary boolean not null default false`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraint: at most one active `is_primary = true` location per tenant.

#### `service_code_catalog`
Purpose: tenant-specific CPT/HCPCS/service-code choices.

Columns:
- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references tenants(id)`
- `code text not null`
- `description text not null`
- `default_fee_cents bigint not null default 0`
- `default_units numeric not null default 1`
- `default_duration_minutes integer`
- `default_place_of_service text`
- `active boolean not null default true`
- `sort_order integer not null default 0`
- timestamps

Unique: `(tenant_id, code)`.

#### `diagnosis_code_catalog`
Purpose: control which diagnosis codes appear in Therassistant search.

Columns:
- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references tenants(id)`
- `code text not null`
- `description text not null`
- `active boolean not null default true`
- `favorite boolean not null default false`
- `sort_order integer not null default 0`
- timestamps

Unique: `(tenant_id, code)`.

#### `intervention_catalog`
Purpose: reusable intervention choices for Treatment Plans and Progress Notes.

Columns:
- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references tenants(id)`
- `name text not null`
- `category text`
- `active boolean not null default true`
- `sort_order integer not null default 0`
- timestamps

Unique: `(tenant_id, name)`.

All new public tables have RLS enabled and tenant-scoped policies. Frontend access is limited to the current tenant. Mutation access is restricted to administrative roles rather than all authenticated users.

## Tenant Settings JSON

`tenants.settings` stores low-cardinality practice-wide toggles and scalar values that do not need independent querying/history tables.

The app reads/writes the following namespaced objects while preserving unrelated keys.

### `practice`
- `contact_email`
- `contact_phone`
- `website`

### `patient_records`
- `enable_preferred_name`
- `enable_emergency_contacts`
- `enable_patient_journal`
- `enable_treatment_plans`
- `enable_document_uploads`

Core patient demographics, insurance, diagnosis capture, clinical-note signing, and billing-readiness data are not disable-able because they are required by existing workflows.

### `client_portal`
- `enabled`
- `balance_limit_cents` (nullable; null means no balance-based restriction)
- `allow_online_payments`
- `allow_journal`
- `allow_documents`
- `allow_appointments`

### `practice_billing`
- `default_place_of_service`
- `default_claim_frequency_code`
- `auto_create_charge_after_signed_note`
- `require_billing_readiness_before_charge`
- `statement_from_name`

### `patient_billing`
- `statements_enabled`
- `minimum_statement_balance_cents`
- `statement_due_days`
- `show_insurance_pending_balance`
- `allow_payment_plans`

### `branding`
- `logo_path`

## Page Responsibilities

### Practice Information & Locations
Edits practice name, timezone, contact information, and normalized locations. The practice name in the application shell must come from tenant data instead of the current hard-coded demo practice label.

### Patient Records
Edits only the supported optional patient-record toggles. Disabling an optional feature hides its user-facing entry points; it never deletes existing records.

### Practice Logo
Uploads/replaces the practice logo. Store logo assets in a dedicated `practice-assets` Supabase Storage bucket using a tenant-prefixed path. Logos are non-PHI branding assets. Writes require practice-admin access. `tenants.settings.branding.logo_path` stores the current object path.

### Activity Log
Read-only page combining:
- `audit_logs` mutations
- `phi_access_logs` patient-record access

Normalize both into one activity-row model with timestamp, user, action, target, patient context when applicable, and change summary. Filters: date range, user, action, target type, and free-text search. No edit/delete actions are exposed.

### Change Your Password
Uses Supabase Auth for the signed-in user. Requires new password + confirmation; current-session authentication rules remain governed by Supabase Auth. No password or password hash is stored in application tables.

### Client Portal
Configures portal enablement, balance threshold, online payments visibility, journal, documents, and appointment visibility. The operational exception/payment-plan tables remain separate.

### Service Codes
CRUD for `service_code_catalog`; inactive codes stop appearing in new search/select controls but remain valid on historical records.

### Diagnosis Codes
CRUD for `diagnosis_code_catalog`; inactive codes stop appearing in new search/select controls but remain visible on historical diagnoses/claims.

### Interventions
CRUD for `intervention_catalog`; inactive interventions stop appearing in new Treatment Plan/Progress Note selection lists without altering historical text.

### Practice Billing
Edits tenant-wide claim/billing defaults only. It does not own payer contracts, fee schedules, claims, denials, or payment-posting workflows.

### Patient Billing
Edits statement/patient-responsibility defaults only. It does not duplicate Payments or patient A/R records.

### Payment Processing
Shows payment-processing connection status and setup actions. No processor secret keys, API secrets, or private credentials may be written to `tenants.settings`, browser source, or other client-readable tables. A real processor integration must use server-side secrets/connector configuration. Until a processor is connected, the page clearly shows `Not connected` and does not simulate a stored credential.

### Staff
Uses `user_profiles`, `tenant_users`, and `tenant_user_roles` to list staff, status, and role assignments. Provider records remain separate; a future optional provider-user association may link clinical staff without merging provider and auth identities.

## Authorization

Settings pages are visible to practice administrators by default. `Change Your Password` is visible to every authenticated user. `Activity Log` is admin-only. Staff role assignment is admin-only.

The frontend may hide unavailable actions, but database RLS/policies are the enforcement boundary.

Role authorization must use tenant role data / trusted app metadata, never user-editable `user_metadata`.

## Auditing

Every Settings mutation writes an `audit_logs` record containing:
- tenant
- actor
- action
- target type/id
- old values
- new values
- metadata identifying the Settings page/source

Activity-log reads do not modify audit history.

## Error Handling

- Each Settings page has loading, empty, saved, and error states.
- Save errors preserve entered form data and display a plain-language error.
- Catalog deletes use soft deactivation (`active = false`) rather than destructive deletion when historical records may reference the item.
- Location removal uses `status = inactive` when it has been used operationally.
- Password errors come from Supabase Auth and are translated into user-readable messages.
- Payment Processing never asks the user to paste a secret into a browser form.

## Testing

### Unit/source-model tests
- Settings navigation contains exactly the approved pages/groups.
- Legacy `/administration` redirects to `/settings`.
- Tenant settings updates preserve unrelated JSON keys.
- Catalog normalization/validation rejects blank codes/names and negative fee values.
- Activity Log normalization combines audit + PHI access rows deterministically.
- Payment Processing source contains no secret-key storage path.

### Repository tests
- Tenant settings update targets only the current tenant.
- Location/service/diagnosis/intervention writes include `tenant_id`.
- Staff role mutations target existing tenant/user-role tables.

### Browser E2E
- Settings overview renders five approved groups.
- Every canonical Settings route renders its expected H1.
- Settings sidebar grouping is visible when expanded.
- `/administration` redirects to `/settings`.
- Practice name edit propagates to shell after save in the supported demo/test path.
- Activity Log is read-only.
- Password page renders without exposing password values.

## Implementation Order

1. Settings routes/navigation/overview and compatibility redirect.
2. Shared Settings repository and safe tenant-settings merge helper.
3. Practice Information & Locations plus dynamic shell practice name.
4. Patient Records and Client Portal.
5. Clinical catalogs: Service Codes, Diagnosis Codes, Interventions.
6. Practice Billing and Patient Billing.
7. Staff and Activity Log using existing tables.
8. Practice Logo storage integration.
9. Change Your Password using Supabase Auth.
10. Payment Processing connection-status page and server-side integration boundary.
11. Full unit/type/build/Playwright/security verification.

## Out of Scope for This Settings Build

- Rebuilding the RCM workqueues.
- Payer contract or fee-schedule management inside Settings.
- Storing payment processor secrets in Supabase public tables.
- Deleting historical clinical/billing data when a catalog item is disabled.
- Making Database Inventory a normal end-user Settings page.

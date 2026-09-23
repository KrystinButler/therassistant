# THERASSISTANT Pilot & Release Acceptance

Bundle: `pilot-report-production-acceptance-2026-09-23`

## Canonical production chain

- GitHub: `KrystinButler/therassistant`
- Supabase: `lpjwfdvaxobewxcklenl`
- Vercel: `therassistant`
- Accepted production baseline commit: `f786c6fa3e7769f17f71eed826fbbdc03f0d43b5`
- Accepted production baseline deployment: `dpl_AK1hSTMwDpo8b4enc6gA6s9yfodv` — READY
- GitHub migrations: 135
- Production Supabase migrations: 135
- Migration drift: 0

## Synthetic data rule

Release tests do not create synthetic patients, users, claims, payments, or portal records in production. CI starts an isolated local Supabase stack, replays the canonical migration chain, provisions reserved-domain synthetic identities, runs acceptance, and discards the local stack.

## Identity and isolation gates

The connected pilot gate verifies distinct staff/practice-administrator, clinician/provider, and patient-portal identities. It proves own-tenant staff/provider visibility, cross-tenant denial, patient direct-table denial, linked-patient portal resolution, and same-tenant/cross-tenant appointment isolation.

The full system-role matrix adds one distinct Auth identity for every value of `system_role_enum`:

- `platform_admin`
- `practice_admin`
- `billing_company_admin`
- `billing_manager`
- `biller`
- `clinician`
- `front_desk`
- `credentialing_specialist`
- `read_only`
- `client`

Against the canonical `clients` RLS path, the matrix requires:

1. The eight operational/admin roles can read and update an own-tenant synthetic patient.
2. `read_only` can read the own-tenant patient but cannot update it.
3. `client` receives no staff-style direct read or update access to the `clients` table.
4. Every one of the 10 identities is denied cross-tenant patient reads and updates.
5. All 10 Auth user IDs are distinct.
6. The role matrix runs only against the isolated local Supabase stack.

Patient portal access remains separately validated through the dedicated portal lifecycle and linked-patient RPC tests.

## Connected workflow evidence already accepted

Production CI already verifies portal activation/check-in/journal/revoke/restore/recovery, provider schedule → encounter → signed note → service line → self-pay charge, and the insured claim → 837P archive/acknowledgement → payment/reconciliation path.

## Reporting

The canonical Reports page is deployed and reconciles management A/R to claim balance summaries. Claims missing a balance summary are excluded from management totals and surfaced as exceptions.

Production report acceptance is complete. The production `/reports` route returned HTTP 200, and a read-only acceptance transaction established an authenticated RLS context from an existing active non-client tenant membership and evaluated the same production metric families used by `ReportsPage`: active patients/providers, reconciled open A/R, A/R over 90 days, missing balance summaries, claim exceptions, active denials, posted payments, reversed/voided payments, and open work. No production records were inserted, updated, or deleted.

## Restore procedure

### Frontend

1. Select the last known-good Vercel production deployment.
2. Confirm its commit and rollback-candidate state.
3. Roll back or promote that deployment.
4. Verify the production alias and runtime errors.
5. Run smoke checks.

### Database

1. Restrict application writes.
2. Select the recovery point immediately before the bad event.
3. Restore only through the project's supported backup/PITR path.
4. Reconcile migrations, Auth-linked records, Storage availability, immutable claim artifacts, and integrations.
5. Re-run tenant/patient isolation, role matrix, clinical workflow, claim/payment reconciliation, audit, and reporting checks before reopening writes.

The restore drill must use a disposable Supabase branch or duplicate project. Production is not a restore-test target. Branch creation can incur cost, so the drill remains open until cost is explicitly approved.

## Security item

Supabase currently reports **Leaked Password Protection disabled**.

Reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Closure rule

`release_closed` stays false while any requirement is open. A requirement cannot be closed unless implemented, verified, configured, and deployed are all true.

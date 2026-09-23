# THERASSISTANT Pilot & Release Acceptance

Bundle: `pilot-acceptance-isolation-2026-09-23`

## Canonical production chain

- GitHub: `KrystinButler/therassistant`
- Supabase: `lpjwfdvaxobewxcklenl`
- Vercel: `therassistant`
- Production commit: `e4bba95108cf0b5894e74928276f0879a38f819c`
- Production deployment: `dpl_GHwfjJyyEVQoDXzqewhdg77i4nsd` — READY
- GitHub migrations: 135
- Production Supabase migrations: 135
- Migration drift: 0

## Synthetic data rule

Release tests do not create synthetic patients, users, claims, payments, or portal records in production. CI starts an isolated local Supabase stack, replays the canonical migration chain, provisions reserved-domain synthetic identities, runs acceptance, and discards the local stack.

## Current isolation gate

This bundle verifies the connected pilot identities: staff/practice administrator, clinician/provider, and patient portal.

The gate requires:

1. Three distinct Auth identities.
2. Staff and clinician can see the pilot tenant's synthetic patients.
3. Staff and clinician cannot read or update a second tenant's patient.
4. Patient portal identity receives no staff-style direct access to the patients table.
5. Patient portal resolves only its linked patient.
6. Patient cannot submit pre-visit data for the insured synthetic patient in the same tenant.
7. Patient cannot submit pre-visit data for a patient in another tenant.

The broader 10-role system matrix remains a separate open requirement.

## Connected workflow evidence already accepted

Production CI already verifies portal activation/check-in/journal/revoke/restore/recovery, provider schedule → encounter → signed note → service line → self-pay charge, and the insured claim → 837P archive/acknowledgement → payment/reconciliation path.

## Reporting

The canonical Reports page is deployed and reconciles management A/R to claim balance summaries. Claims missing a balance summary are excluded from management totals and surfaced as exceptions.

An authenticated live-production review of the management report remains open.

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
5. Re-run tenant/patient isolation, clinical workflow, claim/payment reconciliation, audit, and reporting checks before reopening writes.

The restore drill must use a disposable Supabase branch or duplicate project. Production is not a restore-test target. Branch creation can incur cost, so the drill remains open until cost is explicitly approved.

## Security item

Supabase currently reports **Leaked Password Protection disabled**.

Reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Closure rule

`release_closed` stays false while any requirement is open. A requirement cannot be closed unless implemented, verified, configured, and deployed are all true.

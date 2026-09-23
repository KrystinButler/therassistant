# THERASSISTANT Pilot & Release Acceptance

Bundle: `pilot-release-acceptance-2026-09-23`

This record separates **implemented**, **verified**, **configured**, and **deployed**. A requirement may be marked closed only when all four are true and observable evidence is recorded in `release/acceptance.json`.

## Production baseline

- GitHub baseline: `951fd76fb0e07c3fa95f36d46ce2a582b4e1dc85`
- Vercel production deployment: `dpl_Fv4hB41xS9gbQFFcgh4S1pNVrUdo`
- Vercel state at inspection: `READY`
- Supabase project: `lpjwfdvaxobewxcklenl`
- Supabase migration history was previously reconciled to 124 applied migrations through `20260923043000_immutable_837p_archive`.

## Synthetic production pilot evidence — 2026-09-23

The pilot used distinct synthetic identities and two isolated synthetic tenants. Production patient prerequisites were honored: each tenant received an active practice entity, provider, and linked active practice location before patient creation.

Roles exercised:

`platform_admin`, `practice_admin`, `billing_company_admin`, `billing_manager`, `biller`, `clinician`, `front_desk`, `credentialing_specialist`, `read_only`, and `client`.

Observed results:

- All 10 role identities passed their access scenario.
- Each staff role saw the two expected same-tenant synthetic patients and zero patients from the second tenant.
- Cross-tenant update attempts affected zero rows.
- `read_only` could read but could not create an audit event.
- The patient identity resolved its own patient through `get_my_patient_portal_data()`.
- The patient could not read the second patient or the other-tenant patient.
- The patient could not save a pre-visit check-in against the second patient's appointment.
- Repeating the same permitted pre-visit check-in twice resulted in exactly one persisted `client_checkins` row.
- A later database request still saw 3 synthetic patients, 8 permitted staff audit events, 1 retry-safe check-in, and 0 cross-patient check-ins.
- Cleanup was then performed and independently verified at 0 synthetic auth users, 0 synthetic patients, and 0 synthetic audit events.

The first setup attempt was also intentionally left as evidence of prerequisite enforcement: patient creation failed when the synthetic tenant lacked the required active practice entity/provider/location. The test was corrected to satisfy the production rule rather than bypass it.

## Reports acceptance

Credentialing reports are implemented from normalized operational rows and repository tests cover application aging, participation, expirations, roster status, network/directory exceptions, and CSV escaping.

The complete management/financial reporting surface has **not** yet received a production-data acceptance pass under this bundle. It remains open in the manifest and must not be represented as closed.

## Restore and rollback procedure

### Frontend / application rollback

1. Identify the last known-good Vercel production deployment.
2. Confirm its commit SHA and READY state.
3. Roll back or promote that known-good deployment.
4. Confirm the production alias points to the intended deployment.
5. Scan production runtime logs for new error/fatal events and run the production smoke routes.

The inspected baseline deployment is already marked by Vercel as a rollback candidate.

### Database restore

1. Stop or restrict application writes before restoring.
2. Identify the desired recovery point immediately before the bad migration/data event.
3. Use the available Supabase daily backup or PITR recovery point for the project.
4. Account for database downtime during restoration.
5. After restore, reconcile migrations, Auth-dependent records, Storage object availability, webhooks/replication, and immutable claim artifacts before reopening writes.
6. Run tenant isolation, patient isolation, payment/claim reconciliation, audit-history, and smoke tests after restore.

Supabase database backups restore database state; Storage object bytes require separate consideration. A production restore is destructive and is **not** the acceptance test.

### Required restore drill before closure

Run the database restore drill on a disposable Supabase preview branch or duplicate project, not on production. The current project inspection showed only the default `main` branch, so this drill remains open. Creating a paid preview branch must not be done without explicit cost approval.

## Bundle release protocol

For each accepted functional bundle:

1. Build all source changes into a single candidate commit before creating the candidate branch.
2. Create the candidate branch at that commit so Vercel produces one preview deployment rather than one preview per intermediate edit.
3. Verify the preview build, required tests, and acceptance evidence.
4. Merge the accepted commit to `main`.
5. Verify exactly one production deployment for that accepted bundle and scan runtime errors.
6. Record the preview deployment ID, production deployment ID, commit SHA, and evidence result.
7. Evidence-only follow-up commits must include `[skip-vercel]` so they do not create an extra deployment.

## Closure rule

Do not set `release_closed=true` while any requirement in `release/acceptance.json` remains open.

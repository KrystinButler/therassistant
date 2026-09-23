# Management Report Production Acceptance

Date: 2026-09-23

## Scope

This acceptance verifies the deployed management-report route and its production data path without creating synthetic production users, patients, claims, payments, or other test records.

## Evidence

- Production deployment: `dpl_AK1hSTMwDpo8b4enc6gA6s9yfodv` — READY.
- Production route `/reports` returned HTTP 200 from Vercel.
- Main Production CI run `35925411343` completed successfully.
- Supabase production and repository migration counts remain 135 / 135 with zero migration drift.
- A read-only database transaction established the `authenticated` Postgres role with an existing active non-client tenant membership as the request subject.
- Under that RLS context, the acceptance query evaluated the same metric families loaded by `ReportsPage`:
  - active patients
  - active providers
  - reconciled open A/R
  - A/R 91+ days from date of service
  - financial claims missing balance summaries
  - rejected/denied/validation-failed claim exceptions
  - active denials
  - posted/partially-applied payments with a posting timestamp
  - reversed/voided payments
  - open workqueue items

## Safety

The transaction was read-only in effect and rolled back. It did not create, update, or delete production records. No production synthetic data was used.

## Result

The management report production acceptance item is verified and closed.

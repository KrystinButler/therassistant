# Isolated Database Restore Rehearsal

Date: 2026-09-23

## Purpose

Verify THERASSISTANT database recovery mechanics without touching production or creating synthetic production data.

## Required CI sequence

The rehearsal runs after the isolated environment has completed patient-portal, browser, insured revenue-cycle, and clinical-to-charge acceptance. It:

1. creates a custom-format PostgreSQL dump of the exercised local Supabase database;
2. restores the dump into a second disposable local database;
3. compares critical source/restored row counts for Auth, tenants, roles, patients, providers, appointments, portal access, encounters, notes, charges, claims, payments, allocations, workqueues, and migration history;
4. confirms RLS remains enabled on `public.clients`;
5. confirms the restored client-policy count matches the source;
6. confirms the private tenant read/write helper functions are restored;
7. confirms the canonical synthetic patient fixtures exist in the restored copy; and
8. drops the restored database and recovery artifact at the end of the job.

## Hosted recovery limitation

A disposable Supabase branch was attempted after the user explicitly approved the quoted `$0.01344/hour` branch cost. Supabase rejected branch creation because the organization is on the Free plan.

The organization currently has two active Free projects, so a third temporary duplicate project is also unavailable under the Free project limit.

The hosted managed-recovery drill is deferred until Supabase Pro or equivalent disposable capacity is available. Production is not used for destructive restore testing.

## Release interpretation

The local recovery procedure is an executable release gate. Hosted branch/PITR recovery remains an infrastructure-hardening item and must be performed before relying on managed Supabase recovery as a contractual disaster-recovery control.

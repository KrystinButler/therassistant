# Phase 4 Credentialing + Payers Specification

## Goal
Turn the existing provider, credentialing, payer, contract, fee schedule, history, and workqueue data into a connected operational workflow without replacing the established schema.

## Provider 360
The provider detail page remains the primary provider record. It shows provider demographics, NPI and taxonomy, provider identifiers, payer enrollments, credentialing issues, revalidation dates, and related revenue-cycle activity. Provider identifiers use the existing `provider_identifiers` table for CAQH, PECOS/PTAN, Medicaid IDs, payer-specific IDs, and other identifiers.

## Credentialing Workspace
The credentialing page becomes an actionable workqueue rather than a status dropdown. Each provider-payer enrollment displays provider, payer, current enrollment status, effective date, revalidation due date, termination date, payer provider ID, notes, and available next actions. Status changes create `status_history` rows. Revalidation or enrollment problems create or update `credentialing_issue` workqueue items sourced to the provider.

## Enrollment lifecycle
Supported statuses remain the existing enum values: not_started, in_progress, submitted, approved, denied, terminated, expired, needs_revalidation, and unknown. Actions are explicit and contextual. Approved enrollment passes billing readiness. Submitted, denied, expired, terminated, unknown, and not_started remain blocking. Needs revalidation produces an operational warning/task and remains visible throughout provider and payer workflows.

## Revalidation
Add one nullable `revalidation_due_date` column to `provider_payer_enrollments`. This is the only required Phase 4 schema extension. Revalidation logic is deterministic: an approved enrollment with an approaching due date is surfaced as due soon; an overdue date is surfaced as overdue and creates credentialing work. Existing status history and workqueue infrastructure are reused.

## Payer 360
The payer workspace shows payer reference information, clearinghouse payer ID, payer plans/products, contracts, enrolled providers, fee schedules, and fee schedule lines. Add a payer detail route so users can navigate from payer listings to a complete payer record without seeing raw internal IDs.

## Contracts and fee schedules
Tenant-specific contracts continue to use `payer_contracts`. Fee schedules continue to use `fee_schedules` and `fee_schedule_lines`, linked through payer contract. Users can add/edit contract status and dates, create fee schedules, and maintain CPT/modifier rates. These rates become the authoritative contract expectation source available to later billing variance logic.

## Work Center and auditability
Credentialing problems use existing `workqueue_items` with `workqueue_type = credentialing_issue` and `source_object_type = provider`. Enrollment status transitions write to `status_history` with `target_type = provider_payer_enrollment`. Phase 4 does not create parallel task or history systems.

## Billing dependency
Existing billing-readiness credentialing checks remain intact. Phase 4 enriches the provider enrollment records those checks consume. Approved participation passes. Non-participating/incomplete statuses block. Revalidation is surfaced as operational work so it cannot silently expire.

## User interface rules
All provider, payer, plan, contract, and enrollment references display human-readable names. No operational page exposes raw UUIDs as the primary label. Actions use explicit buttons or forms instead of unexplained status dropdowns. Provider and payer records deep-link to each other where appropriate.

## Security
All exposed Supabase tables retain RLS. New write policies must be scoped consistently with the existing demo/tenant access model. No service-role or secret key enters browser code. Status/history/workqueue writes must preserve tenant ownership.

## Verification
Phase 4 adds behavior tests using the repository's existing `node:test` setup, a Phase 4 TypeScript config and CI workflow, secret scanning, production build, and SPA route smoke tests for provider, credentialing, payer, and payer-detail routes. Existing Phase 1-3 tests remain regression gates.
# EHR schema reconciliation — October 22, 2026

Source: KrystinButler/therassistant main 7e6feb1. Database: EHR / lpjwfdvaxobewxcklenl. CRM excluded.

## Applied live

Migration 20261023051120 restores two missing specialty-program tables, their tenant-scoped RLS policies, indexes and standard starter definitions; three security-invoker operational views; and nullable MUE adjudication-indicator metadata. Historical migration records falsely suggested these objects already existed. Verified catalog presence, RLS, grants and 231 recorded migrations after applying. No clinical or financial records deleted or rewritten.

## Source reconciliation

Recovered 41 absent production migration files, consolidated 13 alternate local timestamps into the canonical production versions, and added a 231-entry baseline plus CI history checks. Four clinical-engine fragments replace the combined local duplicate. Recovered accounting-period and signed-note document migrations are now tracked. Five historical lineage backfills now tolerate absent optional legacy columns while preserving legacy values where present. Two of those fixes also exist in PR #189; this branch does not include its unrelated UI changes.

## Verification

- 676 inventory regression tests, 67 credentialing tests, 6 API-verifier isolation tests and 3 migration-history tests passed.
- Library TypeScript, Phase 3 TypeScript, production auth contract and production build passed. Existing large bundle/sourcemap warnings remain.
- Embedded PostgreSQL/PGlite application migration replay reached the latest repair. Applying the repair a second time passed.
- Replay used minimal Supabase auth/storage scaffolding; omitted historical demo/CRM seed operations and unavailable HTTP/queue/scheduler infrastructure. It is not a substitute for the complete Supabase Docker CI replay.
- Every literal application RPC reference exists in production. Live catalog queries confirmed missing objects before repair and restored objects afterward.
- Post-repair security advisor raised no new schema findings. Existing disabled leaked-password protection remains outside this schema repair.

## Follow-up reconciliation

Migration 20261023052546 was applied live after workflow review. It aligns 18 optional references with the canonical source schema, allowing unresolved ERA imports, appointment-free charges and drafts that are validated before submission. Existing FK and RLS checks remain in force. A synthetic isolated SQL fixture reproduces the old ERA NOT NULL failure and passes after repair, while confirming invalid non-null references are rejected. No synthetic rows were written to production.

The 24 existing nullable legacy UUID aliases and their foreign keys are now represented in the migration chain without removing or copying existing values. This makes the compatibility schema reproducible while keeping canonical application columns authoritative.

The source baseline now contains all 232 applied production versions. Publication was corrected to explicitly delete obsolete renamed paths; the initial remote tree retained nine aliases and CI correctly rejected them. Fresh comparison of public column names, types, nullability and defaults shows zero differences after accounting for the scheduler-owned catalog progress fields in the embedded replay. This does not imply that a complete schema-only dump, permissions, extensions and runtime behavior have all been proven equivalent; full Supabase CI remains the final replay gate.

## October 24 continuation: clinician signing revocation

The CI clinical signing fixture still expected uncoded notes to fail billing validation, although clinical signing was deliberately made independent of billing readiness. The fixture now checks atomic handoff rollback for uncoded notes and accepts the specific identity-mismatch rejection for an unauthorized signer.

The replay also exposed a real revocation gap: signing calls the self-link RPC, which could reactivate a disabled clinician link. Pending migration `20261023062608_require_admin_provider_link_reactivation.sql` prevents clinician self-reactivation, direct status updates, and delete/recreate bypasses. Practice administrators can disable or restore signing access through an invoker RPC and the Users & Roles page, with tenant-scoped authorization and audit logging. Even direct admin updates cannot reactivate an inactive provider. Historical signatures are preserved.

Verified locally: 676 application regression tests; three migration-history tests; Phase 3 TypeScript; production build; seven clinical/claim handoff SQL fixtures; optional-reference integrity; repair reapplication. SQL fixtures run as authenticated synthetic users in the isolated embedded replay and roll back. Regression tests used Node's tsx loader because the tsx CLI's IPC socket is unavailable in this environment. The embedded replay retains the infrastructure omissions documented above.

## October 24 production release

The revocation migration was applied to production as canonical version `20261024164047`; its pending local timestamp was replaced, and the baseline now records all 233 production migrations. Verified the invoker RPC, denied anonymous execution, denied authenticated deletion, admin policies, and audit trigger in production.

The release integrates the existing production billing/ledger work from #189 and the prepared payment, note-signature and eligibility fixes from #190. Duplicate pending clinician-link migrations were consolidated into the applied canonical version. The patient portal lifecycle fixture now explicitly defers screeners, matching the current patient workflow.

Fresh comparison of all 1,972 public columns against isolated migration replay found zero missing columns and zero differences in type, nullability or default. All 686 application tests, three migration-history tests, full inventory TypeScript, production build, seven clinical/claim SQL fixtures, optional-reference behavior, and repair reapplication pass locally. GitHub full-stack CI is the remaining release gate. No production clinical or financial rows were modified by the release migration.

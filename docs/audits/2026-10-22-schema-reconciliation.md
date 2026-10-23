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

## Remaining differences requiring workflow review

Production retains 24 optional legacy compatibility columns that the clean migration chain does not create. These were preserved; removing them requires checking data and external consumers. Three payer catalog progress columns differ in the embedded comparison because the scheduler migration was intentionally omitted from that replay.

Production also enforces NOT NULL on these 18 columns where replay allows NULL. Existing constraints were preserved pending workflow-specific review; zero total schema drift is not claimed:

- `appointments.provider_id`
- `charge_capture_items.appointment_id`
- `charge_capture_items.clinical_note_id`
- `charge_capture_items.provider_id`
- `claim_submissions.batch_id`
- `denials.claim_id`
- `denials.client_id`
- `denials.payer_id`
- `document_history.actor_id`
- `encounter_service_lines.place_of_service_code`
- `encounters.provider_id`
- `era_claims.claim_id`
- `era_claims.client_id`
- `era_files.payer_id`
- `professional_claims.billing_provider_id`
- `professional_claims.charge_id`
- `professional_claims.payer_id`
- `professional_claims.rendering_provider_id`

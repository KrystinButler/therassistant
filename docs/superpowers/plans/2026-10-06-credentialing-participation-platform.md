# Credentialing Participation Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Therassistant Credentialing as a tenant-isolated Colorado provider credentialing and payer-participation verification module with payer/plan/network selection, asynchronous evidence-backed verification, immutable history, and no claim workflow authority.

**Architecture:** Extend the existing modular monolith instead of replatforming it. Reuse the current React credentialing shell, Express API, Supabase Postgres/Auth/RLS, Vercel deployment, provider/entity/location tables, and manual credentialing workflows. Add an effective-dated payer/network catalog, separate automated verification runs/evidence, a Supabase Queue + JWT-protected worker, adapter/matching boundaries, and the Verify Participation UI.

**Tech Stack:** TypeScript 5.9, React, Wouter, Express, Drizzle, Supabase Postgres/Auth/Queues/Cron/Edge Functions, Playwright, Node test runner, Vercel.

**Spec:** `docs/superpowers/specs/2026-10-06-credentialing-participation-platform-design.md`

## Global Constraints

- Credentialing must never stop, hold, edit, route, validate, or otherwise gate a claim.
- Automated statuses are exactly `IN_PROGRESS`, `PARTICIPATING`, `NOT_FOUND`, and `UNABLE_TO_VERIFY`.
- `NOT_FOUND` must never be translated to out-of-network or `non_participating`.
- Adapter/source failure must produce `UNABLE_TO_VERIFY`, never `NOT_FOUND`.
- A name-only/fuzzy match cannot independently produce `PARTICIPATING`.
- No patient/member data enters the participation-verification domain.
- All tenant-owned public tables use RLS; browser clients never receive privileged/service credentials.
- Directory/source evidence is immutable from the application perspective.
- Shared catalog records are effective-dated/deactivated rather than deleted when retired.
- Unsupported or prohibited payer-site scraping is out of scope; use an official fallback path instead.
- No new paid infrastructure or project is required.

## Review Focus

1. **Authoritative source unavailable after a user clicks Verify:** terminal result is `UNABLE_TO_VERIFY` with error classification and official fallback; never `NOT_FOUND`.
2. **Same provider name with a different NPI:** exact NPI wins; name-only candidate cannot return `PARTICIPATING`.
3. **Provider found but selected network/location is not established:** result is `NOT_FOUND` only after a successful authoritative search; otherwise `UNABLE_TO_VERIFY`.
4. **Cross-tenant ID substitution:** API and RLS reject reads/writes when provider/entity/location IDs belong to another tenant.
5. **Credentialing service/queue unavailable during clinical billing:** note → charge → claim continues without consulting credentialing tables or verification status.

---

### Task 1: Restore a green baseline and pin the module boundary

**Files:**
- Modify: `artifacts/therassistant-inventory/tests/patient-portal-navigation.test.ts`
- Modify: `artifacts/therassistant-inventory/tests/credentialing-workspace-contract.test.ts`
- Modify: `artifacts/therassistant-inventory/tests/rcm-route-model.test.ts`
- Modify: `tests/credentialing/module-boundary.test.ts`
- Test: existing inventory + credentialing tests

**Interfaces:**
- Consumes: existing `CredentialingModuleApp`, EHR shell, Provider 360, API module facade.
- Produces: a regression contract that EHR mounts one credentialing module entry point and no claims path depends on credentialing.

- [ ] **Step 1: Update only stale test assumptions**
  - Patient-portal test checks behavior (`target=_blank`, `noopener noreferrer`, private-window guidance) rather than one exact phrase.
  - Provider 360 test asserts credentialing tables are absent and `Open Credentialing Module` is present.
  - Shell test asserts `/credentialing` launcher and legacy `/payers-contracts` redirect rather than a direct payer nav item.

- [ ] **Step 2: Run focused tests**
  - Run the inventory test suite and `pnpm test:credentialing`.
  - Expected: zero failures before new product work begins.

- [ ] **Step 3: Verify claim isolation contract**
  - Assert claim/billing routes and validation SQL contain no reads from `provider_payer_enrollments`, `provider_network_participation`, `participation_verification_runs`, `credentialing_directory_*`, or credentialing APIs.

- [ ] **Step 4: Commit baseline fixes**

### Task 2: Complete payer, plan, network, and Colorado regional catalog schema

**Files:**
- Create: `supabase/migrations/<generated>_credentialing_participation_catalog.sql`
- Create: `tests/credentialing/catalog-schema.test.ts`
- Modify: `artifacts/api-server/src/modules/credentialing/router.ts`
- Create: `artifacts/api-server/src/modules/credentialing/catalog.ts`
- Test: Supabase schema/RLS + credentialing contract tests

**Interfaces:**
- Consumes: existing `payers`, `payer_plans`, `practice_entities`, `practice_locations`.
- Produces: `payer_networks`, `payer_coverage_areas`, `payer_catalog_syncs`, effective-dated catalog fields, and read APIs.

- [ ] **Step 1: Write failing schema-contract tests**
  - Assert payer has `adapter_key`, `active`, `effective_from`, `effective_to`.
  - Assert payer plans support external ID, market/product type, state, effective dates, active, source timestamp.
  - Assert `payer_networks` and catalog-sync tables exist.
  - Assert shared catalog is authenticated read-only from browser-facing policies.

- [ ] **Step 2: Create additive migration**
  - Extend existing payer tables without deleting existing data.
  - Add network, coverage-area/regional relationship, and catalog-sync tables.
  - Seed effective-dated Colorado ACC Phase III region relationships: Region 1/RMHP, Region 2/Northeast Health Partners, Region 3/CCHA, Region 4/Colorado Access; model RMHP PRIME and Denver Health Medicaid Choice without hard-coded permanent RAE enums.

- [ ] **Step 3: Add versioned catalog reads**
  - `GET /api/v1/payers`
  - `GET /api/v1/payers/:payerId/plans`
  - `GET /api/v1/plans/:planId/networks`
  - Colorado-active filtering while allowing inactive historical records by explicit query.

- [ ] **Step 4: Apply migration to Supabase EHR and verify**
  - Apply DDL once through the Supabase migration tool.
  - Query columns, constraints, seed relationships, and RLS policies.

- [ ] **Step 5: Run Supabase security/performance advisors and fix new findings**

- [ ] **Step 6: Commit catalog slice**

### Task 3: Add automated verification runs, evidence, adapter health, and durable queue

**Files:**
- Create: `supabase/migrations/<generated>_credentialing_verification_engine.sql`
- Create: `tests/credentialing/verification-schema.test.ts`
- Create: `artifacts/api-server/src/modules/credentialing/types.ts`
- Create: `artifacts/api-server/src/modules/credentialing/queue.ts`
- Test: schema, RLS, queue contract

**Interfaces:**
- Consumes: provider/entity/location IDs and payer/plan/network catalog IDs.
- Produces:
  - `participation_verification_runs`
  - `participation_verification_matches`
  - `payer_adapter_health`
  - optional normalized directory sync/index tables
  - `CredentialingVerificationJob` queue payload

- [ ] **Step 1: Write failing verification/RLS tests**
  - Status set is exactly the four SPEC-1 statuses.
  - Confidence is HIGH/MEDIUM/LOW.
  - Tenant IDs cannot be substituted across tenants.
  - Evidence rows are selectable but not update/delete-able through authenticated browser policies.
  - Existing manual `participation_verifications` remains intact.

- [ ] **Step 2: Add verification-engine schema**
  - Add timestamps, source references, adapter/matcher versions, created-by user, error classification/detail.
  - Evidence rows store match type, expected, observed, matched, score, source reference.
  - Add append-only audit trigger/function or server audit write path consistent with existing `audit_logs`.

- [ ] **Step 3: Enable Supabase Queues (`pgmq`)**
  - Create durable `credentialing_participation_verification` queue.
  - Keep queue schema unavailable to browser clients; do not expose `pgmq_public` unless required.
  - Implement server-only queue adapter with `enqueueVerification(runId, tenantId): Promise<string>`.

- [ ] **Step 4: Add Supabase Cron only if needed for scheduled source refresh**
  - Schedule catalog/directory refresh via a controlled worker invocation rather than browser execution.

- [ ] **Step 5: Apply migration and verify queue/RLS/advisors**

- [ ] **Step 6: Commit verification foundation**

### Task 4: Extract the adapter contract and deterministic matching engine

**Files:**
- Create: `artifacts/api-server/src/modules/credentialing/adapters/types.ts`
- Create: `artifacts/api-server/src/modules/credentialing/adapters/registry.ts`
- Move/refactor: `artifacts/api-server/src/lib/credentialing-directory.ts`
- Create: `artifacts/api-server/src/modules/credentialing/matching-engine.ts`
- Test: `tests/credentialing/adapter-contract.test.ts`
- Test: `tests/credentialing/matching-engine.test.ts`

**Interfaces:**
- Produces:
  - `PayerAdapter.syncCatalog()`
  - `PayerAdapter.verifyParticipation(request)`
  - `PayerAdapter.healthCheck()`
  - `evaluateParticipation(request, evidence): VerificationDecision`

- [ ] **Step 1: Write matcher tests for the critical scenarios**
  - exact Type 1 + exact plan/network -> participating when authoritative evidence confirms relationship.
  - same name/different NPI -> never participating.
  - provider found/different network or location -> no false positive.
  - Type 1/Type 2 mismatch -> confidence/evidence reflects mismatch; no unsupported positive.
  - source unavailable/API timeout -> unable to verify.
  - successful authoritative search with no qualifying record -> not found.

- [ ] **Step 2: Introduce normalized adapter evidence/error types**
  - Error classes: `TRANSIENT_NETWORK`, `RATE_LIMITED`, `AUTHENTICATION_FAILED`, `SOURCE_UNAVAILABLE`, `INVALID_RESPONSE`, `PROVIDER_NOT_FOUND`, `PLAN_NOT_FOUND`, `AMBIGUOUS_RESULT`.

- [ ] **Step 3: Refactor NPPES and PECOS into adapters/evidence providers**
  - Correct provider NPI field usage to existing `providers.individual_npi`.
  - NPPES supplies identity/taxonomy/location only.
  - PECOS supplies Medicare FFS enrollment evidence only.
  - Neither alone can claim MA plan/network participation.

- [ ] **Step 4: Implement deterministic matcher**
  - Exact NPI -> payer -> plan -> network -> Type 2 relation -> CO location -> taxonomy -> conflict handling.
  - Name/fuzzy candidate fields never establish participation.

- [ ] **Step 5: Run adapter/matcher tests and commit**

### Task 5: Implement the async verification API and worker

**Files:**
- Create: `artifacts/api-server/src/modules/credentialing/verification-routes.ts`
- Modify: `artifacts/api-server/src/modules/credentialing/router.ts`
- Create: `supabase/functions/credentialing-verification-worker/index.ts`
- Create: `supabase/functions/credentialing-verification-worker/deno.json`
- Test: `tests/credentialing/verification-api.test.ts`
- Test: worker fixture tests

**Interfaces:**
- `POST /api/v1/participation-verifications` -> HTTP 202 `{verificationId,status:"IN_PROGRESS"}`.
- `GET /api/v1/participation-verifications/:id`.
- `GET /api/v1/providers/:providerId/participation`.
- `GET /api/v1/providers/:providerId/verification-history`.

- [ ] **Step 1: Write failing API authorization/validation tests**
  - Cross-tenant provider/entity/location rejected.
  - Plan must belong to payer; network must belong to selected plan.
  - Missing Type 1 NPI returns validation error, not a fabricated result.

- [ ] **Step 2: Implement POST + enqueue**
  - Insert `IN_PROGRESS`, audit `VERIFICATION_REQUESTED`, enqueue job, return 202.

- [ ] **Step 3: Implement worker with bounded retry**
  - Read with visibility timeout.
  - Retry transient/rate-limited failures with bounded backoff.
  - Do not retry permanent invalid/configuration errors indefinitely.
  - Persist normalized evidence first, then final decision and `VERIFICATION_COMPLETED` audit.
  - Archive successful/terminal queue messages.

- [ ] **Step 4: Implement read/history endpoints**
  - Tenant scoped and evidence-backed.

- [ ] **Step 5: Deploy JWT-protected worker to Supabase and smoke-test with synthetic fixture**

- [ ] **Step 6: Commit async workflow**

### Task 6: Implement target payer adapters and controlled fallbacks

**Files:**
- Create under `artifacts/api-server/src/modules/credentialing/adapters/`:
  - `medicare.ts`
  - `health-first-colorado.ts`
  - `colorado-rae.ts`
  - `cigna.ts`
  - `anthem.ts`
  - `aetna.ts`
  - `uhc.ts`
  - `tricare.ts`
  - `manual-fallback.ts`
- Test: payer-specific fixtures under `tests/credentialing/fixtures/` and contract tests

**Interfaces:**
- Every adapter implements the shared `PayerAdapter` contract.
- Every adapter returns normalized evidence or typed failure; payer-specific shapes do not leak to matcher/UI.

- [ ] **Step 1: Verify current official public source documentation/endpoints before coding each adapter**
  - Do not rely on stale endpoint assumptions.

- [ ] **Step 2: Medicare/MA**
  - Keep PECOS FFS enrollment evidence distinct from MA plan/network directory evidence.
  - If selected MA plan lacks an automatable authoritative source, use controlled `UNABLE_TO_VERIFY` fallback.

- [ ] **Step 3: Health First Colorado + RAE**
  - Keep state enrollment/directory signal separate from specific RAE/network participation.
  - Use effective-dated Region 1-4 relationships.

- [ ] **Step 4: Cigna first live Plan-Net adapter**
  - Normalize Practitioner/PractitionerRole/Organization/Affiliation/Location/InsurancePlan evidence where current official access supports it.

- [ ] **Step 5: Anthem, Aetna, UHC, TRICARE**
  - Implement official machine-readable/API source where currently permitted and technically stable.
  - Otherwise return `UNABLE_TO_VERIFY` plus official manual directory path; never unsupported scrape.

- [ ] **Step 6: Adapter health/freshness tests**
  - Timeout, rate limit, invalid response, stale source, auth/config missing.

- [ ] **Step 7: Commit adapter coverage**

### Task 7: Add catalog/directory synchronization and discrepancy monitoring

**Files:**
- Create: `artifacts/api-server/src/modules/credentialing/sync.ts`
- Refactor/extend: existing `credentialing_directory_expectations`, `credentialing_directory_snapshots`, `credentialing_directory_discrepancies` usage
- Modify worker to process sync job types
- Test: `tests/credentialing/directory-sync.test.ts`

**Interfaces:**
- Nightly catalog sync.
- Source-specific directory sync, generally daily where permitted.
- Existing snapshots remain immutable source observations.

- [ ] **Step 1: Add sync provenance**
  - source, source version, retrieved/source-updated timestamps, checksum, adapter version, record count.

- [ ] **Step 2: Detect source changes without rewriting manual credentialing records**
  - Create/update credentialing discrepancy work only.
  - `SOURCE_UNAVAILABLE` is distinct from `NOT_FOUND`.

- [ ] **Step 3: Add adapter-health/freshness calculation**

- [ ] **Step 4: Schedule refresh jobs via Cron + queue**

- [ ] **Step 5: Test disappearance/change/recovery and commit**

### Task 8: Build the Verify Participation UI and evidence/history views

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/credentialing/ParticipationVerificationPage.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/credentialing/ParticipationEvidenceDrawer.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/credentialing/participation-api.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/credentialing/CredentialingModuleApp.tsx`
- Modify/refactor: `artifacts/therassistant-inventory/src/domains/credentialing/CredentialingPage.tsx`
- Test: inventory component-contract tests + Playwright

**Interfaces:**
- UI selects provider -> practice -> location -> payer -> plan -> network.
- POSTs one async verification, polls status, displays evidence/history.

- [ ] **Step 1: Add module navigation destination `Verify Participation`**

- [ ] **Step 2: Implement dependent selectors**
  - Provider and provider-related practice/location are tenant scoped.
  - Payer/plan/network come from normalized catalog; no free-text plan requirement for normal path.

- [ ] **Step 3: Implement async state**
  - `Verification in progress...` while `IN_PROGRESS`.
  - Poll boundedly and permit leaving/reopening via verification ID/history.

- [ ] **Step 4: Implement result copy exactly by semantics**
  - Participating + confidence/evidence.
  - Not Found includes explicit statement that this does not establish out-of-network status.
  - Unable to Verify includes reason + official fallback link when available.

- [ ] **Step 5: Add View Evidence + verification history**
  - Show source freshness and verified timestamp.
  - Evidence view does not mutate historical evidence.

- [ ] **Step 6: Add Report Incorrect Result**
  - Creates a credentialing review/discrepancy item without changing historical verification.

- [ ] **Step 7: Run E2E synthetic verification path and commit**

### Task 9: Security, isolation, claim-independence, and release verification

**Files:**
- Extend: `tests/credentialing/module-boundary.test.ts`
- Create/extend: Supabase RLS integration tests
- Extend: note/charge/claim workflow regression tests
- Modify: `.github/workflows/*` only if a gate is missing
- Update: PR #162 body/evidence

**Interfaces:**
- Produces release evidence required to move PR #162 out of draft.

- [ ] **Step 1: Run cross-tenant read/write tests**
  - Provider/entity/location/run/evidence/discrepancy IDs from another tenant are inaccessible.

- [ ] **Step 2: Run credentialing outage/negative-result claim tests**
  - no credentialing row -> note→charge→claim works.
  - stale credentialing data -> works.
  - `NOT_FOUND` verification -> works.
  - credentialing source/worker unavailable -> works.
  - credentialing updates do not mutate existing claims.

- [ ] **Step 3: Run full repository tests/typecheck/build**
  - Required: zero test failures, TypeScript errors, or build errors.

- [ ] **Step 4: Run Supabase advisors after final DDL**
  - Review and fix new security findings; review performance findings affecting new schema.

- [ ] **Step 5: Verify Vercel preview**
  - Deployment must be READY.
  - Smoke credentialing module routes and existing EHR routes.

- [ ] **Step 6: Review GitHub checks and PR threads**
  - No unresolved merge blocker.
  - Update PR body with exact implemented sources, controlled fallbacks, migration evidence, and remaining pilot limitations.

- [ ] **Step 7: Mark PR ready only after all gates pass**
  - Do not promote/merge if cross-tenant or claim-isolation checks fail.

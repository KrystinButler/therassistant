# Hybrid API Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require authenticated, active-tenant, role-appropriate access for clinical API reads and provider-bound clinical-note signing.

**Architecture:** Keep the existing server-side PostgreSQL data layer, but add centralized Supabase JWT verification and tenant membership resolution in Express. Clinical routes will consume a verified request context and enforce tenant scoping and provider ownership before querying or mutating PHI.

**Tech Stack:** TypeScript, Express 5, Supabase Auth, PostgreSQL/Drizzle, existing repository test framework.

**Spec:** Approved hybrid authorization design from 2026-10-04 review.

## Global Constraints

- Do not expose the Supabase service role or secret key to the browser.
- Do not authorize from user-editable JWT user metadata.
- All clinical PHI queries must be tenant-scoped at SQL level.
- Clinical note signing must require an authenticated clinician linked to the note's provider within the same tenant.
- Denied cross-tenant access must not disclose record existence.
- Keep the first change limited to centralized auth, tenant membership, clinical reads, and note signing.

## Review Focus

- Missing, malformed, expired, or unverifiable bearer token returns 401.
- Suspended/terminated/inactive membership returns 403.
- Cross-tenant clinical note identifiers do not disclose record existence.
- A clinician cannot sign another provider's note.
- Authorized requests remain tenant-scoped even when using the direct server PostgreSQL pool.

---

### Task 1: Authentication and tenant request context

**Files:**
- Create: `artifacts/api-server/src/middleware/auth.ts`
- Modify: `artifacts/api-server/src/app.ts`
- Test: use the repository's existing API test location/pattern after inspection.

**Interfaces:**
- Produces: an authenticated Express request context containing Supabase user ID, active tenant ID, tenant role, and linked provider ID when present.

- [ ] Write failing tests for missing/invalid token and inactive tenant membership.
- [ ] Run tests and confirm failures are caused by missing middleware behavior.
- [ ] Implement JWT verification using current Supabase guidance and resolve active membership from database state.
- [ ] Mount middleware before protected `/api` routes while preserving explicit public endpoints if any are discovered.
- [ ] Run focused and full tests.

### Task 2: Tenant-scoped clinical note listing

**Files:**
- Modify: `artifacts/api-server/src/routes/clinical.ts`
- Test: clinical API authorization tests.

**Interfaces:**
- Consumes: authenticated request context from Task 1.
- Produces: clinical list results limited to the caller's active tenant and authorized clinical role.

- [ ] Write failing tests proving cross-tenant rows and unauthorized roles are blocked.
- [ ] Run tests and confirm expected failures.
- [ ] Add role gate and explicit tenant predicates to the clinical query and joins.
- [ ] Run focused and full tests.

### Task 3: Provider-bound clinical note signing

**Files:**
- Modify: `artifacts/api-server/src/routes/clinical.ts`
- Test: clinical signing authorization tests.

**Interfaces:**
- Consumes: authenticated request context from Task 1.
- Produces: signing only when tenant, provider linkage, and note ownership all match.

- [ ] Write failing tests for cross-tenant signing, non-clinician signing, and clinician signing another provider's note.
- [ ] Run tests and confirm expected failures.
- [ ] Scope the note lookup and update to tenant plus authorized provider identity; return non-disclosing failures.
- [ ] Run focused and full tests.

### Task 4: Verification and release evidence

**Files:**
- Update this plan checklist only if useful; no production behavior required.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: evidence that security checks pass before deployment.

- [ ] Run repository test suite.
- [ ] Run TypeScript/build checks.
- [ ] Review changed files for PHI in logs and secret leakage.
- [ ] Run Supabase security/advisor checks where applicable.
- [ ] Open PR with test evidence and unresolved risks explicitly listed.

# Hybrid API Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require authenticated, active-tenant, role-appropriate access for clinical API reads and provider-bound clinical-note signing.

**Architecture:** Keep the existing server-side PostgreSQL data layer, but add centralized Supabase JWT verification and tenant membership resolution in Express. Clinical routes consume a verified request context and enforce tenant scoping and provider ownership before querying or mutating PHI.

**Tech Stack:** TypeScript, Express 5, Supabase Auth, PostgreSQL/Drizzle, Node integration tests, GitHub Actions.

**Spec:** Approved hybrid authorization design from 2026-10-04 review.

## Global Constraints

- Do not expose a Supabase service-role or secret key to the browser.
- Do not authorize from user-editable JWT user metadata.
- All clinical PHI queries must be tenant-scoped at SQL level.
- Clinical note signing must require an authenticated clinician linked to the note's provider within the same tenant.
- Denied cross-tenant access must not disclose record existence.
- Health and SMART OAuth endpoints remain outside this first protected clinical slice.
- Psychotherapy notes must not travel through the ordinary clinical-note API path.

## Review Focus

- Missing, malformed, expired, or unverifiable bearer token returns 401.
- Missing active-tenant context returns 400; inactive or foreign tenant membership returns 403.
- Cross-tenant clinical-note identifiers do not disclose record existence.
- A clinician cannot sign another provider's note; an administrator cannot sign merely because they are an administrator.
- Authorized direct-pool SQL remains explicitly tenant-scoped and psychotherapy notes are excluded from the ordinary path.

---

### Task 1: Failing clinical authorization acceptance test

**Files:**
- Create: `scripts/verify-api-clinical-authorization.mjs`
- Modify: `.github/workflows/production-ci.yml`

- [ ] Seed isolated synthetic ordinary, foreign-provider, cross-tenant, and psychotherapy note fixtures.
- [ ] Assert 401 without a token, 400 without tenant context, 403 for patient/foreign membership, provider-only note visibility, admin tenant visibility, and provider-bound signing.
- [ ] Run CI and confirm the test fails against the current unauthenticated API for the expected reason.

### Task 2: Authentication and tenant request context

**Files:**
- Create: `artifacts/api-server/src/middlewares/auth.ts`
- Modify: `artifacts/api-server/src/routes/clinical.ts`

- [ ] Verify bearer tokens against Supabase Auth using the current project URL and publishable key.
- [ ] Resolve the requested tenant from `X-Tenant-Id` against active `tenant_users`, `tenant_user_roles`, and active `provider_user_links`.
- [ ] Attach typed user/tenant/roles/provider context to the Express request.
- [ ] Re-run CI until authentication acceptance assertions pass.

### Task 3: Tenant-scoped clinical reads

**Files:**
- Modify: `artifacts/api-server/src/routes/clinical.ts`

- [ ] Permit ordinary clinical-note reads only for platform/practice admin or clinician roles.
- [ ] Scope every join and clinical-note predicate by tenant.
- [ ] Scope clinicians to their linked provider record.
- [ ] Exclude `note_type='psychotherapy'` from this ordinary clinical path.
- [ ] Re-run the acceptance test and full CI.

### Task 4: Provider-bound clinical note signing

**Files:**
- Modify: `artifacts/api-server/src/routes/clinical.ts`

- [ ] Require clinician role plus an active provider-user link.
- [ ] Scope lookup, update, signature insert, charge update, and final read by tenant and provider.
- [ ] Record authenticated user ID and provider ID on the signature.
- [ ] Return a non-disclosing 404 for foreign/cross-tenant note IDs.
- [ ] Re-run the acceptance test and full CI.

### Task 5: Verification

- [ ] Run API server typecheck/build in CI.
- [ ] Run the new synthetic API authorization test.
- [ ] Run the existing production CI suite.
- [ ] Run Supabase security advisors; document any unrelated pre-existing warnings.
- [ ] Open the PR with verification evidence and remaining scope clearly stated.

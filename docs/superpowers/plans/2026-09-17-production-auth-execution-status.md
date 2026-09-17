# Production Auth Execution Status — 2026-09-17

The production authentication and tenant-context conversion is being executed on `feature/production-auth-tenant-context` through PR #27.

## Completed in the isolated branch

- Staff authentication uses Supabase Auth sessions with token refresh and sign-out.
- Staff routes require authentication; patient portal routing remains outside the staff auth gate for this phase.
- Tenant context resolves from active `tenant_users` membership and `tenant_user_roles`; there is no demo-tenant fallback.
- Staff PostgREST and Storage access uses the authenticated session and active tenant context.
- Production Mailroom tenant RPCs were added in Supabase.
- A regression test now rejects any staff source import of the retired `supabase-demo-client` or `supabase-demo-storage` adapters.
- The regression guard identified 31 remaining legacy imports; a guarded transform migrated those files to `tenant-data-client` / `storage-client` and aborted on unsupported legacy exports.
- Existing Phase 3 regression coverage was restored after an earlier branch-only test simplification was identified.

## Remaining verification gates

The generated adapter migration must pass the full PR verification chain: unit tests, production-auth contract, TypeScript, browser secret scan, build, SPA route smoke tests, and Playwright E2E.

Production merge remains blocked until a real authorized Supabase Auth staff account exists with an active tenant membership and role. The branch must remain isolated until that account can be used to verify authenticated RLS access and the Vercel preview.

# Production Authentication and Tenant Context Spec

## Goal

Replace the staff application's anonymous, hard-coded `Therassistant Demo` runtime with Supabase Auth sessions and tenant membership resolved from the existing `tenant_users`, `tenant_user_roles`, `user_profiles`, and `tenants` tables.

## Scope

This phase covers the staff application only. Patient portal routes under `/patient-portal/*` remain outside the staff auth gate and keep their current access model until a separate patient-identity/security phase.

## Requirements

- Staff routes must require a valid Supabase Auth session before application data loads.
- There is no public staff self-registration screen. Accounts are provisioned through Supabase Auth/admin workflows.
- The browser may use the Supabase project URL and publishable key; no service-role or secret key may be shipped to the client.
- Every staff data request must send the current bearer access token so PostgreSQL RLS evaluates the signed-in user.
- Tenant context must come from an active `tenant_users` membership for `auth.uid()`, not from tenant name, a hard-coded UUID, or browser-controlled tenant input.
- If a user has multiple active tenant memberships, the first phase chooses deterministically and exposes the resolved tenant in context; tenant switching is a later feature.
- A signed-in user with no active tenant membership must see an access/setup error and must not fall back to anonymous or demo data.
- `AppShell` must display the resolved tenant name and authenticated user's identity instead of demo labels.
- The `/demo` staff route and runtime demo badges are removed in this phase. Synthetic fixture files may remain temporarily only if other code still imports them; they must not determine production tenant context.
- Existing RLS policies remain the security boundary. Frontend tenant filters are convenience/scoping, not authorization.
- Session persistence and token refresh must use Supabase's supported JavaScript client rather than a custom token implementation.
- Existing staff workspaces should continue using the current API-shaped frontend interfaces during migration to minimize unrelated UI churn.

## Current Database Contract

- `tenants(id, name, status, timezone, ...)`
- `tenant_users(tenant_id, user_id, status, ...)`
- `tenant_user_roles(tenant_id, user_id, role, ...)`
- `user_profiles(id, display_name, email, status, ...)`
- Staff roles are represented by `system_role_enum`.
- At the start of this work the Supabase project contains zero `auth.users` rows, so production cutover must not be merged until an authorized staff account can be provisioned and assigned to a tenant.

## Out of Scope

- Patient portal authentication redesign.
- Multi-tenant switching UI.
- Staff invitation/admin user-management UI.
- Rewriting every workspace query from the existing API-shaped adapter to direct component-level Supabase queries.
- Destructive removal of existing synthetic rows from the database.

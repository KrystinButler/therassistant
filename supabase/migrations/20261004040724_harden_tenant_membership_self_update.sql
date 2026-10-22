drop policy if exists "users can update own tenant memberships" on public.tenant_users;

revoke update on table public.tenant_users from authenticated;

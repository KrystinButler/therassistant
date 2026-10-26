begin;

-- Tenant membership status must be controlled through administrative RPCs.
-- Prevent an authenticated user from directly reactivating or altering their
-- own tenant membership row.
drop policy if exists "users can update own tenant memberships"
  on public.tenant_users;
revoke update on table public.tenant_users from authenticated;

-- Audit and PHI-access logs are administrative/compliance records.
-- Ordinary active tenant membership is not sufficient to view them.
drop policy if exists "members can read audit logs"
  on public.audit_logs;
create policy "admins can read audit logs"
  on public.audit_logs
  for select
  to authenticated
  using (private.has_tenant_admin_access(tenant_id));

drop policy if exists "members can read phi access logs"
  on public.phi_access_logs;
create policy "admins can read phi access logs"
  on public.phi_access_logs
  for select
  to authenticated
  using (private.has_tenant_admin_access(tenant_id));

commit;

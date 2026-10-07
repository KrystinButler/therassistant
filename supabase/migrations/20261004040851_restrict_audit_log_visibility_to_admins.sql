drop policy if exists "members can read audit logs" on public.audit_logs;
create policy "admins can read audit logs"
on public.audit_logs
for select
to authenticated
using (private.has_tenant_admin_access(tenant_id));

drop policy if exists "members can read phi access logs" on public.phi_access_logs;
create policy "admins can read phi access logs"
on public.phi_access_logs
for select
to authenticated
using (private.has_tenant_admin_access(tenant_id));

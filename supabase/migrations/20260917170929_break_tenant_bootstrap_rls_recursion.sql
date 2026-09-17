alter policy "members or creator can read tenants"
on public.tenants
using (
  created_by = (select auth.uid())
  or (select private.has_tenant_read_access(id))
);

alter policy "creator or members can update tenants"
on public.tenants
using (
  created_by = (select auth.uid())
  or (select private.has_tenant_write_access(id))
)
with check (
  created_by = (select auth.uid())
  or (select private.has_tenant_write_access(id))
);

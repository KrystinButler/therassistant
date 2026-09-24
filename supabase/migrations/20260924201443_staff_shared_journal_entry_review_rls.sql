-- Staff may record a patient-supplied reflection or review a shared portal entry.
-- Private entries remain inaccessible to staff, and tenant/client identity must match.
create policy "patient_journal_entries staff shared insert"
on public.patient_journal_entries for insert to authenticated
with check (
  private.has_tenant_write_access(tenant_id)
  and visibility = 'shared_with_provider'
  and author_type = 'patient'
  and exists (
    select 1 from public.clients c
    where c.id = client_id and c.tenant_id = patient_journal_entries.tenant_id
  )
);
create policy "patient_journal_entries staff shared review"
on public.patient_journal_entries for update to authenticated
using (private.has_tenant_write_access(tenant_id) and visibility = 'shared_with_provider')
with check (private.has_tenant_write_access(tenant_id) and visibility = 'shared_with_provider');

-- Distinguish portal-authored entries from patient reports entered by staff.
alter table public.patient_journal_entries
  add column if not exists recorded_by_staff_user_id uuid references auth.users(id);
drop policy if exists "patient_journal_entries staff shared insert" on public.patient_journal_entries;
create policy "patient_journal_entries staff shared insert"
on public.patient_journal_entries for insert to authenticated
with check (
  private.has_tenant_write_access(tenant_id)
  and visibility = 'shared_with_provider'
  and author_type = 'patient'
  and recorded_by_staff_user_id = (select auth.uid())
  and exists (
    select 1 from public.clients c
    where c.id = client_id and c.tenant_id = patient_journal_entries.tenant_id
  )
);

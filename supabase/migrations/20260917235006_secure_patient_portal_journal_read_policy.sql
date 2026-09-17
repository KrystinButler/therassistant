begin;

drop policy if exists "journal patient portal select" on public.patient_journal_entries;
drop policy if exists "patient_journal_entries tenant select" on public.patient_journal_entries;
create policy "patient_journal_entries tenant select"
  on public.patient_journal_entries for select to authenticated
  using (
    private.has_tenant_read_access(tenant_id)
    or (select private.has_client_portal_access(tenant_id, client_id))
  );

commit;

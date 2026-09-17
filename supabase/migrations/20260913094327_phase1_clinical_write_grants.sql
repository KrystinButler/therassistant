begin;

drop policy if exists "demo anon insert clinical note signatures" on public.clinical_note_signatures;
create policy "demo anon insert clinical note signatures"
  on public.clinical_note_signatures for insert to anon
  with check (
    tenant_id in (
      select id from public.tenants where name = 'Therassistant Demo'
    )
  );

grant insert on public.clinical_note_signatures to anon;

commit;

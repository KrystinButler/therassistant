begin;

drop policy if exists "Patients can read own portal documents" on storage.objects;
create policy "Patients can read own portal documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'therassistant-documents'
  and exists (
    select 1
    from public.documents d
    where d.storage_path = storage.objects.name
      and d.client_id is not null
      and d.document_type::text in (
        'insurance_card',
        'intake_form',
        'consent_form',
        'client_correspondence',
        'statement'
      )
      and d.document_status::text not in ('rejected', 'voided')
      and private.has_client_portal_access(d.tenant_id, d.client_id)
  )
);

create or replace function public.get_my_portal_document(p_document_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.id,
    'file_name', d.file_name,
    'storage_path', d.storage_path,
    'mime_type', d.mime_type,
    'file_size_bytes', d.file_size_bytes,
    'document_type', d.document_type,
    'document_status', d.document_status
  )
  from public.documents d
  where d.id = p_document_id
    and d.client_id is not null
    and d.document_type::text in (
      'insurance_card',
      'intake_form',
      'consent_form',
      'client_correspondence',
      'statement'
    )
    and d.document_status::text not in ('rejected', 'voided')
    and private.has_client_portal_access(d.tenant_id, d.client_id)
  limit 1;
$$;

revoke all on function public.get_my_portal_document(uuid) from public, anon;
grant execute on function public.get_my_portal_document(uuid) to authenticated;

commit;

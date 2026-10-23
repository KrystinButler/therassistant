-- Recovered from production migration history; already applied.
-- Additive link: existing uploaded documents remain unchanged.
alter table public.documents add column if not exists clinical_note_id uuid references public.clinical_notes(id) on delete restrict;
alter table public.documents add column if not exists content_sha256 text;
create unique index if not exists documents_signed_clinical_note_unique
  on public.documents(tenant_id,clinical_note_id) where clinical_note_id is not null;

create or replace function private.validate_signed_note_document()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_note public.clinical_notes%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.clinical_note_id is not null then raise exception 'Signed note PDF records cannot be deleted through ordinary chart actions'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.clinical_note_id is not null then
    raise exception 'Signed note PDF records are immutable; file an amended note separately';
  end if;
  if new.clinical_note_id is null then return new; end if;
  select * into v_note from public.clinical_notes where id=new.clinical_note_id;
  if not found or v_note.tenant_id is distinct from new.tenant_id
    or v_note.client_id is distinct from new.client_id
    or v_note.note_status::text not in ('signed','locked')
    or not exists(select 1 from public.clinical_note_signatures s where s.clinical_note_id=v_note.id and s.tenant_id=v_note.tenant_id)
    or new.document_type::text <> 'clinical_note' or new.mime_type is distinct from 'application/pdf'
    or new.content_sha256 is null or new.content_sha256 !~ '^[a-f0-9]{64}$'
    or not exists(select 1 from storage.objects o where o.bucket_id='therassistant-documents' and o.name=new.storage_path)
    or new.storage_path <> new.tenant_id::text || '/' || new.client_id::text || '/clinical-notes/' || v_note.id::text || '.pdf' then
    raise exception 'A signed PDF must match its clinical note, patient, tenant and private storage path';
  end if;
  return new;
end;
$$;
drop trigger if exists validate_signed_note_document on public.documents;
create trigger validate_signed_note_document before insert or update or delete on public.documents
for each row execute function private.validate_signed_note_document();

-- Restrictive policies apply in addition to existing permissive tenant policies.
-- Ordinary uploads remain unchanged; signed PDF paths cannot be overwritten,
-- renamed into/out of the reserved namespace, or deleted by authenticated clients.
create policy signed_note_objects_immutable_update on storage.objects as restrictive
for update to authenticated
using (bucket_id <> 'therassistant-documents' or split_part(name,'/',3) <> 'clinical-notes')
with check (bucket_id <> 'therassistant-documents' or split_part(name,'/',3) <> 'clinical-notes');
create policy signed_note_objects_immutable_delete on storage.objects as restrictive
for delete to authenticated
using (bucket_id <> 'therassistant-documents' or split_part(name,'/',3) <> 'clinical-notes');

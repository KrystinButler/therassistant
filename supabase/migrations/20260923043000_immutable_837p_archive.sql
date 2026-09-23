-- Canonical immutable 837P archive for claim batches.

-- Remove legacy anonymous Storage access that is no longer used by the authenticated app.
drop policy if exists "demo anon delete mailroom documents" on storage.objects;
drop policy if exists "demo anon read mailroom documents" on storage.objects;
drop policy if exists "demo anon upload mailroom documents" on storage.objects;

alter table public.claim_batches
  add column if not exists edi_storage_path text,
  add column if not exists edi_file_name text,
  add column if not exists edi_sha256 text,
  add column if not exists edi_byte_length bigint,
  add column if not exists edi_generated_at timestamptz,
  add column if not exists edi_generated_by uuid references public.user_profiles(id) on delete set null,
  add column if not exists edi_archived_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='claim_batches_edi_sha256_format'
      and conrelid='public.claim_batches'::regclass
  ) then
    alter table public.claim_batches
      add constraint claim_batches_edi_sha256_format
      check (edi_sha256 is null or edi_sha256 ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='claim_batches_edi_byte_length_nonnegative'
      and conrelid='public.claim_batches'::regclass
  ) then
    alter table public.claim_batches
      add constraint claim_batches_edi_byte_length_nonnegative
      check (edi_byte_length is null or edi_byte_length >= 0);
  end if;
end $$;

create unique index if not exists claim_batches_edi_storage_path_uidx
  on public.claim_batches(tenant_id,edi_storage_path)
  where edi_storage_path is not null;

create index if not exists claim_batches_edi_generated_by_idx
  on public.claim_batches(edi_generated_by)
  where edi_generated_by is not null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'claim-edis',
  'claim-edis',
  false,
  10485760,
  array['text/plain','application/octet-stream']::text[]
)
on conflict (id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Tenant members can read claim EDI" on storage.objects;
create policy "Tenant members can read claim EDI"
on storage.objects for select
to authenticated
using (
  bucket_id='claim-edis'
  and exists (
    select 1
    from public.tenant_users tu
    where tu.user_id=(select auth.uid())
      and tu.status='active'::public.user_status_enum
      and tu.tenant_id::text=(storage.foldername(name))[1]
  )
);

drop policy if exists "Tenant members can archive claim EDI" on storage.objects;
create policy "Tenant members can archive claim EDI"
on storage.objects for insert
to authenticated
with check (
  bucket_id='claim-edis'
  and exists (
    select 1
    from public.tenant_users tu
    where tu.user_id=(select auth.uid())
      and tu.status='active'::public.user_status_enum
      and tu.tenant_id::text=(storage.foldername(name))[1]
  )
);

-- No UPDATE or DELETE policy is created for claim-edis: outbound artifacts are immutable.

create or replace function public.prepare_claim_edi_artifact(p_batch_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_batch public.claim_batches%rowtype;
  v_generated_at timestamptz;
  v_file_name text;
  v_storage_path text;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;

  select * into v_batch
  from public.claim_batches
  where id=p_batch_id
  for update;

  if not found then raise exception 'Claim batch not found'; end if;
  perform public.assert_tenant_access(v_batch.tenant_id);

  if v_batch.edi_archived_at is not null then
    return jsonb_build_object(
      'batch_id',v_batch.id,
      'generated_at',v_batch.edi_generated_at,
      'file_name',v_batch.edi_file_name,
      'storage_path',v_batch.edi_storage_path,
      'archived',true,
      'sha256',v_batch.edi_sha256,
      'byte_length',v_batch.edi_byte_length
    );
  end if;

  if v_batch.batch_status not in (
    'ready'::public.claim_batch_status_enum,
    'downloaded'::public.claim_batch_status_enum
  ) then
    raise exception 'Only a ready batch can generate an outbound 837P artifact';
  end if;

  v_generated_at := coalesce(v_batch.edi_generated_at,now());
  v_file_name := coalesce(nullif(v_batch.edi_file_name,''),'batch_' || v_batch.id::text || '.837');
  v_storage_path := coalesce(
    nullif(v_batch.edi_storage_path,''),
    v_batch.tenant_id::text || '/outbound/837p/' || v_batch.id::text || '/' || v_file_name
  );

  update public.claim_batches
  set edi_generated_at=v_generated_at,
      edi_generated_by=coalesce(edi_generated_by,(select auth.uid())),
      edi_file_name=v_file_name,
      edi_storage_path=v_storage_path,
      updated_at=now()
  where id=v_batch.id;

  return jsonb_build_object(
    'batch_id',v_batch.id,
    'generated_at',v_generated_at,
    'file_name',v_file_name,
    'storage_path',v_storage_path,
    'archived',false
  );
end;
$$;

create or replace function public.finalize_claim_edi_artifact(
  p_batch_id uuid,
  p_sha256 text,
  p_byte_length bigint
)
returns jsonb
language plpgsql
security invoker
set search_path=public,storage,pg_temp
as $$
declare
  v_batch public.claim_batches%rowtype;
  v_hash text := lower(trim(coalesce(p_sha256,'')));
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if v_hash !~ '^[0-9a-f]{64}$' then raise exception 'A valid SHA-256 hash is required'; end if;
  if p_byte_length is null or p_byte_length <= 0 then raise exception 'A positive EDI artifact byte length is required'; end if;

  select * into v_batch
  from public.claim_batches
  where id=p_batch_id
  for update;

  if not found then raise exception 'Claim batch not found'; end if;
  perform public.assert_tenant_access(v_batch.tenant_id);

  if v_batch.edi_storage_path is null or v_batch.edi_generated_at is null then
    raise exception 'Prepare the EDI artifact before finalizing it';
  end if;

  if not exists (
    select 1 from storage.objects o
    where o.bucket_id='claim-edis'
      and o.name=v_batch.edi_storage_path
  ) then
    raise exception 'The archived EDI object was not found in private storage';
  end if;

  if v_batch.edi_sha256 is not null and v_batch.edi_sha256 <> v_hash then
    raise exception 'The archived EDI artifact hash does not match the finalized batch hash';
  end if;

  if v_batch.edi_byte_length is not null and v_batch.edi_byte_length <> p_byte_length then
    raise exception 'The archived EDI artifact length does not match the finalized batch length';
  end if;

  update public.claim_batches
  set edi_sha256=v_hash,
      edi_byte_length=p_byte_length,
      edi_archived_at=coalesce(edi_archived_at,now()),
      updated_at=now()
  where id=v_batch.id
  returning * into v_batch;

  return jsonb_build_object(
    'batch_id',v_batch.id,
    'generated_at',v_batch.edi_generated_at,
    'archived_at',v_batch.edi_archived_at,
    'file_name',v_batch.edi_file_name,
    'storage_path',v_batch.edi_storage_path,
    'sha256',v_batch.edi_sha256,
    'byte_length',v_batch.edi_byte_length,
    'transmission_ready',true
  );
end;
$$;

create or replace function public.enforce_claim_submission_edi_archive()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_batch public.claim_batches%rowtype;
begin
  if new.batch_id is null or coalesce(new.submission_method,'') <> 'external_837p' then
    return new;
  end if;

  select * into v_batch
  from public.claim_batches
  where id=new.batch_id and tenant_id=new.tenant_id;

  if not found then raise exception 'Claim batch not found for submission'; end if;

  if v_batch.edi_archived_at is null
     or v_batch.edi_storage_path is null
     or v_batch.edi_sha256 is null
     or v_batch.edi_byte_length is null then
    raise exception 'Archive and verify the 837P artifact before recording external submission';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_claim_submission_edi_archive on public.claim_submissions;
create trigger enforce_claim_submission_edi_archive
before insert on public.claim_submissions
for each row execute function public.enforce_claim_submission_edi_archive();

revoke all on function public.prepare_claim_edi_artifact(uuid) from public;
revoke all on function public.finalize_claim_edi_artifact(uuid,text,bigint) from public;
grant execute on function public.prepare_claim_edi_artifact(uuid) to authenticated;
grant execute on function public.finalize_claim_edi_artifact(uuid,text,bigint) to authenticated;

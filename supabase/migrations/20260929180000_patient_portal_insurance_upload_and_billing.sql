begin;

drop policy if exists "Patients can upload own insurance cards" on storage.objects;
create policy "Patients can upload own insurance cards"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'therassistant-documents'
  and (storage.foldername(name))[3] = 'portal-insurance'
  and lower(storage.extension(name)) = any (array['pdf','jpg','jpeg','png','webp']::text[])
  and exists (
    select 1
    from public.client_portal_access cpa
    where cpa.user_id = (select auth.uid())
      and cpa.status = 'active'
      and cpa.tenant_id::text = (storage.foldername(storage.objects.name))[1]
      and cpa.client_id::text = (storage.foldername(storage.objects.name))[2]
  )
);

drop policy if exists "Patients can clean up unlinked insurance uploads" on storage.objects;
create policy "Patients can clean up unlinked insurance uploads"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'therassistant-documents'
  and (storage.foldername(name))[3] = 'portal-insurance'
  and exists (
    select 1
    from public.client_portal_access cpa
    where cpa.user_id = (select auth.uid())
      and cpa.status = 'active'
      and cpa.tenant_id::text = (storage.foldername(storage.objects.name))[1]
      and cpa.client_id::text = (storage.foldername(storage.objects.name))[2]
  )
  and not exists (
    select 1
    from public.documents d
    where d.storage_path = storage.objects.name
  )
);

create or replace function private.portal_register_insurance_card_impl(
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.client_portal_access%rowtype;
  v_storage_path text := trim(coalesce(p_storage_path, ''));
  v_file_name text := regexp_replace(trim(coalesce(p_file_name, '')), '[\\/]+', '_', 'g');
  v_mime_type text := lower(trim(coalesce(p_mime_type, '')));
  v_document public.documents%rowtype;
  v_item public.mailroom_items%rowtype;
  v_work public.workqueue_items%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select cpa.*
    into v_access
  from public.client_portal_access cpa
  where cpa.user_id = (select auth.uid())
    and cpa.status = 'active'
  order by cpa.created_at desc
  limit 1;

  if not found then
    raise exception 'Active patient portal access is required' using errcode = '42501';
  end if;

  if v_storage_path = ''
    or (storage.foldername(v_storage_path))[1] <> v_access.tenant_id::text
    or (storage.foldername(v_storage_path))[2] <> v_access.client_id::text
    or (storage.foldername(v_storage_path))[3] <> 'portal-insurance'
  then
    raise exception 'Insurance card storage path is invalid' using errcode = '22023';
  end if;

  if lower(storage.extension(v_storage_path)) <> all (array['pdf','jpg','jpeg','png','webp']::text[]) then
    raise exception 'Insurance cards must be PDF, JPG, PNG, or WebP files' using errcode = '22023';
  end if;

  if v_mime_type <> all (array['application/pdf','image/jpeg','image/png','image/webp']::text[]) then
    raise exception 'Insurance card MIME type is not allowed' using errcode = '22023';
  end if;

  if coalesce(p_file_size_bytes, 0) <= 0 or p_file_size_bytes > 52428800 then
    raise exception 'Insurance card file size is invalid' using errcode = '22023';
  end if;

  if v_file_name = '' then
    raise exception 'Insurance card file name is required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from storage.objects so
    where so.bucket_id = 'therassistant-documents'
      and so.name = v_storage_path
  ) then
    raise exception 'Uploaded insurance card object was not found' using errcode = 'P0002';
  end if;

  select d.*
    into v_document
  from public.documents d
  where d.storage_path = v_storage_path
    and d.tenant_id = v_access.tenant_id
    and d.client_id = v_access.client_id
  limit 1;

  if found then
    return jsonb_build_object(
      'id', v_document.id,
      'file_name', v_document.file_name,
      'document_type', v_document.document_type,
      'document_status', v_document.document_status,
      'created_at', v_document.created_at
    );
  end if;

  insert into public.documents (
    tenant_id,
    client_id,
    document_type,
    document_status,
    file_name,
    storage_path,
    mime_type,
    file_size_bytes,
    uploaded_by
  ) values (
    v_access.tenant_id,
    v_access.client_id,
    'insurance_card'::public.document_type_enum,
    'pending_review'::public.document_status_enum,
    v_file_name,
    v_storage_path,
    v_mime_type,
    p_file_size_bytes,
    (select auth.uid())
  )
  returning * into v_document;

  insert into public.mailroom_items (
    tenant_id,
    client_id,
    subject,
    correspondence_type,
    received_date,
    status,
    notes
  ) values (
    v_access.tenant_id,
    v_access.client_id,
    'Patient insurance card upload',
    'client_correspondence',
    current_date,
    'action_required',
    'Insurance card uploaded from patient portal: ' || v_document.file_name ||
      E'\nDocument ID: ' || v_document.id::text
  )
  returning * into v_item;

  insert into public.workqueue_items (
    tenant_id,
    workqueue_type,
    workqueue_status,
    priority,
    source_object_type,
    source_object_id,
    title,
    description,
    created_by
  ) values (
    v_access.tenant_id,
    'correspondence'::public.workqueue_type_enum,
    'open'::public.workqueue_status_enum,
    'normal'::public.workqueue_priority_enum,
    'mailroom_item'::public.workqueue_source_object_type_enum,
    v_item.id,
    'Review patient insurance card',
    'Patient uploaded a new insurance card. Review the document and update coverage if needed.',
    (select auth.uid())
  )
  returning * into v_work;

  return jsonb_build_object(
    'id', v_document.id,
    'file_name', v_document.file_name,
    'document_type', v_document.document_type,
    'document_status', v_document.document_status,
    'mailroom_item_id', v_item.id,
    'workqueue_item_id', v_work.id,
    'created_at', v_document.created_at
  );
end;
$$;

revoke all on function private.portal_register_insurance_card_impl(text, text, text, bigint) from public, anon;
grant execute on function private.portal_register_insurance_card_impl(text, text, text, bigint) to authenticated;

create or replace function public.portal_register_insurance_card(
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.portal_register_insurance_card_impl(
    p_storage_path,
    p_file_name,
    p_mime_type,
    p_file_size_bytes
  );
$$;

revoke all on function public.portal_register_insurance_card(text, text, text, bigint) from public, anon;
grant execute on function public.portal_register_insurance_card(text, text, text, bigint) to authenticated;

create or replace function private.get_my_portal_billing_summary_impl()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access public.client_portal_access%rowtype;
begin
  select cpa.*
    into v_access
  from public.client_portal_access cpa
  where cpa.user_id = (select auth.uid())
    and cpa.status = 'active'
  order by cpa.created_at desc
  limit 1;

  if not found then
    raise exception 'Active patient portal access is required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'open_balance_cents',
    coalesce(
      (
        select cbs.open_balance_cents
        from public.client_balance_summaries cbs
        where cbs.tenant_id = v_access.tenant_id
          and cbs.client_id = v_access.client_id
        limit 1
      ),
      0
    ),
    'payments',
    coalesce(
      (
        select jsonb_agg(row_data order by payment_date desc, created_at desc)
        from (
          select
            jsonb_build_object(
              'id', p.id,
              'payment_date', p.payment_date,
              'amount_cents', p.amount_cents,
              'payment_method', p.payment_method,
              'payment_status', p.payment_status,
              'created_at', p.created_at
            ) as row_data,
            p.payment_date,
            p.created_at
          from public.payments p
          where p.tenant_id = v_access.tenant_id
            and p.client_id = v_access.client_id
            and p.payment_source = 'patient'::public.payment_source_enum
            and p.payment_status <> 'voided'::public.payment_status_enum
          order by p.payment_date desc, p.created_at desc
          limit 50
        ) patient_payments
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function private.get_my_portal_billing_summary_impl() from public, anon;
grant execute on function private.get_my_portal_billing_summary_impl() to authenticated;

create or replace function public.get_my_portal_billing_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_my_portal_billing_summary_impl();
$$;

revoke all on function public.get_my_portal_billing_summary() from public, anon;
grant execute on function public.get_my_portal_billing_summary() to authenticated;

commit;

create or replace function private.portal_register_insurance_card_impl(
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_access public.client_portal_access%rowtype;
  v_storage_path text := trim(coalesce(p_storage_path, ''));
  v_file_name text := regexp_replace(trim(coalesce(p_file_name, '')), '[\\/]+', '_', 'g');
  v_mime_type text := lower(trim(coalesce(p_mime_type, '')));
  v_document public.documents%rowtype;
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
    'client'::public.workqueue_source_object_type_enum,
    v_access.client_id,
    'Review patient insurance card',
    'Patient uploaded a new insurance card. Review document ' || v_document.id::text ||
      ' and update coverage if needed.',
    (select auth.uid())
  )
  returning * into v_work;

  return jsonb_build_object(
    'id', v_document.id,
    'file_name', v_document.file_name,
    'document_type', v_document.document_type,
    'document_status', v_document.document_status,
    'workqueue_item_id', v_work.id,
    'created_at', v_document.created_at
  );
end;
$function$;

create or replace function private.portal_submit_change_request_impl(
  p_request_type text,
  p_details text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_access public.client_portal_access%rowtype;
  v_request_type text := lower(trim(coalesce(p_request_type, '')));
  v_details text := trim(coalesce(p_details, ''));
  v_subject text;
  v_work public.workqueue_items%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if v_request_type not in ('demographics', 'insurance') then
    raise exception 'Unsupported portal change request type' using errcode = '22023';
  end if;

  if v_details = '' then
    raise exception 'Describe what needs to be updated' using errcode = '22023';
  end if;

  if length(v_details) > 2000 then
    raise exception 'Change request details must be 2000 characters or fewer' using errcode = '22023';
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

  v_subject := case v_request_type
    when 'demographics' then 'Patient demographic update request'
    when 'insurance' then 'Patient insurance update request'
  end;

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
    'client'::public.workqueue_source_object_type_enum,
    v_access.client_id,
    v_subject,
    'Submitted from patient portal.' || E'\n\n' || v_details,
    (select auth.uid())
  )
  returning * into v_work;

  return jsonb_build_object(
    'workqueue_item_id', v_work.id,
    'request_type', v_request_type,
    'status', v_work.workqueue_status,
    'created_at', v_work.created_at
  );
end;
$function$;

create or replace function private.portal_submit_schedule_change_impl(
  p_appointment_id uuid,
  p_request_type text,
  p_details text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_access public.client_portal_access%rowtype;
  v_appointment public.appointments%rowtype;
  v_request_type text := lower(trim(coalesce(p_request_type, '')));
  v_details text := trim(coalesce(p_details, ''));
  v_subject text;
  v_work public.workqueue_items%rowtype;
  v_priority public.workqueue_priority_enum;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if v_request_type not in ('cancel', 'reschedule') then
    raise exception 'Unsupported schedule change request type' using errcode = '22023';
  end if;

  if v_details = '' then
    raise exception 'Add a note for the practice about this schedule change' using errcode = '22023';
  end if;

  if length(v_details) > 2000 then
    raise exception 'Schedule change details must be 2000 characters or fewer' using errcode = '22023';
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

  select a.*
    into v_appointment
  from public.appointments a
  where a.id = p_appointment_id
    and a.tenant_id = v_access.tenant_id
    and a.client_id = v_access.client_id
  limit 1;

  if not found then
    raise exception 'Appointment is unavailable' using errcode = 'P0002';
  end if;

  if v_appointment.appointment_status::text not in ('scheduled', 'confirmed') then
    raise exception 'This appointment can no longer be changed from the portal. Contact the practice directly.' using errcode = '22023';
  end if;

  if v_appointment.starts_at <= now() then
    raise exception 'This appointment has already started. Contact the practice directly.' using errcode = '22023';
  end if;

  v_subject := case v_request_type
    when 'cancel' then 'Patient cancellation request'
    when 'reschedule' then 'Patient reschedule request'
  end;

  v_priority := case
    when v_appointment.starts_at <= now() + interval '48 hours'
      then 'high'::public.workqueue_priority_enum
    else 'normal'::public.workqueue_priority_enum
  end;

  insert into public.workqueue_items (
    tenant_id,
    workqueue_type,
    workqueue_status,
    priority,
    source_object_type,
    source_object_id,
    title,
    description,
    due_date,
    created_by
  ) values (
    v_access.tenant_id,
    'correspondence'::public.workqueue_type_enum,
    'open'::public.workqueue_status_enum,
    v_priority,
    'appointment'::public.workqueue_source_object_type_enum,
    v_appointment.id,
    v_subject,
    'Submitted from patient portal for appointment ' || v_appointment.id::text ||
      ' scheduled ' || v_appointment.starts_at::text || E'.\n\n' || v_details,
    (v_appointment.starts_at at time zone 'UTC')::date,
    (select auth.uid())
  )
  returning * into v_work;

  return jsonb_build_object(
    'workqueue_item_id', v_work.id,
    'appointment_id', v_appointment.id,
    'request_type', v_request_type,
    'status', v_work.workqueue_status,
    'created_at', v_work.created_at
  );
end;
$function$;

drop trigger if exists trg_route_document_to_mailroom on public.documents;
drop function if exists private.route_document_to_mailroom();
drop function if exists public.transition_mailroom_item(uuid, text, text);
drop function if exists public.get_mailroom_assignees(uuid);
drop function if exists private.get_mailroom_assignees(uuid);
drop function if exists private.get_demo_mailroom_assignees();

alter type public.workqueue_source_object_type_enum
  rename value 'mailroom_item' to 'legacy_correspondence';

drop table public.mailroom_items;

alter table public.documents drop column authorization_id;

drop table public.authorization_units;
drop table public.authorizations;

drop table public.system_events;

drop function if exists public.get_coding_guidance_sheet(text, text);
drop table public.coding_guidance_sheet_rows;

notify pgrst, 'reload schema';

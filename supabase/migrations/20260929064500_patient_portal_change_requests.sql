begin;

create or replace function private.portal_submit_change_request_impl(
  p_request_type text,
  p_details text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.client_portal_access%rowtype;
  v_request_type text := lower(trim(coalesce(p_request_type, '')));
  v_details text := trim(coalesce(p_details, ''));
  v_subject text;
  v_item public.mailroom_items%rowtype;
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
    v_subject,
    'client_correspondence',
    current_date,
    'action_required',
    'Submitted from patient portal.' || E'\n\n' || v_details
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
    v_subject,
    case v_request_type
      when 'demographics' then 'Patient-submitted demographic change requires staff review.'
      when 'insurance' then 'Patient-submitted insurance change requires staff review.'
    end,
    (select auth.uid())
  )
  returning * into v_work;

  insert into public.status_history (
    tenant_id,
    target_type,
    target_id,
    old_status,
    new_status,
    changed_by,
    reason
  ) values (
    v_access.tenant_id,
    'mailroom_item',
    v_item.id,
    null,
    'action_required',
    (select auth.uid()),
    'Created from patient portal change request.'
  );

  return jsonb_build_object(
    'mailroom_item_id', v_item.id,
    'workqueue_item_id', v_work.id,
    'request_type', v_request_type,
    'status', v_item.status,
    'created_at', v_item.created_at
  );
end;
$$;

revoke all on function private.portal_submit_change_request_impl(text, text) from public, anon;
grant execute on function private.portal_submit_change_request_impl(text, text) to authenticated;

create or replace function public.portal_submit_change_request(
  p_request_type text,
  p_details text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.portal_submit_change_request_impl(p_request_type, p_details);
$$;

revoke all on function public.portal_submit_change_request(text, text) from public, anon;
grant execute on function public.portal_submit_change_request(text, text) to authenticated;

commit;

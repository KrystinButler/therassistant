begin;

create or replace function private.portal_submit_schedule_change_impl(
  p_appointment_id uuid,
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
  v_appointment public.appointments%rowtype;
  v_request_type text := lower(trim(coalesce(p_request_type, '')));
  v_details text := trim(coalesce(p_details, ''));
  v_subject text;
  v_item public.mailroom_items%rowtype;
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

  insert into public.mailroom_items (
    tenant_id,
    client_id,
    subject,
    correspondence_type,
    received_date,
    due_date,
    status,
    notes
  ) values (
    v_access.tenant_id,
    v_access.client_id,
    v_subject,
    'client_correspondence',
    current_date,
    (v_appointment.starts_at at time zone 'UTC')::date,
    'action_required',
    'Submitted from patient portal for appointment ' || v_appointment.id::text ||
      ' scheduled ' || v_appointment.starts_at::text || E'.\n\n' || v_details
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
    due_date,
    created_by
  ) values (
    v_access.tenant_id,
    'correspondence'::public.workqueue_type_enum,
    'open'::public.workqueue_status_enum,
    v_priority,
    'mailroom_item'::public.workqueue_source_object_type_enum,
    v_item.id,
    v_subject,
    case v_request_type
      when 'cancel' then 'Patient requested appointment cancellation; staff confirmation is required.'
      when 'reschedule' then 'Patient requested appointment rescheduling; staff follow-up is required.'
    end,
    (v_appointment.starts_at at time zone 'UTC')::date,
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
    'Created from patient portal schedule change request.'
  );

  return jsonb_build_object(
    'mailroom_item_id', v_item.id,
    'workqueue_item_id', v_work.id,
    'appointment_id', v_appointment.id,
    'request_type', v_request_type,
    'status', v_item.status,
    'created_at', v_item.created_at
  );
end;
$$;

revoke all on function private.portal_submit_schedule_change_impl(uuid, text, text) from public, anon;
grant execute on function private.portal_submit_schedule_change_impl(uuid, text, text) to authenticated;

create or replace function public.portal_submit_schedule_change(
  p_appointment_id uuid,
  p_request_type text,
  p_details text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.portal_submit_schedule_change_impl(p_appointment_id, p_request_type, p_details);
$$;

revoke all on function public.portal_submit_schedule_change(uuid, text, text) from public, anon;
grant execute on function public.portal_submit_schedule_change(uuid, text, text) to authenticated;

commit;

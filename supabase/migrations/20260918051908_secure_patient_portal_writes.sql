begin;

create or replace function private.record_client_checkin_impl(
  p_appointment_id uuid,
  p_status text,
  p_responses jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_checkin_id uuid;
  v_new_status public.appointment_status_enum;
  v_staff_access boolean := false;
  v_patient_access boolean := false;
begin
  select * into v_appt
  from public.appointments
  where id = p_appointment_id;

  if not found then
    raise exception 'Appointment is unavailable';
  end if;

  v_staff_access := coalesce(private.has_tenant_write_access(v_appt.tenant_id), false);
  v_patient_access := coalesce(
    private.has_client_portal_access(v_appt.tenant_id, v_appt.client_id),
    false
  );

  if not v_staff_access and not v_patient_access then
    raise exception 'Appointment is unavailable';
  end if;

  if lower(coalesce(p_status, '')) not in ('on_my_way', 'arrived', 'checked_in') then
    raise exception 'Invalid check-in status';
  end if;

  if v_patient_access and not v_staff_access then
    if v_appt.appointment_status in (
      'completed'::public.appointment_status_enum,
      'cancelled'::public.appointment_status_enum,
      'no_show'::public.appointment_status_enum,
      'late_cancel'::public.appointment_status_enum
    ) then
      raise exception 'Appointment is unavailable';
    end if;

    if coalesce(p_responses, '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'Patient check-in responses must use the pre-visit endpoint';
    end if;
  end if;

  insert into public.client_checkins (
    tenant_id, appointment_id, client_id,
    on_my_way_at, arrived_at, checked_in_at, responses
  )
  values (
    v_appt.tenant_id,
    v_appt.id,
    v_appt.client_id,
    case when lower(p_status) = 'on_my_way' then now() else null end,
    case when lower(p_status) = 'arrived' then now() else null end,
    case when lower(p_status) = 'checked_in' then now() else null end,
    case when v_staff_access then coalesce(p_responses, '{}'::jsonb) else '{}'::jsonb end
  )
  on conflict (appointment_id)
  do update set
    on_my_way_at = coalesce(public.client_checkins.on_my_way_at, excluded.on_my_way_at),
    arrived_at = coalesce(public.client_checkins.arrived_at, excluded.arrived_at),
    checked_in_at = coalesce(public.client_checkins.checked_in_at, excluded.checked_in_at),
    responses = case
      when v_staff_access
        then coalesce(public.client_checkins.responses, '{}'::jsonb)
          || coalesce(excluded.responses, '{}'::jsonb)
      else public.client_checkins.responses
    end,
    updated_at = now()
  returning id into v_checkin_id;

  v_new_status := case lower(p_status)
    when 'on_my_way' then 'client_on_my_way'::public.appointment_status_enum
    when 'arrived' then 'client_arrived'::public.appointment_status_enum
    else 'checked_in'::public.appointment_status_enum
  end;

  update public.appointments
  set appointment_status = v_new_status,
      updated_at = now()
  where id = v_appt.id;

  insert into public.status_history (
    tenant_id, target_type, target_id, old_status, new_status, changed_by, reason
  )
  values (
    v_appt.tenant_id,
    'appointment',
    v_appt.id,
    v_appt.appointment_status::text,
    v_new_status::text,
    (select auth.uid()),
    'Client check-in update'
  );

  return v_checkin_id;
end;
$$;

revoke all on function private.record_client_checkin_impl(uuid, text, jsonb) from public, anon;
grant execute on function private.record_client_checkin_impl(uuid, text, jsonb) to authenticated;

create or replace function public.record_client_checkin(
  p_appointment_id uuid,
  p_status text,
  p_responses jsonb default '{}'::jsonb
) returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.record_client_checkin_impl(p_appointment_id, p_status, p_responses);
$$;

revoke all on function public.record_client_checkin(uuid, text, jsonb) from public, anon;
grant execute on function public.record_client_checkin(uuid, text, jsonb) to authenticated;

create or replace function private.portal_save_previsit_checkin_impl(
  p_appointment_id uuid,
  p_update jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_checkin public.client_checkins%rowtype;
  v_previous jsonb := '{}'::jsonb;
  v_next jsonb := '{}'::jsonb;
  v_responses jsonb := '{}'::jsonb;
begin
  select * into v_appt
  from public.appointments
  where id = p_appointment_id;

  if not found
     or not private.has_client_portal_access(v_appt.tenant_id, v_appt.client_id) then
    raise exception 'Appointment is unavailable';
  end if;

  if v_appt.appointment_status in (
    'completed'::public.appointment_status_enum,
    'cancelled'::public.appointment_status_enum,
    'no_show'::public.appointment_status_enum,
    'late_cancel'::public.appointment_status_enum
  ) then
    raise exception 'Appointment is unavailable';
  end if;

  if p_update is null or jsonb_typeof(p_update) <> 'object' then
    raise exception 'Pre-visit update must be an object';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_update) as supplied(key)
    where supplied.key not in (
      'demographics_confirmed',
      'insurance_confirmed',
      'visit_questions',
      'consents',
      'submitted'
    )
  ) then
    raise exception 'Unsupported pre-visit field';
  end if;

  select * into v_checkin
  from public.client_checkins
  where appointment_id = v_appt.id
  limit 1;

  v_responses := coalesce(v_checkin.responses, '{}'::jsonb);
  v_previous := coalesce(v_responses -> 'pre_visit', '{}'::jsonb);
  v_next := v_previous || jsonb_build_object('updated_at', now());

  if p_update ? 'demographics_confirmed' then
    if jsonb_typeof(p_update -> 'demographics_confirmed') <> 'boolean' then
      raise exception 'Demographics confirmation must be boolean';
    end if;
    v_next := v_next || jsonb_build_object(
      'demographics_confirmed',
      (p_update ->> 'demographics_confirmed')::boolean
    );
  end if;

  if p_update ? 'insurance_confirmed' then
    if jsonb_typeof(p_update -> 'insurance_confirmed') <> 'boolean' then
      raise exception 'Insurance confirmation must be boolean';
    end if;
    v_next := v_next || jsonb_build_object(
      'insurance_confirmed',
      (p_update ->> 'insurance_confirmed')::boolean
    );
  end if;

  if p_update ? 'visit_questions' then
    if jsonb_typeof(p_update -> 'visit_questions') <> 'object' then
      raise exception 'Visit questions must be an object';
    end if;
    v_next := v_next || jsonb_build_object(
      'visit_questions',
      coalesce(v_previous -> 'visit_questions', '{}'::jsonb)
        || (p_update -> 'visit_questions')
    );
  end if;

  if p_update ? 'consents' then
    if jsonb_typeof(p_update -> 'consents') <> 'object' then
      raise exception 'Consents must be an object';
    end if;
    v_next := v_next || jsonb_build_object(
      'consents',
      coalesce(v_previous -> 'consents', '{}'::jsonb)
        || (p_update -> 'consents')
    );
  end if;

  if p_update ? 'submitted' then
    if jsonb_typeof(p_update -> 'submitted') <> 'boolean' then
      raise exception 'Submitted must be boolean';
    end if;
    if (p_update ->> 'submitted')::boolean then
      v_next := v_next || jsonb_build_object('submitted_at', now());
    end if;
  end if;

  v_responses := v_responses || jsonb_build_object('pre_visit', v_next);

  insert into public.client_checkins (tenant_id, appointment_id, client_id, responses)
  values (v_appt.tenant_id, v_appt.id, v_appt.client_id, v_responses)
  on conflict (appointment_id)
  do update set responses = excluded.responses, updated_at = now()
  returning * into v_checkin;

  return to_jsonb(v_checkin);
end;
$$;

revoke all on function private.portal_save_previsit_checkin_impl(uuid, jsonb) from public, anon;
grant execute on function private.portal_save_previsit_checkin_impl(uuid, jsonb) to authenticated;

create or replace function public.portal_save_previsit_checkin(
  p_appointment_id uuid,
  p_update jsonb
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.portal_save_previsit_checkin_impl(p_appointment_id, p_update);
$$;

revoke all on function public.portal_save_previsit_checkin(uuid, jsonb) from public, anon;
grant execute on function public.portal_save_previsit_checkin(uuid, jsonb) to authenticated;

create or replace function private.portal_add_journal_entry_impl(
  p_entry_text text,
  p_mood text default null,
  p_visibility text default 'shared_with_provider',
  p_tags jsonb default '[]'::jsonb,
  p_related_treatment_goal_id uuid default null,
  p_entry_status text default 'submitted'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.client_portal_access%rowtype;
  v_entry public.patient_journal_entries%rowtype;
begin
  select * into v_access
  from public.client_portal_access
  where user_id = (select auth.uid())
    and status = 'active'
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'Active patient portal access is required';
  end if;

  if nullif(trim(coalesce(p_entry_text, '')), '') is null then
    raise exception 'Journal entry text is required';
  end if;

  if p_visibility not in ('private', 'shared_with_provider') then
    raise exception 'Invalid journal visibility';
  end if;

  if p_entry_status not in ('draft', 'submitted') then
    raise exception 'Invalid journal entry status';
  end if;

  if jsonb_typeof(coalesce(p_tags, '[]'::jsonb)) <> 'array' then
    raise exception 'Journal tags must be an array';
  end if;

  if p_related_treatment_goal_id is not null and not exists (
    select 1
    from public.treatment_plan_goals tpg
    join public.treatment_plans tp on tp.id = tpg.treatment_plan_id
    where tpg.id = p_related_treatment_goal_id
      and tp.tenant_id = v_access.tenant_id
      and tp.client_id = v_access.client_id
  ) then
    raise exception 'Treatment goal is unavailable';
  end if;

  insert into public.patient_journal_entries (
    tenant_id, client_id, entry_date, entry_text, mood, author_type,
    review_status, visibility, tags, related_treatment_goal_id,
    entry_status, submitted_at
  )
  values (
    v_access.tenant_id,
    v_access.client_id,
    current_date,
    trim(p_entry_text),
    nullif(trim(coalesce(p_mood, '')), ''),
    'patient',
    'unreviewed',
    p_visibility,
    coalesce(p_tags, '[]'::jsonb),
    p_related_treatment_goal_id,
    p_entry_status,
    case when p_entry_status = 'submitted' then now() else null end
  )
  returning * into v_entry;

  return to_jsonb(v_entry);
end;
$$;

revoke all on function private.portal_add_journal_entry_impl(text, text, text, jsonb, uuid, text) from public, anon;
grant execute on function private.portal_add_journal_entry_impl(text, text, text, jsonb, uuid, text) to authenticated;

create or replace function public.portal_add_journal_entry(
  p_entry_text text,
  p_mood text default null,
  p_visibility text default 'shared_with_provider',
  p_tags jsonb default '[]'::jsonb,
  p_related_treatment_goal_id uuid default null,
  p_entry_status text default 'submitted'
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.portal_add_journal_entry_impl(
    p_entry_text, p_mood, p_visibility, p_tags,
    p_related_treatment_goal_id, p_entry_status
  );
$$;

revoke all on function public.portal_add_journal_entry(text, text, text, jsonb, uuid, text) from public, anon;
grant execute on function public.portal_add_journal_entry(text, text, text, jsonb, uuid, text) to authenticated;

commit;


drop function if exists public.create_roster_action_work(
  uuid, uuid, public.roster_action_type_enum, jsonb, text, date,
  public.workqueue_priority_enum, uuid, uuid
);

drop function if exists public.transition_roster_action(
  uuid, uuid, public.roster_action_status_enum, text, text, text
);

CREATE OR REPLACE FUNCTION public.create_roster_action_work(p_tenant_id uuid, p_enrollment_id uuid, p_action_type roster_action_type_enum, p_requested_change jsonb DEFAULT '{}'::jsonb, p_notes text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_priority workqueue_priority_enum DEFAULT 'normal'::workqueue_priority_enum, p_assigned_user_id uuid DEFAULT NULL::uuid, p_participation_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(roster_action_id uuid, workqueue_item_id uuid)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_action_id uuid;
  v_work_id uuid;
  v_participation_id uuid;
  v_provider_name text;
  v_payer_name text;
  v_description text;
begin
  if auth.uid() is null or not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'Tenant write access required'
      using errcode = '42501';
  end if;

  select
    trim(concat_ws(' ', pr.first_name, pr.last_name)),
    py.name
  into v_provider_name, v_payer_name
  from public.provider_payer_enrollments e
  join public.providers pr
    on pr.id = e.provider_id
   and pr.tenant_id = e.tenant_id
  join public.payers py
    on py.id = e.payer_id
  where e.id = p_enrollment_id
    and e.tenant_id = p_tenant_id;

  if not found then
    raise exception 'Enrollment not found for tenant'
      using errcode = '22023';
  end if;

  if p_participation_id is not null then
    select np.id
    into v_participation_id
    from public.provider_network_participation np
    where np.id = p_participation_id
      and np.tenant_id = p_tenant_id
      and np.enrollment_id = p_enrollment_id;

    if not found then
      raise exception 'Network participation does not match enrollment'
        using errcode = '22023';
    end if;
  else
    select np.id
    into v_participation_id
    from public.provider_network_participation np
    where np.tenant_id = p_tenant_id
      and np.enrollment_id = p_enrollment_id;
  end if;

  if p_assigned_user_id is not null and not exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.user_id = p_assigned_user_id
      and tu.status = 'active'
  ) then
    raise exception 'Assigned user is not an active tenant member'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.roster_actions ra
    where ra.tenant_id = p_tenant_id
      and ra.enrollment_id = p_enrollment_id
      and ra.action_type = p_action_type
      and ra.requested_change = coalesce(p_requested_change, '{}'::jsonb)
      and ra.status not in ('confirmed', 'cancelled')
  ) then
    raise exception 'An active matching roster action already exists'
      using errcode = '23505';
  end if;

  insert into public.roster_actions (
    tenant_id,
    enrollment_id,
    participation_id,
    action_type,
    status,
    requested_date,
    requested_change,
    notes,
    assigned_user_id
  )
  values (
    p_tenant_id,
    p_enrollment_id,
    v_participation_id,
    p_action_type,
    'ready',
    current_date,
    coalesce(p_requested_change, '{}'::jsonb),
    nullif(btrim(p_notes), ''),
    p_assigned_user_id
  )
  returning id into v_action_id;

  v_description := coalesce(
    nullif(btrim(p_notes), ''),
    nullif(coalesce(p_requested_change, '{}'::jsonb)->>'details', ''),
    'Payer roster maintenance action'
  );

  v_work_id := public.create_workqueue_item(
    p_tenant_id := p_tenant_id,
    p_workqueue_type := 'roster_action',
    p_source_object_type := 'roster_action',
    p_source_object_id := v_action_id,
    p_title := 'Roster: ' || initcap(replace(p_action_type::text, '_', ' ')) ||
      case when coalesce(v_provider_name, '') <> '' then ' · ' || v_provider_name else '' end ||
      case when coalesce(v_payer_name, '') <> '' then ' · ' || v_payer_name else '' end,
    p_description := v_description,
    p_priority := coalesce(p_priority, 'normal'),
    p_due_date := p_due_date,
    p_assigned_user_id := p_assigned_user_id
  );

  return query select v_action_id, v_work_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.transition_roster_action(p_tenant_id uuid, p_roster_action_id uuid, p_status roster_action_status_enum, p_reference_number text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_old_status public.roster_action_status_enum;
  v_reason text;
  v_work_status public.workqueue_status_enum;
begin
  if auth.uid() is null or not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'Tenant write access required'
      using errcode = '42501';
  end if;

  select ra.status
  into v_old_status
  from public.roster_actions ra
  where ra.id = p_roster_action_id
    and ra.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Roster action not found for tenant'
      using errcode = '22023';
  end if;

  if p_status is distinct from v_old_status and not (
    (v_old_status = 'not_started' and p_status in ('ready', 'cancelled')) or
    (v_old_status = 'ready' and p_status in ('submitted', 'cancelled')) or
    (v_old_status = 'submitted' and p_status in ('pending', 'confirmed', 'rejected', 'cancelled')) or
    (v_old_status = 'pending' and p_status in ('confirmed', 'rejected', 'cancelled')) or
    (v_old_status = 'rejected' and p_status in ('ready', 'cancelled'))
  ) then
    raise exception 'Invalid roster action transition: % -> %', v_old_status, p_status
      using errcode = '22023';
  end if;

  update public.roster_actions
  set
    status = p_status,
    submitted_date = case
      when p_status = 'submitted' and submitted_date is null then current_date
      else submitted_date
    end,
    confirmed_date = case
      when p_status = 'confirmed' and confirmed_date is null then current_date
      else confirmed_date
    end,
    reference_number = coalesce(nullif(btrim(p_reference_number), ''), reference_number),
    notes = coalesce(nullif(btrim(p_notes), ''), notes)
  where id = p_roster_action_id
    and tenant_id = p_tenant_id;

  if p_status is distinct from v_old_status then
    v_reason := coalesce(
      nullif(btrim(p_reason), ''),
      nullif(btrim(p_notes), ''),
      'Roster action moved from ' || v_old_status::text || ' to ' || p_status::text
    );

    insert into public.status_history (
      tenant_id,
      target_type,
      target_id,
      old_status,
      new_status,
      changed_by,
      reason
    )
    values (
      p_tenant_id,
      'roster_action',
      p_roster_action_id,
      v_old_status::text,
      p_status::text,
      auth.uid(),
      v_reason
    );
  end if;

  v_work_status := case p_status
    when 'not_started' then 'open'::public.workqueue_status_enum
    when 'ready' then 'open'::public.workqueue_status_enum
    when 'submitted' then 'in_progress'::public.workqueue_status_enum
    when 'pending' then 'pending'::public.workqueue_status_enum
    when 'confirmed' then 'completed'::public.workqueue_status_enum
    when 'rejected' then 'open'::public.workqueue_status_enum
    when 'cancelled' then 'cancelled'::public.workqueue_status_enum
  end;

  update public.workqueue_items
  set
    workqueue_status = v_work_status,
    completed_at = case
      when v_work_status = 'completed' then coalesce(completed_at, now())
      else null
    end,
    completed_by = case
      when v_work_status = 'completed' then coalesce(completed_by, auth.uid())
      else null
    end
  where tenant_id = p_tenant_id
    and workqueue_type = 'roster_action'
    and source_object_type = 'roster_action'
    and source_object_id = p_roster_action_id
    and workqueue_status <> v_work_status;

  return p_roster_action_id;
end;
$function$
;

revoke all on function public.create_roster_action_work(
  uuid, uuid, public.roster_action_type_enum, jsonb, text, date,
  public.workqueue_priority_enum, uuid, uuid
) from public, anon;
grant execute on function public.create_roster_action_work(
  uuid, uuid, public.roster_action_type_enum, jsonb, text, date,
  public.workqueue_priority_enum, uuid, uuid
) to authenticated, service_role;

revoke all on function public.transition_roster_action(
  uuid, uuid, public.roster_action_status_enum, text, text, text
) from public, anon;
grant execute on function public.transition_roster_action(
  uuid, uuid, public.roster_action_status_enum, text, text, text
) to authenticated, service_role;


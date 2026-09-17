create or replace function public.transition_provider_enrollment(
  p_tenant_id uuid,
  p_enrollment_id uuid,
  p_enrollment_status public.provider_enrollment_status_enum,
  p_reason text default 'Credentialing workflow update'
)
returns uuid
language plpgsql
security invoker
set search_path = public, private, auth, pg_temp
as $$
declare
  v_before public.provider_payer_enrollments%rowtype;
  v_after public.provider_payer_enrollments%rowtype;
  v_payer_name text;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required';
  end if;

  if not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'Write access required for tenant %', p_tenant_id;
  end if;

  select * into v_before
  from public.provider_payer_enrollments
  where id = p_enrollment_id
    and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Provider enrollment not found';
  end if;

  update public.provider_payer_enrollments
  set enrollment_status = p_enrollment_status,
      updated_at = now()
  where id = p_enrollment_id
    and tenant_id = p_tenant_id
  returning * into v_after;

  if v_before.enrollment_status is distinct from v_after.enrollment_status then
    insert into public.status_history (
      tenant_id,
      target_type,
      target_id,
      old_status,
      new_status,
      changed_by,
      reason
    ) values (
      p_tenant_id,
      'provider_payer_enrollment',
      p_enrollment_id,
      v_before.enrollment_status::text,
      v_after.enrollment_status::text,
      auth.uid(),
      nullif(trim(coalesce(p_reason, '')), '')
    );
  end if;

  if v_after.enrollment_status = 'needs_revalidation'::public.provider_enrollment_status_enum
     or (
       v_after.enrollment_status = 'approved'::public.provider_enrollment_status_enum
       and v_after.revalidation_due_date is not null
       and v_after.revalidation_due_date <= current_date + 90
     ) then
    select name into v_payer_name
    from public.payers
    where id = v_after.payer_id;

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
    )
    select
      p_tenant_id,
      'credentialing_issue'::public.workqueue_type_enum,
      'open'::public.workqueue_status_enum,
      case
        when v_after.revalidation_due_date is not null and v_after.revalidation_due_date < current_date
          then 'urgent'::public.workqueue_priority_enum
        else 'high'::public.workqueue_priority_enum
      end,
      'provider'::public.workqueue_source_object_type_enum,
      v_after.provider_id,
      coalesce(v_payer_name, 'Payer') || ' revalidation ' ||
        case
          when v_after.revalidation_due_date is not null and v_after.revalidation_due_date < current_date then 'overdue'
          else 'due soon'
        end,
      case
        when v_after.revalidation_due_date is null then 'Provider revalidation requires action.'
        else 'Provider revalidation is due ' || v_after.revalidation_due_date::text || '.'
      end,
      v_after.revalidation_due_date,
      auth.uid()
    where not exists (
      select 1
      from public.workqueue_items w
      where w.tenant_id = p_tenant_id
        and w.workqueue_type = 'credentialing_issue'::public.workqueue_type_enum
        and w.source_object_type = 'provider'::public.workqueue_source_object_type_enum
        and w.source_object_id = v_after.provider_id
        and w.workqueue_status not in (
          'completed'::public.workqueue_status_enum,
          'cancelled'::public.workqueue_status_enum
        )
        and w.title ilike coalesce(v_payer_name, 'Payer') || ' revalidation%'
    );
  end if;

  return v_after.id;
end;
$$;

revoke all on function public.transition_provider_enrollment(uuid, uuid, public.provider_enrollment_status_enum, text) from public, anon;
grant execute on function public.transition_provider_enrollment(uuid, uuid, public.provider_enrollment_status_enum, text) to authenticated, service_role;

create or replace function public.sync_provider_revalidation_work(
  p_tenant_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = public, private, auth, pg_temp
as $$
declare
  v_created integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required';
  end if;

  if not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'Write access required for tenant %', p_tenant_id;
  end if;

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
  )
  select
    ppe.tenant_id,
    'credentialing_issue'::public.workqueue_type_enum,
    'open'::public.workqueue_status_enum,
    case
      when ppe.revalidation_due_date < current_date then 'urgent'::public.workqueue_priority_enum
      else 'high'::public.workqueue_priority_enum
    end,
    'provider'::public.workqueue_source_object_type_enum,
    ppe.provider_id,
    p.name || ' revalidation ' ||
      case
        when ppe.revalidation_due_date < current_date then 'overdue'
        else 'due soon'
      end,
    'Provider revalidation is due ' || ppe.revalidation_due_date::text || '.',
    ppe.revalidation_due_date,
    auth.uid()
  from public.provider_payer_enrollments ppe
  join public.payers p on p.id = ppe.payer_id
  where ppe.tenant_id = p_tenant_id
    and ppe.revalidation_due_date is not null
    and ppe.enrollment_status in (
      'approved'::public.provider_enrollment_status_enum,
      'needs_revalidation'::public.provider_enrollment_status_enum
    )
    and ppe.revalidation_due_date <= current_date + 90
    and not exists (
      select 1
      from public.workqueue_items w
      where w.tenant_id = ppe.tenant_id
        and w.workqueue_type = 'credentialing_issue'::public.workqueue_type_enum
        and w.source_object_type = 'provider'::public.workqueue_source_object_type_enum
        and w.source_object_id = ppe.provider_id
        and w.workqueue_status not in (
          'completed'::public.workqueue_status_enum,
          'cancelled'::public.workqueue_status_enum
        )
        and w.title ilike p.name || ' revalidation%'
    );

  get diagnostics v_created = row_count;
  return v_created;
end;
$$;

revoke all on function public.sync_provider_revalidation_work(uuid) from public, anon;
grant execute on function public.sync_provider_revalidation_work(uuid) to authenticated, service_role;

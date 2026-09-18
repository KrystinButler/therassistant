
create or replace function public.sync_credentialing_operational_work(
  p_tenant_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $function$
declare
  v_created integer := 0;
  v_count integer := 0;
begin
  if auth.uid() is null or not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'Tenant write access required'
      using errcode = '42501';
  end if;

  -- Initial 14-day payer follow-up after submission. Once any payer contact is
  -- recorded, subsequent scheduling is owned by credentialing_followups.
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
    assigned_user_id,
    created_by
  )
  select
    ca.tenant_id,
    'credentialing_followup'::public.workqueue_type_enum,
    'open'::public.workqueue_status_enum,
    ca.priority,
    'credentialing_application'::public.workqueue_source_object_type_enum,
    ca.id,
    'Credentialing: Payer Follow-Up',
    'Follow up with the payer 14 days after credentialing submission.',
    ca.submitted_date + 14,
    ca.assigned_user_id,
    auth.uid()
  from public.credentialing_applications ca
  where ca.tenant_id = p_tenant_id
    and ca.status in (
      'submitted'::public.credentialing_application_status_enum,
      'payer_review'::public.credentialing_application_status_enum
    )
    and ca.submitted_date is not null
    and ca.submitted_date + 14 <= current_date
    and not exists (
      select 1
      from public.credentialing_followups cf
      where cf.tenant_id = ca.tenant_id
        and cf.application_id = ca.id
        and cf.followup_date >= ca.submitted_date
    )
    and not exists (
      select 1
      from public.workqueue_items w
      where w.tenant_id = ca.tenant_id
        and w.source_object_type = 'credentialing_application'
        and w.source_object_id = ca.id
        and w.workqueue_type = 'credentialing_followup'
        and w.workqueue_status not in ('completed', 'cancelled')
    );

  get diagnostics v_count = row_count;
  v_created := v_created + v_count;

  -- Escalate any existing active follow-up when the payer asks for more.
  update public.workqueue_items w
  set
    priority = 'high',
    title = 'Credentialing: Additional Information Requested',
    description = 'The payer requested additional information. Review requirements and respond.',
    due_date = current_date,
    assigned_user_id = coalesce(ca.assigned_user_id, w.assigned_user_id),
    workqueue_status = case
      when w.workqueue_status in ('pending', 'snoozed') then 'open'
      else w.workqueue_status
    end,
    completed_at = null,
    completed_by = null
  from public.credentialing_applications ca
  where ca.tenant_id = p_tenant_id
    and ca.status = 'additional_information_requested'
    and w.tenant_id = ca.tenant_id
    and w.source_object_type = 'credentialing_application'
    and w.source_object_id = ca.id
    and w.workqueue_type = 'credentialing_followup'
    and w.workqueue_status not in ('completed', 'cancelled');

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
    assigned_user_id,
    created_by
  )
  select
    ca.tenant_id,
    'credentialing_followup'::public.workqueue_type_enum,
    'open'::public.workqueue_status_enum,
    'high'::public.workqueue_priority_enum,
    'credentialing_application'::public.workqueue_source_object_type_enum,
    ca.id,
    'Credentialing: Additional Information Requested',
    'The payer requested additional information. Review requirements and respond.',
    current_date,
    ca.assigned_user_id,
    auth.uid()
  from public.credentialing_applications ca
  where ca.tenant_id = p_tenant_id
    and ca.status = 'additional_information_requested'
    and not exists (
      select 1
      from public.workqueue_items w
      where w.tenant_id = ca.tenant_id
        and w.source_object_type = 'credentialing_application'
        and w.source_object_id = ca.id
        and w.workqueue_type = 'credentialing_followup'
        and w.workqueue_status not in ('completed', 'cancelled')
    )
    and not exists (
      select 1
      from public.credentialing_followups cf
      where cf.tenant_id = ca.tenant_id
        and cf.application_id = ca.id
        and cf.followup_date >= ca.updated_at::date
    );

  get diagnostics v_count = row_count;
  v_created := v_created + v_count;

  -- Approval is not complete until effective date and payer provider ID are known.
  -- Reuse an active follow-up rather than creating a parallel task.
  update public.workqueue_items w
  set
    priority = 'high',
    title = 'Credentialing: Approval Details Needed',
    description = concat_ws(
      ' ',
      'Approval is recorded.',
      case when e.effective_date is null then 'Obtain the effective date.' end,
      case when nullif(btrim(e.payer_provider_id), '') is null then 'Obtain the payer provider ID.' end
    ),
    due_date = current_date + 3,
    assigned_user_id = coalesce(ca.assigned_user_id, w.assigned_user_id),
    workqueue_status = case
      when w.workqueue_status in ('pending', 'snoozed') then 'open'
      else w.workqueue_status
    end,
    completed_at = null,
    completed_by = null
  from public.credentialing_applications ca
  join public.provider_payer_enrollments e
    on e.id = ca.enrollment_id
   and e.tenant_id = ca.tenant_id
  where ca.tenant_id = p_tenant_id
    and ca.status = 'approved'
    and (
      e.effective_date is null
      or nullif(btrim(e.payer_provider_id), '') is null
    )
    and w.tenant_id = ca.tenant_id
    and w.source_object_type = 'credentialing_application'
    and w.source_object_id = ca.id
    and w.workqueue_type = 'credentialing_followup'
    and w.workqueue_status not in ('completed', 'cancelled');

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
    assigned_user_id,
    created_by
  )
  select
    ca.tenant_id,
    'credentialing_followup'::public.workqueue_type_enum,
    'open'::public.workqueue_status_enum,
    'high'::public.workqueue_priority_enum,
    'credentialing_application'::public.workqueue_source_object_type_enum,
    ca.id,
    'Credentialing: Approval Details Needed',
    concat_ws(
      ' ',
      'Approval is recorded.',
      case when e.effective_date is null then 'Obtain the effective date.' end,
      case when nullif(btrim(e.payer_provider_id), '') is null then 'Obtain the payer provider ID.' end
    ),
    current_date + 3,
    ca.assigned_user_id,
    auth.uid()
  from public.credentialing_applications ca
  join public.provider_payer_enrollments e
    on e.id = ca.enrollment_id
   and e.tenant_id = ca.tenant_id
  where ca.tenant_id = p_tenant_id
    and ca.status = 'approved'
    and (
      e.effective_date is null
      or nullif(btrim(e.payer_provider_id), '') is null
    )
    and not exists (
      select 1
      from public.workqueue_items w
      where w.tenant_id = ca.tenant_id
        and w.source_object_type = 'credentialing_application'
        and w.source_object_id = ca.id
        and w.workqueue_type = 'credentialing_followup'
        and w.workqueue_status not in ('completed', 'cancelled')
    )
    and not exists (
      select 1
      from public.credentialing_followups cf
      where cf.tenant_id = ca.tenant_id
        and cf.application_id = ca.id
        and cf.followup_date >= ca.updated_at::date
    );

  get diagnostics v_count = row_count;
  v_created := v_created + v_count;

  -- Effective participation should be followed by roster verification.
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
    assigned_user_id,
    created_by
  )
  select
    ca.tenant_id,
    'roster_action'::public.workqueue_type_enum,
    'open'::public.workqueue_status_enum,
    'normal'::public.workqueue_priority_enum,
    'credentialing_application'::public.workqueue_source_object_type_enum,
    ca.id,
    'Credentialing: Verify Payer Roster',
    'Verify that the provider is present on the payer roster after the effective date.',
    current_date + 7,
    ca.assigned_user_id,
    auth.uid()
  from public.credentialing_applications ca
  where ca.tenant_id = p_tenant_id
    and ca.status = 'effective'
    and not exists (
      select 1
      from public.workqueue_items w
      where w.tenant_id = ca.tenant_id
        and w.source_object_type = 'credentialing_application'
        and w.source_object_id = ca.id
        and w.workqueue_type = 'roster_action'
        and w.title = 'Credentialing: Verify Payer Roster'
    );

  get diagnostics v_count = row_count;
  v_created := v_created + v_count;

  -- Once roster presence is verified, verify the payer directory.
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
    assigned_user_id,
    created_by
  )
  select
    ca.tenant_id,
    'network_verification'::public.workqueue_type_enum,
    'open'::public.workqueue_status_enum,
    'normal'::public.workqueue_priority_enum,
    'credentialing_application'::public.workqueue_source_object_type_enum,
    ca.id,
    'Credentialing: Verify Payer Directory',
    'Verify the provider is accurately listed in the payer directory and retain evidence.',
    current_date + 7,
    ca.assigned_user_id,
    auth.uid()
  from public.credentialing_applications ca
  where ca.tenant_id = p_tenant_id
    and ca.status = 'roster_verified'
    and not exists (
      select 1
      from public.workqueue_items w
      where w.tenant_id = ca.tenant_id
        and w.source_object_type = 'credentialing_application'
        and w.source_object_id = ca.id
        and w.workqueue_type = 'network_verification'
        and w.title = 'Credentialing: Verify Payer Directory'
    );

  get diagnostics v_count = row_count;
  v_created := v_created + v_count;

  -- Explicit recredentialing milestone.
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
    assigned_user_id,
    created_by
  )
  select
    ca.tenant_id,
    'recredentialing'::public.workqueue_type_enum,
    'open'::public.workqueue_status_enum,
    'high'::public.workqueue_priority_enum,
    'credentialing_application'::public.workqueue_source_object_type_enum,
    ca.id,
    'Credentialing: Recredentialing Due',
    'Complete the payer recredentialing workflow and retain submission evidence.',
    current_date,
    ca.assigned_user_id,
    auth.uid()
  from public.credentialing_applications ca
  where ca.tenant_id = p_tenant_id
    and ca.status = 'recredentialing_due'
    and not exists (
      select 1
      from public.workqueue_items w
      where w.tenant_id = ca.tenant_id
        and w.source_object_type = 'credentialing_application'
        and w.source_object_id = ca.id
        and w.workqueue_type = 'recredentialing'
        and w.title = 'Credentialing: Recredentialing Due'
    );

  get diagnostics v_count = row_count;
  v_created := v_created + v_count;

  -- Credential renewal work at 90/60/30-day and overdue horizons.
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
    pc.tenant_id,
    'credential_expiration'::public.workqueue_type_enum,
    'open'::public.workqueue_status_enum,
    case
      when pc.expiration_date < current_date then 'urgent'::public.workqueue_priority_enum
      when pc.expiration_date <= current_date + 30 then 'high'::public.workqueue_priority_enum
      else 'normal'::public.workqueue_priority_enum
    end,
    'provider_credential'::public.workqueue_source_object_type_enum,
    pc.id,
    'Renew ' || coalesce(
      nullif(btrim(pc.credential_name), ''),
      initcap(replace(pc.credential_type, '_', ' '))
    ),
    'Provider credential is approaching expiration. Complete renewal and update the credential record.',
    pc.expiration_date,
    auth.uid()
  from public.provider_credentials pc
  where pc.tenant_id = p_tenant_id
    and pc.status = 'active'
    and pc.expiration_date is not null
    and pc.expiration_date <= current_date + 90
    and not exists (
      select 1
      from public.workqueue_items w
      where w.tenant_id = pc.tenant_id
        and w.source_object_type = 'provider_credential'
        and w.source_object_id = pc.id
        and w.workqueue_type = 'credential_expiration'
        and w.due_date is not distinct from pc.expiration_date
    );

  get diagnostics v_count = row_count;
  v_created := v_created + v_count;

  -- A terminated provider must be removed from each payer roster.
  with candidates as (
    select
      e.tenant_id,
      e.id as enrollment_id,
      np.id as participation_id
    from public.provider_payer_enrollments e
    join public.providers p
      on p.id = e.provider_id
     and p.tenant_id = e.tenant_id
    left join public.provider_network_participation np
      on np.enrollment_id = e.id
     and np.tenant_id = e.tenant_id
    where e.tenant_id = p_tenant_id
      and p.provider_status = 'terminated'
      and e.enrollment_status not in ('terminated', 'expired')
      and not exists (
        select 1
        from public.roster_actions ra
        where ra.tenant_id = e.tenant_id
          and ra.enrollment_id = e.id
          and ra.action_type = 'remove_provider'
          and (
            ra.status <> 'cancelled'
            or ra.requested_change->>'automation' = 'provider_terminated'
          )
      )
  ),
  inserted_roster as (
    insert into public.roster_actions (
      tenant_id,
      enrollment_id,
      participation_id,
      action_type,
      status,
      requested_date,
      requested_change,
      notes
    )
    select
      c.tenant_id,
      c.enrollment_id,
      c.participation_id,
      'remove_provider'::public.roster_action_type_enum,
      'ready'::public.roster_action_status_enum,
      current_date,
      jsonb_build_object(
        'automation', 'provider_terminated',
        'details', 'Remove terminated provider from payer roster.'
      ),
      'Automatically created because the provider is terminated in Therassistant.'
    from candidates c
    returning id, tenant_id, enrollment_id
  )
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
    ir.tenant_id,
    'roster_action'::public.workqueue_type_enum,
    'open'::public.workqueue_status_enum,
    'high'::public.workqueue_priority_enum,
    'roster_action'::public.workqueue_source_object_type_enum,
    ir.id,
    'Roster: Remove Provider · ' ||
      trim(concat_ws(' ', p.first_name, p.last_name)) ||
      ' · ' || py.name,
    'Provider is terminated in Therassistant. Remove the provider from the payer roster.',
    current_date + 3,
    auth.uid()
  from inserted_roster ir
  join public.provider_payer_enrollments e
    on e.id = ir.enrollment_id
   and e.tenant_id = ir.tenant_id
  join public.providers p
    on p.id = e.provider_id
   and p.tenant_id = e.tenant_id
  join public.payers py
    on py.id = e.payer_id;

  get diagnostics v_count = row_count;
  v_created := v_created + v_count;

  return v_created;
end;
$function$;

revoke all on function public.sync_credentialing_operational_work(uuid)
from public, anon;

grant execute on function public.sync_credentialing_operational_work(uuid)
to authenticated, service_role;


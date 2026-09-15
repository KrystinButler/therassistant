do $$
declare
  v_tenant_id uuid;
  v_client_id uuid;
  v_provider_id uuid;
  v_payer_id uuid;
  v_recoup_claim_id uuid;
  v_appeal_claim_id uuid;
begin
  select id into v_tenant_id
  from public.tenants
  where name = 'Therassistant Demo'
  limit 1;

  if v_tenant_id is null then
    raise exception 'Therassistant Demo tenant not found';
  end if;

  select id into v_client_id
  from public.clients
  where tenant_id = v_tenant_id
    and first_name = 'Jordan'
    and last_name = 'Ellis'
  limit 1;

  select id into v_provider_id
  from public.providers
  where tenant_id = v_tenant_id
    and first_name = 'Jamie'
    and last_name = 'Parker'
  limit 1;

  select id into v_payer_id
  from public.payers
  where name = 'Aetna'
  limit 1;

  select id into v_recoup_claim_id
  from public.professional_claims
  where tenant_id = v_tenant_id
    and patient_control_number = 'P3-RECOUP-001'
  limit 1;

  select id into v_appeal_claim_id
  from public.professional_claims
  where tenant_id = v_tenant_id
    and patient_control_number = 'P3-APPEAL-001'
  limit 1;

  if v_client_id is null or v_provider_id is null or v_payer_id is null
     or v_recoup_claim_id is null or v_appeal_claim_id is null then
    raise exception 'Required Therassistant Demo natural-key records are missing';
  end if;

  insert into public.mailroom_items (
    id, tenant_id, payer_id, claim_id, client_id, provider_id,
    subject, correspondence_type, received_date, status, notes,
    assigned_user_id, due_date, reviewed_at, closed_at
  ) values
    (
      '75000000-0000-4000-8000-000000000001', v_tenant_id, v_payer_id, null, v_client_id, null,
      'Payer policy update received', 'payer_correspondence', date '2026-09-14', 'new',
      'Synthetic payer correspondence awaiting initial review.', null, null, null, null
    ),
    (
      '75000000-0000-4000-8000-000000000002', v_tenant_id, v_payer_id, null, v_client_id, null,
      'Medical records request due September 18', 'medical_record_request', date '2026-09-12', 'action_required',
      'Synthetic records request with an active follow-up deadline.', null, date '2026-09-18', timestamp with time zone '2026-09-12 10:05:00+00', null
    ),
    (
      '75000000-0000-4000-8000-000000000003', v_tenant_id, v_payer_id, v_recoup_claim_id, v_client_id, null,
      'Recoupment notice linked to P3-RECOUP-001', 'recoupment_notice', date '2026-09-13', 'reviewed',
      'Synthetic recoupment correspondence linked to the existing Phase 3 recovery claim.', null, null, timestamp with time zone '2026-09-13 11:00:00+00', null
    ),
    (
      '75000000-0000-4000-8000-000000000004', v_tenant_id, v_payer_id, null, null, v_provider_id,
      'Credentialing roster letter for Jamie Parker', 'credentialing_letter', date '2026-09-13', 'reviewed',
      'Synthetic provider-payer credentialing correspondence.', null, null, timestamp with time zone '2026-09-13 12:00:00+00', null
    ),
    (
      '75000000-0000-4000-8000-000000000005', v_tenant_id, v_payer_id, v_appeal_claim_id, v_client_id, null,
      'Appeal response processed and resolved', 'appeal', date '2026-09-11', 'resolved',
      'Synthetic resolved correspondence with completed Work Center follow-up and status history.', null, null, timestamp with time zone '2026-09-11 09:05:00+00', null
    )
  on conflict (id) do update set
    tenant_id = excluded.tenant_id,
    payer_id = excluded.payer_id,
    claim_id = excluded.claim_id,
    client_id = excluded.client_id,
    provider_id = excluded.provider_id,
    subject = excluded.subject,
    correspondence_type = excluded.correspondence_type,
    received_date = excluded.received_date,
    status = excluded.status,
    notes = excluded.notes,
    assigned_user_id = excluded.assigned_user_id,
    due_date = excluded.due_date,
    reviewed_at = excluded.reviewed_at,
    closed_at = excluded.closed_at;

  insert into public.workqueue_items (
    id, tenant_id, workqueue_type, workqueue_status, priority,
    source_object_type, source_object_id, title, description, due_date,
    assigned_user_id, completed_at, completed_by, created_at, updated_at
  ) values
    (
      '76000000-0000-4000-8000-000000000002', v_tenant_id, 'correspondence', 'open', 'high',
      'mailroom_item', '75000000-0000-4000-8000-000000000002',
      'Medical records request due September 18',
      'Respond to the payer records request before the deadline.', date '2026-09-18',
      null, null, null, timestamp with time zone '2026-09-12 10:05:00+00', timestamp with time zone '2026-09-12 10:05:00+00'
    ),
    (
      '76000000-0000-4000-8000-000000000005', v_tenant_id, 'correspondence', 'completed', 'normal',
      'mailroom_item', '75000000-0000-4000-8000-000000000005',
      'Appeal response processed and resolved',
      'Review and process the payer appeal response.', null,
      null, timestamp with time zone '2026-09-11 15:30:00+00', null,
      timestamp with time zone '2026-09-11 09:05:00+00', timestamp with time zone '2026-09-11 15:30:00+00'
    )
  on conflict (id) do update set
    tenant_id = excluded.tenant_id,
    workqueue_type = excluded.workqueue_type,
    workqueue_status = excluded.workqueue_status,
    priority = excluded.priority,
    source_object_type = excluded.source_object_type,
    source_object_id = excluded.source_object_id,
    title = excluded.title,
    description = excluded.description,
    due_date = excluded.due_date,
    assigned_user_id = excluded.assigned_user_id,
    completed_at = excluded.completed_at,
    completed_by = excluded.completed_by,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

  insert into public.status_history (
    id, tenant_id, target_type, target_id, old_status, new_status, reason, created_at
  ) values
    (
      '77000000-0000-4000-8000-000000000021', v_tenant_id, 'mailroom_item',
      '75000000-0000-4000-8000-000000000002', 'new', 'action_required',
      'Payer records request requires deadline follow-up.', timestamp with time zone '2026-09-12 10:05:00+00'
    ),
    (
      '77000000-0000-4000-8000-000000000031', v_tenant_id, 'mailroom_item',
      '75000000-0000-4000-8000-000000000003', 'new', 'reviewed',
      'Recoupment notice reviewed and linked to the recovery claim.', timestamp with time zone '2026-09-13 11:00:00+00'
    ),
    (
      '77000000-0000-4000-8000-000000000041', v_tenant_id, 'mailroom_item',
      '75000000-0000-4000-8000-000000000004', 'new', 'reviewed',
      'Credentialing letter classified to provider and payer.', timestamp with time zone '2026-09-13 12:00:00+00'
    ),
    (
      '77000000-0000-4000-8000-000000000051', v_tenant_id, 'mailroom_item',
      '75000000-0000-4000-8000-000000000005', 'new', 'action_required',
      'Appeal response required operational review.', timestamp with time zone '2026-09-11 09:05:00+00'
    ),
    (
      '77000000-0000-4000-8000-000000000052', v_tenant_id, 'mailroom_item',
      '75000000-0000-4000-8000-000000000005', 'action_required', 'resolved',
      'Payer response processed and correspondence resolved.', timestamp with time zone '2026-09-11 15:30:00+00'
    )
  on conflict (id) do update set
    tenant_id = excluded.tenant_id,
    target_type = excluded.target_type,
    target_id = excluded.target_id,
    old_status = excluded.old_status,
    new_status = excluded.new_status,
    reason = excluded.reason,
    created_at = excluded.created_at;
end
$$;

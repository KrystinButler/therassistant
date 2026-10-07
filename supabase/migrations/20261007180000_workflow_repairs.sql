begin;
alter table public.appointments add column if not exists telehealth_url text;
alter table public.appointments add constraint appointments_telehealth_https check (telehealth_url is null or telehealth_url ~ '^https://[^[:space:]]+$');

create or replace function private.portal_send_message_impl(
  p_thread_id uuid,
  p_subject text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.client_portal_access%rowtype;
  v_thread public.portal_message_threads%rowtype;
  v_work public.workqueue_items%rowtype;
  v_old_status public.workqueue_status_enum;
  v_subject text := trim(coalesce(p_subject, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if v_body = '' or char_length(v_body) > 4000 then
    raise exception 'Message must be between 1 and 4000 characters' using errcode = '22023';
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

  if p_thread_id is null then
    if v_subject = '' or char_length(v_subject) > 160 then
      raise exception 'Subject must be between 1 and 160 characters' using errcode = '22023';
    end if;

    insert into public.portal_message_threads (
      tenant_id,
      client_id,
      subject,
      status,
      created_by_patient_user_id,
      last_message_at
    ) values (
      v_access.tenant_id,
      v_access.client_id,
      v_subject,
      'open',
      (select auth.uid()),
      v_now
    )
    returning * into v_thread;
  else
    select t.*
      into v_thread
    from public.portal_message_threads t
    where t.id = p_thread_id
      and t.tenant_id = v_access.tenant_id
      and t.client_id = v_access.client_id
    for update;

    if not found then
      raise exception 'Message thread is unavailable' using errcode = 'P0002';
    end if;
    if v_thread.status <> 'open' then
      raise exception 'This conversation is closed. Start a new message instead.' using errcode = '22023';
    end if;
  end if;

  insert into public.portal_messages (
    tenant_id,
    client_id,
    thread_id,
    sender_type,
    sender_user_id,
    body
  ) values (
    v_access.tenant_id,
    v_access.client_id,
    v_thread.id,
    'patient',
    (select auth.uid()),
    v_body
  );

  update public.portal_message_threads
  set last_message_at = v_now, updated_at = v_now
  where id = v_thread.id
  returning * into v_thread;

  if v_thread.workqueue_item_id is not null then
    select w.*
      into v_work
    from public.workqueue_items w
    where w.id = v_thread.workqueue_item_id
      and w.tenant_id = v_access.tenant_id
    for update;
  end if;

  if v_work.id is null or v_work.workqueue_status in ('completed','cancelled') then
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
      'Patient portal message: ' || v_thread.subject,
      'A patient sent a secure portal message. Review and respond from the Patient Chart Engagement tab.',
      (select auth.uid())
    )
    on conflict (tenant_id, source_object_type, source_object_id, workqueue_type)
      where workqueue_status not in ('completed','cancelled')
    do update set updated_at = excluded.updated_at
    returning * into v_work;

    update public.portal_message_threads
    set workqueue_item_id = v_work.id, updated_at = v_now
    where id = v_thread.id;
  elsif v_work.workqueue_status in ('pending','snoozed') then
    v_old_status := v_work.workqueue_status;
    update public.workqueue_items
    set workqueue_status = 'reopened',
        completed_at = null,
        completed_by = null,
        updated_at = v_now
    where id = v_work.id
    returning * into v_work;

    insert into public.workqueue_history (
      tenant_id,
      workqueue_item_id,
      old_status,
      new_status,
      old_priority,
      new_priority,
      changed_by,
      note
    ) values (
      v_access.tenant_id,
      v_work.id,
      v_old_status,
      v_work.workqueue_status,
      v_work.priority,
      v_work.priority,
      (select auth.uid()),
      'Patient sent a new portal message.'
    );
  end if;

  return jsonb_build_object(
    'thread_id', v_thread.id,
    'status', v_thread.status,
    'last_message_at', v_now
  );
end;
$$;

create or replace function private.close_client_portal_message_thread_impl(
  p_tenant_id uuid,
  p_thread_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread public.portal_message_threads%rowtype;
  v_work public.workqueue_items%rowtype;
  v_old_status public.workqueue_status_enum;
  v_now timestamptz := now();
begin
  if not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'You do not have write access to this organization' using errcode = '42501';
  end if;

  select t.*
    into v_thread
  from public.portal_message_threads t
  where t.id = p_thread_id
    and t.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Message thread is unavailable' using errcode = 'P0002';
  end if;

  if v_thread.status <> 'closed' then
    update public.portal_message_threads
    set status = 'closed',
        closed_at = v_now,
        updated_at = v_now
    where id = v_thread.id
    returning * into v_thread;
  end if;

  if v_thread.workqueue_item_id is not null then
    select w.*
      into v_work
    from public.workqueue_items w
    where w.id = v_thread.workqueue_item_id
      and w.tenant_id = p_tenant_id
    for update;

    if found and v_work.workqueue_status not in ('completed','cancelled') and not exists (select 1 from public.portal_message_threads t where t.tenant_id=p_tenant_id and t.workqueue_item_id=v_work.id and t.status='open') then
      v_old_status := v_work.workqueue_status;
      update public.workqueue_items
      set workqueue_status = 'completed',
          completed_at = v_now,
          completed_by = (select auth.uid()),
          updated_at = v_now
      where id = v_work.id
      returning * into v_work;

      insert into public.workqueue_history (
        tenant_id,
        workqueue_item_id,
        old_status,
        new_status,
        old_priority,
        new_priority,
        changed_by,
        note
      ) values (
        p_tenant_id,
        v_work.id,
        v_old_status,
        v_work.workqueue_status,
        v_work.priority,
        v_work.priority,
        (select auth.uid()),
        coalesce(nullif(trim(p_note), ''), 'Patient portal conversation closed.')
      );
    end if;
  end if;

  return jsonb_build_object(
    'thread_id', v_thread.id,
    'status', v_thread.status,
    'closed_at', v_thread.closed_at
  );
end;
$$;

create or replace function private.get_my_patient_portal_data_impl()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_client_id uuid;
  v_active_plan_id uuid;
begin
  select cpa.tenant_id, cpa.client_id
    into v_tenant_id, v_client_id
  from public.client_portal_access cpa
  where cpa.user_id = (select auth.uid())
    and cpa.status = 'active'
  order by cpa.created_at desc
  limit 1;

  if v_client_id is null then
    raise exception 'Active patient portal access is required';
  end if;

  select tp.id
    into v_active_plan_id
  from public.treatment_plans tp
  where tp.tenant_id = v_tenant_id
    and tp.client_id = v_client_id
  order by
    case when tp.status::text = 'active' then 0 else 1 end,
    tp.effective_date desc nulls last,
    tp.created_at desc
  limit 1;

  return jsonb_build_object(
    'patient',
    (
      select jsonb_build_object(
        'id', c.id,
        'first_name', c.first_name,
        'last_name', c.last_name,
        'preferred_name', c.preferred_name,
        'date_of_birth', c.date_of_birth,
        'email', c.email,
        'phone', c.phone,
        'address_line1', c.address_line1,
        'city', c.city,
        'state', c.state,
        'postal_code', c.postal_code,
        'client_status', c.client_status,
        'registration_status', c.registration_status
      )
      from public.clients c
      where c.tenant_id = v_tenant_id
        and c.id = v_client_id
        and c.deleted_at is null
    ),
    'appointments',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', a.id,
            'client_id', a.client_id,
            'starts_at', a.starts_at,
            'ends_at', a.ends_at,
            'appointment_status', a.appointment_status,
            'location_type', a.location_type,
            'telehealth_url', a.telehealth_url,
            'service_type', a.service_type
          )
          order by a.starts_at asc
        )
        from public.appointments a
        where a.tenant_id = v_tenant_id
          and a.client_id = v_client_id
      ),
      '[]'::jsonb
    ),
    'insurancePolicies',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', cip.id,
            'client_id', cip.client_id,
            'insurance_order', cip.insurance_order,
            'status', cip.status,
            'member_id', cip.member_id,
            'group_number', cip.group_number,
            'effective_date', cip.effective_date,
            'termination_date', cip.termination_date
          )
          order by cip.created_at asc
        )
        from public.client_insurance_policies cip
        where cip.tenant_id = v_tenant_id
          and cip.client_id = v_client_id
      ),
      '[]'::jsonb
    ),
    'documents',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', d.id,
            'client_id', d.client_id,
            'document_type', d.document_type,
            'document_status', d.document_status,
            'file_name', d.file_name,
            'created_at', d.created_at
          )
          order by d.created_at desc
        )
        from public.documents d
        where d.tenant_id = v_tenant_id
          and d.client_id = v_client_id
          and d.document_type::text = any (
            array[
              'insurance_card',
              'intake_form',
              'consent_form',
              'client_correspondence',
              'statement'
            ]::text[]
          )
          and d.document_status::text <> all (array['rejected', 'voided']::text[])
      ),
      '[]'::jsonb
    ),
    'checkins',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', ci.id,
            'appointment_id', ci.appointment_id,
            'client_id', ci.client_id,
            'on_my_way_at', ci.on_my_way_at,
            'arrived_at', ci.arrived_at,
            'checked_in_at', ci.checked_in_at,
            'responses',
              case
                when jsonb_typeof(ci.responses -> 'pre_visit') = 'object'
                  then jsonb_build_object(
                    'pre_visit',
                    jsonb_strip_nulls(
                      jsonb_build_object(
                        'demographics_confirmed', ci.responses -> 'pre_visit' -> 'demographics_confirmed',
                        'insurance_confirmed', ci.responses -> 'pre_visit' -> 'insurance_confirmed',
                        'visit_questions', ci.responses -> 'pre_visit' -> 'visit_questions',
                        'consents', ci.responses -> 'pre_visit' -> 'consents',
                        'submitted_at', ci.responses -> 'pre_visit' -> 'submitted_at',
                        'updated_at', ci.responses -> 'pre_visit' -> 'updated_at'
                      )
                    )
                  )
                else '{}'::jsonb
              end,
            'created_at', ci.created_at
          )
          order by ci.created_at desc
        )
        from public.client_checkins ci
        where ci.tenant_id = v_tenant_id
          and ci.client_id = v_client_id
      ),
      '[]'::jsonb
    ),
    'journalEntries',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', pje.id,
            'client_id', pje.client_id,
            'entry_date', pje.entry_date,
            'entry_text', pje.entry_text,
            'mood', pje.mood,
            'visibility', pje.visibility,
            'tags', pje.tags,
            'related_treatment_goal_id', pje.related_treatment_goal_id,
            'entry_status', pje.entry_status,
            'submitted_at', pje.submitted_at,
            'created_at', pje.created_at
          )
          order by pje.entry_date desc, pje.created_at desc
        )
        from public.patient_journal_entries pje
        where pje.tenant_id = v_tenant_id
          and pje.client_id = v_client_id
      ),
      '[]'::jsonb
    ),
    'balance',
    (
      select jsonb_build_object(
        'client_id', cbs.client_id,
        'open_balance_cents', cbs.open_balance_cents
      )
      from public.client_balance_summaries cbs
      where cbs.tenant_id = v_tenant_id
        and cbs.client_id = v_client_id
      limit 1
    ),
    'treatmentPlans',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', tp.id,
            'client_id', tp.client_id,
            'status', tp.status,
            'effective_date', tp.effective_date,
            'review_due_date', tp.review_due_date
          )
          order by tp.effective_date desc nulls last, tp.created_at desc
        )
        from public.treatment_plans tp
        where tp.tenant_id = v_tenant_id
          and tp.client_id = v_client_id
      ),
      '[]'::jsonb
    ),
    'treatmentGoals',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', tpg.id,
            'treatment_plan_id', tpg.treatment_plan_id,
            'goal_text', tpg.goal_text,
            'status', tpg.status,
            'created_at', tpg.created_at
          )
          order by tpg.created_at asc
        )
        from public.treatment_plan_goals tpg
        where tpg.tenant_id = v_tenant_id
          and tpg.treatment_plan_id = v_active_plan_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.sign_encounter_note(
  p_encounter_id uuid, p_note_id uuid, p_provider_id uuid, p_signature_text text
)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_note public.clinical_notes%rowtype;
  v_encounter public.encounters%rowtype;
  v_signed_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  -- Serialize note retries before the existing signature trigger locks the encounter.
  select * into v_note from public.clinical_notes where id=p_note_id and encounter_id=p_encounter_id for update;
  if not found then raise exception 'Clinical note not found'; end if;
  perform public.assert_tenant_access(v_note.tenant_id);
  if not exists(select 1 from public.tenant_user_roles where tenant_id=v_note.tenant_id
      and user_id=auth.uid() and role='clinician')
    or not exists(select 1 from public.provider_user_links where tenant_id=v_note.tenant_id
      and user_id=auth.uid() and provider_id=v_note.provider_id and status='active') then
    raise exception 'A linked clinician account is required to sign this note' using errcode='42501';
  end if;
  select * into v_encounter from public.encounters where id=p_encounter_id and tenant_id=v_note.tenant_id for update;
  if not found or v_note.provider_id is distinct from p_provider_id
    or v_encounter.provider_id is distinct from v_note.provider_id
    or v_encounter.client_id is distinct from v_note.client_id
    or v_encounter.encounter_status='voided' then
    raise exception 'Clinical note does not match the signing provider and encounter';
  end if;
  if nullif(trim(v_note.note_text),'') is null or nullif(trim(p_signature_text),'') is null then
    raise exception 'Clinical documentation and signature text are required';
  end if;
  if v_note.service_date > (now() at time zone (select timezone from public.tenants where id=v_note.tenant_id))::date then
    raise exception 'Future-dated clinical notes cannot be signed';
  end if;
  if v_note.note_status in ('signed','locked') then
    select signed_at into v_signed_at from public.clinical_note_signatures
    where tenant_id=v_note.tenant_id and clinical_note_id=v_note.id order by signed_at,id limit 1;
    if v_signed_at is null then raise exception 'Signed note has no signature; review its audit history'; end if;
    perform private.ensure_clinical_billing_handoff(v_note.id);
  else
    if v_note.note_status not in ('draft','in_progress','ready_for_signature') then
      raise exception 'Clinical note cannot be signed from its current status';
    end if;
    if not exists (select 1 from public.encounter_diagnoses where tenant_id=v_note.tenant_id and encounter_id=p_encounter_id and nullif(trim(diagnosis_code),'') is not null)
      or not exists (select 1 from public.encounter_service_lines where tenant_id=v_note.tenant_id and encounter_id=p_encounter_id)
      or exists (select 1 from public.encounter_service_lines where tenant_id=v_note.tenant_id and encounter_id=p_encounter_id and nullif(trim(cpt_hcpcs_code),'') is null) then
      raise exception 'Add the visit diagnosis and procedure code before signing' using errcode='22023';
    end if;
    insert into public.clinical_note_signatures(tenant_id,clinical_note_id,signer_id,provider_id,signature_text)
    values(v_note.tenant_id,v_note.id,auth.uid(),v_note.provider_id,trim(p_signature_text)) returning signed_at into v_signed_at;
    -- Explicit as well as trigger-backed: no browser PATCH can be lost.
    update public.clinical_notes set note_status='signed',locked_at=coalesce(locked_at,v_signed_at),updated_at=now()
    where id=v_note.id and tenant_id=v_note.tenant_id;
  end if;
  return jsonb_build_object('note_id',v_note.id,'signed_at',v_signed_at);
end;
$function$;
create or replace function public.get_portal_message_inbox(p_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_tenant_read_access(p_tenant_id) then
    raise exception 'Organization read access required' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(row_to_json(q) order by q.last_message_at desc) from (
    select t.client_id as id,c.first_name,c.last_name,max(t.last_message_at) as last_message_at
    from public.portal_message_threads t join public.clients c on c.id=t.client_id and c.tenant_id=t.tenant_id
    where t.tenant_id=p_tenant_id group by t.client_id,c.first_name,c.last_name
  ) q),'[]'::jsonb);
end;
$$;
revoke all on function public.get_portal_message_inbox(uuid) from public,anon;
grant execute on function public.get_portal_message_inbox(uuid) to authenticated;

commit;

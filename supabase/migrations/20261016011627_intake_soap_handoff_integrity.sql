CREATE OR REPLACE FUNCTION private.portal_save_previsit_checkin_impl(p_appointment_id uuid, p_update jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_appt public.appointments%rowtype;
  v_checkin public.client_checkins%rowtype;
  v_now timestamptz := now();
  v_scalar_patch jsonb := '{}'::jsonb;
  v_insert_previsit jsonb := '{}'::jsonb;
  v_insert_responses jsonb := '{}'::jsonb;
begin
  select * into v_appt
  from public.appointments
  where id = p_appointment_id;

  if not found
     or not private.has_client_portal_access(v_appt.tenant_id, v_appt.client_id) then
    raise exception 'Appointment is unavailable';
  end if;

  if v_appt.appointment_status in (
    'in_session'::public.appointment_status_enum,
    'completed'::public.appointment_status_enum,
    'cancelled'::public.appointment_status_enum,
    'no_show'::public.appointment_status_enum,
    'late_cancel'::public.appointment_status_enum,
    'rescheduled'::public.appointment_status_enum
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
      'submitted',
      'expected_updated_at'
    )
  ) then
    raise exception 'Unsupported pre-visit field';
  end if;


  -- Serialize submissions for this appointment, including the first insert.
  perform 1 from public.appointments where id=p_appointment_id for update;
  select * into v_checkin from public.client_checkins
    where appointment_id=p_appointment_id and tenant_id=v_appt.tenant_id and client_id=v_appt.client_id;
  if nullif(v_checkin.responses #>> '{pre_visit,submitted_at}','') is not null then
    if p_update->>'submitted'='true'
      and (not p_update ? 'visit_questions' or p_update->'visit_questions'=v_checkin.responses #> '{pre_visit,visit_questions}')
      and (not p_update ? 'consents' or p_update->'consents'=v_checkin.responses #> '{pre_visit,consents}') then
      return to_jsonb(v_checkin);
    end if;
    raise exception 'Submitted check-in is read-only. Contact your care team to make a correction.';
  end if;
  if p_update ? 'expected_updated_at' and
     (p_update->>'expected_updated_at') is distinct from (v_checkin.responses #>> '{pre_visit,updated_at}') then
    raise exception using errcode='40001',message='This check-in changed in another session. Reload before saving.';
  end if;

  v_scalar_patch := jsonb_build_object('updated_at', v_now);

  if p_update ? 'demographics_confirmed' then
    if jsonb_typeof(p_update -> 'demographics_confirmed') <> 'boolean' then
      raise exception 'Demographics confirmation must be boolean';
    end if;
    v_scalar_patch := v_scalar_patch || jsonb_build_object(
      'demographics_confirmed',
      (p_update ->> 'demographics_confirmed')::boolean
    );
  end if;

  if p_update ? 'insurance_confirmed' then
    if jsonb_typeof(p_update -> 'insurance_confirmed') <> 'boolean' then
      raise exception 'Insurance confirmation must be boolean';
    end if;
    v_scalar_patch := v_scalar_patch || jsonb_build_object(
      'insurance_confirmed',
      (p_update ->> 'insurance_confirmed')::boolean
    );
  end if;

  if p_update ? 'visit_questions'
     and jsonb_typeof(p_update -> 'visit_questions') <> 'object' then
    raise exception 'Visit questions must be an object';
  end if;

  if p_update ? 'visit_questions' then
    v_scalar_patch := v_scalar_patch || jsonb_build_object('visit_questions_saved_at', v_now);
  end if;

  if p_update ? 'consents'
     and jsonb_typeof(p_update -> 'consents') <> 'object' then
    raise exception 'Consents must be an object';
  end if;

  if p_update ? 'consents' then
    v_scalar_patch := v_scalar_patch || jsonb_build_object('consents_saved_at', v_now);
  end if;

  if p_update ? 'submitted' then
    if jsonb_typeof(p_update -> 'submitted') <> 'boolean' then
      raise exception 'Submitted must be boolean';
    end if;
    if (p_update ->> 'submitted')::boolean then
      v_scalar_patch := v_scalar_patch || jsonb_build_object('submitted_at', v_now);
    end if;
  end if;

  v_insert_previsit := v_scalar_patch;

  if p_update ? 'visit_questions' then
    v_insert_previsit := v_insert_previsit || jsonb_build_object(
      'visit_questions', p_update -> 'visit_questions'
    );
  end if;

  if p_update ? 'consents' then
    v_insert_previsit := v_insert_previsit || jsonb_build_object(
      'consents', p_update -> 'consents'
    );
  end if;

  v_insert_responses := jsonb_build_object('pre_visit', v_insert_previsit);

  insert into public.client_checkins (
    tenant_id, appointment_id, client_id, responses
  )
  values (
    v_appt.tenant_id, v_appt.id, v_appt.client_id, v_insert_responses
  )
  on conflict (appointment_id)
  do update set
    responses =
      coalesce(public.client_checkins.responses, '{}'::jsonb)
      || jsonb_build_object(
        'pre_visit',
        (
          case
            when jsonb_typeof(public.client_checkins.responses -> 'pre_visit') = 'object'
              then public.client_checkins.responses -> 'pre_visit'
            else '{}'::jsonb
          end
        )
        || v_scalar_patch
        || case
          when p_update ? 'visit_questions' then jsonb_build_object(
            'visit_questions',
            (
              case
                when jsonb_typeof(
                  public.client_checkins.responses -> 'pre_visit' -> 'visit_questions'
                ) = 'object'
                  then public.client_checkins.responses -> 'pre_visit' -> 'visit_questions'
                else '{}'::jsonb
              end
            )
            || (p_update -> 'visit_questions')
          )
          else '{}'::jsonb
        end
        || case
          when p_update ? 'consents' then jsonb_build_object(
            'consents',
            (
              case
                when jsonb_typeof(
                  public.client_checkins.responses -> 'pre_visit' -> 'consents'
                ) = 'object'
                  then public.client_checkins.responses -> 'pre_visit' -> 'consents'
                else '{}'::jsonb
              end
            )
            || (p_update -> 'consents')
          )
          else '{}'::jsonb
        end
      ),
    updated_at = v_now
  returning * into v_checkin;

  return to_jsonb(v_checkin);
end;
$function$;

CREATE OR REPLACE FUNCTION private.get_my_patient_portal_data_impl()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and tp.status::text = 'active'
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
                        'updated_at', ci.responses -> 'pre_visit' -> 'updated_at',
                        'visit_questions_saved_at', ci.responses #> '{pre_visit,visit_questions_saved_at}',
                        'consents_saved_at', ci.responses #> '{pre_visit,consents_saved_at}'
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
            'review_due_date', tp.review_due_date,
            'updated_at', tp.updated_at,
            'plan_text', tp.plan_text
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
$function$;

-- Validate final intake atomically before the existing screener synchronization.
create or replace function private.validate_portal_intake() returns trigger
language plpgsql security definer set search_path='' as $$
declare p jsonb; q jsonb; g jsonb; plan public.treatment_plans%rowtype;
begin
 if tg_op='UPDATE' and nullif(old.responses #>> '{pre_visit,submitted_at}','') is not null then
   if (new.responses->'pre_visit') is distinct from (old.responses->'pre_visit') then
     raise exception 'Submitted check-in is read-only. Contact your care team to make a correction.';
   end if;
   return new;
 end if;
 p:=new.responses->'pre_visit'; q:=p->'visit_questions';
 if nullif(p->>'submitted_at','') is null then return new; end if;
 if p->>'demographics_confirmed' is distinct from 'true' or p->>'insurance_confirmed' is distinct from 'true'
    or p #>> '{consents,information_accurate}' is distinct from 'true'
    or p #>> '{consents,privacy_acknowledged}' is distinct from 'true'
    or p #>> '{consents,care_acknowledged}' is distinct from 'true' then
   raise exception 'Confirm your information and acknowledgments before submitting.';
 end if;
 if jsonb_typeof(q) is distinct from 'object' or jsonb_typeof(q->'screeners') is distinct from 'object' then
   raise exception 'Complete the screeners or defer them for discussion with your provider.';
 end if;
 if q #>> '{screeners,declined}'='true' and jsonb_typeof(q #> '{screeners,declined}')<>'boolean' then
   raise exception 'Screener deferral must be boolean';
 end if;
 if q ? 'goal_updates' and jsonb_typeof(q->'goal_updates') is distinct from 'array' then raise exception 'Goal updates must be an array'; end if;
 if nullif(q #>> '{treatment_plan_review,plan_id}','') is not null then
   select * into plan from public.treatment_plans where id=(q #>> '{treatment_plan_review,plan_id}')::uuid
     and tenant_id=new.tenant_id and client_id=new.client_id and status::text='active';
   if not found then raise exception 'The treatment plan changed. Reload and review your current plan.'; end if;
   if nullif(q #>> '{treatment_plan_review,plan_updated_at}','') is not null
      and (q #>> '{treatment_plan_review,plan_updated_at}')::timestamptz is distinct from plan.updated_at then
     raise exception 'The treatment plan changed. Reload and review your current plan.';
   end if;
 end if;
 for g in select value from jsonb_array_elements(coalesce(q->'goal_updates','[]'::jsonb)) loop
   if not exists(select 1 from public.treatment_plan_goals tpg join public.treatment_plans tp on tp.id=tpg.treatment_plan_id
     where tpg.id=(g->>'goal_id')::uuid and tpg.tenant_id=new.tenant_id and tp.tenant_id=new.tenant_id
       and tp.client_id=new.client_id and tp.status::text='active'
       and tp.id=(q #>> '{treatment_plan_review,plan_id}')::uuid) then
     raise exception 'A treatment goal changed. Reload your current treatment plan.';
   end if;
   if length(coalesce(g->>'progress',''))>10000 or length(coalesce(g->>'barriers',''))>10000 then raise exception 'Goal responses must be 10000 characters or fewer'; end if;
 end loop;
 if nullif(q->>'treatment_goal_id','') is not null and not exists(
   select 1 from public.treatment_plan_goals tpg join public.treatment_plans tp on tp.id=tpg.treatment_plan_id
   where tpg.id=(q->>'treatment_goal_id')::uuid and tpg.tenant_id=new.tenant_id and tp.tenant_id=new.tenant_id
     and tp.client_id=new.client_id and tp.status::text='active') then raise exception 'The selected treatment goal is no longer active'; end if;
 return new;
end; $$;
revoke all on function private.validate_portal_intake() from public,anon,authenticated;
create trigger validate_portal_intake before insert or update of responses on public.client_checkins
for each row execute function private.validate_portal_intake();

create or replace function private.portal_screener_score(answers jsonb,n integer) returns integer
language plpgsql immutable security invoker set search_path='' as $$
begin
 if jsonb_typeof(answers) is distinct from 'array' then return null; end if;
 if jsonb_array_length(answers)<>n or exists(select 1 from jsonb_array_elements(answers) x
   where jsonb_typeof(x) is distinct from 'number' or x::text !~ '^[0-3]$') then return null; end if;
 return (select sum(x::text::integer) from jsonb_array_elements(answers) x);
end; $$;
revoke all on function private.portal_screener_score(jsonb,integer) from public,anon,authenticated;

-- Discrete note fields with source attribution; no change to clinician-authored note text.
create or replace function private.portal_note_payload(responses jsonb,checkin_id uuid) returns jsonb
language sql immutable security definer set search_path='' as $$
 select case when nullif(responses #>> '{pre_visit,submitted_at}','') is null then '{}'::jsonb else
 jsonb_build_object('schema_version','1.0','source_checkin_id',checkin_id,
   'submitted_at',responses #>> '{pre_visit,submitted_at}',
   'patient_reported',true,'provider_review','pending',
   'phq9_total',case when responses #>> '{pre_visit,visit_questions,screeners,declined}'='true' then null else private.portal_screener_score(responses #> '{pre_visit,visit_questions,screeners,phq9}',9) end,
   'gad7_total',case when responses #>> '{pre_visit,visit_questions,screeners,declined}'='true' then null else private.portal_screener_score(responses #> '{pre_visit,visit_questions,screeners,gad7}',7) end,
   'screeners',responses #> '{pre_visit,visit_questions,screeners}',
   'focus_today',responses #>> '{pre_visit,visit_questions,focus_today}',
   'feeling_since_last_visit',responses #>> '{pre_visit,visit_questions,feeling_since_last_visit}',
   'important_changes',responses #>> '{pre_visit,visit_questions,important_changes}',
   'safety_concerns',responses #>> '{pre_visit,visit_questions,safety_concerns}',
   'treatment_goal',responses #>> '{pre_visit,visit_questions,treatment_goal}',
   'treatment_goal_id',responses #>> '{pre_visit,visit_questions,treatment_goal_id}',
   'treatment_plan_review',responses #> '{pre_visit,visit_questions,treatment_plan_review}',
   'goal_updates',coalesce(responses #> '{pre_visit,visit_questions,goal_updates}','[]'::jsonb),
   'anything_else',responses #>> '{pre_visit,visit_questions,anything_else}') end;
$$;
revoke all on function private.portal_note_payload(jsonb,uuid) from public,anon,authenticated;
alter table public.clinical_notes add column if not exists portal_intake jsonb not null default '{}'::jsonb;

create or replace function private.hydrate_note_portal_intake() returns trigger
language plpgsql security definer set search_path='' as $$
declare payload jsonb; appointment uuid;
begin
 if new.note_status::text in ('signed','locked') then return new; end if;
 appointment:=new.appointment_id;
 if new.encounter_id is not null then
   select appointment_id into appointment from public.encounters where id=new.encounter_id and tenant_id=new.tenant_id and client_id=new.client_id;
 end if;
 select private.portal_note_payload(ci.responses,ci.id) into payload from public.client_checkins ci
   where ci.appointment_id=appointment and ci.tenant_id=new.tenant_id and ci.client_id=new.client_id;
 if payload is not null and payload<>'{}'::jsonb then new.portal_intake:=payload; end if;
 return new;
end; $$;
revoke all on function private.hydrate_note_portal_intake() from public,anon,authenticated;
create trigger hydrate_note_portal_intake before insert or update on public.clinical_notes
for each row execute function private.hydrate_note_portal_intake();

create or replace function private.sync_note_portal_intake() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if nullif(new.responses #>> '{pre_visit,submitted_at}','') is null then return new; end if;
 update public.clinical_notes n set portal_intake=private.portal_note_payload(new.responses,new.id)
 where n.tenant_id=new.tenant_id and n.client_id=new.client_id and n.note_status::text not in ('signed','locked')
 and (n.appointment_id=new.appointment_id or exists(select 1 from public.encounters e where e.id=n.encounter_id
   and e.tenant_id=new.tenant_id and e.client_id=new.client_id and e.appointment_id=new.appointment_id));
 return new;
end; $$;
revoke all on function private.sync_note_portal_intake() from public,anon,authenticated;
create trigger sync_note_portal_intake after insert or update of responses on public.client_checkins
for each row execute function private.sync_note_portal_intake();

-- A positive item 9 must not wait for completion of every other intake step.
create or replace function private.portal_draft_safety_review() returns trigger
language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin
 item:=new.responses #> '{pre_visit,visit_questions,screeners,phq9,8}';
 if jsonb_typeof(item)='number' and item::text ~ '^[1-3]$' and not exists(
   select 1 from public.workqueue_items where tenant_id=new.tenant_id and source_object_id=new.appointment_id
   and title='Patient screening safety review' and workqueue_status in ('open','in_progress','pending')) then
   insert into public.workqueue_items(tenant_id,workqueue_type,source_object_type,source_object_id,title,description,priority)
   values(new.tenant_id,'general_task','appointment',new.appointment_id,'Patient screening safety review',
    'Patient endorsed PHQ-9 item 9 in a saved portal questionnaire. Clinical assessment is required; no risk classification or intervention is implied.','high');
 end if;
 return new;
end; $$;
revoke all on function private.portal_draft_safety_review() from public,anon,authenticated;
create trigger portal_draft_safety_review after insert or update of responses on public.client_checkins
for each row execute function private.portal_draft_safety_review();

-- Fill only missing links using the appointment's own provider configuration.
update public.appointments a set telehealth_url=p.telehealth_url from public.providers p
 where p.id=a.provider_id and p.tenant_id=a.tenant_id and a.location_type='telehealth'
 and nullif(btrim(a.telehealth_url),'') is null and p.telehealth_url='https://doxy.me/therassistant';

-- Backfill dedicated data only; preserve all existing note text and signed records.
update public.clinical_notes n set portal_intake=private.portal_note_payload(ci.responses,ci.id)
 from public.client_checkins ci where ci.tenant_id=n.tenant_id and ci.client_id=n.client_id
 and nullif(ci.responses #>> '{pre_visit,submitted_at}','') is not null
 and n.note_status::text not in ('signed','locked')
 and (n.appointment_id=ci.appointment_id or exists(select 1 from public.encounters e
   where e.id=n.encounter_id and e.tenant_id=n.tenant_id and e.client_id=n.client_id and e.appointment_id=ci.appointment_id));

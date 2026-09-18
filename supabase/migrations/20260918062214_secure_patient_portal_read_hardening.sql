begin;

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

revoke all on function private.get_my_patient_portal_data_impl() from public, anon;
grant execute on function private.get_my_patient_portal_data_impl() to authenticated;

create or replace function public.get_my_patient_portal_data()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_my_patient_portal_data_impl();
$$;

revoke all on function public.get_my_patient_portal_data() from public, anon;
grant execute on function public.get_my_patient_portal_data() to authenticated;

drop policy if exists "clients tenant select" on public.clients;
create policy "clients tenant select" on public.clients
for select to authenticated using (private.has_tenant_read_access(tenant_id));

drop policy if exists "appointments tenant select" on public.appointments;
create policy "appointments tenant select" on public.appointments
for select to authenticated using (private.has_tenant_read_access(tenant_id));

drop policy if exists "client_insurance_policies tenant select" on public.client_insurance_policies;
create policy "client_insurance_policies tenant select" on public.client_insurance_policies
for select to authenticated using (private.has_tenant_read_access(tenant_id));

drop policy if exists "documents tenant select" on public.documents;
create policy "documents tenant select" on public.documents
for select to authenticated using (private.has_tenant_read_access(tenant_id));

drop policy if exists "client_checkins tenant select" on public.client_checkins;
create policy "client_checkins tenant select" on public.client_checkins
for select to authenticated using (private.has_tenant_read_access(tenant_id));

drop policy if exists "client_balance_summaries tenant select" on public.client_balance_summaries;
create policy "client_balance_summaries tenant select" on public.client_balance_summaries
for select to authenticated using (private.has_tenant_read_access(tenant_id));

drop policy if exists "treatment_plans tenant select" on public.treatment_plans;
create policy "treatment_plans tenant select" on public.treatment_plans
for select to authenticated using (private.has_tenant_read_access(tenant_id));

drop policy if exists "treatment_plan_goals tenant select" on public.treatment_plan_goals;
create policy "treatment_plan_goals tenant select" on public.treatment_plan_goals
for select to authenticated using (private.has_tenant_read_access(tenant_id));

drop policy if exists "patient_journal_entries tenant select" on public.patient_journal_entries;
create policy "patient_journal_entries tenant select" on public.patient_journal_entries
for select to authenticated
using (
  private.has_tenant_read_access(tenant_id)
  and visibility = 'shared_with_provider'
);

commit;

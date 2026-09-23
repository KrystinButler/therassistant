
alter table public.payer_resources
  add column if not exists payer_plan_id uuid references public.payer_plans(id) on delete set null,
  add column if not exists source_url text,
  add column if not exists reviewed_at date,
  add column if not exists review_due_at date,
  add column if not exists verification_status text not null default 'unverified';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payer_resources'::regclass
      and conname = 'payer_resources_verification_status_check'
  ) then
    alter table public.payer_resources
      add constraint payer_resources_verification_status_check
      check (verification_status in ('verified','needs_review','unverified'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payer_resources'::regclass
      and conname = 'payer_resources_review_date_check'
  ) then
    alter table public.payer_resources
      add constraint payer_resources_review_date_check
      check (review_due_at is null or reviewed_at is null or review_due_at >= reviewed_at);
  end if;
end $$;

create index if not exists payer_resources_scope_review_idx
  on public.payer_resources (tenant_id, payer_id, payer_plan_id, resource_type, review_due_at, sort_order);

comment on column public.payer_resources.payer_plan_id is
  'Optional plan/product applicability. NULL means the resource applies payer-wide.';
comment on column public.payer_resources.source_url is
  'Authoritative source used to verify the operational resource; distinct from the working/action URL.';
comment on column public.payer_resources.reviewed_at is
  'Date staff last verified the resource against its authoritative source.';
comment on column public.payer_resources.review_due_at is
  'Next planned source review date; not the same as a policy or contract expiration date.';
comment on column public.payer_resources.verification_status is
  'Source-verification state: verified, needs_review, or unverified.';

with
tenant as (
  select id from public.tenants where name = 'THERASSISTANT' and status = 'active' order by created_at desc limit 1
),
seed (
  payer_key, plan_name, resource_type, label, value, url, notes,
  effective_date, expiration_date, source_url, reviewed_at, review_due_at,
  verification_status, sort_order
) as (
  values
  (
    'health first colorado', 'Health First Colorado Medicaid', 'portal',
    'Provider Web Portal enrollment and maintenance',
    'Use the Health First Colorado Provider Web Portal for enrollment, maintenance, claims, eligibility and revalidation.',
    'https://hcpf.colorado.gov/sites/hcpf/files/Provider%20Enrollment%20Manual%20-%201-20-2026.pdf',
    'Enrollment approval assigns the Provider ID used for portal registration. For missing information, resume the existing enrollment application rather than starting a duplicate application.',
    null::date, null::date,
    'https://hcpf.colorado.gov/sites/hcpf/files/Provider%20Enrollment%20Manual%20-%201-20-2026.pdf',
    date '2026-09-23', date '2026-12-22', 'verified', 10
  ),
  (
    'health first colorado', null, 'provider_services',
    'Provider Services Call Center',
    '1-833-468-0362',
    'https://hcpf.colorado.gov/sites/hcpf/files/Provider%20News%20%26%20Resources%2005-02-2025%20Issue%20115.pdf',
    'Current provider support line for billing, claims, eligibility, enrollment, revalidation and Provider Web Portal technical support. Record the case number from each call.',
    date '2025-05-01', null::date,
    'https://hcpf.colorado.gov/sites/hcpf/files/Provider%20News%20%26%20Resources%2005-02-2025%20Issue%20115.pdf',
    date '2026-09-23', date '2026-12-22', 'verified', 20
  ),
  (
    'health first colorado', 'Health First Colorado Medicaid', 'timely_filing',
    'Professional claim timely filing',
    '365 days from date of service',
    'https://hcpf.colorado.gov/sites/hcpf/files/Bulletin_1224_B2400517_0.pdf',
    'After the initial 365-day period, Health First Colorado guidance describes keeping a claim within timely filing by resubmitting every 60 days and referencing the previous ICN when applicable. Treat the source and claim history as the controlling evidence.',
    null::date, null::date,
    'https://hcpf.colorado.gov/sites/hcpf/files/Bulletin_1224_B2400517_0.pdf',
    date '2026-09-23', date '2026-12-22', 'verified', 30
  ),
  (
    'health first colorado', 'Health First Colorado Medicaid', 'credentialing',
    'Participation evidence to retain',
    'Enrollment approval + assigned Health First Colorado Provider ID',
    'https://hcpf.colorado.gov/sites/hcpf/files/Provider%20Enrollment%20Manual%20-%201-20-2026.pdf',
    'Retain the approval notice, assigned Provider ID, effective date/location information and any deficiency-response evidence. Do not treat an application submission as proof of participation.',
    null::date, null::date,
    'https://hcpf.colorado.gov/sites/hcpf/files/Provider%20Enrollment%20Manual%20-%201-20-2026.pdf',
    date '2026-09-23', date '2026-12-22', 'verified', 40
  ),

  (
    'colorado access', 'Colorado Access RAE', 'portal',
    'Colorado Access Provider Portal and toolkit',
    'Claims, eligibility, behavioral care fee schedule, provider updates and portal training.',
    'https://www.coaccess.com/providers/toolkit/',
    'Use the portal/toolkit for current forms and operational workflows. The toolkit includes Clinical Update Form training for adding/terminating providers and submitting rosters.',
    null::date, null::date,
    'https://www.coaccess.com/providers/toolkit/',
    date '2026-09-23', date '2026-12-22', 'verified', 10
  ),
  (
    'colorado access', 'Colorado Access RAE', 'credentialing',
    'Contracting and credentialing workflow',
    'credentialing@coaccess.com · provider.contracting@coaccess.com',
    'https://www.coaccess.com/providers/resources/contracting/',
    'Provider must be contracted and credentialed before network participation. Credentialing follows contract initiation, uses CAQH, requires current state validation, and recredentialing occurs at least every three years. Confirm current network capacity before initiating a brand-new contract.',
    null::date, null::date,
    'https://www.coaccess.com/providers/resources/contracting/',
    date '2026-09-23', date '2026-10-23', 'verified', 20
  ),
  (
    'colorado access', 'Colorado Access RAE', 'provider_services',
    'Provider Network Services',
    'ProviderNetworkServices@coaccess.com',
    'https://www.coaccess.com/providers/resources/',
    'Use for provider-network questions. ClaimsResearch@coaccess.com is listed for claims research and ProviderPortal.Support@coaccess.com for portal support.',
    null::date, null::date,
    'https://www.coaccess.com/providers/resources/',
    date '2026-09-23', date '2026-12-22', 'verified', 30
  ),
  (
    'colorado access', 'Colorado Access RAE', 'timely_filing',
    'Claim timely filing',
    '365 days from date of service or the limit in the provider contract',
    'https://www.coaccess.com/providers/resources/claims/',
    'Check the contract when it is more restrictive. Track submitted claims in the provider portal and retain submission/acceptance evidence.',
    null::date, null::date,
    'https://www.coaccess.com/providers/resources/claims/',
    date '2026-09-23', date '2026-12-22', 'verified', 40
  ),
  (
    'colorado access', 'Colorado Access RAE', 'credentialing',
    'Add provider to an existing group contract / roster',
    'Complete the current Clinical Staff Update Form',
    'https://www.coaccess.com/providers/resources/contracting/',
    'For a provider joining an existing contracted practice, use the current Clinical Staff Update Form and retain submission confirmation. Do not assume the provider effective date until Colorado Access confirms it.',
    null::date, null::date,
    'https://www.coaccess.com/providers/resources/contracting/',
    date '2026-09-23', date '2026-10-23', 'verified', 50
  ),
  (
    'colorado access', 'Colorado Access RAE', 'directory',
    'Participation evidence and directory verification',
    'Executed/confirmed network participation + roster confirmation + directory evidence',
    'https://www.coaccess.com/providers/',
    'Retain the credentialing/contract approval, confirmed effective date, group roster confirmation and a date-stamped directory or portal verification. Application submission alone is not participation evidence.',
    null::date, null::date,
    'https://www.coaccess.com/providers/',
    date '2026-09-23', date '2026-12-22', 'verified', 60
  ),

  (
    'medicare', 'Traditional Medicare', 'portal',
    'PECOS enrollment management',
    'Enroll, update, reassign and revalidate through PECOS.',
    'https://www.cms.gov/medicare/enrollment-renewal/providers-suppliers/chain-ownership-system-pecos/manage-your-enrollment',
    'PECOS is the CMS online enrollment system. Use the enrollment contractor or MAC for application-specific questions.',
    null::date, null::date,
    'https://www.cms.gov/medicare/enrollment-renewal/providers-suppliers/chain-ownership-system-pecos/manage-your-enrollment',
    date '2026-09-23', date '2026-12-22', 'verified', 10
  ),
  (
    'medicare', 'Traditional Medicare', 'credentialing',
    'Medicare revalidation',
    'Generally every 5 years for non-DMEPOS providers; use the CMS Revalidation List for the actual due date.',
    'https://www.cms.gov/medicare/enrollment-renewal/providers-suppliers/revalidations',
    'CMS can require off-cycle revalidation. Due dates are posted in advance; do not substitute a locally calculated five-year date for the CMS-assigned due date.',
    null::date, null::date,
    'https://www.cms.gov/medicare/enrollment-renewal/providers-suppliers/revalidations',
    date '2026-09-23', date '2026-10-23', 'verified', 20
  ),
  (
    'medicare', 'Traditional Medicare', 'provider_services',
    'Enrollment contractor / MAC support',
    'Use the CMS enrollment contractor finder for application questions.',
    'https://www.cms.gov/medicare/enrollment-renewal/providers-suppliers/chain-ownership-system-pecos/manage-your-enrollment',
    'MACs process enrollment applications for providers, group practices and non-DMEPOS suppliers. Use the contractor shown for the provider enrollment jurisdiction.',
    null::date, null::date,
    'https://www.cms.gov/medicare/enrollment-renewal/providers-suppliers/chain-ownership-system-pecos/manage-your-enrollment',
    date '2026-09-23', date '2026-12-22', 'verified', 30
  ),
  (
    'medicare', 'Traditional Medicare', 'timely_filing',
    'Medicare claim timely filing',
    'No later than 1 calendar year after the date of service',
    'https://www.cms.gov/Regulations-and-Guidance/Guidance/Manuals/downloads/clm104c01.pdf',
    'Medicare denies claims received after the timely filing period except limited exceptions. Preserve transmission/receipt evidence; a generated or downloaded claim is not proof of filing.',
    null::date, null::date,
    'https://www.cms.gov/Regulations-and-Guidance/Guidance/Manuals/downloads/clm104c01.pdf',
    date '2026-09-23', date '2026-12-22', 'verified', 40
  ),
  (
    'medicare', 'Traditional Medicare', 'directory',
    'Participation and revalidation evidence to retain',
    'PECOS/MAC approval or reassignment evidence + CMS Revalidation List result',
    'https://data.cms.gov/tools/medicare-revalidation-list',
    'Retain the enrollment/reassignment approval and query the CMS Revalidation List for the actual revalidation due date. A due date of TBD means CMS has not assigned the next date yet.',
    null::date, null::date,
    'https://data.cms.gov/tools/medicare-revalidation-list',
    date '2026-09-23', date '2026-10-23', 'verified', 50
  )
),
resolved as (
  select
    t.id as tenant_id,
    p.id as payer_id,
    pp.id as payer_plan_id,
    s.*
  from seed s
  cross join tenant t
  join public.payers p on p.normalized_name = s.payer_key
  left join public.payer_plans pp
    on pp.payer_id = p.id
   and pp.name = s.plan_name
  where s.plan_name is null or pp.id is not null
)
insert into public.payer_resources (
  tenant_id, payer_id, payer_plan_id, resource_type, label, value, url, notes,
  effective_date, expiration_date, source_url, reviewed_at, review_due_at,
  verification_status, sort_order
)
select
  r.tenant_id, r.payer_id, r.payer_plan_id, r.resource_type, r.label, r.value, r.url, r.notes,
  r.effective_date, r.expiration_date, r.source_url, r.reviewed_at, r.review_due_at,
  r.verification_status, r.sort_order
from resolved r
where not exists (
  select 1
  from public.payer_resources existing
  where existing.tenant_id = r.tenant_id
    and existing.payer_id = r.payer_id
    and existing.payer_plan_id is not distinct from r.payer_plan_id
    and existing.label = r.label
);

do $$
declare
  v_tenant uuid;
  v_provider uuid;
  v_payer uuid;
  v_plan uuid;
  v_entity uuid;
  v_location uuid;
  v_enrollment uuid;
  v_application uuid;
  v_participation uuid;
  v_roster uuid;
begin
  select id into v_tenant
  from public.tenants
  where name='THERASSISTANT' and status='active'
  order by created_at desc limit 1;

  if v_tenant is null then return; end if;

  select id into v_provider
  from public.providers
  where tenant_id=v_tenant and first_name='Test' and last_name='Provider'
  order by created_at limit 1;

  select id into v_payer from public.payers where normalized_name='colorado access' limit 1;
  select pp.id into v_plan
  from public.payer_plans pp
  where pp.payer_id=v_payer and pp.name='Colorado Access RAE'
  limit 1;
  select id into v_entity from public.practice_entities where tenant_id=v_tenant and status='active' order by created_at limit 1;
  select id into v_location from public.practice_locations where tenant_id=v_tenant and status='active' order by is_primary desc, created_at limit 1;

  if v_provider is null or v_payer is null or v_plan is null then return; end if;

  select id into v_enrollment
  from public.provider_payer_enrollments
  where tenant_id=v_tenant and provider_id=v_provider and payer_id=v_payer and payer_plan_id=v_plan
  order by created_at limit 1;

  if v_enrollment is null then
    insert into public.provider_payer_enrollments (
      tenant_id, provider_id, payer_id, payer_plan_id, practice_entity_id, practice_location_id,
      enrollment_status, effective_date, payer_provider_id, revalidation_due_date, notes
    ) values (
      v_tenant, v_provider, v_payer, v_plan, v_entity, v_location,
      'approved', date '2026-07-15', 'QA-COA-TEST-001', date '2029-07-15',
      'SYNTHETIC QA ONLY — completed Colorado Access onboarding cycle used to prove the credentialing workflow. Not real provider participation.'
    )
    returning id into v_enrollment;
  else
    update public.provider_payer_enrollments
    set enrollment_status='approved',
        effective_date=date '2026-07-15',
        payer_provider_id='QA-COA-TEST-001',
        revalidation_due_date=date '2029-07-15',
        payer_plan_id=v_plan,
        practice_entity_id=coalesce(practice_entity_id,v_entity),
        practice_location_id=coalesce(practice_location_id,v_location),
        notes='SYNTHETIC QA ONLY — completed Colorado Access onboarding cycle used to prove the credentialing workflow. Not real provider participation.'
    where id=v_enrollment;
  end if;

  select id into v_application
  from public.credentialing_applications
  where tenant_id=v_tenant and enrollment_id=v_enrollment and application_reference='QA-COA-2026-001'
  limit 1;

  if v_application is null then
    insert into public.credentialing_applications (
      tenant_id, enrollment_id, application_type, status, application_reference,
      submitted_date, payer_received_date, decision_date, closed_date, priority, notes
    ) values (
      v_tenant, v_enrollment, 'initial', 'complete', 'QA-COA-2026-001',
      date '2026-06-10', date '2026-06-11', date '2026-07-02', date '2026-07-24',
      'normal',
      'SYNTHETIC QA ONLY — deficiency, payer follow-up, approval, effective date, roster, directory verification and revalidation are represented in linked records.'
    )
    returning id into v_application;
  end if;

  insert into public.credentialing_requirements (
    tenant_id, application_id, requirement_key, requirement_name, category, status,
    due_date, received_date, verified_at, notes
  )
  select v_tenant, v_application, x.requirement_key, x.requirement_name, x.category,
         'verified', x.due_date, x.received_date, x.verified_at, x.notes
  from (values
    (
      'caqh_attestation',
      'Current CAQH attestation / payer authorization',
      'credentialing',
      date '2026-06-20',
      date '2026-06-19',
      timestamptz '2026-06-20 10:00:00-06',
      'SYNTHETIC QA deficiency: payer requested current CAQH attestation. Corrected/received and marked verified.'
    ),
    (
      'state_medicaid_validation',
      'Current Health First Colorado state validation',
      'enrollment',
      date '2026-06-20',
      date '2026-06-19',
      timestamptz '2026-06-20 10:05:00-06',
      'SYNTHETIC QA evidence: state validation prerequisite represented as verified for workflow testing.'
    )
  ) as x(requirement_key,requirement_name,category,due_date,received_date,verified_at,notes)
  where not exists (
    select 1 from public.credentialing_requirements cr
    where cr.application_id=v_application and cr.requirement_key=x.requirement_key
  );

  insert into public.credentialing_followups (
    tenant_id, application_id, followup_date, channel, contact_name, contact_details,
    reference_number, outcome, next_followup_date, notes
  )
  select
    v_tenant, v_application, date '2026-06-19', 'email', 'Colorado Access Credentialing',
    'credentialing@coaccess.com', 'QA-COA-FU-001',
    'Synthetic QA: deficiency response received and application returned to credentialing review.',
    date '2026-06-26',
    'SYNTHETIC QA ONLY — demonstrates structured payer contact history; not an actual payer interaction.'
  where not exists (
    select 1 from public.credentialing_followups
    where application_id=v_application and reference_number='QA-COA-FU-001'
  );

  insert into public.credentialing_followups (
    tenant_id, application_id, followup_date, channel, contact_name, contact_details,
    reference_number, outcome, next_followup_date, notes
  )
  select
    v_tenant, v_application, date '2026-06-26', 'email', 'Colorado Access Credentialing',
    'credentialing@coaccess.com', 'QA-COA-FU-002',
    'Synthetic QA: payer review confirmed; no further deficiency outstanding.',
    null,
    'SYNTHETIC QA ONLY — closes the follow-up loop without creating a duplicate open follow-up.'
  where not exists (
    select 1 from public.credentialing_followups
    where application_id=v_application and reference_number='QA-COA-FU-002'
  );

  insert into public.credentialing_application_events (
    tenant_id, application_id, event_type, event_at, details, notes
  )
  select v_tenant, v_application, e.event_type, e.event_at, e.details, e.notes
  from (values
    ('application_submitted', timestamptz '2026-06-10 09:00:00-06', '{"synthetic":true}'::jsonb, 'Synthetic QA initial application/Clinical Staff Update workflow submitted.'),
    ('deficiency_received', timestamptz '2026-06-18 11:00:00-06', '{"synthetic":true,"requirement":"caqh_attestation"}'::jsonb, 'Synthetic QA deficiency received: current CAQH attestation requested.'),
    ('deficiency_resolved', timestamptz '2026-06-20 10:00:00-06', '{"synthetic":true,"requirement":"caqh_attestation"}'::jsonb, 'Synthetic QA deficiency resolved and evidence verified.'),
    ('approval_received', timestamptz '2026-07-02 14:00:00-06', '{"synthetic":true,"reference":"QA-COA-APPROVAL-001"}'::jsonb, 'Synthetic QA approval represented for workflow verification.'),
    ('effective_date_confirmed', timestamptz '2026-07-15 09:00:00-06', '{"synthetic":true,"effective_date":"2026-07-15"}'::jsonb, 'Synthetic QA effective date confirmed.'),
    ('group_roster_confirmed', timestamptz '2026-07-23 13:00:00-06', '{"synthetic":true,"reference":"QA-COA-ROSTER-001"}'::jsonb, 'Synthetic QA group roster add confirmed.'),
    ('revalidation_scheduled', timestamptz '2026-07-24 09:00:00-06', '{"synthetic":true,"due_date":"2029-07-15"}'::jsonb, 'Synthetic QA revalidation checkpoint derived from the payer at-least-every-three-years rule; real records must use the payer-assigned due date.')
  ) as e(event_type,event_at,details,notes)
  where not exists (
    select 1 from public.credentialing_application_events existing
    where existing.application_id=v_application and existing.event_type=e.event_type
  );

  insert into public.status_history (
    tenant_id, target_type, target_id, old_status, new_status, reason, created_at
  )
  select v_tenant, 'credentialing_application', v_application, s.old_status, s.new_status, s.reason, s.changed_at
  from (values
    ('intake','submitted','Synthetic QA application submitted.', timestamptz '2026-06-10 09:00:00-06'),
    ('submitted','additional_information_requested','Synthetic QA deficiency received.', timestamptz '2026-06-18 11:00:00-06'),
    ('additional_information_requested','payer_review','Synthetic QA deficiency resolved.', timestamptz '2026-06-20 10:00:00-06'),
    ('payer_review','approved','Synthetic QA approval received.', timestamptz '2026-07-02 14:00:00-06'),
    ('approved','effective','Synthetic QA effective date confirmed.', timestamptz '2026-07-15 09:00:00-06'),
    ('effective','roster_verified','Synthetic QA group roster confirmed.', timestamptz '2026-07-23 13:00:00-06'),
    ('roster_verified','directory_verified','Synthetic QA participation/directory evidence recorded.', timestamptz '2026-07-24 08:30:00-06'),
    ('directory_verified','complete','Synthetic QA onboarding cycle complete.', timestamptz '2026-07-24 09:00:00-06')
  ) as s(old_status,new_status,reason,changed_at)
  where not exists (
    select 1 from public.status_history sh
    where sh.target_type='credentialing_application'
      and sh.target_id=v_application
      and sh.new_status=s.new_status
      and sh.created_at=s.changed_at
  );

  select id into v_participation
  from public.provider_network_participation
  where tenant_id=v_tenant and enrollment_id=v_enrollment
  order by created_at limit 1;

  if v_participation is null then
    insert into public.provider_network_participation (
      tenant_id, enrollment_id, participation_status, directory_status,
      effective_date, next_verification_due_date, notes
    ) values (
      v_tenant, v_enrollment, 'participating', 'listed',
      date '2026-07-15', date '2026-10-24',
      'SYNTHETIC QA ONLY — participation and directory states exercise the verification workflow; not real network evidence.'
    )
    returning id into v_participation;
  else
    update public.provider_network_participation
    set participation_status='participating',
        directory_status='listed',
        effective_date=date '2026-07-15',
        next_verification_due_date=date '2026-10-24',
        notes='SYNTHETIC QA ONLY — participation and directory states exercise the verification workflow; not real network evidence.'
    where id=v_participation;
  end if;

  insert into public.participation_verifications (
    tenant_id, participation_id, verified_at, verification_method, result,
    reference_number, source_url, notes
  )
  select
    v_tenant, v_participation, timestamptz '2026-07-24 08:30:00-06',
    'synthetic_qa_evidence', 'participating', 'QA-COA-PART-001',
    'https://www.coaccess.com/providers/',
    'SYNTHETIC QA ONLY — tests evidence capture and review-date behavior. Not proof that a real provider participates with Colorado Access.'
  where not exists (
    select 1 from public.participation_verifications
    where participation_id=v_participation and reference_number='QA-COA-PART-001'
  );

  select id into v_roster
  from public.roster_actions
  where tenant_id=v_tenant and enrollment_id=v_enrollment
    and action_type='add_provider'
    and reference_number='QA-COA-ROSTER-001'
  limit 1;

  if v_roster is null then
    insert into public.roster_actions (
      tenant_id, enrollment_id, participation_id, action_type, status,
      requested_date, submitted_date, confirmed_date, reference_number,
      requested_change, notes
    ) values (
      v_tenant, v_enrollment, v_participation, 'add_provider', 'confirmed',
      date '2026-06-10', date '2026-06-10', date '2026-07-23', 'QA-COA-ROSTER-001',
      jsonb_build_object(
        'synthetic', true,
        'workflow', 'Clinical Staff Update / add provider to existing group',
        'plan', 'Colorado Access RAE',
        'effective_date', '2026-07-15'
      ),
      'SYNTHETIC QA ONLY — represents confirmation that the test provider was added to the test group roster.'
    )
    returning id into v_roster;
  end if;

  insert into public.workqueue_items (
    tenant_id, workqueue_type, workqueue_status, priority, source_object_type,
    source_object_id, title, description, due_date, completed_at
  )
  select v_tenant, 'credentialing_followup', 'completed', 'high',
         'credentialing_application', v_application,
         'Credentialing: Resolve synthetic deficiency',
         'QA cycle: obtain current CAQH attestation and return deficiency response.',
         date '2026-06-20', timestamptz '2026-06-20 10:00:00-06'
  where not exists (
    select 1 from public.workqueue_items
    where tenant_id=v_tenant and source_object_type='credentialing_application'
      and source_object_id=v_application and title='Credentialing: Resolve synthetic deficiency'
  );

  insert into public.workqueue_items (
    tenant_id, workqueue_type, workqueue_status, priority, source_object_type,
    source_object_id, title, description, due_date, completed_at
  )
  select v_tenant, 'roster_action', 'completed', 'normal',
         'roster_action', v_roster,
         'Roster: Add synthetic provider to Colorado Access group',
         'QA cycle: submit and confirm group roster add; retain confirmation/effective date.',
         date '2026-07-23', timestamptz '2026-07-23 13:00:00-06'
  where not exists (
    select 1 from public.workqueue_items
    where tenant_id=v_tenant and source_object_type='roster_action'
      and source_object_id=v_roster and title='Roster: Add synthetic provider to Colorado Access group'
  );

  insert into public.workqueue_items (
    tenant_id, workqueue_type, workqueue_status, priority, source_object_type,
    source_object_id, title, description, due_date, completed_at
  )
  select v_tenant, 'network_verification', 'completed', 'normal',
         'provider_network_participation', v_participation,
         'Network: Verify synthetic Colorado Access participation',
         'QA cycle: retain participation/directory evidence after roster confirmation.',
         date '2026-07-24', timestamptz '2026-07-24 08:30:00-06'
  where not exists (
    select 1 from public.workqueue_items
    where tenant_id=v_tenant and source_object_type='provider_network_participation'
      and source_object_id=v_participation and title='Network: Verify synthetic Colorado Access participation'
  );

  insert into public.workqueue_items (
    tenant_id, workqueue_type, workqueue_status, priority, source_object_type,
    source_object_id, title, description, due_date
  )
  select v_tenant, 'recredentialing', 'open', 'normal',
         'provider_enrollment', v_enrollment,
         'Revalidate synthetic Colorado Access enrollment',
         'QA future task. Re-check payer-assigned recredentialing/revalidation due date before action; local 3-year date is a workflow checkpoint, not payer proof.',
         date '2029-07-15'
  where not exists (
    select 1 from public.workqueue_items
    where tenant_id=v_tenant and workqueue_type='recredentialing'
      and source_object_type='provider_enrollment'
      and source_object_id=v_enrollment
      and workqueue_status not in ('completed','cancelled')
  );
end $$;

insert into public.reference_code_systems (
  system, version, display_name, release_date, effective_from, effective_to,
  source_name, source_url, status, row_count, loaded_at, metadata
)
values
(
  'CPT', 'PILOT_2026', 'CPT behavioral-health pilot subset', null,
  date '2026-01-01', date '2026-12-31',
  'Therassistant internal operational labels',
  null, 'active', (select count(*) from public.cpt_codes), now(),
  jsonb_build_object(
    'pilot', true,
    'coverage', 'Curated behavioral-health and outpatient E/M subset only',
    'limitations', 'Not a complete CPT dataset. Only the codes present in cpt_codes are searchable; validate codes outside the pilot set against current authoritative coding and payer guidance. Official AMA descriptions are not stored.'
  )
),
(
  'POS', 'PILOT_2026', 'CMS Place of Service pilot reference', null,
  date '2026-01-01', date '2026-12-31',
  'CMS',
  'https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets',
  'active', (select count(*) from public.place_of_service_codes), now(),
  jsonb_build_object(
    'pilot', true,
    'coverage', 'CMS place-of-service reference loaded for professional claims',
    'limitations', 'Payer-specific POS and telehealth billing rules are not inferred from this table and must be checked in payer guidance.'
  )
),
(
  'MODIFIER', 'PILOT_2026', 'Behavioral-health/professional claim modifier pilot subset', null,
  date '2026-01-01', date '2026-12-31',
  'Therassistant internal operational labels',
  null, 'active', (select count(*) from public.code_modifiers), now(),
  jsonb_build_object(
    'pilot', true,
    'coverage', 'Small curated modifier subset used in the pilot',
    'limitations', 'Not a complete CPT/HCPCS modifier library. Modifier applicability is payer- and service-specific; verify before billing.'
  )
)
on conflict (system,version) do update
set display_name=excluded.display_name,
    effective_from=excluded.effective_from,
    effective_to=excluded.effective_to,
    source_name=excluded.source_name,
    source_url=excluded.source_url,
    status=excluded.status,
    row_count=excluded.row_count,
    loaded_at=excluded.loaded_at,
    metadata=excluded.metadata;

update public.reference_code_systems
set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'pilot', true,
      'coverage', 'HCPCS Level II dataset is not loaded in the pilot',
      'limitations', 'HCPCS search coverage is intentionally unavailable until an official current dataset is loaded and validated. Do not interpret an empty HCPCS result as an invalid code.'
    ),
    row_count = (select count(*) from public.hcpcs_codes)
where system='HCPCS';

update public.reference_code_systems
set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'pilot', true,
      'coverage', 'Date-aware ICD-10-CM reference',
      'limitations', 'Use the code set effective for the date of service. FY2027 is staged until 2026-10-01.'
    )
where system='ICD10CM';

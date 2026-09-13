-- Therassistant Phase 2 connected synthetic patient-chart seed.
-- Safe to rerun. Synthetic demo data only; no PHI.

do $$
declare
  t uuid;
  jordan uuid := 'ff648f71-9c94-433c-9aab-f80b039a80fd';
  jamie uuid := 'c1538366-c7d3-4dad-a249-2914a891dc52';
  anthem uuid := '93bada2a-1a9b-4cb3-939d-af98fc0e81a3';
  uhc uuid := 'a0be2998-2479-482b-8e2c-223d011a5ce3';
begin
  select id into t from public.tenants where name = 'Therassistant Demo' limit 1;
  if t is null then raise exception 'Therassistant Demo tenant not found'; end if;

  update public.clients
  set preferred_name = 'Jordan',
      email = 'jordan.ellis@example.test',
      phone = '303-555-0110',
      address_line1 = '1200 Demo Avenue',
      address_line2 = 'Unit 2',
      city = 'Denver',
      state = 'CO',
      postal_code = '80202',
      client_status = 'active',
      registration_status = 'complete',
      updated_at = now()
  where id = jordan and tenant_id = t;

  insert into public.client_contacts
    (id, tenant_id, client_id, contact_name, relationship, phone, email, is_emergency_contact, is_responsible_party)
  values
    ('70000000-0000-4000-8000-000000000001', t, jordan, 'Alex Ellis', 'Parent', '303-555-0111', 'alex.ellis@example.test', true, true)
  on conflict (id) do update set
    contact_name=excluded.contact_name, relationship=excluded.relationship, phone=excluded.phone,
    email=excluded.email, is_emergency_contact=excluded.is_emergency_contact,
    is_responsible_party=excluded.is_responsible_party, updated_at=now();

  insert into public.client_insurance_policies
    (id, tenant_id, client_id, payer_id, insurance_order, status, member_id, group_number, subscriber_name, relationship_to_subscriber, effective_date, metadata)
  values
    ('71000000-0000-4000-8000-000000000001', t, jordan, uhc, 'secondary', 'active', 'DEMO-SECONDARY-001', 'UHC-SECONDARY', 'Jordan Ellis', 'self', '2026-01-01', '{"scenario":"phase2_multiple_insurance","authorization_required":false}'::jsonb)
  on conflict (id) do update set
    payer_id=excluded.payer_id, insurance_order=excluded.insurance_order, status=excluded.status,
    member_id=excluded.member_id, group_number=excluded.group_number, metadata=excluded.metadata, updated_at=now();

  insert into public.eligibility_checks
    (id, tenant_id, client_id, insurance_policy_id, payer_id, service_date, eligibility_status, response_source, raw_response, notes)
  values
    ('72000000-0000-4000-8000-000000000001', t, jordan, '51000000-0000-4000-8000-000000000001', anthem, '2026-09-13', 'active', 'synthetic_demo_270_271',
     '{"demo":true,"transaction":"271","member_id":"DEMO-ACTIVE-001","outcome":"active","benefits":{"copay_cents":2000,"coinsurance_percent":20,"deductible_cents":150000,"deductible_remaining_cents":75000,"out_of_pocket_cents":500000,"out_of_pocket_remaining_cents":325000,"network_status":"in_network","authorization_required":true}}'::jsonb,
     'Synthetic 271 with illustrative Phase 2 benefit details.')
  on conflict (id) do update set
    eligibility_status=excluded.eligibility_status, raw_response=excluded.raw_response,
    response_source=excluded.response_source, notes=excluded.notes, updated_at=now();

  -- Preserve the Phase 1 approved authorization while demonstrating low-unit utilization.
  update public.authorization_units
  set authorized_units = 10, used_units = 8, updated_at = now()
  where id = '53100000-0000-4000-8000-000000000001' and tenant_id = t;

  insert into public.authorizations
    (id, tenant_id, client_id, payer_id, authorization_number, status, start_date, end_date, notes)
  values
    ('73000000-0000-4000-8000-000000000002', t, jordan, anthem, 'AUTH-DEMO-EXPIRED', 'expired', '2026-01-01', '2026-08-31', 'Expired authorization retained for history.')
  on conflict (id) do update set status=excluded.status, end_date=excluded.end_date, notes=excluded.notes, updated_at=now();

  insert into public.authorization_units
    (id, tenant_id, authorization_id, cpt_code, authorized_units, used_units)
  values
    ('73100000-0000-4000-8000-000000000002', t, '73000000-0000-4000-8000-000000000002', '90837', 6, 6)
  on conflict (id) do update set authorized_units=excluded.authorized_units, used_units=excluded.used_units, updated_at=now();

  update public.treatment_plans
  set problem_statement = 'Anxiety interferes with daily functioning and stress management.',
      interventions = 'CBT skill building, grounding practice, psychoeducation, and progress review.',
      review_due_date = '2026-09-20',
      updated_at = now()
  where id = '54000000-0000-4000-8000-000000000001' and tenant_id = t;

  insert into public.treatment_plan_goals
    (id, tenant_id, treatment_plan_id, goal_text, objective_text, status)
  values
    ('74100000-0000-4000-8000-000000000002', t, '54000000-0000-4000-8000-000000000001',
     'Reduce weekly anxiety interference with daily activities.',
     'Patient will rate anxiety interference at 4/10 or lower for three consecutive weeks.', 'active')
  on conflict (id) do update set goal_text=excluded.goal_text, objective_text=excluded.objective_text, status=excluded.status, updated_at=now();

  insert into public.appointments
    (id, tenant_id, client_id, provider_id, starts_at, ends_at, appointment_status, location_type, service_type, cpt_code, notes)
  values
    ('75000000-0000-4000-8000-000000000001', t, jordan, jamie, '2026-09-22 10:00:00-06', '2026-09-22 11:00:00-06', 'scheduled', 'telehealth', 'Individual Psychotherapy', '90837', 'Phase 2 upcoming patient-portal appointment.')
  on conflict (id) do update set starts_at=excluded.starts_at, ends_at=excluded.ends_at, appointment_status=excluded.appointment_status, notes=excluded.notes, updated_at=now();

  insert into public.client_checkins
    (id, tenant_id, appointment_id, client_id, on_my_way_at, arrived_at, checked_in_at, responses)
  values
    ('77000000-0000-4000-8000-000000000001', t, '55000000-0000-4000-8000-000000000001', jordan,
     '2026-09-12 09:35:00-06', '2026-09-12 09:50:00-06', '2026-09-12 09:55:00-06',
     '{"demographics_confirmed":true,"insurance_confirmed":true,"forms_complete":true}'::jsonb)
  on conflict (id) do update set
    on_my_way_at=excluded.on_my_way_at, arrived_at=excluded.arrived_at,
    checked_in_at=excluded.checked_in_at, responses=excluded.responses, updated_at=now();

  insert into public.documents
    (id, tenant_id, client_id, document_type, document_status, file_name, storage_path, mime_type, file_size_bytes)
  values
    ('76000000-0000-4000-8000-000000000001', t, jordan, 'insurance_card', 'approved', 'demo-insurance-card.pdf', 'synthetic-demo/metadata-only/jordan/demo-insurance-card.pdf', 'application/pdf', 0),
    ('76000000-0000-4000-8000-000000000002', t, jordan, 'consent_form', 'approved', 'demo-consent-form.pdf', 'synthetic-demo/metadata-only/jordan/demo-consent-form.pdf', 'application/pdf', 0)
  on conflict (id) do update set document_status=excluded.document_status, file_name=excluded.file_name, storage_path=excluded.storage_path, updated_at=now();

  insert into public.patient_journal_entries
    (id, tenant_id, client_id, entry_date, entry_text, mood, author_type, review_status)
  values
    ('78000000-0000-4000-8000-000000000001', t, jordan, '2026-09-13', 'I used the breathing exercise twice this week and it helped me settle down faster.', 'improving', 'patient', 'unreviewed')
  on conflict (id) do update set entry_text=excluded.entry_text, mood=excluded.mood, review_status=excluded.review_status, updated_at=now();

  insert into public.client_diagnoses
    (id, tenant_id, client_id, diagnosis_code, description, diagnosis_status, onset_date)
  values
    ('79000000-0000-4000-8000-000000000001', t, jordan, 'F41.1', 'Generalized anxiety disorder', 'active', '2026-01-15')
  on conflict (id) do update set description=excluded.description, diagnosis_status=excluded.diagnosis_status, updated_at=now();
end $$;

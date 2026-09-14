-- Phase 3 supplemental synthetic Patient A/R scenario.
-- Idempotent by fixed UUID and intentionally separate from the original Phase 3 seed.
-- Demonstrates ERA adjudication transferring the remaining balance to patient responsibility.

insert into professional_claims (
  id,tenant_id,client_id,rendering_provider_id,billing_provider_id,payer_id,
  claim_status,service_date_from,service_date_to,total_charge_cents,
  patient_control_number,clearinghouse_claim_id,submitted_at,accepted_at,metadata
)
values (
  '62000000-0000-4000-8000-000000000007',
  'aea3549e-8b53-4358-8426-9f7b79f69a34',
  'ff648f71-9c94-433c-9aab-f80b039a80fd',
  'c1538366-c7d3-4dad-a249-2914a891dc52',
  'c1538366-c7d3-4dad-a249-2914a891dc52',
  'b296205c-97b4-4f9f-9dd3-e01cd67c08f8',
  'patient_responsibility',
  '2026-08-16','2026-08-16',12000,
  'P3-PATIENT-AR-001','P3-CH-PATIENT-AR-001',
  '2026-08-26T16:00:00Z','2026-08-27T16:00:00Z',
  '{"demo_phase":3,"demo_id":"P3-PATIENT-AR-001","synthetic":true,"patient_responsibility_cents":2000}'::jsonb
)
on conflict (id) do update set
  claim_status=excluded.claim_status,
  service_date_from=excluded.service_date_from,
  service_date_to=excluded.service_date_to,
  total_charge_cents=excluded.total_charge_cents,
  patient_control_number=excluded.patient_control_number,
  clearinghouse_claim_id=excluded.clearinghouse_claim_id,
  submitted_at=excluded.submitted_at,
  accepted_at=excluded.accepted_at,
  metadata=excluded.metadata,
  updated_at=now();

insert into professional_claim_lines (
  id,tenant_id,claim_id,service_date,cpt_code,units,charge_amount_cents,
  allowed_amount_cents,paid_amount_cents,adjustment_amount_cents
)
values (
  '62100000-0000-4000-8000-000000000007',
  'aea3549e-8b53-4358-8426-9f7b79f69a34',
  '62000000-0000-4000-8000-000000000007',
  '2026-08-16','90834',1,12000,10000,8000,2000
)
on conflict (id) do update set
  service_date=excluded.service_date,
  cpt_code=excluded.cpt_code,
  units=excluded.units,
  charge_amount_cents=excluded.charge_amount_cents,
  allowed_amount_cents=excluded.allowed_amount_cents,
  paid_amount_cents=excluded.paid_amount_cents,
  adjustment_amount_cents=excluded.adjustment_amount_cents,
  updated_at=now();

insert into era_files (
  id,tenant_id,payer_id,file_name,check_or_trace_number,payment_amount_cents,status,raw_metadata
)
values (
  '62e00000-0000-4000-8000-000000000007',
  'aea3549e-8b53-4358-8426-9f7b79f69a34',
  'b296205c-97b4-4f9f-9dd3-e01cd67c08f8',
  'p3-patient-ar-001.835','P3-PATIENT-AR-EFT-001',8000,'posted',
  '{"demo_phase":3,"demo_id":"P3-PATIENT-AR-001","synthetic":true,"patient_responsibility_cents":2000}'::jsonb
)
on conflict (id) do update set
  payer_id=excluded.payer_id,
  file_name=excluded.file_name,
  check_or_trace_number=excluded.check_or_trace_number,
  payment_amount_cents=excluded.payment_amount_cents,
  status=excluded.status,
  raw_metadata=excluded.raw_metadata,
  updated_at=now();

insert into era_claims (
  id,tenant_id,era_file_id,payer_claim_number,patient_control_number,client_id,claim_id,
  charge_amount_cents,paid_amount_cents,status,raw_data
)
values (
  '62f00000-0000-4000-8000-000000000007',
  'aea3549e-8b53-4358-8426-9f7b79f69a34',
  '62e00000-0000-4000-8000-000000000007',
  'P3-PAYER-PATIENT-AR-001','P3-PATIENT-AR-001',
  'ff648f71-9c94-433c-9aab-f80b039a80fd',
  '62000000-0000-4000-8000-000000000007',
  12000,8000,'posted',
  '{"demo_phase":3,"demo_id":"P3-PATIENT-AR-001","synthetic":true,"contractual_adjustment_cents":2000,"patient_responsibility_cents":2000}'::jsonb
)
on conflict (id) do update set
  payer_claim_number=excluded.payer_claim_number,
  patient_control_number=excluded.patient_control_number,
  client_id=excluded.client_id,
  claim_id=excluded.claim_id,
  charge_amount_cents=excluded.charge_amount_cents,
  paid_amount_cents=excluded.paid_amount_cents,
  status=excluded.status,
  raw_data=excluded.raw_data,
  updated_at=now();

insert into era_matches (
  id,tenant_id,era_claim_id,claim_id,match_status,confidence
)
values (
  '63000000-0000-4000-8000-000000000007',
  'aea3549e-8b53-4358-8426-9f7b79f69a34',
  '62f00000-0000-4000-8000-000000000007',
  '62000000-0000-4000-8000-000000000007',
  'posted',1
)
on conflict (id) do update set
  claim_id=excluded.claim_id,
  match_status=excluded.match_status,
  confidence=excluded.confidence,
  updated_at=now();

insert into payments (
  id,tenant_id,client_id,payer_id,payment_source,payment_method,payment_status,
  payment_date,amount_cents,trace_number,notes,posted_at
)
values (
  '62600000-0000-4000-8000-000000000007',
  'aea3549e-8b53-4358-8426-9f7b79f69a34',
  'ff648f71-9c94-433c-9aab-f80b039a80fd',
  'b296205c-97b4-4f9f-9dd3-e01cd67c08f8',
  'insurance','eft','posted','2026-08-27',8000,
  'P3-PATIENT-AR-EFT-001',
  'Synthetic ERA payment leaving a 2000-cent patient-responsibility balance.',
  '2026-08-27T18:00:00Z'
)
on conflict (id) do update set
  payment_status=excluded.payment_status,
  payment_date=excluded.payment_date,
  amount_cents=excluded.amount_cents,
  trace_number=excluded.trace_number,
  notes=excluded.notes,
  posted_at=excluded.posted_at,
  updated_at=now();

insert into payment_allocations (
  id,tenant_id,payment_id,client_id,claim_id,claim_line_id,amount_cents,reversed_at
)
values (
  '62700000-0000-4000-8000-000000000007',
  'aea3549e-8b53-4358-8426-9f7b79f69a34',
  '62600000-0000-4000-8000-000000000007',
  'ff648f71-9c94-433c-9aab-f80b039a80fd',
  '62000000-0000-4000-8000-000000000007',
  '62100000-0000-4000-8000-000000000007',8000,null
)
on conflict (id) do update set
  amount_cents=excluded.amount_cents,
  reversed_at=excluded.reversed_at,
  updated_at=now();

insert into adjustments (
  id,tenant_id,client_id,claim_id,payer_id,adjustment_type,adjustment_status,
  adjustment_date,amount_cents,reason,carc_code,posted_at
)
values (
  '62900000-0000-4000-8000-000000000007',
  'aea3549e-8b53-4358-8426-9f7b79f69a34',
  'ff648f71-9c94-433c-9aab-f80b039a80fd',
  '62000000-0000-4000-8000-000000000007',
  'b296205c-97b4-4f9f-9dd3-e01cd67c08f8',
  'contractual','posted','2026-08-27',2000,
  'Synthetic ERA contractual adjustment before transfer of the remaining balance to patient responsibility.',
  '45','2026-08-27T18:00:00Z'
)
on conflict (id) do update set
  adjustment_type=excluded.adjustment_type,
  adjustment_status=excluded.adjustment_status,
  adjustment_date=excluded.adjustment_date,
  amount_cents=excluded.amount_cents,
  reason=excluded.reason,
  carc_code=excluded.carc_code,
  posted_at=excluded.posted_at,
  updated_at=now();

insert into adjustment_allocations (
  id,tenant_id,adjustment_id,client_id,claim_id,claim_line_id,amount_cents
)
values (
  '63100000-0000-4000-8000-000000000007',
  'aea3549e-8b53-4358-8426-9f7b79f69a34',
  '62900000-0000-4000-8000-000000000007',
  'ff648f71-9c94-433c-9aab-f80b039a80fd',
  '62000000-0000-4000-8000-000000000007',
  '62100000-0000-4000-8000-000000000007',2000
)
on conflict (id) do update set
  amount_cents=excluded.amount_cents,
  updated_at=now();

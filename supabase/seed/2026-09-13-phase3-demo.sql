-- Phase 3 synthetic billing scenarios.
-- Idempotent by fixed UUID. Does not delete or replace Phase 1/2 demo rows.

-- Shared demo anchors:
-- tenant  aea3549e-8b53-4358-8426-9f7b79f69a34 (Therassistant Demo)
-- patient ff648f71-9c94-433c-9aab-f80b039a80fd (Jordan Ellis)
-- provider c1538366-c7d3-4dad-a249-2914a891dc52 (Jamie Parker, LCSW)
-- payer   b296205c-97b4-4f9f-9dd3-e01cd67c08f8 (Aetna)

insert into payer_contracts (id,tenant_id,payer_id,contract_name,status,effective_date,notes)
values ('62a00000-0000-4000-8000-000000000001','aea3549e-8b53-4358-8426-9f7b79f69a34','b296205c-97b4-4f9f-9dd3-e01cd67c08f8','P3 Aetna Synthetic Contract','active','2026-01-01','Synthetic Phase 3 underpayment demonstration contract.')
on conflict (id) do update set contract_name=excluded.contract_name,status=excluded.status,effective_date=excluded.effective_date,notes=excluded.notes,updated_at=now();

insert into fee_schedules (id,tenant_id,payer_contract_id,name,status,effective_date)
values ('62b00000-0000-4000-8000-000000000001','aea3549e-8b53-4358-8426-9f7b79f69a34','62a00000-0000-4000-8000-000000000001','P3 Aetna Synthetic Fee Schedule','active','2026-01-01')
on conflict (id) do update set name=excluded.name,status=excluded.status,effective_date=excluded.effective_date,updated_at=now();

insert into fee_schedule_lines (id,tenant_id,fee_schedule_id,cpt_code,modifier,rate_cents,unit_type)
values ('62c00000-0000-4000-8000-000000000001','aea3549e-8b53-4358-8426-9f7b79f69a34','62b00000-0000-4000-8000-000000000001','90834',null,12000,'service')
on conflict (id) do update set cpt_code=excluded.cpt_code,modifier=excluded.modifier,rate_cents=excluded.rate_cents,unit_type=excluded.unit_type,updated_at=now();

insert into professional_claims (id,tenant_id,client_id,rendering_provider_id,billing_provider_id,payer_id,claim_status,service_date_from,service_date_to,total_charge_cents,patient_control_number,clearinghouse_claim_id,submitted_at,accepted_at,metadata)
values
('62000000-0000-4000-8000-000000000001','aea3549e-8b53-4358-8426-9f7b79f69a34','ff648f71-9c94-433c-9aab-f80b039a80fd','c1538366-c7d3-4dad-a249-2914a891dc52','c1538366-c7d3-4dad-a249-2914a891dc52','b296205c-97b4-4f9f-9dd3-e01cd67c08f8','accepted','2026-08-04','2026-08-04',12000,'P3-REJECT-001','P3-CH-REJECT-001','2026-08-15T16:00:00Z','2026-08-16T17:00:00Z','{"demo_phase":3,"demo_id":"P3-REJECT-001","synthetic":true}'::jsonb),
('62000000-0000-4000-8000-000000000002','aea3549e-8b53-4358-8426-9f7b79f69a34','ff648f71-9c94-433c-9aab-f80b039a80fd','c1538366-c7d3-4dad-a249-2914a891dc52','c1538366-c7d3-4dad-a249-2914a891dc52','b296205c-97b4-4f9f-9dd3-e01cd67c08f8','appealed','2026-08-06','2026-08-06',14000,'P3-APPEAL-001','P3-CH-APPEAL-001','2026-08-17T16:00:00Z',null,'{"demo_phase":3,"demo_id":"P3-APPEAL-001","synthetic":true}'::jsonb),
('62000000-0000-4000-8000-000000000003','aea3549e-8b53-4358-8426-9f7b79f69a34','ff648f71-9c94-433c-9aab-f80b039a80fd','c1538366-c7d3-4dad-a249-2914a891dc52','c1538366-c7d3-4dad-a249-2914a891dc52','b296205c-97b4-4f9f-9dd3-e01cd67c08f8','partially_paid','2026-08-08','2026-08-08',15000,'P3-UNDERPAY-001','P3-CH-UNDERPAY-001','2026-08-18T16:00:00Z','2026-08-19T16:00:00Z','{"demo_phase":3,"demo_id":"P3-UNDERPAY-001","synthetic":true}'::jsonb),
('62000000-0000-4000-8000-000000000004','aea3549e-8b53-4358-8426-9f7b79f69a34','ff648f71-9c94-433c-9aab-f80b039a80fd','c1538366-c7d3-4dad-a249-2914a891dc52','c1538366-c7d3-4dad-a249-2914a891dc52','b296205c-97b4-4f9f-9dd3-e01cd67c08f8','partially_paid','2026-08-10','2026-08-10',12000,'P3-RECOUP-001','P3-CH-RECOUP-001','2026-08-20T16:00:00Z','2026-08-21T16:00:00Z','{"demo_phase":3,"demo_id":"P3-RECOUP-001","synthetic":true}'::jsonb),
('62000000-0000-4000-8000-000000000005','aea3549e-8b53-4358-8426-9f7b79f69a34','ff648f71-9c94-433c-9aab-f80b039a80fd','c1538366-c7d3-4dad-a249-2914a891dc52','c1538366-c7d3-4dad-a249-2914a891dc52','b296205c-97b4-4f9f-9dd3-e01cd67c08f8','accepted','2026-08-12','2026-08-12',10000,'P3-REVERSAL-001','P3-CH-REVERSAL-001','2026-08-22T16:00:00Z','2026-08-23T16:00:00Z','{"demo_phase":3,"demo_id":"P3-REVERSAL-001","synthetic":true}'::jsonb),
('62000000-0000-4000-8000-000000000006','aea3549e-8b53-4358-8426-9f7b79f69a34','ff648f71-9c94-433c-9aab-f80b039a80fd','c1538366-c7d3-4dad-a249-2914a891dc52','c1538366-c7d3-4dad-a249-2914a891dc52','b296205c-97b4-4f9f-9dd3-e01cd67c08f8','paid','2026-08-14','2026-08-14',12000,'P3-CRED-WO-001','P3-CH-CRED-WO-001','2026-08-24T16:00:00Z',null,'{"demo_phase":3,"demo_id":"P3-CRED-WO-001","synthetic":true}'::jsonb)
on conflict (id) do update set claim_status=excluded.claim_status,service_date_from=excluded.service_date_from,service_date_to=excluded.service_date_to,total_charge_cents=excluded.total_charge_cents,patient_control_number=excluded.patient_control_number,clearinghouse_claim_id=excluded.clearinghouse_claim_id,submitted_at=excluded.submitted_at,accepted_at=excluded.accepted_at,metadata=excluded.metadata,updated_at=now();

insert into professional_claim_lines (id,tenant_id,claim_id,service_date,cpt_code,units,charge_amount_cents,allowed_amount_cents,paid_amount_cents,adjustment_amount_cents)
values
('62100000-0000-4000-8000-000000000001','aea3549e-8b53-4358-8426-9f7b79f69a34','62000000-0000-4000-8000-000000000001','2026-08-04','90834',1,12000,null,0,0),
('62100000-0000-4000-8000-000000000002','aea3549e-8b53-4358-8426-9f7b79f69a34','62000000-0000-4000-8000-000000000002','2026-08-06','90837',1,14000,null,0,0),
('62100000-0000-4000-8000-000000000003','aea3549e-8b53-4358-8426-9f7b79f69a34','62000000-0000-4000-8000-000000000003','2026-08-08','90834',1,15000,8000,8000,3000),
('62100000-0000-4000-8000-000000000004','aea3549e-8b53-4358-8426-9f7b79f69a34','62000000-0000-4000-8000-000000000004','2026-08-10','90834',1,12000,12000,12000,0),
('62100000-0000-4000-8000-000000000005','aea3549e-8b53-4358-8426-9f7b79f69a34','62000000-0000-4000-8000-000000000005','2026-08-12','90834',1,10000,10000,0,0),
('62100000-0000-4000-8000-000000000006','aea3549e-8b53-4358-8426-9f7b79f69a34','62000000-0000-4000-8000-000000000006','2026-08-14','90834',1,12000,null,0,12000)
on conflict (id) do update set service_date=excluded.service_date,cpt_code=excluded.cpt_code,units=excluded.units,charge_amount_cents=excluded.charge_amount_cents,allowed_amount_cents=excluded.allowed_amount_cents,paid_amount_cents=excluded.paid_amount_cents,adjustment_amount_cents=excluded.adjustment_amount_cents,updated_at=now();

insert into claim_submissions (id,tenant_id,claim_id,submission_status,submission_method,submitted_at,response_payload)
values
('62200000-0000-4000-8000-000000000001','aea3549e-8b53-4358-8426-9f7b79f69a34','62000000-0000-4000-8000-000000000001','rejected','837P','2026-08-15T16:00:00Z','{"demo_id":"P3-REJECT-001","attempt":1}'::jsonb),
('62200000-0000-4000-8000-000000000002','aea3549e-8b53-4358-8426-9f7b79f69a34','62000000-0000-4000-8000-000000000001','resubmitted','837P corrected','2026-08-16T16:00:00Z','{"demo_id":"P3-REJECT-001","attempt":2,"corrected":true}'::jsonb)
on conflict (id) do update set submission_status=excluded.submission_status,submission_method=excluded.submission_method,submitted_at=excluded.submitted_at,response_payload=excluded.response_payload,updated_at=now();

insert into submission_responses (id,tenant_id,submission_id,claim_id,response_status,response_code,response_message,raw_response)
values
('62300000-0000-4000-8000-000000000001','aea3549e-8b53-4358-8426-9f7b79f69a34','62200000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','rejected','A3','Claim rejected for synthetic subscriber-data correction.','{"demo_id":"P3-REJECT-001","attempt":1}'::jsonb),
('62300000-0000-4000-8000-000000000002','aea3549e-8b53-4358-8426-9f7b79f69a34','62200000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001','accepted','A1','Corrected claim accepted by synthetic clearinghouse.','{"demo_id":"P3-REJECT-001","attempt":2}'::jsonb)
on conflict (id) do update set response_status=excluded.response_status,response_code=excluded.response_code,response_message=excluded.response_message,raw_response=excluded.raw_response;

insert into denials (id,tenant_id,claim_id,client_id,payer_id,denial_date,denial_status,denial_category,workability,carc_code,rarc_code,amount_cents,reason,timely_filing_deadline)
values
('62400000-0000-4000-8000-000000000001','aea3549e-8b53-4358-8426-9f7b79f69a34','62000000-0000-4000-8000-000000000002','ff648f71-9c94-433c-9aab-f80b039a80fd','b296205c-97b4-4f9f-9dd3-e01cd67c08f8','2026-08-25','appealed','authorization','workable','197','N130',14000,'Synthetic authorization denial under active appeal.','2026-10-15'),
('62400000-0000-4000-8000-000000000002','aea3549e-8b53-4358-8426-9f7b79f69a34','62000000-0000-4000-8000-000000000006','ff648f71-9c94-433c-9aab-f80b039a80fd','b296205c-97b4-4f9f-9dd3-e01cd67c08f8','2026-08-28','resolved_writeoff','credentialing','auto_writeoff','170',null,12000,'Synthetic credentialing denial resolved under configured write-off policy.',null)
on conflict (id) do update set denial_status=excluded.denial_status,denial_category=excluded.denial_category,workability=excluded.workability,carc_code=excluded.carc_code,rarc_code=excluded.rarc_code,amount_cents=excluded.amount_cents,reason=excluded.reason,timely_filing_deadline=excluded.timely_filing_deadline,updated_at=now();

insert into appeals (id,tenant_id,denial_id,claim_id,appeal_status,appeal_level,deadline_date,submitted_at,notes)
values ('62500000-0000-4000-8000-000000000001','aea3549e-8b53-4358-8426-9f7b79f69a34','62400000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000002','submitted','1','2026-10-15','2026-09-01T16:00:00Z','Synthetic Phase 3 authorization appeal submitted with supporting records.')
on conflict (id) do update set appeal_status=excluded.appeal_status,appeal_level=excluded.appeal_level,deadline_date=excluded.deadline_date,submitted_at=excluded.submitted_at,notes=excluded.notes,updated_at=now();

insert into payments (id,tenant_id,client_id,payer_id,payment_source,payment_method,payment_status,payment_date,amount_cents,trace_number,notes,posted_at)
values
('62600000-0000-4000-8000-000000000001','aea3549e-8b53-4358-8426-9f7b79f69a34','ff648f71-9c94-433c-9aab-f80b039a80fd','b296205c-97b4-4f9f-9dd3-e01cd67c08f8','insurance','eft','posted','2026-08-27',8000,'P3-UNDERPAY-EFT-001','Synthetic payment supporting the contract-underpayment scenario.','2026-08-27T18:00:00Z'),
('62600000-0000-4000-8000-000000000002','aea3549e-8b53-4358-8426-9f7b79f69a34','ff648f71-9c94-433c-9aab-f80b039a80fd','b296205c-97b4-4f9f-9dd3-e01cd67c08f8','insurance','eft','posted','2026-08-29',12000,'P3-RECOUP-EFT-001','Original synthetic payer payment later subject to recoupment.','2026-08-29T18:00:00Z'),
('62600000-0000-4000-8000-000000000003','aea3549e-8b53-4358-8426-9f7b79f69a34','ff648f71-9c94-433c-9aab-f80b039a80fd','b296205c-97b4-4f9f-9dd3-e01cd67c08f8','insurance','eft','reversed','2026-09-02',10000,'P3-REVERSAL-EFT-001','Synthetic payment was initially partially applied (6000 allocated / 4000 unapplied) and later reversed.','2026-09-02T18:00:00Z')
on conflict (id) do update set payment_status=excluded.payment_status,payment_date=excluded.payment_date,amount_cents=excluded.amount_cents,trace_number=excluded.trace_number,notes=excluded.notes,posted_at=excluded.posted_at,updated_at=now();

insert into payment_allocations (id,tenant_id,payment_id,client_id,claim_id,claim_line_id,amount_cents,reversed_at)
values
('62700000-0000-4000-8000-000000000001','aea3549e-8b53-4358-8426-9f7b79f69a34','62600000-0000-4000-8000-000000000001','ff648f71-9c94-433c-9aab-f80b039a80fd','62000000-0000-4000-8000-000000000003','62100000-0000-4000-8000-000000000003',8000,null),
('62700000-0000-4000-8000-000000000002','aea3549e-8b53-4358-8426-9f7b79f69a34','62600000-0000-4000-8000-000000000002','ff648f71-9c94-433c-9aab-f80b039a80fd','62000000-0000-4000-8000-000000000004','62100000-0000-4000-8000-000000000004',12000,null),
('62700000-0000-4000-8000-000000000003','aea3549e-8b53-4358-8426-9f7b79f69a34','62600000-0000-4000-8000-000000000003','ff648f71-9c94-433c-9aab-f80b039a80fd','62000000-0000-4000-8000-000000000005','62100000-0000-4000-8000-000000000005',6000,'2026-09-03T16:00:00Z')
on conflict (id) do update set amount_cents=excluded.amount_cents,reversed_at=excluded.reversed_at,updated_at=now();

insert into payment_reversals (id,tenant_id,payment_id,reason)
values ('62800000-0000-4000-8000-000000000001','aea3549e-8b53-4358-8426-9f7b79f69a34','62600000-0000-4000-8000-000000000003','Synthetic duplicate/remittance correction; original payment retained for audit.')
on conflict (id) do update set reason=excluded.reason;

insert into adjustments (id,tenant_id,client_id,claim_id,payer_id,adjustment_type,adjustment_status,adjustment_date,amount_cents,reason,carc_code,posted_at)
values
('62900000-0000-4000-8000-000000000001','aea3549e-8b53-4358-8426-9f7b79f69a34','ff648f71-9c94-433c-9aab-f80b039a80fd','62000000-0000-4000-8000-000000000003','b296205c-97b4-4f9f-9dd3-e01cd67c08f8','contractual','posted','2026-08-27',3000,'Expected contractual reduction before identifying remaining underpayment.','45','2026-08-27T18:00:00Z'),
('62900000-0000-4000-8000-000000000002','aea3549e-8b53-4358-8426-9f7b79f69a34','ff648f71-9c94-433c-9aab-f80b039a80fd','62000000-0000-4000-8000-000000000004','b296205c-97b4-4f9f-9dd3-e01cd67c08f8','recoupment','posted','2026-09-05',3000,'Synthetic payer recoupment requiring revenue-recovery review.',null,'2026-09-05T16:00:00Z'),
('62900000-0000-4000-8000-000000000003','aea3549e-8b53-4358-8426-9f7b79f69a34','ff648f71-9c94-433c-9aab-f80b039a80fd','62000000-0000-4000-8000-000000000006','b296205c-97b4-4f9f-9dd3-e01cd67c08f8','credentialing_writeoff','posted','2026-08-28',12000,'Configured credentialing-denial write-off; no appeal workflow.','170','2026-08-28T18:00:00Z')
on conflict (id) do update set adjustment_type=excluded.adjustment_type,adjustment_status=excluded.adjustment_status,adjustment_date=excluded.adjustment_date,amount_cents=excluded.amount_cents,reason=excluded.reason,carc_code=excluded.carc_code,posted_at=excluded.posted_at,updated_at=now();

insert into workqueue_items (id,tenant_id,workqueue_type,workqueue_status,priority,source_object_type,source_object_id,title,description,due_date,completed_at)
values
('62d00000-0000-4000-8000-000000000001','aea3549e-8b53-4358-8426-9f7b79f69a34','claim_rejection','completed','high','claim','62000000-0000-4000-8000-000000000001','Correct rejected P3 claim','Synthetic A3 rejection corrected and resubmitted successfully.',null,'2026-08-16T17:00:00Z'),
('62d00000-0000-4000-8000-000000000002','aea3549e-8b53-4358-8426-9f7b79f69a34','appeal_deadline','open','high','appeal','62500000-0000-4000-8000-000000000001','P3 appeal deadline','Track synthetic authorization appeal through payer outcome.','2026-10-15',null),
('62d00000-0000-4000-8000-000000000003','aea3549e-8b53-4358-8426-9f7b79f69a34','contract_variance','open','high','claim','62000000-0000-4000-8000-000000000003','P3 contract underpayment','Expected allowed 12000 cents; actual allowed 8000 cents; variance 4000 cents.',null,null),
('62d00000-0000-4000-8000-000000000004','aea3549e-8b53-4358-8426-9f7b79f69a34','overpayment_review','open','high','adjustment','62900000-0000-4000-8000-000000000002','P3 recoupment review','Review 3000-cent synthetic recoupment and pursue recovery as appropriate.',null,null),
('62d00000-0000-4000-8000-000000000005','aea3549e-8b53-4358-8426-9f7b79f69a34','payment_posting_issue','completed','normal','payment','62600000-0000-4000-8000-000000000003','P3 payment reversal','Synthetic unapplied/partially-applied payment was reversed with allocation history retained.',null,'2026-09-03T16:00:00Z'),
('62d00000-0000-4000-8000-000000000006','aea3549e-8b53-4358-8426-9f7b79f69a34','credentialing_issue','completed','normal','denial','62400000-0000-4000-8000-000000000002','P3 credentialing write-off','Configured non-workable credentialing denial resolved through write-off, not appeal.',null,'2026-08-28T18:00:00Z')
on conflict (id) do update set workqueue_type=excluded.workqueue_type,workqueue_status=excluded.workqueue_status,priority=excluded.priority,source_object_type=excluded.source_object_type,source_object_id=excluded.source_object_id,title=excluded.title,description=excluded.description,due_date=excluded.due_date,completed_at=excluded.completed_at,updated_at=now();
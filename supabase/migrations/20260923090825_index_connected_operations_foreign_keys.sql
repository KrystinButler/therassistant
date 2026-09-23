
begin;
create index if not exists appointment_reminders_created_by_idx on public.appointment_reminders(created_by) where created_by is not null;
create index if not exists referral_outs_client_fk_idx on public.referral_outs(client_id);
create index if not exists referral_outs_provider_fk_idx on public.referral_outs(referred_by_provider_id) where referred_by_provider_id is not null;
create index if not exists referral_outs_created_by_idx on public.referral_outs(created_by) where created_by is not null;
create index if not exists records_requests_client_fk_idx on public.records_requests(client_id) where client_id is not null;
create index if not exists records_requests_document_fk_idx on public.records_requests(document_id) where document_id is not null;
create index if not exists records_requests_created_by_idx on public.records_requests(created_by) where created_by is not null;
create index if not exists compliance_screenings_client_fk_idx on public.compliance_screenings(client_id) where client_id is not null;
create index if not exists compliance_screenings_provider_fk_idx on public.compliance_screenings(provider_id) where provider_id is not null;
create index if not exists compliance_screenings_reviewed_by_idx on public.compliance_screenings(reviewed_by) where reviewed_by is not null;
create index if not exists compliance_screenings_evidence_document_idx on public.compliance_screenings(evidence_document_id) where evidence_document_id is not null;
create index if not exists document_history_actor_idx on public.document_history(actor_id) where actor_id is not null;
commit;

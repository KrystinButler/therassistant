create index if not exists idx_encounter_diagnoses_tenant_id on public.encounter_diagnoses (tenant_id);
create index if not exists idx_encounter_readiness_checks_tenant_id on public.encounter_readiness_checks (tenant_id);
create index if not exists idx_encounter_service_lines_tenant_id on public.encounter_service_lines (tenant_id);
create index if not exists idx_encounters_client_id on public.encounters (client_id);
create index if not exists idx_encounters_insurance_policy_id on public.encounters (insurance_policy_id);
create index if not exists idx_encounters_payer_id on public.encounters (payer_id);
create index if not exists idx_encounters_provider_id on public.encounters (provider_id);
create index if not exists idx_patient_journal_entries_client_id on public.patient_journal_entries (client_id);
create index if not exists idx_patient_journal_entries_related_treatment_goal_id on public.patient_journal_entries (related_treatment_goal_id);
create index if not exists idx_patient_journal_entries_reviewed_by_provider_id on public.patient_journal_entries (reviewed_by_provider_id);
create index if not exists idx_patient_payment_plans_client_id on public.patient_payment_plans (client_id);
create index if not exists idx_portal_balance_exception_requests_client_id on public.portal_balance_exception_requests (client_id);

drop policy if exists demo_anon_read on public.appeals;
drop policy if exists demo_anon_read on public.payer_contracts;
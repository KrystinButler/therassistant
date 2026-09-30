create index if not exists idx_charge_capture_items_service_line_id
  on public.charge_capture_items (service_line_id);

create index if not exists idx_claim_correction_requests_claim_id
  on public.claim_correction_requests (claim_id);

create index if not exists idx_clinical_note_structured_data_client_id
  on public.clinical_note_structured_data (client_id);
create index if not exists idx_clinical_note_structured_data_encounter_id
  on public.clinical_note_structured_data (encounter_id);
create index if not exists idx_clinical_note_structured_data_provider_id
  on public.clinical_note_structured_data (provider_id);

create index if not exists idx_clinical_outcome_measures_client_id
  on public.clinical_outcome_measures (client_id);
create index if not exists idx_clinical_outcome_measures_encounter_id
  on public.clinical_outcome_measures (encounter_id);
create index if not exists idx_clinical_outcome_measures_provider_id
  on public.clinical_outcome_measures (provider_id);

create index if not exists idx_credentialing_requirement_templates_payer_id
  on public.credentialing_requirement_templates (payer_id);
create index if not exists idx_credentialing_requirement_templates_payer_plan_id
  on public.credentialing_requirement_templates (payer_plan_id);

create index if not exists idx_patient_journal_entries_recorded_by_staff_user_id
  on public.patient_journal_entries (recorded_by_staff_user_id);

create index if not exists idx_portal_message_threads_client_id
  on public.portal_message_threads (client_id);
create index if not exists idx_portal_messages_client_id
  on public.portal_messages (client_id);

create index if not exists idx_smart_phrases_owner_user_id
  on public.smart_phrases (owner_user_id);

create index if not exists idx_treatment_plan_review_drafts_client_id
  on public.treatment_plan_review_drafts (client_id);
create index if not exists idx_treatment_plan_review_drafts_provider_id
  on public.treatment_plan_review_drafts (provider_id);
create index if not exists idx_treatment_plan_review_drafts_source_plan_id
  on public.treatment_plan_review_drafts (source_plan_id);

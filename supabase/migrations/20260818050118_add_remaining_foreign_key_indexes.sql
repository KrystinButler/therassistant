create index if not exists idx_billing_company_practice_links_practice_tenant_id
on public.billing_company_practice_links (practice_tenant_id);

create index if not exists idx_clinical_note_signatures_signer_id
on public.clinical_note_signatures (signer_id);

create index if not exists idx_provider_payer_enrollments_payer_id
on public.provider_payer_enrollments (payer_id);

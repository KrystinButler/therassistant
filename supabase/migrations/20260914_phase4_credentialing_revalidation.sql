begin;

alter table public.provider_payer_enrollments
  add column if not exists revalidation_due_date date;

create index if not exists provider_payer_enrollments_revalidation_due_idx
  on public.provider_payer_enrollments (tenant_id, revalidation_due_date)
  where revalidation_due_date is not null;

commit;

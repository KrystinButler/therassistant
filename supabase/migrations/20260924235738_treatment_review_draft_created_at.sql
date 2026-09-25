-- Align review ordering with the existing EHR query; retain original generated times.
alter table public.treatment_plan_review_drafts
  add column if not exists created_at timestamptz;
update public.treatment_plan_review_drafts
set created_at = coalesce(generated_at, updated_at, now())
where created_at is null;
alter table public.treatment_plan_review_drafts
  alter column created_at set default now(),
  alter column created_at set not null;
create index if not exists treatment_plan_review_drafts_recent_idx
  on public.treatment_plan_review_drafts (tenant_id, client_id, review_date desc, created_at desc);

create table if not exists public.patient_outcome_scores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  provider_id uuid references public.providers(id) on delete set null,
  encounter_id uuid references public.encounters(id) on delete set null,
  instrument_code text not null,
  administered_date date not null default current_date,
  total_score integer not null,
  source text not null default 'manual_clinical',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_outcome_scores_instrument_check
    check (instrument_code in ('phq9','gad7')),
  constraint patient_outcome_scores_range_check
    check (
      (instrument_code = 'phq9' and total_score between 0 and 27)
      or
      (instrument_code = 'gad7' and total_score between 0 and 21)
    )
);

create index if not exists patient_outcome_scores_client_date_idx
  on public.patient_outcome_scores (tenant_id, client_id, administered_date desc);

create index if not exists patient_outcome_scores_instrument_idx
  on public.patient_outcome_scores (tenant_id, client_id, instrument_code, administered_date desc);

alter table public.patient_outcome_scores enable row level security;

drop policy if exists patient_outcome_scores_tenant_select on public.patient_outcome_scores;
create policy patient_outcome_scores_tenant_select
  on public.patient_outcome_scores for select to authenticated
  using (private.has_tenant_read_access(tenant_id));

drop policy if exists patient_outcome_scores_tenant_insert on public.patient_outcome_scores;
create policy patient_outcome_scores_tenant_insert
  on public.patient_outcome_scores for insert to authenticated
  with check (private.has_tenant_write_access(tenant_id));

drop policy if exists patient_outcome_scores_tenant_update on public.patient_outcome_scores;
create policy patient_outcome_scores_tenant_update
  on public.patient_outcome_scores for update to authenticated
  using (private.has_tenant_write_access(tenant_id))
  with check (private.has_tenant_write_access(tenant_id));

drop policy if exists patient_outcome_scores_tenant_delete on public.patient_outcome_scores;
create policy patient_outcome_scores_tenant_delete
  on public.patient_outcome_scores for delete to authenticated
  using (private.has_tenant_write_access(tenant_id));

create table if not exists public.treatment_plan_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  treatment_plan_id uuid not null references public.treatment_plans(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  provider_id uuid references public.providers(id) on delete set null,
  review_period_start date not null,
  review_period_end date not null,
  status text not null default 'draft',
  generated_summary text not null,
  clinician_summary text,
  outcome_snapshot jsonb not null default '[]'::jsonb,
  source_context jsonb not null default '{}'::jsonb,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint treatment_plan_reviews_status_check
    check (status in ('draft','ready_for_review','signed','voided')),
  constraint treatment_plan_reviews_period_check
    check (review_period_end >= review_period_start)
);

create index if not exists treatment_plan_reviews_plan_idx
  on public.treatment_plan_reviews (tenant_id, treatment_plan_id, review_period_end desc);

create index if not exists treatment_plan_reviews_client_idx
  on public.treatment_plan_reviews (tenant_id, client_id, review_period_end desc);

alter table public.treatment_plan_reviews enable row level security;

drop policy if exists treatment_plan_reviews_tenant_select on public.treatment_plan_reviews;
create policy treatment_plan_reviews_tenant_select
  on public.treatment_plan_reviews for select to authenticated
  using (private.has_tenant_read_access(tenant_id));

drop policy if exists treatment_plan_reviews_tenant_insert on public.treatment_plan_reviews;
create policy treatment_plan_reviews_tenant_insert
  on public.treatment_plan_reviews for insert to authenticated
  with check (private.has_tenant_write_access(tenant_id));

drop policy if exists treatment_plan_reviews_tenant_update on public.treatment_plan_reviews;
create policy treatment_plan_reviews_tenant_update
  on public.treatment_plan_reviews for update to authenticated
  using (private.has_tenant_write_access(tenant_id))
  with check (private.has_tenant_write_access(tenant_id));

drop policy if exists treatment_plan_reviews_tenant_delete on public.treatment_plan_reviews;
create policy treatment_plan_reviews_tenant_delete
  on public.treatment_plan_reviews for delete to authenticated
  using (private.has_tenant_write_access(tenant_id));

create table if not exists public.treatment_plan_review_goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  treatment_plan_review_id uuid not null references public.treatment_plan_reviews(id) on delete cascade,
  treatment_plan_goal_id uuid references public.treatment_plan_goals(id) on delete set null,
  goal_text_snapshot text not null,
  objective_text_snapshot text,
  documented_session_count integer not null default 0,
  progress_summary text not null,
  clinician_decision text not null default 'pending',
  clinician_comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint treatment_plan_review_goals_decision_check
    check (clinician_decision in ('pending','continue','met','revise','discontinue'))
);

create index if not exists treatment_plan_review_goals_review_idx
  on public.treatment_plan_review_goals (tenant_id, treatment_plan_review_id);

alter table public.treatment_plan_review_goals enable row level security;

drop policy if exists treatment_plan_review_goals_tenant_select on public.treatment_plan_review_goals;
create policy treatment_plan_review_goals_tenant_select
  on public.treatment_plan_review_goals for select to authenticated
  using (private.has_tenant_read_access(tenant_id));

drop policy if exists treatment_plan_review_goals_tenant_insert on public.treatment_plan_review_goals;
create policy treatment_plan_review_goals_tenant_insert
  on public.treatment_plan_review_goals for insert to authenticated
  with check (private.has_tenant_write_access(tenant_id));

drop policy if exists treatment_plan_review_goals_tenant_update on public.treatment_plan_review_goals;
create policy treatment_plan_review_goals_tenant_update
  on public.treatment_plan_review_goals for update to authenticated
  using (private.has_tenant_write_access(tenant_id))
  with check (private.has_tenant_write_access(tenant_id));

drop policy if exists treatment_plan_review_goals_tenant_delete on public.treatment_plan_review_goals;
create policy treatment_plan_review_goals_tenant_delete
  on public.treatment_plan_review_goals for delete to authenticated
  using (private.has_tenant_write_access(tenant_id));

revoke all privileges on table public.patient_outcome_scores from anon, authenticated;
revoke all privileges on table public.treatment_plan_reviews from anon, authenticated;
revoke all privileges on table public.treatment_plan_review_goals from anon, authenticated;

grant select, insert, update on table public.patient_outcome_scores to anon;
grant select, insert, update on table public.treatment_plan_reviews to anon;
grant select, insert, update on table public.treatment_plan_review_goals to anon;

grant select, insert, update, delete on table public.patient_outcome_scores to authenticated;
grant select, insert, update, delete on table public.treatment_plan_reviews to authenticated;
grant select, insert, update, delete on table public.treatment_plan_review_goals to authenticated;

drop policy if exists demo_anon_outcome_scores on public.patient_outcome_scores;
create policy demo_anon_outcome_scores
  on public.patient_outcome_scores for all to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'))
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists demo_anon_treatment_plan_reviews on public.treatment_plan_reviews;
create policy demo_anon_treatment_plan_reviews
  on public.treatment_plan_reviews for all to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'))
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists demo_anon_treatment_plan_review_goals on public.treatment_plan_review_goals;
create policy demo_anon_treatment_plan_review_goals
  on public.treatment_plan_review_goals for all to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'))
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

create or replace function public.sign_treatment_plan_review(p_review_id uuid)
returns public.treatment_plan_reviews
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  v_review public.treatment_plan_reviews;
begin
  select *
  into v_review
  from public.treatment_plan_reviews
  where id = p_review_id;

  if not found then
    raise exception 'Treatment plan review not found';
  end if;

  if coalesce(btrim(v_review.clinician_summary), '') = '' then
    raise exception 'Clinician review summary is required before signing';
  end if;

  if exists (
    select 1
    from public.treatment_plan_review_goals g
    where g.treatment_plan_review_id = p_review_id
      and g.clinician_decision = 'pending'
  ) then
    raise exception 'Every treatment goal needs a clinician decision before signing';
  end if;

  update public.treatment_plan_reviews
  set status = 'signed',
      signed_at = now(),
      updated_at = now()
  where id = p_review_id
  returning * into v_review;

  update public.treatment_plans
  set review_due_date = (v_review.review_period_end + 90),
      updated_at = now()
  where id = v_review.treatment_plan_id;

  return v_review;
end;
$$;

revoke all on function public.sign_treatment_plan_review(uuid) from public, anon, authenticated;
grant execute on function public.sign_treatment_plan_review(uuid) to authenticated, anon;

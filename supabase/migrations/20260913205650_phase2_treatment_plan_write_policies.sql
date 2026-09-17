begin;

alter table public.treatment_plans
  add column if not exists problem_statement text,
  add column if not exists interventions text;

drop policy if exists "demo anon insert treatment plans phase2" on public.treatment_plans;
create policy "demo anon insert treatment plans phase2"
  on public.treatment_plans for insert to anon
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists "demo anon update treatment plans phase2" on public.treatment_plans;
create policy "demo anon update treatment plans phase2"
  on public.treatment_plans for update to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'))
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists "demo anon insert treatment goals phase2" on public.treatment_plan_goals;
create policy "demo anon insert treatment goals phase2"
  on public.treatment_plan_goals for insert to anon
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

drop policy if exists "demo anon update treatment goals phase2" on public.treatment_plan_goals;
create policy "demo anon update treatment goals phase2"
  on public.treatment_plan_goals for update to anon
  using (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'))
  with check (tenant_id in (select id from public.tenants where name = 'Therassistant Demo'));

grant insert, update on public.treatment_plans to anon;
grant insert, update on public.treatment_plan_goals to anon;
revoke delete, truncate, references, trigger on public.treatment_plans from anon;
revoke delete, truncate, references, trigger on public.treatment_plan_goals from anon;

commit;

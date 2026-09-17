begin;

create index client_portal_access_created_by_idx
  on public.client_portal_access(created_by);

drop policy if exists "client_portal_access patient self select" on public.client_portal_access;
drop policy if exists "client_portal_access staff select" on public.client_portal_access;
create policy "client_portal_access authenticated select"
  on public.client_portal_access for select to authenticated
  using (
    (select private.has_tenant_read_access(tenant_id))
    or (
      (select auth.uid()) is not null
      and user_id = (select auth.uid())
    )
  );

drop policy if exists "appointments patient portal select" on public.appointments;
drop policy if exists "appointments tenant select" on public.appointments;
create policy "appointments tenant select"
  on public.appointments for select to authenticated
  using (
    private.has_tenant_read_access(tenant_id)
    or (select private.has_client_portal_access(tenant_id, client_id))
  );

drop policy if exists "balances patient portal select" on public.client_balance_summaries;
drop policy if exists "client_balance_summaries tenant select" on public.client_balance_summaries;
create policy "client_balance_summaries tenant select"
  on public.client_balance_summaries for select to authenticated
  using (
    private.has_tenant_read_access(tenant_id)
    or (select private.has_client_portal_access(tenant_id, client_id))
  );

drop policy if exists "checkins patient portal select" on public.client_checkins;
drop policy if exists "client_checkins tenant select" on public.client_checkins;
create policy "client_checkins tenant select"
  on public.client_checkins for select to authenticated
  using (
    private.has_tenant_read_access(tenant_id)
    or (select private.has_client_portal_access(tenant_id, client_id))
  );

drop policy if exists "insurance patient portal select" on public.client_insurance_policies;
drop policy if exists "client_insurance_policies tenant select" on public.client_insurance_policies;
create policy "client_insurance_policies tenant select"
  on public.client_insurance_policies for select to authenticated
  using (
    private.has_tenant_read_access(tenant_id)
    or (select private.has_client_portal_access(tenant_id, client_id))
  );

drop policy if exists "clients patient portal select" on public.clients;
drop policy if exists "clients tenant select" on public.clients;
create policy "clients tenant select"
  on public.clients for select to authenticated
  using (
    private.has_tenant_read_access(tenant_id)
    or (select private.has_client_portal_access(tenant_id, id))
  );

drop policy if exists "documents patient portal select" on public.documents;
drop policy if exists "documents tenant select" on public.documents;
create policy "documents tenant select"
  on public.documents for select to authenticated
  using (
    private.has_tenant_read_access(tenant_id)
    or (
      (select private.has_client_portal_access(tenant_id, client_id))
      and document_type::text in (
        'insurance_card','intake_form','consent_form',
        'client_correspondence','statement'
      )
      and document_status::text not in ('rejected','voided')
    )
  );

drop policy if exists "treatment plans patient portal select" on public.treatment_plans;
drop policy if exists "treatment_plans tenant select" on public.treatment_plans;
create policy "treatment_plans tenant select"
  on public.treatment_plans for select to authenticated
  using (
    private.has_tenant_read_access(tenant_id)
    or (select private.has_client_portal_access(tenant_id, client_id))
  );

drop policy if exists "treatment goals patient portal select" on public.treatment_plan_goals;
drop policy if exists "treatment_plan_goals tenant select" on public.treatment_plan_goals;
create policy "treatment_plan_goals tenant select"
  on public.treatment_plan_goals for select to authenticated
  using (
    private.has_tenant_read_access(tenant_id)
    or exists (
      select 1
      from public.treatment_plans tp
      where tp.id = treatment_plan_goals.treatment_plan_id
        and (select private.has_client_portal_access(tp.tenant_id, tp.client_id))
    )
  );

commit;

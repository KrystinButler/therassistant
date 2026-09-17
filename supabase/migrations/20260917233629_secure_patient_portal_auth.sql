begin;

create table public.client_portal_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  relationship text not null default 'self' check (relationship in ('self','guardian','proxy')),
  status text not null default 'invited' check (status in ('invited','active','revoked')),
  invited_email citext not null,
  invited_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, user_id)
);

create unique index client_portal_access_one_live_identity_idx
  on public.client_portal_access(client_id)
  where status <> 'revoked';

create index client_portal_access_user_status_idx
  on public.client_portal_access(user_id, status);

create index client_portal_access_tenant_client_status_idx
  on public.client_portal_access(tenant_id, client_id, status);

alter table public.client_portal_access enable row level security;

revoke all on public.client_portal_access from anon;
revoke insert, update, delete, truncate, references, trigger on public.client_portal_access from authenticated;
grant select on public.client_portal_access to authenticated;

create policy "client_portal_access staff select"
  on public.client_portal_access for select to authenticated
  using ((select private.has_tenant_read_access(tenant_id)));

create policy "client_portal_access patient self select"
  on public.client_portal_access for select to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create or replace function private.has_client_portal_access(
  p_tenant_id uuid,
  p_client_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.client_portal_access cpa
      where cpa.tenant_id = p_tenant_id
        and cpa.client_id = p_client_id
        and cpa.user_id = (select auth.uid())
        and cpa.status = 'active'
    );
$$;

revoke all on function private.has_client_portal_access(uuid, uuid) from public, anon;
grant execute on function private.has_client_portal_access(uuid, uuid) to authenticated;

create or replace function public.get_my_client_portal_context()
returns jsonb
language sql
stable
security invoker
set search_path = public, auth, pg_temp
as $$
  select jsonb_build_object(
    'tenant_id', cpa.tenant_id,
    'client_id', cpa.client_id,
    'status', cpa.status,
    'relationship', cpa.relationship,
    'invited_email', cpa.invited_email,
    'invited_at', cpa.invited_at,
    'activated_at', cpa.activated_at,
    'revoked_at', cpa.revoked_at
  )
  from public.client_portal_access cpa
  where cpa.user_id = (select auth.uid())
  order by
    case cpa.status when 'active' then 1 when 'invited' then 2 else 3 end,
    cpa.created_at desc
  limit 1;
$$;

revoke all on function public.get_my_client_portal_context() from public, anon;
grant execute on function public.get_my_client_portal_context() to authenticated;

create or replace function public.activate_my_client_portal_access()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.client_portal_access%rowtype;
  v_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_access
  from public.client_portal_access
  where user_id = (select auth.uid())
    and status in ('invited','active')
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'Patient portal invitation is unavailable';
  end if;

  if v_email = '' or v_email <> lower(v_access.invited_email::text) then
    raise exception 'Authenticated email does not match the portal invitation';
  end if;

  if v_access.status = 'invited' then
    update public.client_portal_access
    set status = 'active',
        activated_at = coalesce(activated_at, now()),
        revoked_at = null,
        updated_at = now()
    where id = v_access.id
    returning * into v_access;
  end if;

  return jsonb_build_object(
    'tenant_id', v_access.tenant_id,
    'client_id', v_access.client_id,
    'status', v_access.status,
    'activated_at', v_access.activated_at
  );
end;
$$;

revoke all on function public.activate_my_client_portal_access() from public, anon;
grant execute on function public.activate_my_client_portal_access() to authenticated;

create or replace function public.get_patient_portal_invite_context(p_client_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_client public.clients%rowtype;
  v_access public.client_portal_access%rowtype;
begin
  select * into v_client
  from public.clients
  where id = p_client_id;

  if not found or not private.has_tenant_write_access(v_client.tenant_id) then
    raise exception 'Patient is unavailable for portal enrollment';
  end if;

  select * into v_access
  from public.client_portal_access
  where client_id = v_client.id
    and status <> 'revoked'
  order by created_at desc
  limit 1;

  return jsonb_build_object(
    'tenant_id', v_client.tenant_id,
    'client_id', v_client.id,
    'email', lower(trim(coalesce(v_client.email::text, ''))),
    'first_name', v_client.first_name,
    'last_name', v_client.last_name,
    'access_id', v_access.id,
    'access_status', v_access.status,
    'access_user_id', v_access.user_id,
    'access_invited_at', v_access.invited_at
  );
end;
$$;

revoke all on function public.get_patient_portal_invite_context(uuid) from public, anon;
grant execute on function public.get_patient_portal_invite_context(uuid) to authenticated;

create or replace function public.revoke_client_portal_access(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_access public.client_portal_access%rowtype;
begin
  select tenant_id into v_tenant_id
  from public.clients
  where id = p_client_id;

  if v_tenant_id is null or not private.has_tenant_write_access(v_tenant_id) then
    raise exception 'Patient portal access is unavailable';
  end if;

  update public.client_portal_access
  set status = 'revoked',
      revoked_at = now(),
      updated_at = now()
  where client_id = p_client_id
    and status <> 'revoked'
  returning * into v_access;

  if v_access.id is null then
    raise exception 'No active patient portal access exists';
  end if;

  return jsonb_build_object(
    'client_id', v_access.client_id,
    'status', v_access.status,
    'revoked_at', v_access.revoked_at
  );
end;
$$;

revoke all on function public.revoke_client_portal_access(uuid) from public, anon;
grant execute on function public.revoke_client_portal_access(uuid) to authenticated;

create or replace function public.get_my_portal_provider_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access public.client_portal_access%rowtype;
  v_provider_id uuid;
  v_provider public.providers%rowtype;
begin
  select * into v_access
  from public.client_portal_access
  where user_id = (select auth.uid())
    and status = 'active'
  order by created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  select a.provider_id into v_provider_id
  from public.appointments a
  where a.tenant_id = v_access.tenant_id
    and a.client_id = v_access.client_id
    and a.provider_id is not null
    and a.starts_at >= now()
    and a.appointment_status not in (
      'cancelled'::public.appointment_status_enum,
      'no_show'::public.appointment_status_enum,
      'completed'::public.appointment_status_enum
    )
  order by a.starts_at asc
  limit 1;

  if v_provider_id is null then
    select tp.provider_id into v_provider_id
    from public.treatment_plans tp
    where tp.tenant_id = v_access.tenant_id
      and tp.client_id = v_access.client_id
      and tp.provider_id is not null
      and tp.status in (
        'active'::public.treatment_plan_status_enum,
        'signed'::public.treatment_plan_status_enum
      )
    order by tp.effective_date desc nulls last, tp.created_at desc
    limit 1;
  end if;

  if v_provider_id is null then
    return null;
  end if;

  select * into v_provider
  from public.providers
  where id = v_provider_id
    and tenant_id = v_access.tenant_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_provider.id,
    'first_name', v_provider.first_name,
    'last_name', v_provider.last_name,
    'credentials', v_provider.credentials,
    'primary_specialty', v_provider.primary_specialty
  );
end;
$$;

revoke all on function public.get_my_portal_provider_summary() from public, anon;
grant execute on function public.get_my_portal_provider_summary() to authenticated;

create policy "clients patient portal select"
  on public.clients for select to authenticated
  using ((select private.has_client_portal_access(tenant_id, id)));

create policy "appointments patient portal select"
  on public.appointments for select to authenticated
  using ((select private.has_client_portal_access(tenant_id, client_id)));

create policy "insurance patient portal select"
  on public.client_insurance_policies for select to authenticated
  using ((select private.has_client_portal_access(tenant_id, client_id)));

create policy "documents patient portal select"
  on public.documents for select to authenticated
  using (
    (select private.has_client_portal_access(tenant_id, client_id))
    and document_type::text in (
      'insurance_card','intake_form','consent_form',
      'client_correspondence','statement'
    )
    and document_status::text not in ('rejected','voided')
  );

create policy "checkins patient portal select"
  on public.client_checkins for select to authenticated
  using ((select private.has_client_portal_access(tenant_id, client_id)));

create policy "journal patient portal select"
  on public.patient_journal_entries for select to authenticated
  using ((select private.has_client_portal_access(tenant_id, client_id)));

create policy "balances patient portal select"
  on public.client_balance_summaries for select to authenticated
  using ((select private.has_client_portal_access(tenant_id, client_id)));

create policy "treatment plans patient portal select"
  on public.treatment_plans for select to authenticated
  using ((select private.has_client_portal_access(tenant_id, client_id)));

create policy "treatment goals patient portal select"
  on public.treatment_plan_goals for select to authenticated
  using (
    exists (
      select 1
      from public.treatment_plans tp
      where tp.id = treatment_plan_goals.treatment_plan_id
        and (select private.has_client_portal_access(tp.tenant_id, tp.client_id))
    )
  );

grant select on
  public.clients,
  public.appointments,
  public.client_insurance_policies,
  public.documents,
  public.client_checkins,
  public.patient_journal_entries,
  public.client_balance_summaries,
  public.treatment_plans,
  public.treatment_plan_goals
to authenticated;

commit;

begin;

create or replace function private.activate_my_client_portal_access_impl()
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

revoke all on function private.activate_my_client_portal_access_impl() from public, anon;
grant execute on function private.activate_my_client_portal_access_impl() to authenticated;

create or replace function public.activate_my_client_portal_access()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.activate_my_client_portal_access_impl();
$$;

revoke all on function public.activate_my_client_portal_access() from public, anon;
grant execute on function public.activate_my_client_portal_access() to authenticated;

create or replace function private.revoke_client_portal_access_impl(p_client_id uuid)
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

revoke all on function private.revoke_client_portal_access_impl(uuid) from public, anon;
grant execute on function private.revoke_client_portal_access_impl(uuid) to authenticated;

create or replace function public.revoke_client_portal_access(p_client_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.revoke_client_portal_access_impl(p_client_id);
$$;

revoke all on function public.revoke_client_portal_access(uuid) from public, anon;
grant execute on function public.revoke_client_portal_access(uuid) to authenticated;

create or replace function private.get_my_portal_provider_summary_impl()
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

revoke all on function private.get_my_portal_provider_summary_impl() from public, anon;
grant execute on function private.get_my_portal_provider_summary_impl() to authenticated;

create or replace function public.get_my_portal_provider_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_my_portal_provider_summary_impl();
$$;

revoke all on function public.get_my_portal_provider_summary() from public, anon;
grant execute on function public.get_my_portal_provider_summary() to authenticated;

commit;

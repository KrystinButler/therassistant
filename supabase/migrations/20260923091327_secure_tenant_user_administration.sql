
begin;

create or replace function private.has_tenant_admin_access(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.tenant_users tu
      join public.tenant_user_roles tur
        on tur.tenant_id=tu.tenant_id
       and tur.user_id=tu.user_id
      where tu.tenant_id=p_tenant_id
        and tu.user_id=(select auth.uid())
        and tu.status::text='active'
        and tur.role::text in ('platform_admin','practice_admin','billing_company_admin')
    );
$$;
revoke all on function private.has_tenant_admin_access(uuid) from public, anon;
grant execute on function private.has_tenant_admin_access(uuid) to authenticated;

create or replace function private.list_tenant_users_admin_impl(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not private.has_tenant_admin_access(p_tenant_id)
      then (select jsonb_build_object('error','Administrative access required'))
    else coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'tenant_user_id', tu.id,
          'user_id', tu.user_id,
          'status', tu.status::text,
          'invited_at', tu.invited_at,
          'joined_at', tu.joined_at,
          'display_name', up.display_name,
          'first_name', up.first_name,
          'last_name', up.last_name,
          'email', up.email,
          'roles', coalesce((
            select jsonb_agg(tur.role::text order by tur.role::text)
            from public.tenant_user_roles tur
            where tur.tenant_id=tu.tenant_id and tur.user_id=tu.user_id
          ), '[]'::jsonb)
        )
        order by coalesce(up.display_name, up.email::text, tu.user_id::text)
      )
      from public.tenant_users tu
      left join public.user_profiles up on up.id=tu.user_id
      where tu.tenant_id=p_tenant_id
    ), '[]'::jsonb)
  end;
$$;
revoke all on function private.list_tenant_users_admin_impl(uuid) from public, anon;
grant execute on function private.list_tenant_users_admin_impl(uuid) to authenticated;

create or replace function public.list_tenant_users_admin(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.has_tenant_admin_access(p_tenant_id) then
    raise exception 'Administrative access required' using errcode='42501';
  end if;
  v_result := private.list_tenant_users_admin_impl(p_tenant_id);
  return v_result;
end;
$$;
revoke all on function public.list_tenant_users_admin(uuid) from public, anon;
grant execute on function public.list_tenant_users_admin(uuid) to authenticated;

create or replace function private.set_tenant_user_roles_impl(
  p_tenant_id uuid,
  p_user_id uuid,
  p_roles text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_admin_count integer;
begin
  if not private.has_tenant_admin_access(p_tenant_id) then
    raise exception 'Administrative access required' using errcode='42501';
  end if;

  if p_roles is null or cardinality(p_roles)=0 then
    raise exception 'At least one role is required';
  end if;

  if not exists (
    select 1 from public.tenant_users
    where tenant_id=p_tenant_id and user_id=p_user_id
  ) then
    raise exception 'Tenant user not found';
  end if;

  foreach v_role in array p_roles loop
    if v_role not in (
      'platform_admin','practice_admin','billing_company_admin','billing_manager',
      'biller','clinician','front_desk','credentialing_specialist','read_only','client'
    ) then
      raise exception 'Unsupported role: %', v_role;
    end if;
  end loop;

  if p_user_id=(select auth.uid())
     and not (p_roles && array['platform_admin','practice_admin','billing_company_admin']) then
    select count(distinct tu.user_id)
      into v_admin_count
    from public.tenant_users tu
    join public.tenant_user_roles tur
      on tur.tenant_id=tu.tenant_id and tur.user_id=tu.user_id
    where tu.tenant_id=p_tenant_id
      and tu.status::text='active'
      and tu.user_id<>p_user_id
      and tur.role::text in ('platform_admin','practice_admin','billing_company_admin');

    if v_admin_count=0 then
      raise exception 'The last active administrator cannot remove their own administrative role';
    end if;
  end if;

  delete from public.tenant_user_roles
  where tenant_id=p_tenant_id and user_id=p_user_id;

  insert into public.tenant_user_roles (tenant_id,user_id,role)
  select p_tenant_id,p_user_id,role_text::public.system_role_enum
  from unnest(p_roles) role_text;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, new_values, metadata
  ) values (
    p_tenant_id,(select auth.uid()),'tenant_user_roles_updated','tenant_user',p_user_id::text,
    jsonb_build_object('roles',to_jsonb(p_roles)),
    '{}'::jsonb
  );

  return jsonb_build_object('user_id',p_user_id,'roles',to_jsonb(p_roles));
end;
$$;
revoke all on function private.set_tenant_user_roles_impl(uuid,uuid,text[]) from public, anon;
grant execute on function private.set_tenant_user_roles_impl(uuid,uuid,text[]) to authenticated;

create or replace function public.set_tenant_user_roles(
  p_tenant_id uuid,
  p_user_id uuid,
  p_roles text[]
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.set_tenant_user_roles_impl(p_tenant_id,p_user_id,p_roles);
$$;
revoke all on function public.set_tenant_user_roles(uuid,uuid,text[]) from public, anon;
grant execute on function public.set_tenant_user_roles(uuid,uuid,text[]) to authenticated;

create or replace function private.set_tenant_user_status_impl(
  p_tenant_id uuid,
  p_user_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.user_status_enum;
begin
  if not private.has_tenant_admin_access(p_tenant_id) then
    raise exception 'Administrative access required' using errcode='42501';
  end if;

  if p_status not in ('active','inactive','invited','suspended','terminated') then
    raise exception 'Unsupported user status';
  end if;
  v_status := p_status::public.user_status_enum;

  if p_user_id=(select auth.uid()) and p_status<>'active' then
    raise exception 'Administrators cannot deactivate their own current membership';
  end if;

  update public.tenant_users
  set status=v_status, updated_at=now()
  where tenant_id=p_tenant_id and user_id=p_user_id;

  if not found then raise exception 'Tenant user not found'; end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, new_values, metadata
  ) values (
    p_tenant_id,(select auth.uid()),'tenant_user_status_updated','tenant_user',p_user_id::text,
    jsonb_build_object('status',p_status),
    '{}'::jsonb
  );

  return jsonb_build_object('user_id',p_user_id,'status',p_status);
end;
$$;
revoke all on function private.set_tenant_user_status_impl(uuid,uuid,text) from public, anon;
grant execute on function private.set_tenant_user_status_impl(uuid,uuid,text) to authenticated;

create or replace function public.set_tenant_user_status(
  p_tenant_id uuid,
  p_user_id uuid,
  p_status text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.set_tenant_user_status_impl(p_tenant_id,p_user_id,p_status);
$$;
revoke all on function public.set_tenant_user_status(uuid,uuid,text) from public, anon;
grant execute on function public.set_tenant_user_status(uuid,uuid,text) to authenticated;

commit;

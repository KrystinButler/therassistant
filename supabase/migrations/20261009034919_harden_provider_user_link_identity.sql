create or replace function public.validate_provider_user_link()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_provider public.providers%rowtype;
  v_profile public.user_profiles%rowtype;
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if tg_op = 'UPDATE' then
    if old.user_id <> v_user_id or new.user_id <> old.user_id then
      raise exception 'A provider link cannot be reassigned to another user';
    end if;

    if new.tenant_id <> old.tenant_id or new.provider_id <> old.provider_id then
      raise exception 'Provider link identity cannot be changed after it is created';
    end if;

    if not private.has_tenant_write_access(new.tenant_id) then
      raise exception 'You do not have access to this practice';
    end if;

    if not exists (
      select 1
      from public.tenant_user_roles tur
      where tur.tenant_id = new.tenant_id
        and tur.user_id = v_user_id
        and tur.role = 'clinician'::public.system_role_enum
    ) then
      raise exception 'A clinician role is required to manage a provider link';
    end if;

    return new;
  end if;

  if new.user_id <> v_user_id then
    raise exception 'Clinician account links can only be created by the linked user';
  end if;

  if not private.has_tenant_write_access(new.tenant_id) then
    raise exception 'You do not have access to this practice';
  end if;

  if not exists (
    select 1
    from public.tenant_user_roles tur
    where tur.tenant_id = new.tenant_id
      and tur.user_id = v_user_id
      and tur.role = 'clinician'::public.system_role_enum
  ) then
    raise exception 'A clinician role is required to link an account to a provider';
  end if;

  select * into v_provider
  from public.providers
  where id = new.provider_id
    and tenant_id = new.tenant_id
    and provider_status = 'active';

  if not found then
    raise exception 'Active provider not found in this practice';
  end if;

  select * into v_profile
  from public.user_profiles
  where id = v_user_id;

  if v_profile.id is null
     or v_provider.email is null
     or v_profile.email is null
     or lower(trim(v_provider.email::text)) <> lower(trim(v_profile.email::text)) then
    raise exception 'The clinician login email must match the provider email before accounts can be linked';
  end if;

  return new;
end;
$$;

create or replace function public.link_current_user_to_provider(p_provider_id uuid)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_provider public.providers%rowtype;
  v_profile public.user_profiles%rowtype;
  v_link public.provider_user_links%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  select * into v_provider
  from public.providers
  where id = p_provider_id
  for update;

  if not found then
    raise exception 'Provider not found';
  end if;

  if not private.has_tenant_write_access(v_provider.tenant_id) then
    raise exception 'You do not have access to this practice';
  end if;

  if not exists (
    select 1
    from public.tenant_user_roles tur
    where tur.tenant_id = v_provider.tenant_id
      and tur.user_id = v_user_id
      and tur.role = 'clinician'::public.system_role_enum
  ) then
    raise exception 'Your account must have the Clinician role before it can be linked to a provider';
  end if;

  select * into v_link
  from public.provider_user_links pul
  where pul.tenant_id = v_provider.tenant_id
    and pul.provider_id = v_provider.id
  for update;

  if found then
    if v_link.user_id <> v_user_id then
      raise exception 'This provider is already linked to another user account';
    end if;

    if v_link.status <> 'active' then
      update public.provider_user_links
      set status = 'active', updated_at = now()
      where id = v_link.id
      returning * into v_link;
    end if;

    return jsonb_build_object(
      'linked', true,
      'provider_id', v_provider.id,
      'provider_name', trim(concat_ws(' ', v_provider.first_name, v_provider.last_name))
    );
  end if;

  if exists (
    select 1
    from public.provider_user_links pul
    where pul.tenant_id = v_provider.tenant_id
      and pul.user_id = v_user_id
      and pul.provider_id <> v_provider.id
  ) then
    raise exception 'Your account is already linked to another provider in this practice';
  end if;

  select * into v_profile
  from public.user_profiles
  where id = v_user_id;

  if v_profile.id is null then
    raise exception 'User profile not found';
  end if;

  if v_provider.email is null or v_profile.email is null
     or lower(trim(v_provider.email::text)) <> lower(trim(v_profile.email::text)) then
    raise exception 'The clinician login email must match the provider email before accounts can be linked';
  end if;

  begin
    insert into public.provider_user_links (
      tenant_id, provider_id, user_id, status
    ) values (
      v_provider.tenant_id, v_provider.id, v_user_id, 'active'
    )
    returning * into v_link;
  exception
    when unique_violation then
      raise exception 'The provider or clinician account was linked by another request; refresh and try again';
  end;

  return jsonb_build_object(
    'linked', true,
    'provider_id', v_provider.id,
    'provider_name', trim(concat_ws(' ', v_provider.first_name, v_provider.last_name))
  );
end;
$$;

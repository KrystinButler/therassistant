-- Revocation hardening: an inactive provider link must not be silently
-- reactivated by sign_encounter_note -> link_current_user_to_provider.
-- The database trigger below is authoritative for direct UPDATE and RPC writes.
--
-- Prevent deleting an inactive link then recreating it through first-time linking.
drop policy if exists "provider_user_links_self_delete" on public.provider_user_links;
revoke delete, truncate, trigger, references on public.provider_user_links from authenticated;
revoke delete, truncate, trigger, references on public.provider_user_links from anon;

-- Admins can see and status-update clinician links only within their own practice.
drop policy if exists "provider_user_links_admin_select" on public.provider_user_links;
create policy "provider_user_links_admin_select" on public.provider_user_links
for select to authenticated using (
  private.has_tenant_write_access(tenant_id)
  and exists(select 1 from public.tenant_user_roles tur
    where tur.tenant_id=provider_user_links.tenant_id
      and tur.user_id=(select auth.uid())
      and tur.role='practice_admin'::public.system_role_enum)
);

drop policy if exists "provider_user_links_admin_update" on public.provider_user_links;
create policy "provider_user_links_admin_update" on public.provider_user_links
for update to authenticated using (
  private.has_tenant_write_access(tenant_id)
  and exists(select 1 from public.tenant_user_roles tur
    where tur.tenant_id=provider_user_links.tenant_id
      and tur.user_id=(select auth.uid())
      and tur.role='practice_admin'::public.system_role_enum)
) with check (
  private.has_tenant_write_access(tenant_id)
  and exists(select 1 from public.tenant_user_roles tur
    where tur.tenant_id=provider_user_links.tenant_id
      and tur.user_id=(select auth.uid())
      and tur.role='practice_admin'::public.system_role_enum)
);

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
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id
      or new.provider_id is distinct from old.provider_id
      or new.tenant_id is distinct from old.tenant_id then
      raise exception 'Provider link identity cannot be changed' using errcode='42501';
    end if;
    if not private.has_tenant_write_access(new.tenant_id) then
      raise exception 'You do not have access to this practice' using errcode='42501';
    end if;
    if new.status is distinct from old.status then
      -- Only a practice administrator may disable or reinstate a link.
      if not exists(select 1 from public.tenant_user_roles tur where
        tur.tenant_id=new.tenant_id and tur.user_id=v_user_id
        and tur.role='practice_admin'::public.system_role_enum) then
        raise exception 'An inactive clinician link requires a practice administrator to reactivate it'
          using errcode='42501';
      end if;
      if new.status not in ('active','inactive') then
        raise exception 'Provider link status must be active or inactive' using errcode='22023';
      end if;
      if (to_jsonb(new) - 'status' - 'updated_at') is distinct from
         (to_jsonb(old) - 'status' - 'updated_at') then
        raise exception 'A status change cannot modify provider link identity or metadata'
          using errcode='42501';
      end if;
      return new;
    end if;
    if old.user_id <> v_user_id then
      raise exception 'A provider link cannot be reassigned to another user' using errcode='42501';
    end if;
    if not exists(select 1 from public.tenant_user_roles tur where
      tur.tenant_id=new.tenant_id and tur.user_id=v_user_id
      and tur.role='clinician'::public.system_role_enum) then
      raise exception 'A clinician role is required to manage a provider link' using errcode='42501';
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


-- Audit every administrative link status transition.
drop trigger if exists trg_audit_provider_link_status on public.provider_user_links;
create trigger trg_audit_provider_link_status after update on public.provider_user_links
for each row when (old.status is distinct from new.status)
execute function public.audit_row_change();

-- Publicly exposed but INVOKER-only RPC; the admin role check, existing RLS,
-- and the UPDATE trigger all independently guard authorization.
create or replace function public.admin_set_provider_link_status(
  p_provider_id uuid, p_status text
) returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_provider public.providers%rowtype;
  v_link public.provider_user_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if p_status is null or p_status not in ('active','inactive') then
    raise exception 'Provider link status must be active or inactive' using errcode='22023';
  end if;
  select * into v_provider from public.providers where id=p_provider_id;
  if not found then raise exception 'Provider not found'; end if;
  if not private.has_tenant_write_access(v_provider.tenant_id)
    or not exists(select 1 from public.tenant_user_roles tur
      where tur.tenant_id=v_provider.tenant_id and tur.user_id=auth.uid()
        and tur.role='practice_admin'::public.system_role_enum) then
    raise exception 'Only a practice administrator can change provider link status'
      using errcode='42501';
  end if;
  if p_status='active' and v_provider.provider_status <> 'active' then
    raise exception 'An inactive provider cannot be reactivated for signing'
      using errcode='42501';
  end if;
  select * into v_link from public.provider_user_links
  where tenant_id=v_provider.tenant_id and provider_id=v_provider.id
  for update;
  if not found then raise exception 'No clinician account is linked to this provider'; end if;
  if v_link.status is distinct from p_status then
    update public.provider_user_links set status=p_status,updated_at=now()
    where id=v_link.id returning * into v_link;
  end if;
  return jsonb_build_object('provider_id',v_provider.id,
    'user_id',v_link.user_id,'status',v_link.status);
end;
$function$;
revoke all on function public.admin_set_provider_link_status(uuid,text) from public,anon;
grant execute on function public.admin_set_provider_link_status(uuid,text) to authenticated;

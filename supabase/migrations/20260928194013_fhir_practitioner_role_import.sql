create table public.practitioner_role_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  provider_id uuid not null references public.providers(id),
  source text not null check (length(source) between 1 and 120),
  external_id text not null check (length(external_id) between 1 and 64),
  normalized jsonb not null,
  raw_resource jsonb not null,
  imported_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,source,external_id)
);
alter table public.practitioner_role_imports enable row level security;
revoke all on public.practitioner_role_imports from anon, authenticated;
grant select on public.practitioner_role_imports to authenticated;
grant all on public.practitioner_role_imports to service_role;
create policy practitioner_roles_read on public.practitioner_role_imports for select to authenticated using(private.has_tenant_read_access(tenant_id));
create index practitioner_roles_provider on public.practitioner_role_imports(provider_id);
create index practitioner_roles_actor on public.practitioner_role_imports(imported_by);
create function public.can_import_practitioner_roles(p_tenant_id uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select auth.uid() is not null and private.has_tenant_write_access(p_tenant_id);
$$;
revoke all on function public.can_import_practitioner_roles(uuid) from public,anon;
grant execute on function public.can_import_practitioner_roles(uuid) to authenticated;
create function public.save_practitioner_role_import(p_actor uuid,p_row jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare v_tenant uuid := (p_row->>'tenant_id')::uuid;
        v_provider uuid := (p_row->>'provider_id')::uuid;
begin
 if not exists(select 1 from public.tenant_users tu join public.tenant_user_roles tur on tur.tenant_id=tu.tenant_id and tur.user_id=tu.user_id
   where tu.tenant_id=v_tenant and tu.user_id=p_actor and tu.status='active' and tur.role not in ('client','read_only')) then
   raise exception 'Import access denied' using errcode='42501';
 end if;
 if not exists(select 1 from public.providers where id=v_provider and tenant_id=v_tenant and individual_npi=p_row->'normalized'->>'npi') then
   raise exception 'Provider does not match practice and NPI' using errcode='23514';
 end if;
 insert into public.practitioner_role_imports(tenant_id,provider_id,source,external_id,normalized,raw_resource,imported_by)
 values(v_tenant,v_provider,p_row->>'source',p_row->>'external_id',p_row->'normalized',p_row->'raw_resource',p_actor)
 on conflict(tenant_id,source,external_id) do update set provider_id=excluded.provider_id,normalized=excluded.normalized,raw_resource=excluded.raw_resource,imported_by=excluded.imported_by,updated_at=now();
end;
$$;
revoke all on function public.save_practitioner_role_import(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_practitioner_role_import(uuid,jsonb) to service_role;

create table if not exists public.tenant_edi_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'office_ally' check (provider = 'office_ally'),
  environment text not null default 'test' check (environment in ('test', 'production')),
  status text not null default 'not_connected' check (status in ('not_connected', 'test_ready', 'production_connected', 'connection_error')),
  account_label text,
  credential_profile text,
  credential_secret_id uuid,
  enabled boolean not null default false,
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

alter table public.tenant_edi_connections enable row level security;
revoke all on table public.tenant_edi_connections from anon, authenticated;

create index if not exists idx_tenant_edi_connections_tenant_provider
  on public.tenant_edi_connections (tenant_id, provider);

create or replace function public.get_office_ally_connection_status(p_tenant_id uuid)
returns table (
  provider text,
  environment text,
  status text,
  account_label text,
  credential_profile text,
  last_verified_at timestamptz,
  last_error text
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null or not private.has_tenant_read_access(p_tenant_id) then
    raise exception 'Active tenant membership is required.' using errcode = '42501';
  end if;

  return query
  select
    c.provider,
    c.environment,
    c.status,
    c.account_label,
    c.credential_profile,
    c.last_verified_at,
    c.last_error
  from public.tenant_edi_connections c
  where c.tenant_id = p_tenant_id
    and c.provider = 'office_ally'
  limit 1;

  if not found then
    return query
    select
      'office_ally'::text,
      'test'::text,
      'not_connected'::text,
      null::text,
      null::text,
      null::timestamptz,
      null::text;
  end if;
end;
$$;

revoke all on function public.get_office_ally_connection_status(uuid) from public;
grant execute on function public.get_office_ally_connection_status(uuid) to authenticated;

create or replace function public.save_office_ally_connection(
  p_tenant_id uuid,
  p_environment text,
  p_account_label text,
  p_credential_profile text,
  p_credentials jsonb
)
returns table (
  provider text,
  environment text,
  status text,
  account_label text,
  credential_profile text,
  last_verified_at timestamptz,
  last_error text
)
language plpgsql
security definer
set search_path = public, auth, vault, pg_temp
as $$
declare
  v_environment text := lower(trim(coalesce(p_environment, '')));
  v_profile text := nullif(trim(coalesce(p_credential_profile, '')), '');
  v_account_label text := nullif(trim(coalesce(p_account_label, '')), '');
  v_secret_id uuid;
  v_secret_name text := 'office_ally:' || p_tenant_id::text;
  v_status text;
begin
  if auth.uid() is null or not private.has_tenant_admin_access(p_tenant_id) then
    raise exception 'Practice administrator access is required to manage Office Ally.' using errcode = '42501';
  end if;

  if v_environment not in ('test', 'production') then
    raise exception 'Unsupported Office Ally environment. Use test or production.' using errcode = '22023';
  end if;

  if v_environment = 'production' and v_profile <> 'authorization_api_key' then
    raise exception 'Unsupported Office Ally credential profile.' using errcode = '22023';
  end if;

  if v_environment = 'production' and (
    p_credentials is null
    or p_credentials = '{}'::jsonb
    or nullif(trim(coalesce(p_credentials ->> 'apiKey', '')), '') is null
  ) then
    raise exception 'Production Office Ally API key is required.' using errcode = '22023';
  end if;

  select c.credential_secret_id
    into v_secret_id
  from public.tenant_edi_connections c
  where c.tenant_id = p_tenant_id
    and c.provider = 'office_ally'
  for update;

  if v_environment = 'production' then
    if v_secret_id is null then
      select vault.create_secret(
        p_credentials::text,
        v_secret_name,
        'Office Ally credentials for tenant ' || p_tenant_id::text
      ) into v_secret_id;
    else
      perform vault.update_secret(
        v_secret_id,
        p_credentials::text,
        v_secret_name,
        'Office Ally credentials for tenant ' || p_tenant_id::text
      );
    end if;
    v_status := 'production_connected';
  else
    -- Test mode is internal to THERASSISTANT. Never destroy an existing
    -- production credential just because the practice runs a synthetic test.
    v_status := 'test_ready';
  end if;

  insert into public.tenant_edi_connections (
    tenant_id,
    provider,
    environment,
    status,
    account_label,
    credential_profile,
    credential_secret_id,
    enabled,
    last_verified_at,
    last_error,
    updated_at
  ) values (
    p_tenant_id,
    'office_ally',
    v_environment,
    v_status,
    v_account_label,
    case when v_environment = 'production' then v_profile else null end,
    v_secret_id,
    true,
    case when v_environment = 'test' then now() else null end,
    null,
    now()
  )
  on conflict (tenant_id, provider) do update
    set environment = excluded.environment,
        status = excluded.status,
        account_label = excluded.account_label,
        credential_profile = excluded.credential_profile,
        credential_secret_id = excluded.credential_secret_id,
        enabled = excluded.enabled,
        last_verified_at = excluded.last_verified_at,
        last_error = excluded.last_error,
        updated_at = now();

  return query
  select * from public.get_office_ally_connection_status(p_tenant_id);
end;
$$;

revoke all on function public.save_office_ally_connection(uuid, text, text, text, jsonb) from public;
grant execute on function public.save_office_ally_connection(uuid, text, text, text, jsonb) to authenticated;

create or replace function public.disconnect_office_ally_connection(p_tenant_id uuid)
returns table (
  provider text,
  environment text,
  status text,
  account_label text,
  credential_profile text,
  last_verified_at timestamptz,
  last_error text
)
language plpgsql
security definer
set search_path = public, auth, vault, pg_temp
as $$
declare
  v_secret_id uuid;
begin
  if auth.uid() is null or not private.has_tenant_admin_access(p_tenant_id) then
    raise exception 'Practice administrator access is required to manage Office Ally.' using errcode = '42501';
  end if;

  select c.credential_secret_id
    into v_secret_id
  from public.tenant_edi_connections c
  where c.tenant_id = p_tenant_id
    and c.provider = 'office_ally'
  for update;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;

  insert into public.tenant_edi_connections (
    tenant_id,
    provider,
    environment,
    status,
    account_label,
    credential_profile,
    credential_secret_id,
    enabled,
    last_verified_at,
    last_error,
    updated_at
  ) values (
    p_tenant_id,
    'office_ally',
    'test',
    'not_connected',
    null,
    null,
    null,
    false,
    null,
    null,
    now()
  )
  on conflict (tenant_id, provider) do update
    set environment = 'test',
        status = 'not_connected',
        account_label = null,
        credential_profile = null,
        credential_secret_id = null,
        enabled = false,
        last_verified_at = null,
        last_error = null,
        updated_at = now();

  return query
  select * from public.get_office_ally_connection_status(p_tenant_id);
end;
$$;

revoke all on function public.disconnect_office_ally_connection(uuid) from public;
grant execute on function public.disconnect_office_ally_connection(uuid) to authenticated;

create or replace function public.resolve_office_ally_connection_secret(p_tenant_id uuid)
returns table (
  environment text,
  status text,
  credential_profile text,
  credentials jsonb
)
language sql
stable
security definer
set search_path = public, vault, pg_temp
as $$
  select
    c.environment,
    c.status,
    c.credential_profile,
    d.decrypted_secret::jsonb as credentials
  from public.tenant_edi_connections c
  join vault.decrypted_secrets d
    on d.id = c.credential_secret_id
  where c.tenant_id = p_tenant_id
    and c.provider = 'office_ally'
    and c.environment = 'production'
    and c.enabled = true
    and c.credential_secret_id is not null
  limit 1;
$$;

revoke all on function public.resolve_office_ally_connection_secret(uuid) from public, anon, authenticated;
grant execute on function public.resolve_office_ally_connection_secret(uuid) to service_role;

comment on table public.tenant_edi_connections is
  'Tenant-scoped EDI connection metadata. Credential values are stored only in Supabase Vault.';
comment on column public.tenant_edi_connections.credential_secret_id is
  'Server-only reference to encrypted credential material in Supabase Vault; never return to browser clients.';

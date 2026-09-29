-- EHR onboarding, claim defaults, patient sex, payer defaults, and secure provider setup.

alter table public.clients
  add column if not exists sex text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_sex_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_sex_check
      check (sex is null or sex in ('M','F','U'));
  end if;
end $$;

update public.clients
set sex = upper(metadata->>'sex')
where sex is null
  and upper(coalesce(metadata->>'sex','')) in ('M','F','U');

create or replace function public.sync_client_sex()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_metadata_sex text := upper(coalesce(new.metadata->>'sex',''));
begin
  new.metadata := coalesce(new.metadata, '{}'::jsonb);

  if tg_op = 'INSERT' then
    if new.sex is null and v_metadata_sex in ('M','F','U') then
      new.sex := v_metadata_sex;
    elsif new.sex in ('M','F','U') then
      new.metadata := jsonb_set(new.metadata, '{sex}', to_jsonb(new.sex), true);
    end if;
    return new;
  end if;

  if new.sex is distinct from old.sex then
    if new.sex in ('M','F','U') then
      new.metadata := jsonb_set(new.metadata, '{sex}', to_jsonb(new.sex), true);
    else
      new.metadata := new.metadata - 'sex';
    end if;
  elsif coalesce(new.metadata->>'sex','') is distinct from coalesce(old.metadata->>'sex','') then
    if v_metadata_sex in ('M','F','U') then
      new.sex := v_metadata_sex;
    else
      new.sex := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_client_sex on public.clients;
create trigger trg_sync_client_sex
before insert or update on public.clients
for each row execute function public.sync_client_sex();

create or replace function public.default_professional_claim_metadata()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.metadata := coalesce(new.metadata, '{}'::jsonb);
  if not (new.metadata ? 'accept_assignment') then
    new.metadata := jsonb_set(new.metadata, '{accept_assignment}', 'true'::jsonb, true);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_default_professional_claim_metadata on public.professional_claims;
create trigger trg_default_professional_claim_metadata
before insert on public.professional_claims
for each row execute function public.default_professional_claim_metadata();

update public.professional_claims
set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{accept_assignment}', 'true'::jsonb, true),
    updated_at = now()
where not (coalesce(metadata, '{}'::jsonb) ? 'accept_assignment');

-- Central payer IDs requested as THERASSISTANT defaults.
update public.payers set clearinghouse_payer_id='00050', updated_at=now()
where lower(name)='anthem blue cross blue shield';
update public.payers set clearinghouse_payer_id='COACC', updated_at=now()
where lower(name)='colorado access';
update public.payers set clearinghouse_payer_id='COCHA', updated_at=now()
where lower(name)='colorado community health alliance';
update public.payers set clearinghouse_payer_id='MR004', updated_at=now()
where lower(name)='medicare';
update public.payers set clearinghouse_payer_id='60054', updated_at=now()
where lower(name)='aetna';
update public.payers set clearinghouse_payer_id='87726', updated_at=now()
where lower(name)='unitedhealthcare';
update public.payers set clearinghouse_payer_id='62308', updated_at=now()
where lower(name)='cigna';
update public.payers set clearinghouse_payer_id='77016', updated_at=now()
where lower(name)='health first colorado';

with requested(name, payer_type, payer_id) as (
  values
    ('Colorado Kaiser Permanente','commercial','91617'),
    ('One Health Plan of Colorado','commercial','95412'),
    ('Rocky Mountain HMO','commercial','RMHMO'),
    ('Rocky Mountain Pace','government','93142'),
    ('TriWest Healthcare Alliance','government','VAC45'),
    ('TriCare for Life','government','TDDIR'),
    ('Tricare West','government','99726'),
    ('Humana','commercial','61101')
)
insert into public.payers (name, payer_type, clearinghouse_payer_id)
select r.name, r.payer_type, r.payer_id
from requested r
where not exists (
  select 1 from public.payers p where lower(p.name)=lower(r.name)
);

with requested(name, payer_type, payer_id) as (
  values
    ('Colorado Kaiser Permanente','commercial','91617'),
    ('One Health Plan of Colorado','commercial','95412'),
    ('Rocky Mountain HMO','commercial','RMHMO'),
    ('Rocky Mountain Pace','government','93142'),
    ('TriWest Healthcare Alliance','government','VAC45'),
    ('TriCare for Life','government','TDDIR'),
    ('Tricare West','government','99726'),
    ('Humana','commercial','61101')
)
update public.payers p
set payer_type = coalesce(p.payer_type, r.payer_type),
    clearinghouse_payer_id = r.payer_id,
    updated_at = now()
from requested r
where lower(p.name)=lower(r.name);

insert into public.payer_aliases (payer_id, alias, source)
select id, alias, 'therassistant_default'
from (
  select id, 'BCBS Colorado (Anthem)'::text as alias from public.payers where lower(name)='anthem blue cross blue shield'
  union all select id, 'Aetna Health, Inc.' from public.payers where lower(name)='aetna'
  union all select id, 'UnitedHealthcare (UHC)' from public.payers where lower(name)='unitedhealthcare'
  union all select id, 'CIGNA Health Plan' from public.payers where lower(name)='cigna'
  union all select id, 'Medicare Colorado' from public.payers where lower(name)='medicare'
  union all select id, 'Medicaid Colorado' from public.payers where lower(name)='health first colorado'
) a
where not exists (
  select 1 from public.payer_aliases pa
  where pa.payer_id=a.id and lower(pa.alias)=lower(a.alias)
);

-- First-run onboarding persists separately so existing tenants are not forced into it.
create table if not exists public.tenant_onboarding (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress','completed')),
  current_step integer not null default 1 check (current_step between 1 and 14),
  data jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_onboarding enable row level security;
grant select, insert, update on public.tenant_onboarding to authenticated;

drop policy if exists "tenant onboarding select" on public.tenant_onboarding;
create policy "tenant onboarding select"
on public.tenant_onboarding for select to authenticated
using (private.has_tenant_read_access(tenant_id));

drop policy if exists "tenant onboarding insert" on public.tenant_onboarding;
create policy "tenant onboarding insert"
on public.tenant_onboarding for insert to authenticated
with check (private.has_tenant_write_access(tenant_id));

drop policy if exists "tenant onboarding update" on public.tenant_onboarding;
create policy "tenant onboarding update"
on public.tenant_onboarding for update to authenticated
using (private.has_tenant_write_access(tenant_id))
with check (private.has_tenant_write_access(tenant_id));

create index if not exists idx_tenant_onboarding_status
on public.tenant_onboarding (tenant_id, status);

-- Provider/practice onboarding documents remain in the existing private bucket and document index.
alter table public.documents
  add column if not exists provider_id uuid references public.providers(id) on delete set null,
  add column if not exists practice_entity_id uuid references public.practice_entities(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_documents_provider
on public.documents (provider_id, created_at desc);
create index if not exists idx_documents_practice_entity
on public.documents (practice_entity_id, created_at desc);

-- Full SSNs are stored in Supabase Vault; this table stores only the Vault reference and last four.
create table if not exists public.provider_sensitive_identifiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider_id uuid not null unique references public.providers(id) on delete cascade,
  ssn_secret_id uuid,
  ssn_last4 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ssn_last4 is null or ssn_last4 ~ '^[0-9]{4}$')
);

alter table public.provider_sensitive_identifiers enable row level security;
revoke all on public.provider_sensitive_identifiers from anon, authenticated;

create or replace function public.store_provider_ssn(
  p_tenant_id uuid,
  p_provider_id uuid,
  p_ssn text
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_digits text := regexp_replace(coalesce(p_ssn,''), '[^0-9]', '', 'g');
  v_secret_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required';
  end if;
  if length(v_digits) <> 9 then
    raise exception 'SSN must contain exactly 9 digits';
  end if;
  if not exists (
    select 1
    from public.tenant_users tu
    join public.tenant_user_roles tur
      on tur.tenant_id=tu.tenant_id and tur.user_id=tu.user_id
    where tu.tenant_id=p_tenant_id
      and tu.user_id=v_user_id
      and tu.status='active'
      and tur.role in (
        'practice_admin'::public.system_role_enum,
        'billing_company_admin'::public.system_role_enum,
        'credentialing_specialist'::public.system_role_enum
      )
  ) then
    raise exception 'Credentialing administrator access required';
  end if;
  if not exists (
    select 1 from public.providers
    where id=p_provider_id and tenant_id=p_tenant_id
  ) then
    raise exception 'Provider does not belong to this organization';
  end if;

  select ssn_secret_id into v_secret_id
  from public.provider_sensitive_identifiers
  where tenant_id=p_tenant_id and provider_id=p_provider_id;

  if v_secret_id is null then
    select vault.create_secret(
      v_digits,
      'provider-ssn-' || p_provider_id::text,
      'THERASSISTANT credentialing SSN',
      null
    ) into v_secret_id;
  else
    perform vault.update_secret(
      v_secret_id,
      v_digits,
      'provider-ssn-' || p_provider_id::text,
      'THERASSISTANT credentialing SSN',
      null
    );
  end if;

  insert into public.provider_sensitive_identifiers (
    tenant_id, provider_id, ssn_secret_id, ssn_last4
  ) values (
    p_tenant_id, p_provider_id, v_secret_id, right(v_digits,4)
  )
  on conflict (provider_id) do update
    set ssn_secret_id=excluded.ssn_secret_id,
        ssn_last4=excluded.ssn_last4,
        updated_at=now();

  return jsonb_build_object('stored', true, 'last4', right(v_digits,4));
end;
$$;

revoke all on function public.store_provider_ssn(uuid,uuid,text) from public, anon;
grant execute on function public.store_provider_ssn(uuid,uuid,text) to authenticated;

-- New tenant bootstrap creates onboarding only after membership exists.
create or replace function public.bootstrap_tenant_for_user(
  p_tenant_name text,
  p_tenant_type public.tenant_type_enum default 'billing_company'::public.tenant_type_enum,
  p_timezone text default 'America/Denver',
  p_email text default null,
  p_display_name text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_role public.system_role_enum;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required';
  end if;
  if nullif(trim(p_tenant_name), '') is null then
    raise exception 'Tenant name is required';
  end if;

  if p_tenant_type = 'billing_company'::public.tenant_type_enum then
    v_role := 'billing_company_admin'::public.system_role_enum;
  else
    v_role := 'practice_admin'::public.system_role_enum;
  end if;

  insert into public.user_profiles (id, email, display_name)
  values (v_user_id, nullif(trim(p_email), ''), nullif(trim(p_display_name), ''))
  on conflict (id) do update set
    email=coalesce(excluded.email, public.user_profiles.email),
    display_name=coalesce(excluded.display_name, public.user_profiles.display_name),
    updated_at=now();

  insert into public.tenants (name, tenant_type, timezone, status, created_by)
  values (
    trim(p_tenant_name),
    p_tenant_type,
    coalesce(nullif(trim(p_timezone), ''), 'America/Denver'),
    'pending_setup'::public.tenant_status_enum,
    v_user_id
  )
  returning id into v_tenant_id;

  insert into public.tenant_users (tenant_id, user_id, status, joined_at)
  values (v_tenant_id, v_user_id, 'active'::public.user_status_enum, now())
  on conflict do nothing;

  insert into public.tenant_user_roles (tenant_id, user_id, role)
  values (v_tenant_id, v_user_id, v_role)
  on conflict do nothing;

  insert into public.tenant_onboarding (tenant_id, status, current_step)
  values (v_tenant_id, 'in_progress', 1)
  on conflict (tenant_id) do nothing;

  update public.tenants
  set status='active'::public.tenant_status_enum,
      updated_at=now()
  where id=v_tenant_id;

  return v_tenant_id;
end;
$$;


-- Onboarding accepts common credentialing, contract, spreadsheet, image and text formats.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]::text[]
where id = 'therassistant-documents';

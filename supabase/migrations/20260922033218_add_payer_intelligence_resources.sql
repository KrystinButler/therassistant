create table public.payer_resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payer_id uuid not null references public.payers(id) on delete cascade,
  resource_type text not null,
  label text not null,
  value text,
  url text,
  notes text,
  effective_date date,
  expiration_date date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payer_resources_type_check check (
    resource_type in (
      'provider_services',
      'eligibility',
      'claims',
      'credentialing',
      'appeals',
      'directory',
      'portal',
      'mailing_address',
      'timely_filing',
      'corrected_claim',
      'reimbursement',
      'other'
    )
  ),
  constraint payer_resources_content_check check (
    nullif(btrim(coalesce(value, '')), '') is not null
    or nullif(btrim(coalesce(url, '')), '') is not null
    or nullif(btrim(coalesce(notes, '')), '') is not null
  ),
  constraint payer_resources_date_check check (
    expiration_date is null
    or effective_date is null
    or expiration_date >= effective_date
  )
);

create index payer_resources_tenant_payer_type_idx
  on public.payer_resources (tenant_id, payer_id, resource_type, sort_order, created_at);

alter table public.payer_resources enable row level security;

create policy "payer_resources tenant select"
on public.payer_resources for select
to authenticated
using (private.has_tenant_read_access(tenant_id));

create policy "payer_resources tenant insert"
on public.payer_resources for insert
to authenticated
with check (private.has_tenant_write_access(tenant_id));

create policy "payer_resources tenant update"
on public.payer_resources for update
to authenticated
using (private.has_tenant_write_access(tenant_id))
with check (private.has_tenant_write_access(tenant_id));

create policy "payer_resources tenant delete"
on public.payer_resources for delete
to authenticated
using (private.has_tenant_write_access(tenant_id));

revoke all on table public.payer_resources from anon;
grant select, insert, update, delete on table public.payer_resources to authenticated;

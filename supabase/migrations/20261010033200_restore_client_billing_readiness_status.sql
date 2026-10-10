alter table public.clients
  add column if not exists billing_readiness_status public.billing_readiness_status_enum
  not null default 'not_ready'::public.billing_readiness_status_enum;

create index if not exists idx_clients_billing_readiness_status
  on public.clients(tenant_id, billing_readiness_status);

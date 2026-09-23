
create table if not exists public.payment_desk_users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  display_name text,
  role text not null check (role in ('admin','operator')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_desk_users enable row level security;
revoke all on table public.payment_desk_users from anon, authenticated;
grant select, insert, update, delete on table public.payment_desk_users to service_role;

create table if not exists public.payment_desk_transactions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  operator_email citext not null,
  customer_name text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  reference text,
  note text,
  square_payment_id text unique,
  square_status text not null,
  receipt_url text,
  card_brand text,
  card_last4 text,
  failure_code text,
  failure_detail text
);

create index if not exists payment_desk_transactions_created_at_idx
  on public.payment_desk_transactions (created_at desc);

create index if not exists payment_desk_transactions_reference_idx
  on public.payment_desk_transactions (reference);

alter table public.payment_desk_transactions enable row level security;
revoke all on table public.payment_desk_transactions from anon, authenticated;
grant select, insert, update, delete on table public.payment_desk_transactions to service_role;

insert into public.payment_desk_users (email, display_name, role, active)
values ('admin@therassistant.com', 'Therassistant Admin', 'admin', true)
on conflict (email) do update
set role = 'admin', active = true, updated_at = now();

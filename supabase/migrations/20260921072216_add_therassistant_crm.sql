create table public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  account_number text not null unique,
  customer_name text not null,
  phone text,
  email citext,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  original_balance_cents integer not null check (original_balance_cents >= 0),
  status text not null default 'active' check (status in ('active','payment_plan','paid','closed')),
  next_follow_up_at timestamptz,
  created_by citext not null,
  created_at timestamptz not null default now(),
  updated_by citext not null,
  updated_at timestamptz not null default now()
);

create table public.crm_calls (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_accounts(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  disposition text not null check (disposition in ('paid','payment_plan_discussed','promise_to_pay','no_answer','left_voicemail','follow_up_needed','dispute_question','other')),
  notes text,
  promise_to_pay_cents integer check (promise_to_pay_cents is null or promise_to_pay_cents >= 0),
  promise_to_pay_date date,
  next_follow_up_at timestamptz,
  created_by citext not null,
  created_at timestamptz not null default now()
);

create table public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_accounts(id) on delete cascade,
  note text not null check (length(btrim(note)) > 0),
  created_by citext not null,
  created_at timestamptz not null default now()
);

create table public.crm_documents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_accounts(id) on delete cascade,
  display_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  category text not null default 'other' check (category in ('invoice','contract','correspondence','collection_notice','payment_plan_agreement','signed_payment_plan_agreement','other')),
  uploaded_by citext not null,
  uploaded_at timestamptz not null default now()
);

create table public.crm_payment_plans (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_accounts(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','active','completed','defaulted','cancelled')),
  balance_at_creation_cents integer not null check (balance_at_creation_cents >= 0),
  down_payment_cents integer not null default 0 check (down_payment_cents >= 0),
  remaining_balance_cents integer not null check (remaining_balance_cents >= 0),
  frequency text not null check (frequency in ('weekly','biweekly','monthly')),
  first_installment_date date not null,
  installment_cents integer not null check (installment_cents > 0),
  installment_count integer not null check (installment_count > 0),
  final_installment_cents integer not null check (final_installment_cents > 0),
  final_installment_date date not null,
  grace_period_days integer not null default 0 check (grace_period_days >= 0),
  special_terms text,
  agreement_status text not null default 'not_generated' check (agreement_status in ('not_generated','generated','sent','signed','declined')),
  agreement_version integer not null default 0 check (agreement_version >= 0),
  created_by citext not null,
  created_at timestamptz not null default now(),
  updated_by citext not null,
  updated_at timestamptz not null default now()
);

create table public.crm_payment_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.crm_payment_plans(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  snapshot jsonb not null,
  reason text not null default 'created',
  created_by citext not null,
  created_at timestamptz not null default now(),
  unique (plan_id, version_number)
);

create table public.crm_installments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.crm_payment_plans(id) on delete cascade,
  sequence_number integer not null check (sequence_number > 0),
  due_date date not null,
  amount_due_cents integer not null check (amount_due_cents > 0),
  amount_paid_cents integer not null default 0 check (amount_paid_cents >= 0 and amount_paid_cents <= amount_due_cents),
  status text not null default 'upcoming' check (status in ('upcoming','due','paid','partial','overdue','waived')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, sequence_number)
);

alter table public.payment_desk_transactions
  add column if not exists crm_account_id uuid references public.crm_accounts(id) on delete set null;

create table public.crm_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_transaction_id uuid not null references public.payment_desk_transactions(id) on delete cascade,
  installment_id uuid references public.crm_installments(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (payment_transaction_id, installment_id)
);

create table public.crm_payment_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_accounts(id) on delete cascade,
  installment_id uuid references public.crm_installments(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  square_payment_link_id text unique,
  square_order_id text,
  url text not null,
  status text not null default 'created' check (status in ('created','paid','expired','cancelled','failed')),
  created_by citext not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_activity (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_accounts(id) on delete cascade,
  activity_type text not null,
  summary text not null,
  related_table text,
  related_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  actor_email citext not null,
  created_at timestamptz not null default now()
);

create index crm_accounts_status_idx on public.crm_accounts (status);
create index crm_accounts_follow_up_idx on public.crm_accounts (next_follow_up_at) where next_follow_up_at is not null;
create index crm_calls_account_id_idx on public.crm_calls (account_id, created_at desc);
create index crm_notes_account_id_idx on public.crm_notes (account_id, created_at desc);
create index crm_documents_account_id_idx on public.crm_documents (account_id, uploaded_at desc);
create index crm_payment_plans_account_id_idx on public.crm_payment_plans (account_id, created_at desc);
create index crm_payment_plan_versions_plan_id_idx on public.crm_payment_plan_versions (plan_id, version_number desc);
create index crm_installments_plan_id_idx on public.crm_installments (plan_id, sequence_number);
create index crm_installments_due_date_idx on public.crm_installments (due_date, status);
create index crm_payment_allocations_payment_idx on public.crm_payment_allocations (payment_transaction_id);
create index crm_payment_allocations_installment_idx on public.crm_payment_allocations (installment_id) where installment_id is not null;
create index crm_payment_links_account_id_idx on public.crm_payment_links (account_id, created_at desc);
create index crm_payment_links_installment_idx on public.crm_payment_links (installment_id) where installment_id is not null;
create index crm_activity_account_id_idx on public.crm_activity (account_id, created_at desc);
create index payment_desk_transactions_crm_account_idx on public.payment_desk_transactions (crm_account_id) where crm_account_id is not null;

alter table public.crm_accounts enable row level security;
alter table public.crm_calls enable row level security;
alter table public.crm_notes enable row level security;
alter table public.crm_documents enable row level security;
alter table public.crm_payment_plans enable row level security;
alter table public.crm_payment_plan_versions enable row level security;
alter table public.crm_installments enable row level security;
alter table public.crm_payment_allocations enable row level security;
alter table public.crm_payment_links enable row level security;
alter table public.crm_activity enable row level security;

revoke all on table public.crm_accounts from anon, authenticated;
revoke all on table public.crm_calls from anon, authenticated;
revoke all on table public.crm_notes from anon, authenticated;
revoke all on table public.crm_documents from anon, authenticated;
revoke all on table public.crm_payment_plans from anon, authenticated;
revoke all on table public.crm_payment_plan_versions from anon, authenticated;
revoke all on table public.crm_installments from anon, authenticated;
revoke all on table public.crm_payment_allocations from anon, authenticated;
revoke all on table public.crm_payment_links from anon, authenticated;
revoke all on table public.crm_activity from anon, authenticated;

grant select, insert, update, delete on table public.crm_accounts to service_role;
grant select, insert, update, delete on table public.crm_calls to service_role;
grant select, insert, update, delete on table public.crm_notes to service_role;
grant select, insert, update, delete on table public.crm_documents to service_role;
grant select, insert, update, delete on table public.crm_payment_plans to service_role;
grant select, insert, update, delete on table public.crm_payment_plan_versions to service_role;
grant select, insert, update, delete on table public.crm_installments to service_role;
grant select, insert, update, delete on table public.crm_payment_allocations to service_role;
grant select, insert, update, delete on table public.crm_payment_links to service_role;
grant select, insert, update, delete on table public.crm_activity to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'crm-documents',
  'crm-documents',
  false,
  20971520,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/plain'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

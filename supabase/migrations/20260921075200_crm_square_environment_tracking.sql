alter table public.payment_desk_transactions
  add column if not exists square_environment text not null default 'sandbox'
  check (square_environment in ('sandbox','production'));

alter table public.crm_payment_links
  add column if not exists square_environment text not null default 'sandbox'
  check (square_environment in ('sandbox','production'));

update public.payment_desk_transactions
set square_environment = 'sandbox'
where square_environment is null;

create index if not exists payment_desk_transactions_crm_environment_idx
  on public.payment_desk_transactions (crm_account_id, square_environment, square_status)
  where crm_account_id is not null;

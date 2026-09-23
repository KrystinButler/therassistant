alter table public.payment_desk_transactions
    add column if not exists idempotency_key text;
create unique index if not exists payment_desk_transactions_idempotency_key_uidx
  on public.payment_desk_transactions (idempotency_key)
  where idempotency_key is not null;

create sequence if not exists public.crm_account_number_seq start with 1;

alter table public.crm_accounts
  alter column account_number set default
  ('CRM-' || lpad(nextval('public.crm_account_number_seq')::text, 6, '0'));

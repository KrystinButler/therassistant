set local storage.allow_delete_query = 'true';

drop function if exists public.crm_allocate_production_payment_atomic(uuid,uuid,integer,extensions.citext,uuid);
drop function if exists public.crm_modify_plan_atomic(uuid,jsonb,jsonb,extensions.citext);
drop function if exists public.crm_create_plan_atomic(uuid,jsonb,jsonb,extensions.citext);

drop table if exists public.crm_payment_allocations cascade;
drop table if exists public.crm_payment_links cascade;
drop table if exists public.crm_installments cascade;
drop table if exists public.crm_payment_plan_versions cascade;
drop table if exists public.crm_payment_plans cascade;
drop table if exists public.crm_documents cascade;
drop table if exists public.crm_calls cascade;
drop table if exists public.crm_notes cascade;
drop table if exists public.crm_activity cascade;

alter table if exists public.payment_desk_transactions
  drop column if exists crm_account_id;

drop table if exists public.crm_accounts cascade;
drop sequence if exists public.crm_account_number_seq;

delete from storage.objects where bucket_id='crm-documents';
delete from storage.buckets where id='crm-documents';

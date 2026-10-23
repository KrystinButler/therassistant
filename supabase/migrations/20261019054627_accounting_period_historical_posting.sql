-- Recovered from production migration history; already applied.
-- Existing posted balances are not rewritten or backfilled by this migration.
alter table public.ledger_transactions add column if not exists accounting_period_id uuid references public.accounting_periods(id) on delete restrict;
alter table public.historical_transactions add column if not exists service_date date;
alter table public.historical_transactions add column if not exists procedure_code text;
alter table public.historical_transactions add column if not exists remittance_trace text;
alter table public.historical_transactions add column if not exists legacy_claim_number text;
alter table public.historical_transactions add column if not exists source_metadata jsonb not null default '{}'::jsonb;
alter table public.historical_transactions add column if not exists import_source_key text;
create unique index if not exists historical_import_source_unique on public.historical_transactions(tenant_id,import_source_key) where import_source_key is not null;

create or replace function private.validate_accounting_period_range()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.tenant_id::text,0));
  if exists(select 1 from public.accounting_periods p where p.tenant_id=new.tenant_id and p.id<>new.id and p.start_date<=new.end_date and p.end_date>=new.start_date) then
    raise exception 'Accounting periods cannot overlap within a practice';
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.ledger_transactions t where (t.accounting_period_id=old.id or (t.tenant_id=old.tenant_id and t.transaction_date between old.start_date and old.end_date)) and (t.tenant_id<>new.tenant_id or t.transaction_date<new.start_date or t.transaction_date>new.end_date)) then
    raise exception 'The period range must continue to contain its linked ledger transactions';
  end if;
  return new;
end;
$$;
create trigger validate_accounting_period_range before insert or update on public.accounting_periods for each row execute function private.validate_accounting_period_range();

create or replace function private.assign_ledger_accounting_period()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_period public.accounting_periods%rowtype; v_count integer;
begin
  if tg_op='UPDATE' and exists(select 1 from public.accounting_periods p where p.tenant_id=old.tenant_id and (p.id=old.accounting_period_id or old.transaction_date between p.start_date and p.end_date) and p.status::text in ('closed','locked')) then
    raise exception 'A transaction in a closed or locked period cannot be moved or rewritten';
  end if;
  if not exists(select 1 from public.accounting_periods where tenant_id=new.tenant_id) and new.accounting_period_id is null then return new; end if;
  select count(*) into v_count from public.accounting_periods p where p.tenant_id=new.tenant_id and new.transaction_date between p.start_date and p.end_date;
  if v_count<>1 then raise exception 'Posting requires exactly one accounting period covering the transaction date; configure or reconcile periods first'; end if;
  select * into v_period from public.accounting_periods p where p.tenant_id=new.tenant_id and new.transaction_date between p.start_date and p.end_date for share;
  if v_period.status::text not in ('open','reopened') then raise exception 'The accounting period is closed or locked; use an approved correction in an open period'; end if;
  if new.accounting_period_id is not null and new.accounting_period_id<>v_period.id then raise exception 'The ledger period must match the transaction date and practice'; end if;
  new.accounting_period_id:=v_period.id;
  return new;
end;
$$;
create trigger assign_ledger_accounting_period before insert or update of transaction_date,tenant_id,accounting_period_id on public.ledger_transactions for each row execute function private.assign_ledger_accounting_period();

create or replace function private.validate_ledger_entry_period()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_transaction public.ledger_transactions%rowtype;v_status text;
begin
  if tg_op='UPDATE' and exists(select 1 from public.ledger_transactions t join public.accounting_periods p on p.tenant_id=t.tenant_id and (p.id=t.accounting_period_id or t.transaction_date between p.start_date and p.end_date) where t.id=old.ledger_transaction_id and p.status::text in ('closed','locked')) then raise exception 'Entries in closed or locked periods cannot be moved or rewritten'; end if;
  select * into v_transaction from public.ledger_transactions where id=new.ledger_transaction_id;
  if not found or v_transaction.tenant_id is distinct from new.tenant_id or v_transaction.transaction_date is distinct from new.posting_date then raise exception 'Ledger entry must match a dated, period-linked transaction in this practice'; end if;
  if v_transaction.accounting_period_id is null then
    if not exists(select 1 from public.accounting_periods where tenant_id=new.tenant_id) then return new; end if;
    raise exception 'Configure the transaction accounting period before adding ledger entries';
  end if;
  select status::text into v_status from public.accounting_periods where id=v_transaction.accounting_period_id for share;
  if v_status not in ('open','reopened') then raise exception 'Ledger entries cannot be posted into a closed or locked accounting period'; end if;
  return new;
end;
$$;
create trigger validate_ledger_entry_period before insert or update on public.ledger_entries for each row execute function private.validate_ledger_entry_period();

-- Rollback must not orphan an already posted double-entry transaction.
create or replace function private.protect_posted_historical_transaction()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.ledger_transactions t where t.tenant_id=old.tenant_id and t.source_type='historical_transaction' and t.source_id=old.id) then
    raise exception 'Historical transaction is posted to the ledger; use a recorded reversal instead of deleting financial history';
  end if;
  return old;
end;
$$;
create trigger protect_posted_historical_transaction before delete on public.historical_transactions for each row execute function private.protect_posted_historical_transaction();

create or replace function public.commit_historical_import_row(p_import_row_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.import_rows%rowtype;
  v_batch public.import_batches%rowtype;
  v_data jsonb;
  v_client_id uuid;
  v_transaction_id uuid;
begin
  select * into v_row
  from public.import_rows
  where id = p_import_row_id
  for update;
  if not found then raise exception 'Import row not found'; end if;

  select * into v_batch
  from public.import_batches
  where id = v_row.import_batch_id
  for update;

  perform public.assert_tenant_access(v_row.tenant_id);

  if v_batch.import_type <> 'historical_transactions' then
    raise exception 'Import batch is not a historical transaction import';
  end if;

  if v_row.row_status = 'imported' and v_row.target_id is not null then
    return jsonb_build_object('status','imported','target_id',v_row.target_id,'idempotent',true);
  end if;

  v_data := coalesce(v_row.mapped_data, '{}'::jsonb);
  v_client_id := nullif(v_data ->> 'client_id','')::uuid;

  if v_client_id is null and nullif(v_data ->> 'client_source_key','') is not null then
    select ir.target_id into v_client_id
    from public.import_rows ir
    where ir.tenant_id = v_row.tenant_id
      and ir.source_key = v_data ->> 'client_source_key'
      and ir.target_type = 'client'
      and ir.row_status in ('imported','duplicate')
      and ir.target_id is not null
    order by ir.processed_at desc nulls last
    limit 1;
  end if;

  if v_client_id is null or not exists (
    select 1 from public.clients c
    where c.id = v_client_id and c.tenant_id = v_row.tenant_id
  ) then
    update public.import_rows
    set row_status='failed',
        attempt_count=attempt_count+1,
        processed_at=now(),
        error_message='Historical transaction patient mapping was not found.',
        updated_at=now()
    where id=v_row.id;
    perform public.reconcile_import_batch(v_batch.id);
    return jsonb_build_object('status','failed','error','Historical transaction patient mapping was not found.');
  end if;

  begin
    if nullif(v_data->>'remittance_trace','') is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_row.tenant_id::text || ':' || (v_data->>'remittance_trace'),1));
      if exists(select 1 from public.era_files e where e.tenant_id=v_row.tenant_id and e.check_or_trace_number=v_data->>'remittance_trace')
        or exists(select 1 from public.professional_claims c where c.tenant_id=v_row.tenant_id and c.patient_control_number=v_data->>'legacy_claim_number') then
        raise exception 'This remittance now matches EHR ERA or claim activity; use standard ERA reconciliation to avoid duplicate money';
      end if;
    end if;
    v_transaction_id := public.post_historical_transaction(
      v_row.tenant_id, v_client_id,
      (v_data ->> 'transaction_type')::public.historical_transaction_type_enum,
      (v_data ->> 'amount_cents')::integer,
      (v_data ->> 'transaction_date')::date,
      nullif(v_data ->> 'payer_id','')::uuid,
      null,
      nullif(v_data ->> 'description',''),
      coalesce(nullif(v_batch.source_system,''),'import')
    );
    update public.historical_transactions set
      import_source_key=coalesce(nullif(v_batch.source_system,''),'import') || ':' || coalesce(nullif(v_data->>'source_key',''),v_row.id::text),
      service_date=nullif(v_data->>'service_date','')::date,
      procedure_code=nullif(v_data->>'procedure_code',''),
      remittance_trace=nullif(v_data->>'remittance_trace',''),
      legacy_claim_number=nullif(v_data->>'legacy_claim_number',''),
      source_metadata=coalesce(v_data->'source_metadata','{}'::jsonb)
    where id=v_transaction_id and tenant_id=v_row.tenant_id;

    update public.import_rows
    set row_status='imported',
        target_type='historical_transaction',
        target_id=v_transaction_id,
        attempt_count=attempt_count+1,
        processed_at=now(),
        error_message=null,
        updated_at=now()
    where id=v_row.id;

    update public.import_batches
    set import_status='importing',
        started_at=coalesce(started_at,now()),
        last_processed_row=greatest(last_processed_row,v_row.row_number),
        updated_at=now()
    where id=v_batch.id;

    if not exists (
      select 1 from public.import_rows
      where import_batch_id=v_batch.id
        and row_status in ('pending','valid','failed')
    ) then
      update public.import_batches
      set import_status='completed', completed_at=now(), updated_at=now()
      where id=v_batch.id;
    end if;

    perform public.reconcile_import_batch(v_batch.id);
    return jsonb_build_object('status','imported','target_id',v_transaction_id,'idempotent',false);
  exception when others then
    update public.import_rows
    set row_status='failed',
        attempt_count=attempt_count+1,
        processed_at=now(),
        error_message=sqlerrm,
        updated_at=now()
    where id=v_row.id;
    update public.import_batches
    set import_status='partial',
        started_at=coalesce(started_at,now()),
        updated_at=now()
    where id=v_batch.id;
    perform public.reconcile_import_batch(v_batch.id);
    return jsonb_build_object('status','failed','error',sqlerrm);
  end;
end;
$$;

revoke all on function public.commit_historical_import_row(uuid) from public, anon;
grant execute on function public.commit_historical_import_row(uuid) to authenticated;


create or replace function private.protect_closed_ledger_delete()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_period uuid;v_tenant uuid;v_date date;
begin
  if tg_table_name='ledger_transactions' then v_period:=old.accounting_period_id;v_tenant:=old.tenant_id;v_date:=old.transaction_date;
  else select accounting_period_id,tenant_id,transaction_date into v_period,v_tenant,v_date from public.ledger_transactions where id=old.ledger_transaction_id; end if;
  if exists(select 1 from public.accounting_periods where tenant_id=v_tenant and (id=v_period or v_date between start_date and end_date) and status::text in ('closed','locked')) then raise exception 'Posted financial history in a closed or locked period cannot be deleted'; end if;
  return old;
end;
$$;
create trigger protect_closed_transaction_delete before delete on public.ledger_transactions for each row execute function private.protect_closed_ledger_delete();
create trigger protect_closed_entry_delete before delete on public.ledger_entries for each row execute function private.protect_closed_ledger_delete();

-- A remittance's gross charges, payments and adjustments must commit together.
create or replace function public.commit_historical_835_batch(p_batch_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_batch public.import_batches%rowtype;v_row public.import_rows%rowtype;v_result jsonb;v_count integer:=0;
begin
  select * into v_batch from public.import_batches where id=p_batch_id for update;
  if not found then raise exception 'Import batch not found'; end if;
  perform public.assert_tenant_access(v_batch.tenant_id);
  if v_batch.import_type<>'historical_transactions' or v_batch.source_system<>'Historical 835' then raise exception 'This operation requires a reviewed historical 835 batch'; end if;
  if exists(select 1 from public.import_rows where import_batch_id=p_batch_id and row_status::text not in ('valid','imported','duplicate')) then raise exception 'Resolve all batch validation errors before posting this remittance'; end if;
  for v_row in select * from public.import_rows where import_batch_id=p_batch_id and row_status::text='valid' order by row_number for update loop
    v_result:=public.commit_historical_import_row(v_row.id);
    if (v_result->>'status') is distinct from 'imported' then raise exception 'No remittance transactions were committed: %',coalesce(v_result->>'error','Historical row posting failed'); end if;
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('status','imported','imported_count',v_count);
end;
$$;
revoke all on function public.commit_historical_835_batch(uuid) from public,anon;
grant execute on function public.commit_historical_835_batch(uuid) to authenticated;

-- Serialize both ingestion paths by tenant/trace to prevent cross-workflow posting.
create or replace function private.prevent_duplicate_historical_era()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if nullif(new.check_or_trace_number,'') is null then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.tenant_id::text || ':' || new.check_or_trace_number,1));
  if exists(select 1 from public.historical_transactions h where h.tenant_id=new.tenant_id and h.remittance_trace=new.check_or_trace_number and h.transaction_status::text='posted') then
    raise exception 'This remittance trace is already posted as historical patient-account activity';
  end if;
  return new;
end;
$$;
create trigger prevent_duplicate_historical_era before insert or update of check_or_trace_number on public.era_files for each row execute function private.prevent_duplicate_historical_era();

create or replace function private.protect_used_accounting_period()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.ledger_transactions t where t.tenant_id=old.tenant_id and (t.accounting_period_id=old.id or t.transaction_date between old.start_date and old.end_date)) then raise exception 'An accounting period containing ledger history cannot be deleted'; end if;
  return old;
end;
$$;
create trigger protect_used_accounting_period before delete on public.accounting_periods for each row execute function private.protect_used_accounting_period();

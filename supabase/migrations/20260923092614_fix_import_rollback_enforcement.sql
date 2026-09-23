
begin;

create or replace function private.rollback_import_batch_impl(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.import_batches%rowtype;
  v_row public.import_rows%rowtype;
  v_blocked integer := 0;
  v_rolled_back integer := 0;
  v_deleted integer := 0;
  v_target_exists boolean := false;
begin
  select * into v_batch
  from public.import_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Import batch not found';
  end if;

  if not private.has_tenant_write_access(v_batch.tenant_id) then
    raise exception 'Tenant write access required' using errcode = '42501';
  end if;

  update public.import_batches
  set rollback_status = 'in_progress',
      updated_at = now()
  where id = p_batch_id;

  for v_row in
    select *
    from public.import_rows
    where import_batch_id = p_batch_id
      and target_id is not null
      and rollback_status <> 'rolled_back'
    order by row_number desc
  loop
    begin
      v_deleted := 0;
      v_target_exists := false;

      if v_row.target_type = 'historical_transaction' then
        select exists(
          select 1
          from public.historical_transactions
          where id = v_row.target_id
            and tenant_id = v_batch.tenant_id
        ) into v_target_exists;

        delete from public.historical_transaction_allocations
        where historical_transaction_id = v_row.target_id
          and tenant_id = v_batch.tenant_id;

        delete from public.historical_transactions
        where id = v_row.target_id
          and tenant_id = v_batch.tenant_id;
        get diagnostics v_deleted = row_count;

        if v_target_exists and v_deleted <> 1 then
          raise exception 'Historical transaction rollback did not delete its target';
        end if;

      elsif v_row.target_type = 'client' and v_row.row_status = 'imported' then
        select exists(
          select 1
          from public.clients
          where id = v_row.target_id
            and tenant_id = v_batch.tenant_id
        ) into v_target_exists;

        delete from public.clients
        where id = v_row.target_id
          and tenant_id = v_batch.tenant_id
          and metadata ->> 'imported_from_batch' = p_batch_id::text;
        get diagnostics v_deleted = row_count;

        if v_target_exists and v_deleted <> 1 then
          raise exception 'Imported patient rollback did not delete its batch-owned target';
        end if;
      else
        raise exception 'Unsupported rollback target type or source row state';
      end if;

      update public.import_rows
      set rollback_status = 'rolled_back',
          rolled_back_at = now(),
          rollback_error = null,
          updated_at = now()
      where id = v_row.id;

      v_rolled_back := v_rolled_back + 1;

    exception
      when foreign_key_violation then
        update public.import_rows
        set rollback_status = 'blocked',
            rollback_error = 'Rollback blocked because downstream records now depend on this imported record.',
            updated_at = now()
        where id = v_row.id;
        v_blocked := v_blocked + 1;
      when others then
        update public.import_rows
        set rollback_status = 'blocked',
            rollback_error = sqlerrm,
            updated_at = now()
        where id = v_row.id;
        v_blocked := v_blocked + 1;
    end;
  end loop;

  update public.import_batches
  set rollback_status = case when v_blocked = 0 then 'rolled_back' else 'blocked' end,
      rolled_back_at = case when v_blocked = 0 then now() else rolled_back_at end,
      import_status = case when v_blocked = 0 then 'rolled_back' else import_status end,
      updated_at = now()
  where id = p_batch_id;

  perform public.reconcile_import_batch(p_batch_id);

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, new_values, metadata
  ) values (
    v_batch.tenant_id,
    (select auth.uid()),
    'import_batch_rollback',
    'import_batch',
    p_batch_id::text,
    jsonb_build_object(
      'rollback_status', case when v_blocked = 0 then 'rolled_back' else 'blocked' end,
      'rolled_back_rows', v_rolled_back,
      'blocked_rows', v_blocked
    ),
    jsonb_build_object('import_type', v_batch.import_type, 'source_system', v_batch.source_system)
  );

  return jsonb_build_object(
    'rollback_status', case when v_blocked = 0 then 'rolled_back' else 'blocked' end,
    'rolled_back_rows', v_rolled_back,
    'blocked_rows', v_blocked
  );
end;
$$;

revoke all on function private.rollback_import_batch_impl(uuid) from public, anon;
grant execute on function private.rollback_import_batch_impl(uuid) to authenticated;

create or replace function public.rollback_import_batch(p_batch_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.rollback_import_batch_impl(p_batch_id);
$$;

revoke all on function public.rollback_import_batch(uuid) from public, anon;
grant execute on function public.rollback_import_batch(uuid) to authenticated;

commit;

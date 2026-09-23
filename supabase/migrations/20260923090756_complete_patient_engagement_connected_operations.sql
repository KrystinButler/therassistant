
begin;

-- ---------------------------------------------------------------------------
-- Patient portal restoration
-- ---------------------------------------------------------------------------
create or replace function private.restore_client_portal_access_impl(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_access public.client_portal_access%rowtype;
begin
  select tenant_id into v_tenant_id
  from public.clients
  where id = p_client_id;

  if v_tenant_id is null or not private.has_tenant_write_access(v_tenant_id) then
    raise exception 'Patient portal access is unavailable';
  end if;

  if exists (
    select 1
    from public.client_portal_access
    where client_id = p_client_id
      and status <> 'revoked'
  ) then
    raise exception 'Patient already has live portal access';
  end if;

  select *
  into v_access
  from public.client_portal_access
  where client_id = p_client_id
    and status = 'revoked'
  order by revoked_at desc nulls last, created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'No revoked patient portal access exists';
  end if;

  update public.client_portal_access
  set status = 'active',
      activated_at = coalesce(activated_at, now()),
      revoked_at = null,
      updated_at = now()
  where id = v_access.id
  returning * into v_access;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, old_values, new_values, metadata
  ) values (
    v_access.tenant_id,
    (select auth.uid()),
    'patient_portal_access_restored',
    'client_portal_access',
    v_access.id::text,
    jsonb_build_object('status', 'revoked'),
    jsonb_build_object('status', 'active'),
    jsonb_build_object('client_id', v_access.client_id)
  );

  return jsonb_build_object(
    'client_id', v_access.client_id,
    'status', v_access.status,
    'activated_at', v_access.activated_at,
    'restored_at', now()
  );
end;
$$;

revoke all on function private.restore_client_portal_access_impl(uuid) from public, anon;
grant execute on function private.restore_client_portal_access_impl(uuid) to authenticated;

create or replace function public.restore_client_portal_access(p_client_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.restore_client_portal_access_impl(p_client_id);
$$;

revoke all on function public.restore_client_portal_access(uuid) from public, anon;
grant execute on function public.restore_client_portal_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Immutable document event history + document-origin Mailroom routing
-- ---------------------------------------------------------------------------
create table if not exists public.document_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  event_type text not null check (event_type in ('created','updated','status_changed','archived','voided')),
  snapshot jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists document_history_document_created_idx
  on public.document_history (document_id, created_at desc);
create index if not exists document_history_tenant_created_idx
  on public.document_history (tenant_id, created_at desc);

alter table public.document_history enable row level security;
revoke all on public.document_history from anon;
revoke insert, update, delete, truncate, references, trigger on public.document_history from authenticated;
grant select on public.document_history to authenticated;

drop policy if exists "document_history tenant select" on public.document_history;
create policy "document_history tenant select"
on public.document_history
for select
to authenticated
using (private.has_tenant_read_access(tenant_id));

create or replace function private.capture_document_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'created';
  elsif new.document_status::text is distinct from old.document_status::text then
    v_event := case new.document_status::text
      when 'archived' then 'archived'
      when 'voided' then 'voided'
      else 'status_changed'
    end;
  else
    v_event := 'updated';
  end if;

  insert into public.document_history (
    tenant_id, document_id, event_type, snapshot, actor_id
  ) values (
    new.tenant_id,
    new.id,
    v_event,
    to_jsonb(new),
    (select auth.uid())
  );

  return new;
end;
$$;

revoke all on function private.capture_document_history() from public, anon, authenticated;

drop trigger if exists trg_capture_document_history on public.documents;
create trigger trg_capture_document_history
after insert or update on public.documents
for each row execute function private.capture_document_history();

alter table public.mailroom_items
  add column if not exists source_event_type text,
  add column if not exists source_event_id uuid;

create unique index if not exists mailroom_items_source_event_uq
  on public.mailroom_items (tenant_id, source_event_type, source_event_id)
  where source_event_type is not null and source_event_id is not null;

create or replace function private.route_document_to_mailroom()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correspondence_type text;
  v_subject text;
  v_payer_id uuid;
  v_client_id uuid := new.client_id;
  v_provider_id uuid;
  v_mailroom_id uuid;
begin
  if new.storage_path like '%/mailroom/%' then
    return new;
  end if;

  case new.document_type::text
    when 'eob' then
      v_correspondence_type := 'eob';
      v_subject := 'EOB received';
    when 'authorization_letter' then
      v_correspondence_type := 'authorization_letter';
      v_subject := 'Authorization correspondence received';
    when 'appeal_letter' then
      v_correspondence_type := 'appeal_letter';
      v_subject := 'Appeal correspondence received';
    when 'payer_correspondence' then
      v_correspondence_type := 'payer_correspondence';
      v_subject := 'Payer correspondence received';
    when 'credentialing_approval' then
      v_correspondence_type := 'credentialing_letter';
      v_subject := 'Credentialing approval received';
    when 'network_verification' then
      v_correspondence_type := 'credentialing_letter';
      v_subject := 'Network verification received';
    when 'payer_contract' then
      v_correspondence_type := 'contract_notice';
      v_subject := 'Payer contract document received';
    else
      return new;
  end case;

  if new.claim_id is not null then
    select pc.payer_id, coalesce(v_client_id, pc.client_id), pc.rendering_provider_id
      into v_payer_id, v_client_id, v_provider_id
    from public.professional_claims pc
    where pc.id = new.claim_id and pc.tenant_id = new.tenant_id;
  elsif new.authorization_id is not null then
    select a.payer_id, coalesce(v_client_id, a.client_id)
      into v_payer_id, v_client_id
    from public.authorizations a
    where a.id = new.authorization_id and a.tenant_id = new.tenant_id;
  elsif new.appeal_id is not null then
    select pc.payer_id, coalesce(v_client_id, pc.client_id), pc.rendering_provider_id
      into v_payer_id, v_client_id, v_provider_id
    from public.appeals ap
    join public.professional_claims pc on pc.id = ap.claim_id
    where ap.id = new.appeal_id and ap.tenant_id = new.tenant_id;
  end if;

  insert into public.system_events (
    tenant_id, event_type, source_type, source_id, payload
  ) values (
    new.tenant_id,
    'document_received',
    'document',
    new.id,
    jsonb_build_object(
      'document_type', new.document_type::text,
      'file_name', new.file_name,
      'client_id', v_client_id,
      'payer_id', v_payer_id
    )
  );

  insert into public.mailroom_items (
    tenant_id, payer_id, claim_id, client_id, provider_id,
    authorization_id, appeal_id, document_id, subject,
    correspondence_type, status, source_event_type, source_event_id
  ) values (
    new.tenant_id, v_payer_id, new.claim_id, v_client_id, v_provider_id,
    new.authorization_id, new.appeal_id, new.id, v_subject,
    v_correspondence_type, 'new', 'document', new.id
  )
  on conflict (tenant_id, source_event_type, source_event_id)
    where source_event_type is not null and source_event_id is not null
  do update set
    document_id = excluded.document_id,
    updated_at = now()
  returning id into v_mailroom_id;

  insert into public.notifications (
    tenant_id, user_id, notification_type, title, body, metadata
  )
  select
    new.tenant_id,
    tu.user_id,
    'mailroom_document_received',
    'New Mailroom item',
    v_subject,
    jsonb_build_object(
      'mailroom_item_id', v_mailroom_id,
      'document_id', new.id,
      'event_key', 'document:' || new.id::text
    )
  from public.tenant_users tu
  where tu.tenant_id = new.tenant_id
    and tu.status::text = 'active'
    and tu.user_id is not null
    and not exists (
      select 1
      from public.notifications n
      where n.tenant_id = new.tenant_id
        and n.user_id = tu.user_id
        and n.metadata ->> 'event_key' = 'document:' || new.id::text
    );

  return new;
end;
$$;

revoke all on function private.route_document_to_mailroom() from public, anon, authenticated;

drop trigger if exists trg_route_document_to_mailroom on public.documents;
create trigger trg_route_document_to_mailroom
after insert on public.documents
for each row execute function private.route_document_to_mailroom();

-- ---------------------------------------------------------------------------
-- Migration safety and resumability
-- ---------------------------------------------------------------------------
alter table public.import_batches
  add column if not exists import_type text not null default 'patients',
  add column if not exists source_file_hash text,
  add column if not exists mapping_profile jsonb not null default '{}'::jsonb,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists last_processed_row integer not null default 0,
  add column if not exists reconciliation jsonb not null default '{}'::jsonb,
  add column if not exists rollback_status text not null default 'not_requested',
  add column if not exists rolled_back_at timestamptz;

alter table public.import_batches drop constraint if exists import_batches_import_type_check;
alter table public.import_batches add constraint import_batches_import_type_check
  check (import_type in ('patients','historical_transactions'));
alter table public.import_batches drop constraint if exists import_batches_rollback_status_check;
alter table public.import_batches add constraint import_batches_rollback_status_check
  check (rollback_status in ('not_requested','in_progress','rolled_back','blocked'));

create unique index if not exists import_batches_active_source_hash_uq
  on public.import_batches (tenant_id, source_system, source_file_hash, import_type)
  where source_file_hash is not null and rollback_status <> 'rolled_back';

alter table public.import_rows
  add column if not exists source_key text,
  add column if not exists row_fingerprint text,
  add column if not exists target_type text,
  add column if not exists target_id uuid,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists processed_at timestamptz,
  add column if not exists error_message text,
  add column if not exists rollback_status text not null default 'not_requested',
  add column if not exists rolled_back_at timestamptz,
  add column if not exists rollback_error text;

create unique index if not exists import_rows_batch_row_uq
  on public.import_rows (import_batch_id, row_number);
create unique index if not exists import_rows_batch_fingerprint_uq
  on public.import_rows (import_batch_id, row_fingerprint)
  where row_fingerprint is not null;
create index if not exists import_rows_target_idx
  on public.import_rows (tenant_id, target_type, target_id)
  where target_id is not null;

create or replace function public.reconcile_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_batch public.import_batches%rowtype;
  v_result jsonb;
begin
  select * into v_batch
  from public.import_batches
  where id = p_batch_id;

  if not found then
    raise exception 'Import batch not found';
  end if;

  perform public.assert_tenant_access(v_batch.tenant_id);

  select jsonb_build_object(
    'total_rows', count(*),
    'valid_rows', count(*) filter (where row_status = 'valid'),
    'imported_rows', count(*) filter (where row_status = 'imported'),
    'duplicate_rows', count(*) filter (where row_status = 'duplicate'),
    'failed_rows', count(*) filter (where row_status = 'failed'),
    'rolled_back_rows', count(*) filter (where rollback_status = 'rolled_back'),
    'rollback_blocked_rows', count(*) filter (where rollback_status = 'blocked'),
    'target_rows', count(*) filter (where target_id is not null)
  )
  into v_result
  from public.import_rows
  where import_batch_id = p_batch_id;

  update public.import_batches
  set reconciliation = v_result,
      updated_at = now()
  where id = p_batch_id;

  return v_result;
end;
$$;

revoke all on function public.reconcile_import_batch(uuid) from public, anon;
grant execute on function public.reconcile_import_batch(uuid) to authenticated;

create or replace function public.commit_patient_import_row(p_import_row_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.import_rows%rowtype;
  v_batch public.import_batches%rowtype;
  v_data jsonb;
  v_patient jsonb;
  v_primary jsonb;
  v_client_id uuid;
  v_existing_id uuid;
  v_billing_type text;
  v_result jsonb;
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

  if v_batch.import_type <> 'patients' then
    raise exception 'Import batch is not a patient import';
  end if;

  if v_row.row_status = 'imported' and v_row.target_id is not null then
    return jsonb_build_object('status','imported','target_id',v_row.target_id,'idempotent',true);
  end if;

  if v_row.row_status not in ('valid','failed') then
    raise exception 'Only valid or failed rows can be committed';
  end if;

  v_data := coalesce(v_row.mapped_data, '{}'::jsonb);
  v_billing_type := coalesce(nullif(v_data ->> 'billing_type',''), 'insurance');

  select c.id into v_existing_id
  from public.clients c
  where c.tenant_id = v_row.tenant_id
    and c.deleted_at is null
    and lower(btrim(c.first_name)) = lower(btrim(coalesce(v_data ->> 'first_name','')))
    and lower(btrim(c.last_name)) = lower(btrim(coalesce(v_data ->> 'last_name','')))
    and c.date_of_birth = nullif(v_data ->> 'date_of_birth','')::date
  order by c.created_at
  limit 1;

  if v_existing_id is not null then
    update public.import_rows
    set row_status = 'duplicate',
        target_type = 'client',
        target_id = v_existing_id,
        attempt_count = attempt_count + 1,
        processed_at = now(),
        error_message = 'Possible duplicate: matching name and date of birth already exists.',
        updated_at = now()
    where id = v_row.id;

    perform public.reconcile_import_batch(v_batch.id);
    return jsonb_build_object('status','duplicate','target_id',v_existing_id);
  end if;

  begin
    v_patient := jsonb_build_object(
      'first_name', v_data ->> 'first_name',
      'last_name', v_data ->> 'last_name',
      'preferred_name', nullif(v_data ->> 'preferred_name',''),
      'date_of_birth', v_data ->> 'date_of_birth',
      'sex', upper(v_data ->> 'sex'),
      'email', v_data ->> 'email',
      'phone', v_data ->> 'phone',
      'address_line1', v_data ->> 'address_line1',
      'address_line2', nullif(v_data ->> 'address_line2',''),
      'city', v_data ->> 'city',
      'state', upper(v_data ->> 'state'),
      'postal_code', v_data ->> 'postal_code',
      'billing_type', v_billing_type,
      'client_status', 'active',
      'registration_status', 'complete'
    );

    if v_billing_type = 'insurance' then
      v_primary := jsonb_build_object(
        'payer_id', v_data ->> 'primary_payer_id',
        'payer_plan_id', null,
        'member_id', v_data ->> 'primary_member_id',
        'group_number', nullif(v_data ->> 'primary_group_number',''),
        'subscriber_name', nullif(concat_ws(' ', v_data ->> 'subscriber_first_name', v_data ->> 'subscriber_last_name'),''),
        'subscriber_dob', nullif(v_data ->> 'subscriber_dob',''),
        'relationship_to_subscriber', v_data ->> 'relationship_to_subscriber',
        'metadata', jsonb_build_object(
          'imported_from_batch', v_batch.id,
          'subscriber', jsonb_build_object(
            'first_name', v_data ->> 'subscriber_first_name',
            'last_name', v_data ->> 'subscriber_last_name',
            'dob', v_data ->> 'subscriber_dob',
            'sex', upper(v_data ->> 'subscriber_sex'),
            'address_line1', v_data ->> 'subscriber_address_line1',
            'city', v_data ->> 'subscriber_city',
            'state', upper(v_data ->> 'subscriber_state'),
            'postal_code', v_data ->> 'subscriber_postal_code'
          )
        )
      );
    else
      v_primary := null;
    end if;

    v_result := public.create_patient_intake(
      v_row.tenant_id,
      v_patient,
      null,
      v_primary,
      null,
      false
    );

    v_client_id := (v_result ->> 'id')::uuid;

    update public.clients
    set metadata = metadata || jsonb_build_object(
      'imported_from_batch', v_batch.id,
      'imported_from_row', v_row.id,
      'legacy_source_key', v_row.source_key
    ),
    updated_at = now()
    where id = v_client_id;

    update public.import_rows
    set row_status = 'imported',
        target_type = 'client',
        target_id = v_client_id,
        attempt_count = attempt_count + 1,
        processed_at = now(),
        error_message = null,
        updated_at = now()
    where id = v_row.id;

    update public.import_batches
    set import_status = 'importing',
        started_at = coalesce(started_at, now()),
        last_processed_row = greatest(last_processed_row, v_row.row_number),
        updated_at = now()
    where id = v_batch.id;

    if not exists (
      select 1 from public.import_rows
      where import_batch_id = v_batch.id
        and row_status in ('pending','valid','failed')
    ) then
      update public.import_batches
      set import_status = 'completed',
          completed_at = now(),
          updated_at = now()
      where id = v_batch.id;
    end if;

    perform public.reconcile_import_batch(v_batch.id);
    return jsonb_build_object('status','imported','target_id',v_client_id,'idempotent',false);
  exception when others then
    update public.import_rows
    set row_status = 'failed',
        attempt_count = attempt_count + 1,
        processed_at = now(),
        error_message = sqlerrm,
        updated_at = now()
    where id = v_row.id;

    update public.import_batches
    set import_status = 'partial',
        started_at = coalesce(started_at, now()),
        last_processed_row = greatest(last_processed_row, v_row.row_number),
        updated_at = now()
    where id = v_batch.id;

    perform public.reconcile_import_batch(v_batch.id);
    return jsonb_build_object('status','failed','error',sqlerrm);
  end;
end;
$$;

revoke all on function public.commit_patient_import_row(uuid) from public, anon;
grant execute on function public.commit_patient_import_row(uuid) to authenticated;

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
    insert into public.historical_transactions (
      tenant_id, client_id, payer_id, transaction_type, transaction_status,
      transaction_date, amount_cents, description, legacy_source, posted_by, posted_at
    ) values (
      v_row.tenant_id,
      v_client_id,
      nullif(v_data ->> 'payer_id','')::uuid,
      (v_data ->> 'transaction_type')::public.historical_transaction_type_enum,
      'posted'::public.historical_transaction_status_enum,
      (v_data ->> 'transaction_date')::date,
      (v_data ->> 'amount_cents')::bigint,
      nullif(v_data ->> 'description',''),
      coalesce(nullif(v_batch.source_system,''), 'import'),
      (select auth.uid()),
      now()
    )
    returning id into v_transaction_id;

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

create or replace function public.rollback_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_batch public.import_batches%rowtype;
  v_row public.import_rows%rowtype;
  v_blocked integer := 0;
  v_rolled_back integer := 0;
begin
  select * into v_batch
  from public.import_batches
  where id = p_batch_id
  for update;

  if not found then raise exception 'Import batch not found'; end if;
  perform public.assert_tenant_access(v_batch.tenant_id);

  update public.import_batches
  set rollback_status='in_progress', updated_at=now()
  where id=p_batch_id;

  for v_row in
    select *
    from public.import_rows
    where import_batch_id=p_batch_id
      and target_id is not null
      and rollback_status <> 'rolled_back'
    order by row_number desc
  loop
    begin
      if v_row.target_type = 'historical_transaction' then
        delete from public.historical_transaction_allocations
        where historical_transaction_id=v_row.target_id
          and tenant_id=v_batch.tenant_id;

        delete from public.historical_transactions
        where id=v_row.target_id
          and tenant_id=v_batch.tenant_id;
      elsif v_row.target_type = 'client' and v_row.row_status = 'imported' then
        delete from public.clients
        where id=v_row.target_id
          and tenant_id=v_batch.tenant_id
          and metadata ->> 'imported_from_batch' = p_batch_id::text;
      end if;

      update public.import_rows
      set rollback_status='rolled_back',
          rolled_back_at=now(),
          rollback_error=null,
          updated_at=now()
      where id=v_row.id;
      v_rolled_back := v_rolled_back + 1;
    exception when foreign_key_violation then
      update public.import_rows
      set rollback_status='blocked',
          rollback_error='Rollback blocked because downstream records now depend on this imported record.',
          updated_at=now()
      where id=v_row.id;
      v_blocked := v_blocked + 1;
    when others then
      update public.import_rows
      set rollback_status='blocked',
          rollback_error=sqlerrm,
          updated_at=now()
      where id=v_row.id;
      v_blocked := v_blocked + 1;
    end;
  end loop;

  update public.import_batches
  set rollback_status=case when v_blocked=0 then 'rolled_back' else 'blocked' end,
      rolled_back_at=case when v_blocked=0 then now() else rolled_back_at end,
      import_status=case when v_blocked=0 then 'rolled_back' else import_status end,
      updated_at=now()
  where id=p_batch_id;

  perform public.reconcile_import_batch(p_batch_id);

  return jsonb_build_object(
    'rollback_status', case when v_blocked=0 then 'rolled_back' else 'blocked' end,
    'rolled_back_rows', v_rolled_back,
    'blocked_rows', v_blocked
  );
end;
$$;

revoke all on function public.rollback_import_batch(uuid) from public, anon;
grant execute on function public.rollback_import_batch(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Connected operations: reminders, referral-out, records, compliance screening
-- ---------------------------------------------------------------------------
create table if not exists public.appointment_reminders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  channel text not null default 'email' check (channel in ('email','sms','phone','portal')),
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','cancelled','skipped')),
  sent_at timestamptz,
  failure_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists appointment_reminders_unique_schedule_uq
  on public.appointment_reminders (appointment_id, channel, scheduled_for);
create index if not exists appointment_reminders_due_idx
  on public.appointment_reminders (tenant_id, status, scheduled_for);

create table if not exists public.referral_outs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  referred_by_provider_id uuid references public.providers(id) on delete set null,
  destination_name text not null,
  specialty text,
  phone text,
  fax text,
  email text,
  payer_name text,
  reason text,
  status text not null default 'draft' check (status in ('draft','sent','accepted','scheduled','declined','closed')),
  referred_at timestamptz,
  closed_at timestamptz,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists referral_outs_client_status_idx
  on public.referral_outs (tenant_id, client_id, status);

create table if not exists public.records_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  request_direction text not null default 'outbound' check (request_direction in ('inbound','outbound')),
  requester_name text not null,
  request_type text not null default 'medical_records',
  received_at timestamptz not null default now(),
  due_date date,
  status text not null default 'received' check (status in ('received','reviewing','awaiting_authorization','ready','sent','closed','cancelled')),
  delivery_method text,
  document_id uuid references public.documents(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists records_requests_due_idx
  on public.records_requests (tenant_id, status, due_date);

create table if not exists public.compliance_screenings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  provider_id uuid references public.providers(id) on delete cascade,
  screening_type text not null,
  status text not null default 'due' check (status in ('due','in_progress','clear','flagged','waived','expired')),
  result text,
  due_date date,
  completed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  notes text,
  evidence_document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (client_id is not null or provider_id is not null)
);

create index if not exists compliance_screenings_due_idx
  on public.compliance_screenings (tenant_id, status, due_date);

alter table public.appointment_reminders enable row level security;
alter table public.referral_outs enable row level security;
alter table public.records_requests enable row level security;
alter table public.compliance_screenings enable row level security;

revoke all on public.appointment_reminders, public.referral_outs, public.records_requests, public.compliance_screenings from anon;
grant select, insert, update on public.appointment_reminders, public.referral_outs, public.records_requests, public.compliance_screenings to authenticated;

drop policy if exists "appointment_reminders tenant select" on public.appointment_reminders;
drop policy if exists "appointment_reminders tenant insert" on public.appointment_reminders;
drop policy if exists "appointment_reminders tenant update" on public.appointment_reminders;
create policy "appointment_reminders tenant select" on public.appointment_reminders for select to authenticated using (private.has_tenant_read_access(tenant_id));
create policy "appointment_reminders tenant insert" on public.appointment_reminders for insert to authenticated with check (private.has_tenant_write_access(tenant_id));
create policy "appointment_reminders tenant update" on public.appointment_reminders for update to authenticated using (private.has_tenant_write_access(tenant_id)) with check (private.has_tenant_write_access(tenant_id));

drop policy if exists "referral_outs tenant select" on public.referral_outs;
drop policy if exists "referral_outs tenant insert" on public.referral_outs;
drop policy if exists "referral_outs tenant update" on public.referral_outs;
create policy "referral_outs tenant select" on public.referral_outs for select to authenticated using (private.has_tenant_read_access(tenant_id));
create policy "referral_outs tenant insert" on public.referral_outs for insert to authenticated with check (private.has_tenant_write_access(tenant_id));
create policy "referral_outs tenant update" on public.referral_outs for update to authenticated using (private.has_tenant_write_access(tenant_id)) with check (private.has_tenant_write_access(tenant_id));

drop policy if exists "records_requests tenant select" on public.records_requests;
drop policy if exists "records_requests tenant insert" on public.records_requests;
drop policy if exists "records_requests tenant update" on public.records_requests;
create policy "records_requests tenant select" on public.records_requests for select to authenticated using (private.has_tenant_read_access(tenant_id));
create policy "records_requests tenant insert" on public.records_requests for insert to authenticated with check (private.has_tenant_write_access(tenant_id));
create policy "records_requests tenant update" on public.records_requests for update to authenticated using (private.has_tenant_write_access(tenant_id)) with check (private.has_tenant_write_access(tenant_id));

drop policy if exists "compliance_screenings tenant select" on public.compliance_screenings;
drop policy if exists "compliance_screenings tenant insert" on public.compliance_screenings;
drop policy if exists "compliance_screenings tenant update" on public.compliance_screenings;
create policy "compliance_screenings tenant select" on public.compliance_screenings for select to authenticated using (private.has_tenant_read_access(tenant_id));
create policy "compliance_screenings tenant insert" on public.compliance_screenings for insert to authenticated with check (private.has_tenant_write_access(tenant_id));
create policy "compliance_screenings tenant update" on public.compliance_screenings for update to authenticated using (private.has_tenant_write_access(tenant_id)) with check (private.has_tenant_write_access(tenant_id));

create or replace function private.refresh_default_appointment_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_phone text;
  v_reminder_at timestamptz;
begin
  if new.appointment_status::text not in ('scheduled','confirmed') or new.starts_at <= now() then
    update public.appointment_reminders
    set status='cancelled', updated_at=now()
    where appointment_id=new.id and status='pending';
    return new;
  end if;

  select c.email::text, c.phone
    into v_email, v_phone
  from public.clients c
  where c.id=new.client_id and c.tenant_id=new.tenant_id;

  v_reminder_at := greatest(now(), new.starts_at - interval '24 hours');

  update public.appointment_reminders
  set status='cancelled', updated_at=now()
  where appointment_id=new.id and status='pending'
    and scheduled_for <> v_reminder_at;

  if nullif(btrim(coalesce(v_email,'')), '') is not null then
    insert into public.appointment_reminders (
      tenant_id, appointment_id, channel, scheduled_for, status, created_by
    ) values (
      new.tenant_id, new.id, 'email', v_reminder_at, 'pending', (select auth.uid())
    ) on conflict do nothing;
  end if;

  if nullif(btrim(coalesce(v_phone,'')), '') is not null then
    insert into public.appointment_reminders (
      tenant_id, appointment_id, channel, scheduled_for, status, created_by
    ) values (
      new.tenant_id, new.id, 'sms', v_reminder_at, 'pending', (select auth.uid())
    ) on conflict do nothing;
  end if;

  return new;
end;
$$;

revoke all on function private.refresh_default_appointment_reminders() from public, anon, authenticated;

drop trigger if exists trg_refresh_default_appointment_reminders on public.appointments;
create trigger trg_refresh_default_appointment_reminders
after insert or update of starts_at, appointment_status, client_id on public.appointments
for each row execute function private.refresh_default_appointment_reminders();

-- Backfill default reminders for existing future appointments.
insert into public.appointment_reminders (
  tenant_id, appointment_id, channel, scheduled_for, status
)
select a.tenant_id, a.id, 'email', greatest(now(), a.starts_at - interval '24 hours'), 'pending'
from public.appointments a
join public.clients c on c.id=a.client_id and c.tenant_id=a.tenant_id
where a.starts_at > now()
  and a.appointment_status::text in ('scheduled','confirmed')
  and nullif(btrim(coalesce(c.email::text,'')), '') is not null
on conflict do nothing;

insert into public.appointment_reminders (
  tenant_id, appointment_id, channel, scheduled_for, status
)
select a.tenant_id, a.id, 'sms', greatest(now(), a.starts_at - interval '24 hours'), 'pending'
from public.appointments a
join public.clients c on c.id=a.client_id and c.tenant_id=a.tenant_id
where a.starts_at > now()
  and a.appointment_status::text in ('scheduled','confirmed')
  and nullif(btrim(coalesce(c.phone,'')), '') is not null
on conflict do nothing;

commit;

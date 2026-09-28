-- Background job foundation: durable Postgres queue + audited worker runs.
-- Domain workflows are intentionally not wired here. Start with system.health_check only.

create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if to_regclass('pgmq.q_therassistant_background_jobs') is null then
    perform pgmq.create('therassistant_background_jobs');
  end if;
end
$$;

create table if not exists public.background_job_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null references public.tenants(id) on delete cascade,
  job_type text not null,
  idempotency_key text not null,
  status text not null default 'queued'
    check (status in ('queued','processing','retrying','succeeded','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  queue_message_id bigint null unique,
  last_error text null,
  enqueued_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,
  updated_at timestamptz not null default now(),
  check (job_type ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  check (length(idempotency_key) between 1 and 200)
);

create unique index if not exists background_job_runs_idempotency_idx
  on public.background_job_runs (
    (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    idempotency_key
  );

create index if not exists background_job_runs_status_enqueued_idx
  on public.background_job_runs (status, enqueued_at);

alter table public.background_job_runs enable row level security;

drop policy if exists "background_job_runs tenant read" on public.background_job_runs;
create policy "background_job_runs tenant read"
on public.background_job_runs
for select
to authenticated
using (
  tenant_id is not null
  and private.has_tenant_read_access(tenant_id)
);

grant select on public.background_job_runs to authenticated;
revoke insert, update, delete on public.background_job_runs from anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'background_worker_token'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'background_worker_token'
    );
  end if;
end
$$;

create or replace function public.verify_background_worker_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, vault
as $$
  select coalesce(
    exists (
      select 1
      from vault.decrypted_secrets
      where name = 'background_worker_token'
        and decrypted_secret = p_token
    ),
    false
  );
$$;

create or replace function public.enqueue_background_job(
  p_job_type text,
  p_tenant_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 5
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare
  v_job_id uuid;
  v_msg_id bigint;
begin
  if p_job_type is null
     or p_job_type !~ '^[a-z0-9][a-z0-9._-]{0,79}$' then
    raise exception 'Invalid background job type';
  end if;

  if p_idempotency_key is null
     or length(p_idempotency_key) not between 1 and 200 then
    raise exception 'Invalid background job idempotency key';
  end if;

  if p_max_attempts not between 1 and 20 then
    raise exception 'Invalid background job max attempts';
  end if;

  insert into public.background_job_runs (
    tenant_id,
    job_type,
    idempotency_key,
    max_attempts
  )
  values (
    p_tenant_id,
    p_job_type,
    p_idempotency_key,
    p_max_attempts
  )
  on conflict do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select id
      into v_job_id
    from public.background_job_runs
    where tenant_id is not distinct from p_tenant_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if v_job_id is null then
      raise exception 'Unable to resolve idempotent background job';
    end if;

    return v_job_id;
  end if;

  select *
    into v_msg_id
  from pgmq.send(
    'therassistant_background_jobs',
    jsonb_build_object(
      'job_id', v_job_id,
      'tenant_id', p_tenant_id,
      'job_type', p_job_type,
      'payload', coalesce(p_payload, '{}'::jsonb)
    )
  )
  limit 1;

  update public.background_job_runs
  set queue_message_id = v_msg_id,
      updated_at = now()
  where id = v_job_id;

  return v_job_id;
end;
$$;

create or replace function public.dequeue_background_jobs(
  p_qty integer default 5,
  p_visibility_timeout integer default 90
)
returns setof pgmq.message_record
language sql
security definer
set search_path = pg_catalog, pgmq
as $$
  select *
  from pgmq.read(
    'therassistant_background_jobs',
    greatest(30, least(p_visibility_timeout, 600)),
    greatest(1, least(p_qty, 10))
  );
$$;

create or replace function public.mark_background_job_processing(
  p_job_id uuid,
  p_msg_id bigint,
  p_read_ct integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.background_job_runs
  set status = 'processing',
      attempts = greatest(attempts, p_read_ct),
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = p_job_id
    and queue_message_id = p_msg_id
    and status in ('queued','retrying','processing');

  return found;
end;
$$;

create or replace function public.complete_background_job(
  p_job_id uuid,
  p_msg_id bigint,
  p_read_ct integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare
  v_archived boolean;
begin
  update public.background_job_runs
  set status = 'succeeded',
      attempts = greatest(attempts, p_read_ct),
      completed_at = now(),
      last_error = null,
      updated_at = now()
  where id = p_job_id
    and queue_message_id = p_msg_id;

  if not found then
    raise exception 'Background job run not found';
  end if;

  select pgmq.archive('therassistant_background_jobs', p_msg_id)
    into v_archived;

  if not coalesce(v_archived, false) then
    raise exception 'Background queue message could not be archived';
  end if;

  return true;
end;
$$;

create or replace function public.fail_background_job(
  p_job_id uuid,
  p_msg_id bigint,
  p_read_ct integer,
  p_error text,
  p_permanent boolean default false
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare
  v_max_attempts integer;
  v_archived boolean;
  v_status text;
begin
  select max_attempts
    into v_max_attempts
  from public.background_job_runs
  where id = p_job_id
    and queue_message_id = p_msg_id
  for update;

  if v_max_attempts is null then
    raise exception 'Background job run not found';
  end if;

  if p_permanent or p_read_ct >= v_max_attempts then
    v_status := 'failed';

    update public.background_job_runs
    set status = v_status,
        attempts = greatest(attempts, p_read_ct),
        last_error = left(coalesce(p_error, 'Background job failed'), 2000),
        completed_at = now(),
        updated_at = now()
    where id = p_job_id;

    select pgmq.archive('therassistant_background_jobs', p_msg_id)
      into v_archived;

    if not coalesce(v_archived, false) then
      raise exception 'Background queue message could not be archived';
    end if;
  else
    v_status := 'retrying';

    update public.background_job_runs
    set status = v_status,
        attempts = greatest(attempts, p_read_ct),
        last_error = left(coalesce(p_error, 'Background job failed'), 2000),
        updated_at = now()
    where id = p_job_id;
  end if;

  return v_status;
end;
$$;

create or replace function public.archive_background_message(p_msg_id bigint)
returns boolean
language sql
security definer
set search_path = pg_catalog, pgmq
as $$
  select pgmq.archive('therassistant_background_jobs', p_msg_id);
$$;

create or replace function private.invoke_background_worker()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, vault, net
as $$
declare
  v_project_url text;
  v_worker_token text;
  v_request_id bigint;
begin
  select decrypted_secret
    into v_project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  select decrypted_secret
    into v_worker_token
  from vault.decrypted_secrets
  where name = 'background_worker_token'
  limit 1;

  if v_project_url is null or v_worker_token is null then
    return null;
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/background-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-background-worker-token', v_worker_token
    ),
    body := jsonb_build_object(
      'source', 'supabase_cron',
      'requested_at', now()
    ),
    timeout_milliseconds := 10000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

create or replace function private.ensure_background_worker_cron()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, cron, vault
as $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'project_url'
  ) then
    return false;
  end if;

  if not exists (
    select 1
    from cron.job
    where jobname = 'therassistant-background-worker'
  ) then
    perform cron.schedule(
      'therassistant-background-worker',
      '* * * * *',
      'select private.invoke_background_worker();'
    );
  end if;

  return true;
end;
$$;

revoke all on function public.verify_background_worker_token(text) from public, anon, authenticated;
revoke all on function public.enqueue_background_job(text, uuid, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.dequeue_background_jobs(integer, integer) from public, anon, authenticated;
revoke all on function public.mark_background_job_processing(uuid, bigint, integer) from public, anon, authenticated;
revoke all on function public.complete_background_job(uuid, bigint, integer) from public, anon, authenticated;
revoke all on function public.fail_background_job(uuid, bigint, integer, text, boolean) from public, anon, authenticated;
revoke all on function public.archive_background_message(bigint) from public, anon, authenticated;

grant execute on function public.verify_background_worker_token(text) to service_role;
grant execute on function public.enqueue_background_job(text, uuid, text, jsonb, integer) to service_role;
grant execute on function public.dequeue_background_jobs(integer, integer) to service_role;
grant execute on function public.mark_background_job_processing(uuid, bigint, integer) to service_role;
grant execute on function public.complete_background_job(uuid, bigint, integer) to service_role;
grant execute on function public.fail_background_job(uuid, bigint, integer, text, boolean) to service_role;
grant execute on function public.archive_background_message(bigint) to service_role;

revoke all on function private.invoke_background_worker() from public, anon, authenticated;
revoke all on function private.ensure_background_worker_cron() from public, anon, authenticated;

select private.ensure_background_worker_cron();

begin;

create table if not exists public.portal_message_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  subject text not null,
  status text not null default 'open',
  workqueue_item_id uuid references public.workqueue_items(id) on delete set null,
  created_by_patient_user_id uuid,
  last_message_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_message_threads_subject_length check (char_length(trim(subject)) between 1 and 160),
  constraint portal_message_threads_status check (status in ('open','closed'))
);

create index if not exists idx_portal_message_threads_client
  on public.portal_message_threads (tenant_id, client_id, last_message_at desc);
create index if not exists idx_portal_message_threads_work
  on public.portal_message_threads (workqueue_item_id)
  where workqueue_item_id is not null;

create table if not exists public.portal_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  thread_id uuid not null references public.portal_message_threads(id) on delete cascade,
  sender_type text not null,
  sender_user_id uuid,
  body text not null,
  created_at timestamptz not null default now(),
  constraint portal_messages_sender_type check (sender_type in ('patient','staff')),
  constraint portal_messages_body_length check (char_length(trim(body)) between 1 and 4000)
);

create index if not exists idx_portal_messages_thread
  on public.portal_messages (thread_id, created_at asc);
create index if not exists idx_portal_messages_client
  on public.portal_messages (tenant_id, client_id, created_at desc);

alter table public.portal_message_threads enable row level security;
alter table public.portal_messages enable row level security;

revoke all on table public.portal_message_threads from public, anon, authenticated;
revoke all on table public.portal_messages from public, anon, authenticated;

create or replace function private.portal_message_threads_json(
  p_tenant_id uuid,
  p_client_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'subject', t.subject,
        'status', t.status,
        'last_message_at', t.last_message_at,
        'closed_at', t.closed_at,
        'created_at', t.created_at,
        'messages', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', m.id,
              'sender_type', m.sender_type,
              'body', m.body,
              'created_at', m.created_at
            )
            order by m.created_at asc, m.id asc
          )
          from public.portal_messages m
          where m.thread_id = t.id
            and m.tenant_id = p_tenant_id
            and m.client_id = p_client_id
        ), '[]'::jsonb)
      )
      order by t.last_message_at desc, t.id desc
    ),
    '[]'::jsonb
  )
  from (
    select *
    from public.portal_message_threads
    where tenant_id = p_tenant_id
      and client_id = p_client_id
    order by last_message_at desc, id desc
    limit 20
  ) t;
$$;

revoke all on function private.portal_message_threads_json(uuid, uuid) from public, anon, authenticated;

create or replace function private.get_my_portal_messages_impl()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access public.client_portal_access%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select cpa.*
    into v_access
  from public.client_portal_access cpa
  where cpa.user_id = (select auth.uid())
    and cpa.status = 'active'
  order by cpa.created_at desc
  limit 1;

  if not found then
    raise exception 'Active patient portal access is required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'threads',
    private.portal_message_threads_json(v_access.tenant_id, v_access.client_id)
  );
end;
$$;

revoke all on function private.get_my_portal_messages_impl() from public, anon;
grant execute on function private.get_my_portal_messages_impl() to authenticated;

create or replace function public.get_my_portal_messages()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_my_portal_messages_impl();
$$;

revoke all on function public.get_my_portal_messages() from public, anon;
grant execute on function public.get_my_portal_messages() to authenticated;

create or replace function private.portal_send_message_impl(
  p_thread_id uuid,
  p_subject text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.client_portal_access%rowtype;
  v_thread public.portal_message_threads%rowtype;
  v_work public.workqueue_items%rowtype;
  v_old_status public.workqueue_status_enum;
  v_subject text := trim(coalesce(p_subject, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if v_body = '' or char_length(v_body) > 4000 then
    raise exception 'Message must be between 1 and 4000 characters' using errcode = '22023';
  end if;

  select cpa.*
    into v_access
  from public.client_portal_access cpa
  where cpa.user_id = (select auth.uid())
    and cpa.status = 'active'
  order by cpa.created_at desc
  limit 1;

  if not found then
    raise exception 'Active patient portal access is required' using errcode = '42501';
  end if;

  if p_thread_id is null then
    if v_subject = '' or char_length(v_subject) > 160 then
      raise exception 'Subject must be between 1 and 160 characters' using errcode = '22023';
    end if;

    insert into public.portal_message_threads (
      tenant_id,
      client_id,
      subject,
      status,
      created_by_patient_user_id,
      last_message_at
    ) values (
      v_access.tenant_id,
      v_access.client_id,
      v_subject,
      'open',
      (select auth.uid()),
      v_now
    )
    returning * into v_thread;
  else
    select t.*
      into v_thread
    from public.portal_message_threads t
    where t.id = p_thread_id
      and t.tenant_id = v_access.tenant_id
      and t.client_id = v_access.client_id
    for update;

    if not found then
      raise exception 'Message thread is unavailable' using errcode = 'P0002';
    end if;
    if v_thread.status <> 'open' then
      raise exception 'This conversation is closed. Start a new message instead.' using errcode = '22023';
    end if;
  end if;

  insert into public.portal_messages (
    tenant_id,
    client_id,
    thread_id,
    sender_type,
    sender_user_id,
    body
  ) values (
    v_access.tenant_id,
    v_access.client_id,
    v_thread.id,
    'patient',
    (select auth.uid()),
    v_body
  );

  update public.portal_message_threads
  set last_message_at = v_now, updated_at = v_now
  where id = v_thread.id
  returning * into v_thread;

  if v_thread.workqueue_item_id is not null then
    select w.*
      into v_work
    from public.workqueue_items w
    where w.id = v_thread.workqueue_item_id
      and w.tenant_id = v_access.tenant_id
    for update;
  end if;

  if v_work.id is null or v_work.workqueue_status in ('completed','cancelled') then
    insert into public.workqueue_items (
      tenant_id,
      workqueue_type,
      workqueue_status,
      priority,
      source_object_type,
      source_object_id,
      title,
      description,
      created_by
    ) values (
      v_access.tenant_id,
      'correspondence'::public.workqueue_type_enum,
      'open'::public.workqueue_status_enum,
      'normal'::public.workqueue_priority_enum,
      'client'::public.workqueue_source_object_type_enum,
      v_access.client_id,
      'Patient portal message: ' || v_thread.subject,
      'A patient sent a secure portal message. Review and respond from the Patient Chart Engagement tab.',
      (select auth.uid())
    )
    returning * into v_work;

    update public.portal_message_threads
    set workqueue_item_id = v_work.id, updated_at = v_now
    where id = v_thread.id;
  elsif v_work.workqueue_status in ('pending','snoozed') then
    v_old_status := v_work.workqueue_status;
    update public.workqueue_items
    set workqueue_status = 'reopened',
        completed_at = null,
        completed_by = null,
        updated_at = v_now
    where id = v_work.id
    returning * into v_work;

    insert into public.workqueue_history (
      tenant_id,
      workqueue_item_id,
      old_status,
      new_status,
      old_priority,
      new_priority,
      changed_by,
      note
    ) values (
      v_access.tenant_id,
      v_work.id,
      v_old_status,
      v_work.workqueue_status,
      v_work.priority,
      v_work.priority,
      (select auth.uid()),
      'Patient sent a new portal message.'
    );
  end if;

  return jsonb_build_object(
    'thread_id', v_thread.id,
    'status', v_thread.status,
    'last_message_at', v_now
  );
end;
$$;

revoke all on function private.portal_send_message_impl(uuid, text, text) from public, anon;
grant execute on function private.portal_send_message_impl(uuid, text, text) to authenticated;

create or replace function public.portal_send_message(
  p_thread_id uuid,
  p_subject text,
  p_body text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.portal_send_message_impl(p_thread_id, p_subject, p_body);
$$;

revoke all on function public.portal_send_message(uuid, text, text) from public, anon;
grant execute on function public.portal_send_message(uuid, text, text) to authenticated;

create or replace function private.get_client_portal_messages_impl(
  p_tenant_id uuid,
  p_client_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_tenant_read_access(p_tenant_id) then
    raise exception 'You do not have read access to this organization' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.clients c
    where c.id = p_client_id
      and c.tenant_id = p_tenant_id
  ) then
    raise exception 'Patient is unavailable' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'threads',
    private.portal_message_threads_json(p_tenant_id, p_client_id)
  );
end;
$$;

revoke all on function private.get_client_portal_messages_impl(uuid, uuid) from public, anon;
grant execute on function private.get_client_portal_messages_impl(uuid, uuid) to authenticated;

create or replace function public.get_client_portal_messages(
  p_tenant_id uuid,
  p_client_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_client_portal_messages_impl(p_tenant_id, p_client_id);
$$;

revoke all on function public.get_client_portal_messages(uuid, uuid) from public, anon;
grant execute on function public.get_client_portal_messages(uuid, uuid) to authenticated;

create or replace function private.reply_client_portal_message_impl(
  p_tenant_id uuid,
  p_thread_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread public.portal_message_threads%rowtype;
  v_message public.portal_messages%rowtype;
  v_work public.workqueue_items%rowtype;
  v_old_status public.workqueue_status_enum;
  v_body text := trim(coalesce(p_body, ''));
  v_now timestamptz := now();
begin
  if not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'You do not have write access to this organization' using errcode = '42501';
  end if;
  if v_body = '' or char_length(v_body) > 4000 then
    raise exception 'Message must be between 1 and 4000 characters' using errcode = '22023';
  end if;

  select t.*
    into v_thread
  from public.portal_message_threads t
  where t.id = p_thread_id
    and t.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Message thread is unavailable' using errcode = 'P0002';
  end if;
  if v_thread.status <> 'open' then
    raise exception 'This conversation is closed' using errcode = '22023';
  end if;

  insert into public.portal_messages (
    tenant_id,
    client_id,
    thread_id,
    sender_type,
    sender_user_id,
    body
  ) values (
    p_tenant_id,
    v_thread.client_id,
    v_thread.id,
    'staff',
    (select auth.uid()),
    v_body
  )
  returning * into v_message;

  update public.portal_message_threads
  set last_message_at = v_now, updated_at = v_now
  where id = v_thread.id;

  if v_thread.workqueue_item_id is not null then
    select w.*
      into v_work
    from public.workqueue_items w
    where w.id = v_thread.workqueue_item_id
      and w.tenant_id = p_tenant_id
    for update;

    if found and v_work.workqueue_status in ('open','reopened') then
      v_old_status := v_work.workqueue_status;
      update public.workqueue_items
      set workqueue_status = 'in_progress', updated_at = v_now
      where id = v_work.id
      returning * into v_work;

      insert into public.workqueue_history (
        tenant_id,
        workqueue_item_id,
        old_status,
        new_status,
        old_priority,
        new_priority,
        changed_by,
        note
      ) values (
        p_tenant_id,
        v_work.id,
        v_old_status,
        v_work.workqueue_status,
        v_work.priority,
        v_work.priority,
        (select auth.uid()),
        'Staff replied to the patient portal conversation.'
      );
    end if;
  end if;

  return jsonb_build_object(
    'id', v_message.id,
    'thread_id', v_thread.id,
    'sender_type', v_message.sender_type,
    'body', v_message.body,
    'created_at', v_message.created_at
  );
end;
$$;

revoke all on function private.reply_client_portal_message_impl(uuid, uuid, text) from public, anon;
grant execute on function private.reply_client_portal_message_impl(uuid, uuid, text) to authenticated;

create or replace function public.reply_client_portal_message(
  p_tenant_id uuid,
  p_thread_id uuid,
  p_body text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.reply_client_portal_message_impl(p_tenant_id, p_thread_id, p_body);
$$;

revoke all on function public.reply_client_portal_message(uuid, uuid, text) from public, anon;
grant execute on function public.reply_client_portal_message(uuid, uuid, text) to authenticated;

create or replace function private.close_client_portal_message_thread_impl(
  p_tenant_id uuid,
  p_thread_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread public.portal_message_threads%rowtype;
  v_work public.workqueue_items%rowtype;
  v_old_status public.workqueue_status_enum;
  v_now timestamptz := now();
begin
  if not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'You do not have write access to this organization' using errcode = '42501';
  end if;

  select t.*
    into v_thread
  from public.portal_message_threads t
  where t.id = p_thread_id
    and t.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Message thread is unavailable' using errcode = 'P0002';
  end if;

  if v_thread.status <> 'closed' then
    update public.portal_message_threads
    set status = 'closed',
        closed_at = v_now,
        updated_at = v_now
    where id = v_thread.id
    returning * into v_thread;
  end if;

  if v_thread.workqueue_item_id is not null then
    select w.*
      into v_work
    from public.workqueue_items w
    where w.id = v_thread.workqueue_item_id
      and w.tenant_id = p_tenant_id
    for update;

    if found and v_work.workqueue_status not in ('completed','cancelled') then
      v_old_status := v_work.workqueue_status;
      update public.workqueue_items
      set workqueue_status = 'completed',
          completed_at = v_now,
          completed_by = (select auth.uid()),
          updated_at = v_now
      where id = v_work.id
      returning * into v_work;

      insert into public.workqueue_history (
        tenant_id,
        workqueue_item_id,
        old_status,
        new_status,
        old_priority,
        new_priority,
        changed_by,
        note
      ) values (
        p_tenant_id,
        v_work.id,
        v_old_status,
        v_work.workqueue_status,
        v_work.priority,
        v_work.priority,
        (select auth.uid()),
        coalesce(nullif(trim(p_note), ''), 'Patient portal conversation closed.')
      );
    end if;
  end if;

  return jsonb_build_object(
    'thread_id', v_thread.id,
    'status', v_thread.status,
    'closed_at', v_thread.closed_at
  );
end;
$$;

revoke all on function private.close_client_portal_message_thread_impl(uuid, uuid, text) from public, anon;
grant execute on function private.close_client_portal_message_thread_impl(uuid, uuid, text) to authenticated;

create or replace function public.close_client_portal_message_thread(
  p_tenant_id uuid,
  p_thread_id uuid,
  p_note text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.close_client_portal_message_thread_impl(p_tenant_id, p_thread_id, p_note);
$$;

revoke all on function public.close_client_portal_message_thread(uuid, uuid, text) from public, anon;
grant execute on function public.close_client_portal_message_thread(uuid, uuid, text) to authenticated;

commit;

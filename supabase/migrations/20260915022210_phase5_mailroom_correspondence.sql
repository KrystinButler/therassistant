begin;

alter table public.mailroom_items
  add column if not exists client_id uuid references public.clients(id),
  add column if not exists provider_id uuid references public.providers(id),
  add column if not exists authorization_id uuid references public.authorizations(id),
  add column if not exists appeal_id uuid references public.appeals(id),
  add column if not exists document_id uuid references public.documents(id),
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null,
  add column if not exists due_date date,
  add column if not exists reviewed_at timestamptz,
  add column if not exists closed_at timestamptz;

alter table public.mailroom_items
  drop constraint if exists mailroom_items_status_check;

alter table public.mailroom_items
  add constraint mailroom_items_status_check
  check (status in ('new','reviewed','action_required','in_progress','pending','resolved','closed'));

alter type public.workqueue_type_enum
  add value if not exists 'correspondence';

alter type public.workqueue_source_object_type_enum
  add value if not exists 'mailroom_item';

create index if not exists mailroom_items_tenant_status_received_idx
  on public.mailroom_items (tenant_id, status, received_date desc);
create index if not exists mailroom_items_tenant_due_idx
  on public.mailroom_items (tenant_id, due_date)
  where due_date is not null;
create index if not exists mailroom_items_client_idx
  on public.mailroom_items (tenant_id, client_id);
create index if not exists mailroom_items_provider_idx
  on public.mailroom_items (tenant_id, provider_id);
create index if not exists mailroom_items_claim_idx
  on public.mailroom_items (tenant_id, claim_id);
create index if not exists mailroom_items_payer_idx
  on public.mailroom_items (tenant_id, payer_id);
create index if not exists workqueue_correspondence_lookup_idx
  on public.workqueue_items
    (tenant_id, source_object_type, source_object_id, workqueue_type, workqueue_status);

grant select, insert on table public.status_history to anon;

drop policy if exists "demo anon status history select" on public.status_history;
create policy "demo anon status history select"
on public.status_history
for select
to anon
using (
  tenant_id in (
    select id from public.tenants
    where name = 'Therassistant Demo'
      and coalesce((settings ->> 'demo')::boolean, false) is true
  )
);

drop policy if exists "demo anon status history insert" on public.status_history;
create policy "demo anon status history insert"
on public.status_history
for insert
to anon
with check (
  tenant_id in (
    select id from public.tenants
    where name = 'Therassistant Demo'
      and coalesce((settings ->> 'demo')::boolean, false) is true
  )
);

drop policy if exists "demo anon read mailroom documents" on storage.objects;
create policy "demo anon read mailroom documents"
on storage.objects
for select
to anon
using (
  bucket_id = 'therassistant-documents'
  and (storage.foldername(name))[1] = 'demo'
  and (storage.foldername(name))[3] = 'mailroom'
  and exists (
    select 1
    from public.mailroom_items m
    where m.id::text = (storage.foldername(name))[4]
      and m.tenant_id::text = (storage.foldername(name))[2]
  )
);

drop policy if exists "demo anon upload mailroom documents" on storage.objects;
create policy "demo anon upload mailroom documents"
on storage.objects
for insert
to anon
with check (
  bucket_id = 'therassistant-documents'
  and (storage.foldername(name))[1] = 'demo'
  and (storage.foldername(name))[3] = 'mailroom'
  and exists (
    select 1
    from public.mailroom_items m
    where m.id::text = (storage.foldername(name))[4]
      and m.tenant_id::text = (storage.foldername(name))[2]
  )
);

drop policy if exists "demo anon delete mailroom documents" on storage.objects;
create policy "demo anon delete mailroom documents"
on storage.objects
for delete
to anon
using (
  bucket_id = 'therassistant-documents'
  and (storage.foldername(name))[1] = 'demo'
  and (storage.foldername(name))[3] = 'mailroom'
  and exists (
    select 1
    from public.mailroom_items m
    where m.id::text = (storage.foldername(name))[4]
      and m.tenant_id::text = (storage.foldername(name))[2]
  )
);

create or replace function public.get_demo_mailroom_assignees()
returns table (
  user_id uuid,
  display_label text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    tu.user_id,
    coalesce(
      nullif(trim(up.display_name), ''),
      nullif(trim(concat_ws(' ', up.first_name, up.last_name)), ''),
      'Assigned User'
    ) as display_label
  from public.tenant_users tu
  join public.tenants t on t.id = tu.tenant_id
  left join public.user_profiles up on up.id = tu.user_id
  where t.name = 'Therassistant Demo'
    and coalesce((t.settings ->> 'demo')::boolean, false) is true
    and tu.status = 'active'::public.user_status_enum
  order by display_label, tu.user_id;
$$;

revoke all on function public.get_demo_mailroom_assignees() from public;
grant execute on function public.get_demo_mailroom_assignees() to anon, authenticated;

create or replace function public.transition_demo_mailroom_item(
  p_mailroom_item_id uuid,
  p_action text,
  p_reason text default null
)
returns public.mailroom_items
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_item public.mailroom_items%rowtype;
  v_old_status text;
  v_new_status text;
  v_work public.workqueue_items%rowtype;
  v_old_work_status public.workqueue_status_enum;
  v_priority public.workqueue_priority_enum;
  v_now timestamptz := now();
begin
  select * into v_item from public.mailroom_items where id = p_mailroom_item_id for update;
  if not found then raise exception 'Mailroom item not found.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.tenants t where t.id = v_item.tenant_id and t.name = 'Therassistant Demo' and coalesce((t.settings ->> 'demo')::boolean, false) is true) then raise exception 'Mailroom transition is limited to the Therassistant Demo tenant.' using errcode = '42501'; end if;
  v_old_status := v_item.status;
  case p_action
    when 'review' then if v_old_status <> 'new' then raise exception 'Review is only allowed from new.' using errcode = '22023'; end if; v_new_status := 'reviewed';
    when 'require_action' then if v_old_status not in ('new', 'reviewed') then raise exception 'Action Required is only allowed from new or reviewed.' using errcode = '22023'; end if; v_new_status := 'action_required';
    when 'start' then if v_old_status not in ('action_required', 'pending') then raise exception 'Start is only allowed from action required or pending.' using errcode = '22023'; end if; v_new_status := 'in_progress';
    when 'pend' then if v_old_status not in ('action_required', 'in_progress') then raise exception 'Pend is only allowed from action required or in progress.' using errcode = '22023'; end if; if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A pending reason is required.' using errcode = '22023'; end if; v_new_status := 'pending';
    when 'resolve' then if v_old_status not in ('action_required', 'in_progress', 'pending') then raise exception 'Resolve is only allowed from action required, in progress, or pending.' using errcode = '22023'; end if; v_new_status := 'resolved';
    when 'close' then
      if v_old_status not in ('new', 'reviewed', 'resolved') then raise exception 'Close is only allowed from new, reviewed, or resolved.' using errcode = '22023'; end if;
      if exists (select 1 from public.workqueue_items w where w.tenant_id = v_item.tenant_id and w.source_object_type::text = 'mailroom_item' and w.source_object_id = v_item.id and w.workqueue_type::text = 'correspondence' and w.workqueue_status::text not in ('completed', 'cancelled')) then raise exception 'Correspondence cannot be closed while active follow-up work remains.' using errcode = '23514'; end if;
      v_new_status := 'closed';
    when 'reopen' then if v_old_status not in ('resolved', 'closed') then raise exception 'Reopen is only allowed from resolved or closed.' using errcode = '22023'; end if; v_new_status := 'action_required';
    else raise exception 'Unsupported Mailroom action: %', p_action using errcode = '22023';
  end case;
  if v_item.due_date is null then v_priority := 'normal'; elsif v_item.due_date < current_date then v_priority := 'urgent'; elsif v_item.due_date <= current_date + 7 then v_priority := 'high'; else v_priority := 'normal'; end if;
  select * into v_work from public.workqueue_items w where w.tenant_id = v_item.tenant_id and w.source_object_type::text = 'mailroom_item' and w.source_object_id = v_item.id and w.workqueue_type::text = 'correspondence' and w.workqueue_status::text not in ('completed', 'cancelled') order by w.created_at desc limit 1 for update;
  if p_action = 'require_action' then
    if v_work.id is null then
      insert into public.workqueue_items (tenant_id, workqueue_type, workqueue_status, priority, source_object_type, source_object_id, title, description, due_date, assigned_user_id, created_by)
      values (v_item.tenant_id, 'correspondence', 'open', v_priority, 'mailroom_item', v_item.id, v_item.subject, replace(v_item.correspondence_type, '_', ' ') || ' correspondence requires follow-up.', v_item.due_date, v_item.assigned_user_id, auth.uid()) returning * into v_work;
    end if;
  elsif p_action = 'start' then
    if v_work.id is null then raise exception 'Active correspondence work item not found.' using errcode = 'P0002'; end if;
    v_old_work_status := v_work.workqueue_status;
    update public.workqueue_items set workqueue_status = 'in_progress', updated_at = v_now where id = v_work.id returning * into v_work;
    if v_old_work_status is distinct from v_work.workqueue_status then insert into public.workqueue_history (tenant_id, workqueue_item_id, old_status, new_status, old_priority, new_priority, changed_by, note) values (v_item.tenant_id, v_work.id, v_old_work_status, v_work.workqueue_status, v_work.priority, v_work.priority, auth.uid(), coalesce(nullif(trim(p_reason), ''), 'Correspondence work started.')); end if;
  elsif p_action = 'pend' then
    if v_work.id is null then raise exception 'Active correspondence work item not found.' using errcode = 'P0002'; end if;
    v_old_work_status := v_work.workqueue_status;
    update public.workqueue_items set workqueue_status = 'pending', updated_at = v_now where id = v_work.id returning * into v_work;
    if v_old_work_status is distinct from v_work.workqueue_status then insert into public.workqueue_history (tenant_id, workqueue_item_id, old_status, new_status, old_priority, new_priority, changed_by, note) values (v_item.tenant_id, v_work.id, v_old_work_status, v_work.workqueue_status, v_work.priority, v_work.priority, auth.uid(), trim(p_reason)); end if;
  elsif p_action = 'resolve' then
    if v_work.id is null then raise exception 'Active correspondence work item not found.' using errcode = 'P0002'; end if;
    v_old_work_status := v_work.workqueue_status;
    update public.workqueue_items set workqueue_status = 'completed', completed_at = v_now, completed_by = auth.uid(), updated_at = v_now where id = v_work.id returning * into v_work;
    insert into public.workqueue_history (tenant_id, workqueue_item_id, old_status, new_status, old_priority, new_priority, changed_by, note) values (v_item.tenant_id, v_work.id, v_old_work_status, v_work.workqueue_status, v_work.priority, v_work.priority, auth.uid(), coalesce(nullif(trim(p_reason), ''), 'Correspondence resolved.'));
  elsif p_action = 'reopen' then
    if v_work.id is null then
      select * into v_work from public.workqueue_items w where w.tenant_id = v_item.tenant_id and w.source_object_type::text = 'mailroom_item' and w.source_object_id = v_item.id and w.workqueue_type::text = 'correspondence' and w.workqueue_status::text in ('completed', 'cancelled') order by w.updated_at desc, w.created_at desc limit 1 for update;
      if v_work.id is not null then
        v_old_work_status := v_work.workqueue_status;
        update public.workqueue_items set workqueue_status = 'reopened', due_date = v_item.due_date, assigned_user_id = v_item.assigned_user_id, completed_at = null, completed_by = null, updated_at = v_now where id = v_work.id returning * into v_work;
        insert into public.workqueue_history (tenant_id, workqueue_item_id, old_status, new_status, old_priority, new_priority, changed_by, note) values (v_item.tenant_id, v_work.id, v_old_work_status, v_work.workqueue_status, v_work.priority, v_work.priority, auth.uid(), coalesce(nullif(trim(p_reason), ''), 'Correspondence reopened.'));
      else
        insert into public.workqueue_items (tenant_id, workqueue_type, workqueue_status, priority, source_object_type, source_object_id, title, description, due_date, assigned_user_id, created_by)
        values (v_item.tenant_id, 'correspondence', 'open', v_priority, 'mailroom_item', v_item.id, v_item.subject, replace(v_item.correspondence_type, '_', ' ') || ' correspondence requires follow-up.', v_item.due_date, v_item.assigned_user_id, auth.uid()) returning * into v_work;
      end if;
    end if;
  end if;
  update public.mailroom_items set status = v_new_status, reviewed_at = case when p_action = 'review' then coalesce(reviewed_at, v_now) else reviewed_at end, closed_at = case when p_action = 'close' then v_now when p_action = 'reopen' then null else closed_at end, updated_at = v_now where id = v_item.id returning * into v_item;
  insert into public.status_history (tenant_id, target_type, target_id, old_status, new_status, changed_by, reason) values (v_item.tenant_id, 'mailroom_item', v_item.id, v_old_status, v_new_status, auth.uid(), nullif(trim(coalesce(p_reason, '')), ''));
  return v_item;
end;
$$;

revoke all on function public.transition_demo_mailroom_item(uuid, text, text) from public;
grant execute on function public.transition_demo_mailroom_item(uuid, text, text) to anon, authenticated;

commit;

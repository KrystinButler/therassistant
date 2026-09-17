create or replace function private.get_mailroom_assignees(p_tenant_id uuid)
returns table(user_id uuid, display_label text)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select
    tu.user_id,
    coalesce(
      nullif(trim(up.display_name), ''),
      nullif(trim(concat_ws(' ', up.first_name, up.last_name)), ''),
      'Assigned User'
    ) as display_label
  from public.tenant_users tu
  left join public.user_profiles up on up.id = tu.user_id
  where tu.tenant_id = p_tenant_id
    and tu.status = 'active'::public.user_status_enum
    and private.has_tenant_read_access(p_tenant_id)
  order by display_label, tu.user_id;
$$;

revoke all on function private.get_mailroom_assignees(uuid) from public;
grant execute on function private.get_mailroom_assignees(uuid) to authenticated;

create or replace function public.get_mailroom_assignees(p_tenant_id uuid)
returns table(user_id uuid, display_label text)
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select * from private.get_mailroom_assignees(p_tenant_id);
$$;

revoke all on function public.get_mailroom_assignees(uuid) from public;
grant execute on function public.get_mailroom_assignees(uuid) to authenticated;

create or replace function public.transition_mailroom_item(
  p_mailroom_item_id uuid,
  p_action text,
  p_reason text default null
)
returns public.mailroom_items
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_item public.mailroom_items%rowtype;
  v_old_status text;
  v_new_status text;
  v_work public.workqueue_items%rowtype;
  v_priority public.workqueue_priority_enum;
  v_now timestamptz := now();
begin
  select * into v_item
  from public.mailroom_items
  where id = p_mailroom_item_id
  for update;

  if not found then
    raise exception 'Mailroom item not found.' using errcode = 'P0002';
  end if;

  if not private.has_tenant_write_access(v_item.tenant_id) then
    raise exception 'You do not have write access to this organization.' using errcode = '42501';
  end if;

  v_old_status := v_item.status;
  case p_action
    when 'review' then
      if v_old_status <> 'new' then raise exception 'Review is only allowed from new.' using errcode = '22023'; end if;
      v_new_status := 'reviewed';
    when 'require_action' then
      if v_old_status not in ('new', 'reviewed') then raise exception 'Action Required is only allowed from new or reviewed.' using errcode = '22023'; end if;
      v_new_status := 'action_required';
    when 'start' then
      if v_old_status not in ('action_required', 'pending') then raise exception 'Start is only allowed from action required or pending.' using errcode = '22023'; end if;
      v_new_status := 'in_progress';
    when 'pend' then
      if v_old_status not in ('action_required', 'in_progress') then raise exception 'Pend is only allowed from action required or in progress.' using errcode = '22023'; end if;
      if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A pending reason is required.' using errcode = '22023'; end if;
      v_new_status := 'pending';
    when 'resolve' then
      if v_old_status not in ('action_required', 'in_progress', 'pending') then raise exception 'Resolve is only allowed from action required, in progress, or pending.' using errcode = '22023'; end if;
      v_new_status := 'resolved';
    when 'close' then
      if v_old_status not in ('new', 'reviewed', 'resolved') then raise exception 'Close is only allowed from new, reviewed, or resolved.' using errcode = '22023'; end if;
      if exists (
        select 1 from public.workqueue_items w
        where w.tenant_id = v_item.tenant_id
          and w.source_object_type::text = 'mailroom_item'
          and w.source_object_id = v_item.id
          and w.workqueue_type::text = 'correspondence'
          and w.workqueue_status::text not in ('completed', 'cancelled')
      ) then
        raise exception 'Correspondence cannot be closed while active follow-up work remains.' using errcode = '23514';
      end if;
      v_new_status := 'closed';
    when 'reopen' then
      if v_old_status not in ('resolved', 'closed') then raise exception 'Reopen is only allowed from resolved or closed.' using errcode = '22023'; end if;
      v_new_status := 'action_required';
    else
      raise exception 'Unsupported Mailroom action: %', p_action using errcode = '22023';
  end case;

  if v_item.due_date is null then
    v_priority := 'normal';
  elsif v_item.due_date < current_date then
    v_priority := 'urgent';
  elsif v_item.due_date <= current_date + 7 then
    v_priority := 'high';
  else
    v_priority := 'normal';
  end if;

  select * into v_work
  from public.workqueue_items w
  where w.tenant_id = v_item.tenant_id
    and w.source_object_type::text = 'mailroom_item'
    and w.source_object_id = v_item.id
    and w.workqueue_type::text = 'correspondence'
    and w.workqueue_status::text not in ('completed', 'cancelled')
  order by w.created_at desc
  limit 1
  for update;

  if p_action = 'require_action' then
    if v_work.id is null then
      insert into public.workqueue_items (
        tenant_id, workqueue_type, workqueue_status, priority,
        source_object_type, source_object_id, title, description,
        due_date, assigned_user_id, created_by
      ) values (
        v_item.tenant_id, 'correspondence', 'open', v_priority,
        'mailroom_item', v_item.id, v_item.subject,
        replace(v_item.correspondence_type, '_', ' ') || ' correspondence requires follow-up.',
        v_item.due_date, v_item.assigned_user_id, auth.uid()
      ) returning * into v_work;
    end if;
  elsif p_action = 'start' then
    if v_work.id is null then raise exception 'Active correspondence work item not found.' using errcode = 'P0002'; end if;
    update public.workqueue_items set workqueue_status = 'in_progress', updated_at = v_now where id = v_work.id returning * into v_work;
  elsif p_action = 'pend' then
    if v_work.id is null then raise exception 'Active correspondence work item not found.' using errcode = 'P0002'; end if;
    update public.workqueue_items set workqueue_status = 'pending', updated_at = v_now where id = v_work.id returning * into v_work;
  elsif p_action = 'resolve' then
    if v_work.id is null then raise exception 'Active correspondence work item not found.' using errcode = 'P0002'; end if;
    update public.workqueue_items set workqueue_status = 'completed', completed_at = v_now, completed_by = auth.uid(), updated_at = v_now where id = v_work.id returning * into v_work;
  elsif p_action = 'reopen' then
    if v_work.id is null then
      select * into v_work
      from public.workqueue_items w
      where w.tenant_id = v_item.tenant_id
        and w.source_object_type::text = 'mailroom_item'
        and w.source_object_id = v_item.id
        and w.workqueue_type::text = 'correspondence'
        and w.workqueue_status::text in ('completed', 'cancelled')
      order by w.updated_at desc, w.created_at desc
      limit 1
      for update;
      if v_work.id is not null then
        update public.workqueue_items
        set workqueue_status = 'reopened', due_date = v_item.due_date,
            assigned_user_id = v_item.assigned_user_id, completed_at = null,
            completed_by = null, updated_at = v_now
        where id = v_work.id returning * into v_work;
      else
        insert into public.workqueue_items (
          tenant_id, workqueue_type, workqueue_status, priority,
          source_object_type, source_object_id, title, description,
          due_date, assigned_user_id, created_by
        ) values (
          v_item.tenant_id, 'correspondence', 'open', v_priority,
          'mailroom_item', v_item.id, v_item.subject,
          replace(v_item.correspondence_type, '_', ' ') || ' correspondence requires follow-up.',
          v_item.due_date, v_item.assigned_user_id, auth.uid()
        ) returning * into v_work;
      end if;
    end if;
  end if;

  update public.mailroom_items
  set status = v_new_status,
      reviewed_at = case when p_action = 'review' then coalesce(reviewed_at, v_now) else reviewed_at end,
      closed_at = case when p_action = 'close' then v_now when p_action = 'reopen' then null else closed_at end,
      updated_at = v_now
  where id = v_item.id
  returning * into v_item;

  insert into public.status_history (
    tenant_id, target_type, target_id, old_status, new_status, changed_by, reason
  ) values (
    v_item.tenant_id, 'mailroom_item', v_item.id, v_old_status, v_new_status,
    auth.uid(), nullif(trim(coalesce(p_reason, '')), '')
  );

  return v_item;
end;
$$;

revoke all on function public.transition_mailroom_item(uuid, text, text) from public;
grant execute on function public.transition_mailroom_item(uuid, text, text) to authenticated;

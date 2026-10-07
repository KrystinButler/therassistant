-- Synthetic message collision regression; isolated CI only, rolled back.
begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='jordan.ellis@example.test'), true);
set local role authenticated;
do $$
declare first_thread jsonb; second_thread jsonb;
begin
  first_thread := public.portal_send_message(null,'Synthetic first topic','First synthetic message');
  second_thread := public.portal_send_message(null,'Synthetic second topic','Second synthetic message');
  if first_thread->>'thread_id' = second_thread->>'thread_id' then raise exception 'New topics reused the same thread'; end if;
  perform public.portal_send_message((first_thread->>'thread_id')::uuid,null,'Follow-up synthetic message');
end;
$$;
reset role;
do $$
declare v_patient uuid; v_work uuid;
begin
  select client_id into v_patient from public.client_portal_access where user_id=(select id from auth.users where email='jordan.ellis@example.test');
  if (select count(*) from public.portal_message_threads where client_id=v_patient and subject like 'Synthetic % topic') <> 2 then raise exception 'Messages were not retained'; end if;
  if (select count(distinct workqueue_item_id) from public.portal_message_threads where client_id=v_patient and subject like 'Synthetic % topic') <> 1 then raise exception 'Topics must share the unique patient correspondence task'; end if;
  select workqueue_item_id into v_work from public.portal_message_threads where client_id=v_patient and subject='Synthetic first topic';
  if not exists(select 1 from public.workqueue_items where id=v_work and workqueue_status not in ('completed','cancelled')) then raise exception 'Message task missing'; end if;
end;
$$;
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email='staff.e2e@example.test'), true);
set local role authenticated;
do $$
begin
  if jsonb_array_length(public.get_portal_message_inbox('10000000-0000-4000-8000-000000000002'))=0 then raise exception 'Staff inbox missing portal conversations'; end if;
end;
$$;
rollback;

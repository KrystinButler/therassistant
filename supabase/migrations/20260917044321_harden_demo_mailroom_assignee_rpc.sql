create or replace function public.get_demo_mailroom_assignees()
returns table(user_id uuid, display_label text)
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select * from private.get_demo_mailroom_assignees();
$$;

revoke all on function public.get_demo_mailroom_assignees() from public;
grant execute on function public.get_demo_mailroom_assignees() to anon, authenticated;

drop view if exists public.demo_mailroom_assignees;
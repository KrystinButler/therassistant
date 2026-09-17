create or replace function private.get_demo_mailroom_assignees()
returns table(user_id uuid, display_label text)
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

revoke all on function private.get_demo_mailroom_assignees() from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.get_demo_mailroom_assignees() to anon, authenticated;

drop view if exists public.demo_mailroom_assignees;
create view public.demo_mailroom_assignees
with (security_invoker = true)
as
select * from private.get_demo_mailroom_assignees();

grant select on public.demo_mailroom_assignees to anon, authenticated;
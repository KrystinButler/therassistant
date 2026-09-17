create schema if not exists extensions;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'citext') then
    alter extension citext set schema extensions;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    alter extension pg_trgm set schema extensions;
  end if;
end $$;

create or replace function public.set_timestamps()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at = coalesce(new.created_at, now());
    new.updated_at = coalesce(new.updated_at, now());
  elsif tg_op = 'UPDATE' then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

create or replace function public.prevent_locked_note_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.locked_at is not null and new.note_text is distinct from old.note_text then
    raise exception 'Locked clinical notes cannot be edited. Create an amendment instead.';
  end if;
  return new;
end;
$$;

create policy "members can read billing company links"
on public.billing_company_practice_links
for select
to authenticated
using (
  public.is_tenant_member(billing_company_tenant_id)
  or public.is_tenant_member(practice_tenant_id)
);

revoke execute on function public.audit_row_change() from public, anon, authenticated;
revoke execute on function public.create_claim_status_history() from public, anon, authenticated;
revoke execute on function public.create_workqueue_history() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.lock_note_after_signature() from public, anon, authenticated;
revoke execute on function public.recalculate_balances_from_allocation() from public, anon, authenticated;
revoke execute on function public.recalculate_claim_balance_summary(uuid) from public, anon, authenticated;
revoke execute on function public.recalculate_client_balance_summary(uuid) from public, anon, authenticated;
revoke execute on function public.sync_charge_after_claim_created() from public, anon, authenticated;
revoke execute on function public.set_timestamps() from public, anon, authenticated;
revoke execute on function public.prevent_locked_note_update() from public, anon, authenticated;

revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from public;

grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.has_tenant_role(uuid, system_role_enum) to authenticated;

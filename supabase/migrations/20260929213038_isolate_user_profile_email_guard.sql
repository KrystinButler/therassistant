drop trigger if exists enforce_user_profile_auth_email on public.user_profiles;
drop function if exists public.enforce_user_profile_auth_email();

create or replace function private.enforce_user_profile_auth_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth_email text;
begin
  select u.email into v_auth_email
  from auth.users u
  where u.id = new.id;

  if not found then
    raise exception 'User profile must correspond to an Auth user';
  end if;

  if new.email::text is distinct from v_auth_email then
    raise exception 'Profile email is managed by the authenticated account';
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_user_profile_auth_email() from public, anon;
grant execute on function private.enforce_user_profile_auth_email() to authenticated, service_role, supabase_auth_admin;

create trigger enforce_user_profile_auth_email
before insert or update of email on public.user_profiles
for each row
execute function private.enforce_user_profile_auth_email();

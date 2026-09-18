begin;

create or replace function public.get_patient_portal_invite_context(p_client_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_client public.clients%rowtype;
  v_access public.client_portal_access%rowtype;
begin
  select * into v_client
  from public.clients
  where id = p_client_id;

  if not found or not private.has_tenant_write_access(v_client.tenant_id) then
    raise exception 'Patient is unavailable for portal enrollment';
  end if;

  select * into v_access
  from public.client_portal_access
  where client_id = v_client.id
  order by
    case when status = 'revoked' then 1 else 0 end,
    created_at desc
  limit 1;

  return jsonb_build_object(
    'tenant_id', v_client.tenant_id,
    'client_id', v_client.id,
    'email', lower(trim(coalesce(v_client.email::text, ''))),
    'first_name', v_client.first_name,
    'last_name', v_client.last_name,
    'access_id', v_access.id,
    'access_status', v_access.status,
    'access_user_id', v_access.user_id,
    'access_invited_email', v_access.invited_email,
    'access_invited_at', v_access.invited_at
  );
end;
$$;

revoke all on function public.get_patient_portal_invite_context(uuid) from public, anon;
grant execute on function public.get_patient_portal_invite_context(uuid) to authenticated;

commit;

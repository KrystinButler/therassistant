create or replace function public.record_network_participation_verification(
  p_tenant_id uuid,
  p_enrollment_id uuid,
  p_verification_method text,
  p_result public.network_participation_status_enum,
  p_directory_status public.directory_status_enum default 'unknown',
  p_reference_number text default null,
  p_representative_name text default null,
  p_source_url text default null,
  p_notes text default null,
  p_next_verification_due_date date default null,
  p_verified_at timestamptz default now()
)
returns table(participation_id uuid, verification_id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_participation_id uuid;
  v_verification_id uuid;
begin
  if auth.uid() is null or not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'Tenant write access required'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_verification_method), '') is null then
    raise exception 'Verification method is required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.provider_payer_enrollments e
    where e.id = p_enrollment_id
      and e.tenant_id = p_tenant_id
  ) then
    raise exception 'Enrollment not found for tenant'
      using errcode = '22023';
  end if;

  insert into public.provider_network_participation (
    tenant_id,
    enrollment_id,
    participation_status,
    directory_status,
    next_verification_due_date
  )
  values (
    p_tenant_id,
    p_enrollment_id,
    p_result,
    p_directory_status,
    p_next_verification_due_date
  )
  on conflict (enrollment_id) do update
  set
    participation_status = excluded.participation_status,
    directory_status = excluded.directory_status,
    next_verification_due_date = excluded.next_verification_due_date,
    updated_at = now()
  where public.provider_network_participation.tenant_id = p_tenant_id
  returning id into v_participation_id;

  if v_participation_id is null then
    raise exception 'Unable to resolve network participation for enrollment'
      using errcode = 'P0001';
  end if;

  insert into public.participation_verifications (
    tenant_id,
    participation_id,
    verified_at,
    verification_method,
    result,
    reference_number,
    representative_name,
    source_url,
    notes,
    verified_by
  )
  values (
    p_tenant_id,
    v_participation_id,
    coalesce(p_verified_at, now()),
    btrim(p_verification_method),
    p_result,
    nullif(btrim(p_reference_number), ''),
    nullif(btrim(p_representative_name), ''),
    nullif(btrim(p_source_url), ''),
    nullif(btrim(p_notes), ''),
    auth.uid()
  )
  returning id into v_verification_id;

  return query
  select v_participation_id, v_verification_id;
end;
$function$;

revoke all on function public.record_network_participation_verification(
  uuid, uuid, text, public.network_participation_status_enum,
  public.directory_status_enum, text, text, text, text, date, timestamptz
) from public, anon;

grant execute on function public.record_network_participation_verification(
  uuid, uuid, text, public.network_participation_status_enum,
  public.directory_status_enum, text, text, text, text, date, timestamptz
) to authenticated, service_role;

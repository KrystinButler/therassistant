create or replace function public.sign_encounter_note(
  p_encounter_id uuid,
  p_note_id uuid,
  p_provider_id uuid,
  p_signature_text text
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_note public.clinical_notes%rowtype;
  v_encounter public.encounters%rowtype;
  v_signed_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  -- Serialize note retries before the existing signature trigger locks the encounter.
  select * into v_note
  from public.clinical_notes
  where id=p_note_id and encounter_id=p_encounter_id
  for update;

  if not found then
    raise exception 'Clinical note not found';
  end if;

  perform public.assert_tenant_access(v_note.tenant_id);

  if not exists (
    select 1
    from public.tenant_user_roles
    where tenant_id=v_note.tenant_id
      and user_id=auth.uid()
      and role='clinician'
  ) then
    raise exception 'A linked clinician account is required to sign this note' using errcode='42501';
  end if;

  -- The database is the authoritative signing boundary. If this clinician has
  -- not yet established the provider link, create it here using the hardened
  -- identity checks (tenant access, Clinician role, provider ownership and
  -- matching login/provider email) rather than depending on a prior browser RPC.
  if not exists (
    select 1
    from public.provider_user_links
    where tenant_id=v_note.tenant_id
      and user_id=auth.uid()
      and provider_id=v_note.provider_id
      and status='active'
  ) then
    perform public.link_current_user_to_provider(v_note.provider_id);
  end if;

  if not exists (
    select 1
    from public.provider_user_links
    where tenant_id=v_note.tenant_id
      and user_id=auth.uid()
      and provider_id=v_note.provider_id
      and status='active'
  ) then
    raise exception 'A linked clinician account is required to sign this note' using errcode='42501';
  end if;

  select * into v_encounter
  from public.encounters
  where id=p_encounter_id and tenant_id=v_note.tenant_id
  for update;

  if not found
    or v_note.provider_id is distinct from p_provider_id
    or v_encounter.provider_id is distinct from v_note.provider_id
    or v_encounter.client_id is distinct from v_note.client_id
    or v_encounter.encounter_status='voided' then
    raise exception 'Clinical note does not match the signing provider and encounter';
  end if;

  if nullif(trim(v_note.note_text),'') is null
    or nullif(trim(p_signature_text),'') is null then
    raise exception 'Clinical documentation and signature text are required';
  end if;

  if v_note.service_date > (
    now() at time zone (
      select timezone from public.tenants where id=v_note.tenant_id
    )
  )::date then
    raise exception 'Future-dated clinical notes cannot be signed';
  end if;

  if v_note.note_status in ('signed','locked') then
    select signed_at into v_signed_at
    from public.clinical_note_signatures
    where tenant_id=v_note.tenant_id and clinical_note_id=v_note.id
    order by signed_at,id
    limit 1;

    if v_signed_at is null then
      raise exception 'Signed note has no signature; review its audit history';
    end if;

    perform private.ensure_clinical_billing_handoff(v_note.id);
  else
    if v_note.note_status not in ('draft','in_progress','ready_for_signature') then
      raise exception 'Clinical note cannot be signed from its current status';
    end if;

    if not exists (
      select 1
      from public.encounter_diagnoses
      where tenant_id=v_note.tenant_id
        and encounter_id=p_encounter_id
        and nullif(trim(diagnosis_code),'') is not null
    )
      or not exists (
        select 1
        from public.encounter_service_lines
        where tenant_id=v_note.tenant_id
          and encounter_id=p_encounter_id
      )
      or exists (
        select 1
        from public.encounter_service_lines
        where tenant_id=v_note.tenant_id
          and encounter_id=p_encounter_id
          and nullif(trim(cpt_hcpcs_code),'') is null
      ) then
      raise exception 'Add the visit diagnosis and procedure code before signing' using errcode='22023';
    end if;

    insert into public.clinical_note_signatures(
      tenant_id,
      clinical_note_id,
      signer_id,
      provider_id,
      signature_text
    ) values (
      v_note.tenant_id,
      v_note.id,
      auth.uid(),
      v_note.provider_id,
      trim(p_signature_text)
    )
    returning signed_at into v_signed_at;

    -- Explicit as well as trigger-backed: no browser PATCH can be lost.
    update public.clinical_notes
    set note_status='signed',
        locked_at=coalesce(locked_at,v_signed_at),
        updated_at=now()
    where id=v_note.id and tenant_id=v_note.tenant_id;
  end if;

  return jsonb_build_object('note_id',v_note.id,'signed_at',v_signed_at);
end;
$function$;

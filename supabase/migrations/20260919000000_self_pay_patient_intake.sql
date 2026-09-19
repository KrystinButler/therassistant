begin;

create or replace function public.create_patient_intake(
  p_tenant_id uuid,
  p_patient jsonb,
  p_emergency_contact jsonb,
  p_primary_insurance jsonb,
  p_secondary_insurance jsonb default null::jsonb,
  p_portal_enrolled boolean default false
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_client_id uuid;
  v_contact_name text;
  v_contact_phone text;
  v_contact_relationship text;
  v_primary_payer_id uuid;
  v_secondary_payer_id uuid;
  v_billing_type text;
begin
  perform public.assert_tenant_access(p_tenant_id);

  if p_patient is null then
    raise exception 'Patient details are required';
  end if;
  if nullif(btrim(p_patient ->> 'first_name'), '') is null then
    raise exception 'Patient first name is required';
  end if;
  if nullif(btrim(p_patient ->> 'last_name'), '') is null then
    raise exception 'Patient last name is required';
  end if;
  if nullif(p_patient ->> 'date_of_birth', '') is null then
    raise exception 'Patient date of birth is required';
  end if;
  if coalesce(p_patient ->> 'sex', '') not in ('M', 'F') then
    raise exception 'Patient sex must be M or F';
  end if;
  if nullif(btrim(p_patient ->> 'address_line1'), '') is null then
    raise exception 'Patient address is required';
  end if;
  if nullif(btrim(p_patient ->> 'phone'), '') is null then
    raise exception 'Patient phone is required';
  end if;
  if nullif(btrim(p_patient ->> 'email'), '') is null then
    raise exception 'Patient email is required';
  end if;

  v_billing_type := coalesce(nullif(btrim(p_patient ->> 'billing_type'), ''), 'insurance');
  if v_billing_type not in ('insurance', 'self_pay') then
    raise exception 'Billing type must be insurance or self_pay';
  end if;

  if v_billing_type = 'insurance' then
    if p_primary_insurance is null then
      raise exception 'Primary insurance is required';
    end if;
    if nullif(p_primary_insurance ->> 'payer_id', '') is null then
      raise exception 'Primary insurance company is required';
    end if;
    if nullif(btrim(p_primary_insurance ->> 'member_id'), '') is null then
      raise exception 'Primary insurance ID is required';
    end if;
    if nullif(btrim(p_primary_insurance ->> 'relationship_to_subscriber'), '') is null then
      raise exception 'Primary relationship to subscriber is required';
    end if;
  end if;

  v_contact_name := nullif(btrim(coalesce(p_emergency_contact ->> 'contact_name', '')), '');
  v_contact_phone := nullif(btrim(coalesce(p_emergency_contact ->> 'phone', '')), '');
  v_contact_relationship := nullif(btrim(coalesce(p_emergency_contact ->> 'relationship', '')), '');
  if v_contact_name is null and (v_contact_phone is not null or v_contact_relationship is not null) then
    raise exception 'Emergency contact name is required when phone or relationship is entered';
  end if;

  if v_billing_type = 'insurance' and p_secondary_insurance is not null then
    if nullif(p_secondary_insurance ->> 'payer_id', '') is null then
      raise exception 'Secondary insurance company is required when secondary insurance is entered';
    end if;
    if nullif(btrim(p_secondary_insurance ->> 'member_id'), '') is null then
      raise exception 'Secondary insurance ID is required when secondary insurance is entered';
    end if;
  end if;

  insert into public.clients (
    tenant_id,
    first_name,
    last_name,
    preferred_name,
    date_of_birth,
    email,
    phone,
    address_line1,
    client_status,
    registration_status,
    billing_readiness_status,
    metadata
  ) values (
    p_tenant_id,
    btrim(p_patient ->> 'first_name'),
    btrim(p_patient ->> 'last_name'),
    nullif(btrim(coalesce(p_patient ->> 'preferred_name', '')), ''),
    (p_patient ->> 'date_of_birth')::date,
    btrim(p_patient ->> 'email'),
    btrim(p_patient ->> 'phone'),
    btrim(p_patient ->> 'address_line1'),
    coalesce(nullif(p_patient ->> 'client_status', ''), 'active')::public.client_status_enum,
    coalesce(nullif(p_patient ->> 'registration_status', ''), 'complete')::public.registration_status_enum,
    'not_ready'::public.billing_readiness_status_enum,
    jsonb_build_object(
      'sex', p_patient ->> 'sex',
      'billing_type', v_billing_type,
      'portal_enrolled', coalesce(p_portal_enrolled, false),
      'portal_enrolled_at', case
        when coalesce(p_portal_enrolled, false) then to_jsonb(now())
        else 'null'::jsonb
      end
    )
  )
  returning id into v_client_id;

  if v_contact_name is not null then
    insert into public.client_contacts (
      tenant_id,
      client_id,
      contact_name,
      relationship,
      phone,
      is_emergency_contact,
      is_responsible_party
    ) values (
      p_tenant_id,
      v_client_id,
      v_contact_name,
      v_contact_relationship,
      v_contact_phone,
      true,
      false
    );
  end if;

  if v_billing_type = 'insurance' then
    v_primary_payer_id := (p_primary_insurance ->> 'payer_id')::uuid;
    insert into public.client_insurance_policies (
      tenant_id,
      client_id,
      payer_id,
      payer_plan_id,
      insurance_order,
      status,
      member_id,
      group_number,
      subscriber_name,
      subscriber_dob,
      relationship_to_subscriber,
      metadata
    ) values (
      p_tenant_id,
      v_client_id,
      v_primary_payer_id,
      nullif(p_primary_insurance ->> 'payer_plan_id', '')::uuid,
      'primary'::public.insurance_order_enum,
      'pending_verification'::public.insurance_policy_status_enum,
      btrim(p_primary_insurance ->> 'member_id'),
      nullif(btrim(coalesce(p_primary_insurance ->> 'group_number', '')), ''),
      nullif(btrim(coalesce(p_primary_insurance ->> 'subscriber_name', '')), ''),
      nullif(p_primary_insurance ->> 'subscriber_dob', '')::date,
      btrim(p_primary_insurance ->> 'relationship_to_subscriber'),
      coalesce(p_primary_insurance -> 'metadata', '{}'::jsonb)
    );

    if p_secondary_insurance is not null then
      v_secondary_payer_id := (p_secondary_insurance ->> 'payer_id')::uuid;
      insert into public.client_insurance_policies (
        tenant_id,
        client_id,
        payer_id,
        payer_plan_id,
        insurance_order,
        status,
        member_id,
        group_number,
        subscriber_name,
        subscriber_dob,
        relationship_to_subscriber,
        metadata
      ) values (
        p_tenant_id,
        v_client_id,
        v_secondary_payer_id,
        nullif(p_secondary_insurance ->> 'payer_plan_id', '')::uuid,
        'secondary'::public.insurance_order_enum,
        'pending_verification'::public.insurance_policy_status_enum,
        btrim(p_secondary_insurance ->> 'member_id'),
        nullif(btrim(coalesce(p_secondary_insurance ->> 'group_number', '')), ''),
        nullif(btrim(coalesce(p_secondary_insurance ->> 'subscriber_name', '')), ''),
        nullif(p_secondary_insurance ->> 'subscriber_dob', '')::date,
        nullif(btrim(coalesce(p_secondary_insurance ->> 'relationship_to_subscriber', '')), ''),
        coalesce(p_secondary_insurance -> 'metadata', '{}'::jsonb)
      );
    end if;
  end if;

  return jsonb_build_object('id', v_client_id);
end;
$function$;

commit;

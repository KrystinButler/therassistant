drop index if exists public.encounters_appointment_idx;
drop index if exists public.idx_fee_schedule_lines_lookup;

drop type if exists public.credentialing_issue_severity_enum;
drop type if exists public.credentialing_issue_status_enum;

create or replace function private.credentialing_scope_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_entity uuid;
  v_payer uuid;
begin
  case tg_table_name
    when 'practice_locations' then
      select pe.tenant_id into v_tenant
      from public.practice_entities pe
      where pe.id = new.practice_entity_id;
      if v_tenant is null or v_tenant <> new.tenant_id then
        raise exception 'practice_location practice_entity tenant mismatch';
      end if;

    when 'provider_locations' then
      select p.tenant_id into v_tenant from public.providers p where p.id = new.provider_id;
      if v_tenant is null or v_tenant <> new.tenant_id then
        raise exception 'provider_location provider tenant mismatch';
      end if;
      select pl.tenant_id into v_tenant from public.practice_locations pl where pl.id = new.practice_location_id;
      if v_tenant is null or v_tenant <> new.tenant_id then
        raise exception 'provider_location practice_location tenant mismatch';
      end if;

    when 'provider_credentials' then
      select p.tenant_id into v_tenant from public.providers p where p.id = new.provider_id;
      if v_tenant is null or v_tenant <> new.tenant_id then
        raise exception 'provider_credential provider tenant mismatch';
      end if;

    when 'payer_contracts' then
      if new.practice_entity_id is not null then
        select pe.tenant_id into v_tenant from public.practice_entities pe where pe.id = new.practice_entity_id;
        if v_tenant is null or v_tenant <> new.tenant_id then
          raise exception 'payer_contract practice_entity tenant mismatch';
        end if;
      end if;

    when 'payer_contract_plans' then
      select pc.tenant_id, pc.payer_id into v_tenant, v_payer
      from public.payer_contracts pc where pc.id = new.payer_contract_id;
      if v_tenant is null or v_tenant <> new.tenant_id then
        raise exception 'payer_contract_plan contract tenant mismatch';
      end if;
      if not exists (
        select 1 from public.payer_plans pp
        where pp.id = new.payer_plan_id and pp.payer_id = v_payer
      ) then
        raise exception 'payer_contract_plan payer mismatch';
      end if;

    when 'provider_payer_enrollments' then
      select p.tenant_id into v_tenant from public.providers p where p.id = new.provider_id;
      if v_tenant is null or v_tenant <> new.tenant_id then
        raise exception 'provider enrollment provider tenant mismatch';
      end if;

      if new.payer_plan_id is not null then
        if new.payer_id is null or not exists (
          select 1 from public.payer_plans pp
          where pp.id = new.payer_plan_id and pp.payer_id = new.payer_id
        ) then
          raise exception 'provider enrollment payer plan mismatch';
        end if;
      end if;

      if new.practice_entity_id is not null then
        select pe.tenant_id into v_tenant from public.practice_entities pe where pe.id = new.practice_entity_id;
        if v_tenant is null or v_tenant <> new.tenant_id then
          raise exception 'provider enrollment practice_entity tenant mismatch';
        end if;
      end if;

      if new.practice_location_id is not null then
        if new.practice_entity_id is null then
          raise exception 'provider enrollment location requires practice_entity';
        end if;
        select pl.tenant_id, pl.practice_entity_id into v_tenant, v_entity
        from public.practice_locations pl where pl.id = new.practice_location_id;
        if v_tenant is null or v_tenant <> new.tenant_id then
          raise exception 'provider enrollment location tenant mismatch';
        end if;
        if v_entity <> new.practice_entity_id then
          raise exception 'provider enrollment location/entity mismatch';
        end if;
      end if;

      if new.payer_contract_id is not null then
        if new.payer_id is null or new.practice_entity_id is null then
          raise exception 'provider enrollment contract requires payer and practice_entity';
        end if;
        if not exists (
          select 1 from public.payer_contracts pc
          where pc.id = new.payer_contract_id
            and pc.tenant_id = new.tenant_id
            and pc.payer_id = new.payer_id
            and pc.practice_entity_id = new.practice_entity_id
        ) then
          raise exception 'provider enrollment contract scope mismatch';
        end if;
      end if;

    when 'credentialing_applications' then
      select e.tenant_id into v_tenant from public.provider_payer_enrollments e where e.id = new.enrollment_id;
      if v_tenant is null or v_tenant <> new.tenant_id then
        raise exception 'credentialing application enrollment tenant mismatch';
      end if;

    when 'credentialing_application_events' then
      select a.tenant_id into v_tenant from public.credentialing_applications a where a.id = new.application_id;
      if v_tenant is null or v_tenant <> new.tenant_id then
        raise exception 'credentialing event application tenant mismatch';
      end if;

    when 'credentialing_requirements' then
      select a.tenant_id into v_tenant from public.credentialing_applications a where a.id = new.application_id;
      if v_tenant is null or v_tenant <> new.tenant_id then
        raise exception 'credentialing requirement application tenant mismatch';
      end if;

    when 'credentialing_followups' then
      select a.tenant_id into v_tenant from public.credentialing_applications a where a.id = new.application_id;
      if v_tenant is null or v_tenant <> new.tenant_id then
        raise exception 'credentialing followup application tenant mismatch';
      end if;

    when 'provider_network_participation' then
      select e.tenant_id into v_tenant from public.provider_payer_enrollments e where e.id = new.enrollment_id;
      if v_tenant is null or v_tenant <> new.tenant_id then
        raise exception 'network participation enrollment tenant mismatch';
      end if;

    when 'participation_verifications' then
      select pnp.tenant_id into v_tenant from public.provider_network_participation pnp where pnp.id = new.participation_id;
      if v_tenant is null or v_tenant <> new.tenant_id then
        raise exception 'participation verification tenant mismatch';
      end if;

    when 'roster_actions' then
      if new.enrollment_id is not null then
        select e.tenant_id into v_tenant from public.provider_payer_enrollments e where e.id = new.enrollment_id;
        if v_tenant is null or v_tenant <> new.tenant_id then
          raise exception 'roster action enrollment tenant mismatch';
        end if;
      end if;
      if new.participation_id is not null then
        select pnp.tenant_id into v_tenant from public.provider_network_participation pnp where pnp.id = new.participation_id;
        if v_tenant is null or v_tenant <> new.tenant_id then
          raise exception 'roster action participation tenant mismatch';
        end if;
        if new.enrollment_id is not null and not exists (
          select 1 from public.provider_network_participation pnp
          where pnp.id = new.participation_id and pnp.enrollment_id = new.enrollment_id
        ) then
          raise exception 'roster action participation/enrollment mismatch';
        end if;
      end if;

    when 'credentialing_document_links' then
      select d.tenant_id into v_tenant from public.documents d where d.id = new.document_id;
      if v_tenant is null or v_tenant <> new.tenant_id then
        raise exception 'credentialing document tenant mismatch';
      end if;
      if new.provider_id is not null and not exists (select 1 from public.providers p where p.id = new.provider_id and p.tenant_id = new.tenant_id) then
        raise exception 'credentialing document provider tenant mismatch';
      end if;
      if new.provider_credential_id is not null and not exists (select 1 from public.provider_credentials pc where pc.id = new.provider_credential_id and pc.tenant_id = new.tenant_id) then
        raise exception 'credentialing document provider_credential tenant mismatch';
      end if;
      if new.enrollment_id is not null and not exists (select 1 from public.provider_payer_enrollments e where e.id = new.enrollment_id and e.tenant_id = new.tenant_id) then
        raise exception 'credentialing document enrollment tenant mismatch';
      end if;
      if new.application_id is not null and not exists (select 1 from public.credentialing_applications a where a.id = new.application_id and a.tenant_id = new.tenant_id) then
        raise exception 'credentialing document application tenant mismatch';
      end if;
      if new.participation_id is not null and not exists (select 1 from public.provider_network_participation pnp where pnp.id = new.participation_id and pnp.tenant_id = new.tenant_id) then
        raise exception 'credentialing document participation tenant mismatch';
      end if;
      if new.payer_contract_id is not null and not exists (select 1 from public.payer_contracts pc where pc.id = new.payer_contract_id and pc.tenant_id = new.tenant_id) then
        raise exception 'credentialing document payer_contract tenant mismatch';
      end if;
      if new.verification_id is not null and not exists (select 1 from public.participation_verifications pv where pv.id = new.verification_id and pv.tenant_id = new.tenant_id) then
        raise exception 'credentialing document verification tenant mismatch';
      end if;
  end case;

  return new;
end;
$$;

revoke all on function private.credentialing_scope_guard() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'practice_locations','provider_locations','provider_credentials','payer_contracts','payer_contract_plans',
    'provider_payer_enrollments','credentialing_applications','credentialing_application_events',
    'credentialing_requirements','credentialing_followups','provider_network_participation',
    'participation_verifications','roster_actions','credentialing_document_links'
  ]
  loop
    execute format('drop trigger if exists credentialing_scope_guard on public.%I', t);
    execute format('create trigger credentialing_scope_guard before insert or update on public.%I for each row execute function private.credentialing_scope_guard()', t);
  end loop;
end $$;

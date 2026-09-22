create or replace function public.enforce_patient_creation_prerequisites()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if not exists (
    select 1
    from public.practice_entities pe
    where pe.tenant_id = new.tenant_id
      and pe.status = 'active'
  ) then
    raise exception 'Patient creation requires an active practice entity';
  end if;

  if not exists (
    select 1
    from public.providers p
    where p.tenant_id = new.tenant_id
      and p.provider_status = 'active'
  ) then
    raise exception 'Patient creation requires an active provider';
  end if;

  if not exists (
    select 1
    from public.practice_locations pl
    join public.practice_entities pe
      on pe.id = pl.practice_entity_id
     and pe.tenant_id = pl.tenant_id
    where pl.tenant_id = new.tenant_id
      and pl.status = 'active'
      and pe.status = 'active'
  ) then
    raise exception 'Patient creation requires an active practice location linked to an active practice entity';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_clients_patient_creation_prerequisites on public.clients;

create trigger trg_clients_patient_creation_prerequisites
before insert on public.clients
for each row
execute function public.enforce_patient_creation_prerequisites();

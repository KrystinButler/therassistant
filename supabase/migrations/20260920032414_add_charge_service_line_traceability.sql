alter table public.charge_capture_items
  add column if not exists service_line_id uuid,
  add column if not exists units numeric not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'charge_capture_items_service_line_id_fkey'
      and conrelid = 'public.charge_capture_items'::regclass
  ) then
    alter table public.charge_capture_items
      add constraint charge_capture_items_service_line_id_fkey
      foreign key (service_line_id)
      references public.encounter_service_lines(id)
      on delete set null;
  end if;
end
$$;

with unique_matches as (
  select c.id as charge_id, sl.id as service_line_id, sl.units
  from public.charge_capture_items c
  join public.encounter_service_lines sl
    on sl.tenant_id = c.tenant_id
   and sl.encounter_id = c.encounter_id
   and sl.cpt_hcpcs_code = c.cpt_code
  where c.service_line_id is null
    and c.encounter_id is not null
    and (
      select count(*)
      from public.encounter_service_lines sl2
      where sl2.tenant_id = c.tenant_id
        and sl2.encounter_id = c.encounter_id
        and sl2.cpt_hcpcs_code = c.cpt_code
    ) = 1
)
update public.charge_capture_items c
set service_line_id = m.service_line_id,
    units = m.units,
    updated_at = now()
from unique_matches m
where c.id = m.charge_id;

create unique index if not exists uq_charge_capture_active_service_line
  on public.charge_capture_items (tenant_id, service_line_id)
  where service_line_id is not null
    and charge_status <> 'voided'::public.charge_status_enum;

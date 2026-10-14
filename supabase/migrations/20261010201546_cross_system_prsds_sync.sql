create or replace function private.sync_previsit_prsds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score_text text;
  v_score integer;
  v_appt public.appointments%rowtype;
  v_timezone text;
  v_assessed_on date;
begin
  if new.appointment_id is null then return new; end if;
  if nullif(new.responses #>> '{pre_visit,submitted_at}', '') is null then return new; end if;
  v_score_text := nullif(btrim(new.responses #>> '{pre_visit,visit_questions,somatic_distress_score}'), '');
  if v_score_text is null or v_score_text !~ '^[0-9]{1,2}$' then return new; end if;
  v_score := v_score_text::integer;
  if v_score < 1 or v_score > 10 then return new; end if;

  select * into v_appt from public.appointments where id = new.appointment_id;
  if not found then return new; end if;
  select timezone into v_timezone from public.tenants where id = new.tenant_id;
  v_assessed_on := (v_appt.starts_at at time zone coalesce(nullif(v_timezone,''),'America/Denver'))::date;

  insert into public.clinical_outcome_measures(
    tenant_id,client_id,provider_id,encounter_id,instrument,score,assessed_on,source,notes,source_reference_id
  ) values (
    new.tenant_id,new.client_id,v_appt.provider_id,null,'PRSDS',v_score,v_assessed_on,'patient_reported',
    'Pre-visit patient-reported somatic distress score',new.appointment_id
  )
  on conflict (tenant_id,instrument,source_reference_id) where source_reference_id is not null
  do update set
    score=excluded.score,
    assessed_on=excluded.assessed_on,
    provider_id=excluded.provider_id,
    source=excluded.source,
    notes=excluded.notes,
    updated_at=now();
  return new;
end;
$$;
revoke all on function private.sync_previsit_prsds() from public, anon;
drop trigger if exists sync_previsit_prsds on public.client_checkins;
create trigger sync_previsit_prsds after insert or update of responses on public.client_checkins for each row execute function private.sync_previsit_prsds();

insert into public.clinical_outcome_measures(
  tenant_id,client_id,provider_id,encounter_id,instrument,score,assessed_on,source,notes,source_reference_id
)
select
  ci.tenant_id,ci.client_id,a.provider_id,null,'PRSDS',
  (ci.responses #>> '{pre_visit,visit_questions,somatic_distress_score}')::integer,
  (a.starts_at at time zone coalesce(nullif(t.timezone,''),'America/Denver'))::date,
  'patient_reported','Pre-visit patient-reported somatic distress score',ci.appointment_id
from public.client_checkins ci
join public.appointments a on a.id=ci.appointment_id
join public.tenants t on t.id=ci.tenant_id
where nullif(ci.responses #>> '{pre_visit,submitted_at}','') is not null
  and (ci.responses #>> '{pre_visit,visit_questions,somatic_distress_score}') ~ '^[0-9]{1,2}$'
  and (ci.responses #>> '{pre_visit,visit_questions,somatic_distress_score}')::integer between 1 and 10
on conflict (tenant_id,instrument,source_reference_id) where source_reference_id is not null do nothing;
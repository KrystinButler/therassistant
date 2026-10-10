-- Cross-system clinical documentation engine configuration, PRSDS telemetry, and coding-decision audit.
alter table public.clinical_outcome_measures
  drop constraint if exists clinical_outcome_measures_instrument_check;
alter table public.clinical_outcome_measures
  drop constraint if exists outcome_score_in_range;
alter table public.clinical_outcome_measures
  add constraint clinical_outcome_measures_instrument_check
    check (instrument in ('PHQ-9','GAD-7','PRSDS'));
alter table public.clinical_outcome_measures
  add constraint outcome_score_in_range check(
    (instrument='PHQ-9' and score between 0 and 27) or
    (instrument='GAD-7' and score between 0 and 21) or
    (instrument='PRSDS' and score between 1 and 10)
  );

create table if not exists public.clinical_cross_mapping_config (
  config_version text primary key,
  module_name text not null,
  license_scope text not null,
  config jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clinical_cross_mapping_config enable row level security;
drop policy if exists clinical_cross_mapping_config_select on public.clinical_cross_mapping_config;
create policy clinical_cross_mapping_config_select on public.clinical_cross_mapping_config
  for select to authenticated using (true);
revoke all on public.clinical_cross_mapping_config from anon;
grant select on public.clinical_cross_mapping_config to authenticated;

insert into public.clinical_cross_mapping_config(config_version,module_name,license_scope,config)
values (
  '2026.10.10',
  'Somatic_MentalHealth_SUD_CrossMapping_Engine',
  'Outpatient_Psychotherapy_BehavioralHealth',
  $json$
  {
    "telemetry": {"instrument":"PRSDS","min":1,"max":10,"rolling_days":90,"paired_with":["PHQ-9","GAD-7"]},
    "rules": [
      {
        "id":"SOM-001","category":"Gastrointestinal Distress",
        "keywords":["ibs","irritable bowel","acid reflux","gerd","stomach pain","nausea","cramping"],
        "primary_mh":"F41.1","link_modifier":"F54","somatic_default":"K58.9","somatic_alternative":"R10.9",
        "dot_phrase":".somaticGI",
        "emergency_triggers":["bloody stool","persistent vomiting","unexplained severe weight loss"]
      },
      {
        "id":"SOM-002","category":"Chronic Pain / Musculoskeletal",
        "keywords":["fibromyalgia","chronic pain","low back pain","sciatica","arthritis","neck pain"],
        "primary_mh":"F33.1","link_modifier":"F54","somatic_default":"M79.7","somatic_alternative":"G89.29",
        "dot_phrase":".somaticPain",
        "emergency_triggers":["sudden loss of bowel control","saddle anesthesia","inability to walk"]
      },
      {
        "id":"SOM-003","category":"Cardiovascular Somatic Cues",
        "keywords":["hypertension","high blood pressure","tachycardia","heart racing","chest tightness","palpitations"],
        "primary_mh":"F41.0","link_modifier":"F54","somatic_default":"I10","somatic_alternative":"R00.0",
        "dot_phrase":".somaticCardio",
        "emergency_triggers":["chest pain radiating to arm","jaw pain","left-sided numbness","slurred speech"]
      },
      {
        "id":"SOM-004","category":"Chronic Substance-Induced Organ Damage",
        "keywords":["cirrhosis","liver failure","hepatitis c","hep c","kidney damage","endocarditis"],
        "primary_mh":"F10.20","link_modifier":"F54","somatic_default":"K74.60","somatic_alternative":"B19.20",
        "dot_phrase":".somaticSUD",
        "emergency_triggers":["jaundice","ascites fluid accumulation","hepatic encephalopathy confusion","vomiting blood"]
      }
    ],
    "combination_examples": [
      {"substance":"alcohol","feature":"delusions","code":"F10.150"},
      {"substance":"alcohol","feature":"hallucinations","code":"F10.151"},
      {"substance":"cannabis","feature":"delusions","code":"F12.150"},
      {"substance":"cocaine","feature":"delusions","code":"F14.150"},
      {"substance":"other_stimulant_amphetamine","feature":"delusions","code":"F15.150"}
    ],
    "scope_disclaimer_required": true
  }
  $json$::jsonb
)
on conflict (config_version) do update set
  module_name=excluded.module_name,
  license_scope=excluded.license_scope,
  config=excluded.config,
  updated_at=now();

create table if not exists public.clinical_cross_mapping_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  encounter_id uuid not null references public.encounters(id) on delete cascade,
  rule_id text not null,
  recommendation jsonb not null default '{}'::jsonb,
  action text not null check (action in ('accepted','rejected')),
  rejection_justification text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint cross_mapping_rejection_requires_reason check (
    action='accepted' or nullif(btrim(rejection_justification),'') is not null
  )
);

create index if not exists clinical_cross_mapping_decisions_encounter_idx
  on public.clinical_cross_mapping_decisions(tenant_id,encounter_id,created_at desc);
create index if not exists clinical_cross_mapping_decisions_encounter_fk_idx
  on public.clinical_cross_mapping_decisions(encounter_id);
create index if not exists clinical_cross_mapping_decisions_created_by_idx
  on public.clinical_cross_mapping_decisions(created_by);

alter table public.clinical_cross_mapping_decisions enable row level security;
drop policy if exists clinical_cross_mapping_decisions_select on public.clinical_cross_mapping_decisions;
create policy clinical_cross_mapping_decisions_select on public.clinical_cross_mapping_decisions
  for select to authenticated using (private.has_tenant_read_access(tenant_id));
drop policy if exists clinical_cross_mapping_decisions_insert on public.clinical_cross_mapping_decisions;
create policy clinical_cross_mapping_decisions_insert on public.clinical_cross_mapping_decisions
  for insert to authenticated with check (private.has_tenant_write_access(tenant_id));

revoke all on public.clinical_cross_mapping_decisions from anon;
grant select,insert on public.clinical_cross_mapping_decisions to authenticated;


-- Link patient-reported PRSDS telemetry to the originating pre-visit check-in.
alter table public.clinical_outcome_measures
  add column if not exists source_reference_id uuid;
create unique index if not exists clinical_outcome_measures_source_reference_idx
  on public.clinical_outcome_measures(tenant_id,instrument,source_reference_id)
  where source_reference_id is not null;

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
create trigger sync_previsit_prsds
after insert or update of responses on public.client_checkins
for each row execute function private.sync_previsit_prsds();

-- Backfill only already-submitted check-ins with valid 1-10 PRSDS values.
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


-- Explicit clinician decision paths for coding recommendations. These never run during clinical signing.
create or replace function public.apply_cross_system_diagnosis_sequence(
  p_encounter_id uuid,
  p_rule_id text,
  p_recommendation jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_encounter public.encounters%rowtype;
  v_item jsonb;
  v_code text;
  v_description text;
  v_sequence integer := 0;
begin
  select * into v_encounter from public.encounters where id=p_encounter_id;
  if not found or not private.has_tenant_write_access(v_encounter.tenant_id) then
    raise exception 'Encounter is unavailable';
  end if;
  if jsonb_typeof(p_recommendation) <> 'array' or jsonb_array_length(p_recommendation)=0 then
    raise exception 'Diagnosis recommendation is required';
  end if;
  if exists(select 1 from public.professional_claims where tenant_id=v_encounter.tenant_id and source_encounter_id=p_encounter_id) then
    raise exception 'An existing claim prevents diagnosis replacement here. Correct the claim workflow instead.';
  end if;

  -- Preserve prior diagnosis history but remove superseded rows from the active claim sequence.
  update public.encounter_diagnoses
  set present_on_claim=false, is_primary=false, updated_at=now()
  where tenant_id=v_encounter.tenant_id and encounter_id=p_encounter_id;

  for v_item in select value from jsonb_array_elements(p_recommendation) loop
    v_code := upper(btrim(v_item ->> 'code'));
    v_description := nullif(btrim(v_item ->> 'description'),'');
    if v_code is null or v_code !~ '^[A-Z0-9][A-Z0-9.]{1,15}$' then
      raise exception 'Invalid diagnosis code recommendation';
    end if;
    v_sequence := v_sequence + 1;
    insert into public.encounter_diagnoses(
      tenant_id,encounter_id,client_id,diagnosis_code,diagnosis_description,is_primary,sequence_number,present_on_claim
    ) values (
      v_encounter.tenant_id,p_encounter_id,v_encounter.client_id,v_code,v_description,v_sequence=1,v_sequence,true
    )
    on conflict (encounter_id,diagnosis_code) do update set
      diagnosis_description=excluded.diagnosis_description,
      is_primary=excluded.is_primary,
      sequence_number=excluded.sequence_number,
      present_on_claim=true,
      client_id=coalesce(public.encounter_diagnoses.client_id,excluded.client_id),
      updated_at=now();
  end loop;

  insert into public.clinical_cross_mapping_decisions(
    tenant_id,encounter_id,rule_id,recommendation,action,rejection_justification
  ) values (
    v_encounter.tenant_id,p_encounter_id,coalesce(nullif(btrim(p_rule_id),''),'cross-system'),p_recommendation,'accepted',null
  );

  return jsonb_build_object('applied',true,'encounter_id',p_encounter_id,'diagnosis_count',v_sequence);
end;
$$;

revoke all on function public.apply_cross_system_diagnosis_sequence(uuid,text,jsonb) from public, anon;
grant execute on function public.apply_cross_system_diagnosis_sequence(uuid,text,jsonb) to authenticated;

create or replace function public.record_cross_system_coding_rejection(
  p_encounter_id uuid,
  p_rule_id text,
  p_recommendation jsonb,
  p_justification text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_encounter public.encounters%rowtype;
  v_reason text := nullif(btrim(p_justification),'');
begin
  select * into v_encounter from public.encounters where id=p_encounter_id;
  if not found or not private.has_tenant_write_access(v_encounter.tenant_id) then
    raise exception 'Encounter is unavailable';
  end if;
  if v_reason is null then raise exception 'A justification is required to keep the current coding'; end if;
  if jsonb_typeof(p_recommendation) <> 'array' or jsonb_array_length(p_recommendation)=0 then
    raise exception 'Diagnosis recommendation is required';
  end if;
  insert into public.clinical_cross_mapping_decisions(
    tenant_id,encounter_id,rule_id,recommendation,action,rejection_justification
  ) values (
    v_encounter.tenant_id,p_encounter_id,coalesce(nullif(btrim(p_rule_id),''),'cross-system'),p_recommendation,'rejected',v_reason
  );
  return jsonb_build_object('recorded',true);
end;
$$;

revoke all on function public.record_cross_system_coding_rejection(uuid,text,jsonb,text) from public, anon;
grant execute on function public.record_cross_system_coding_rejection(uuid,text,jsonb,text) to authenticated;

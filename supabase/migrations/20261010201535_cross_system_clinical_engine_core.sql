alter table public.clinical_outcome_measures drop constraint if exists clinical_outcome_measures_instrument_check;
alter table public.clinical_outcome_measures drop constraint if exists outcome_score_in_range;
alter table public.clinical_outcome_measures add constraint clinical_outcome_measures_instrument_check check (instrument in ('PHQ-9','GAD-7','PRSDS'));
alter table public.clinical_outcome_measures add constraint outcome_score_in_range check ((instrument='PHQ-9' and score between 0 and 27) or (instrument='GAD-7' and score between 0 and 21) or (instrument='PRSDS' and score between 1 and 10));

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
create policy clinical_cross_mapping_config_select on public.clinical_cross_mapping_config for select to authenticated using (true);
revoke all on public.clinical_cross_mapping_config from anon;
grant select on public.clinical_cross_mapping_config to authenticated;

insert into public.clinical_cross_mapping_config(config_version,module_name,license_scope,config)
values ('2026.10.10','Somatic_MentalHealth_SUD_CrossMapping_Engine','Outpatient_Psychotherapy_BehavioralHealth',
'{"telemetry":{"instrument":"PRSDS","min":1,"max":10,"rolling_days":90,"paired_with":["PHQ-9","GAD-7"]},"rules":[{"id":"SOM-001","category":"Gastrointestinal Distress","keywords":["ibs","irritable bowel","acid reflux","gerd","stomach pain","nausea","cramping"],"primary_mh":"F41.1","link_modifier":"F54","somatic_default":"K58.9","somatic_alternative":"R10.9","dot_phrase":".somaticGI","emergency_triggers":["bloody stool","persistent vomiting","unexplained severe weight loss"]},{"id":"SOM-002","category":"Chronic Pain / Musculoskeletal","keywords":["fibromyalgia","chronic pain","low back pain","sciatica","arthritis","neck pain"],"primary_mh":"F33.1","link_modifier":"F54","somatic_default":"M79.7","somatic_alternative":"G89.29","dot_phrase":".somaticPain","emergency_triggers":["sudden loss of bowel control","saddle anesthesia","inability to walk"]},{"id":"SOM-003","category":"Cardiovascular Somatic Cues","keywords":["hypertension","high blood pressure","tachycardia","heart racing","chest tightness","palpitations"],"primary_mh":"F41.0","link_modifier":"F54","somatic_default":"I10","somatic_alternative":"R00.0","dot_phrase":".somaticCardio","emergency_triggers":["chest pain radiating to arm","jaw pain","left-sided numbness","slurred speech"]},{"id":"SOM-004","category":"Chronic Substance-Induced Organ Damage","keywords":["cirrhosis","liver failure","hepatitis c","hep c","kidney damage","endocarditis"],"primary_mh":"F10.20","link_modifier":"F54","somatic_default":"K74.60","somatic_alternative":"B19.20","dot_phrase":".somaticSUD","emergency_triggers":["jaundice","ascites fluid accumulation","hepatic encephalopathy confusion","vomiting blood"]}],"combination_examples":[{"substance":"alcohol","feature":"delusions","code":"F10.150"},{"substance":"alcohol","feature":"hallucinations","code":"F10.151"},{"substance":"cannabis","feature":"delusions","code":"F12.150"},{"substance":"cocaine","feature":"delusions","code":"F14.150"},{"substance":"other_stimulant_amphetamine","feature":"delusions","code":"F15.150"}],"scope_disclaimer_required":true}'::jsonb)
on conflict (config_version) do update set module_name=excluded.module_name,license_scope=excluded.license_scope,config=excluded.config,updated_at=now();

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
  constraint cross_mapping_rejection_requires_reason check (action='accepted' or nullif(btrim(rejection_justification),'') is not null)
);
create index if not exists clinical_cross_mapping_decisions_encounter_idx on public.clinical_cross_mapping_decisions(tenant_id,encounter_id,created_at desc);
create index if not exists clinical_cross_mapping_decisions_encounter_fk_idx on public.clinical_cross_mapping_decisions(encounter_id);
create index if not exists clinical_cross_mapping_decisions_created_by_idx on public.clinical_cross_mapping_decisions(created_by);
alter table public.clinical_cross_mapping_decisions enable row level security;
drop policy if exists clinical_cross_mapping_decisions_select on public.clinical_cross_mapping_decisions;
create policy clinical_cross_mapping_decisions_select on public.clinical_cross_mapping_decisions for select to authenticated using (private.has_tenant_read_access(tenant_id));
drop policy if exists clinical_cross_mapping_decisions_insert on public.clinical_cross_mapping_decisions;
create policy clinical_cross_mapping_decisions_insert on public.clinical_cross_mapping_decisions for insert to authenticated with check (private.has_tenant_write_access(tenant_id));
revoke all on public.clinical_cross_mapping_decisions from anon;
grant select,insert on public.clinical_cross_mapping_decisions to authenticated;

alter table public.clinical_outcome_measures add column if not exists source_reference_id uuid;
create unique index if not exists clinical_outcome_measures_source_reference_idx on public.clinical_outcome_measures(tenant_id,instrument,source_reference_id) where source_reference_id is not null;
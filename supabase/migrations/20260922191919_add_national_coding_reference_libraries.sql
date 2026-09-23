
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.reference_code_systems (
  system text not null,
  version text not null,
  display_name text not null,
  release_date date,
  effective_from date not null,
  effective_to date,
  source_name text not null,
  source_url text,
  status text not null default 'active' check (status in ('active','staged','retired')),
  row_count integer not null default 0,
  loaded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  primary key (system, version)
);

create table if not exists public.icd10_codes (
  version text not null,
  code text not null,
  code_compact text not null,
  description text not null,
  short_description text,
  billable boolean not null default true,
  effective_from date not null,
  effective_to date,
  source_name text not null default 'CDC/NCHS',
  source_url text,
  loaded_at timestamptz not null default now(),
  primary key (version, code)
);

create table if not exists public.hcpcs_codes (
  version text not null,
  code text not null,
  short_description text,
  long_description text,
  effective_from date not null,
  effective_to date,
  status_code text,
  action_code text,
  source_name text not null default 'CMS',
  source_url text,
  loaded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (version, code)
);

create table if not exists public.cpt_codes (
  code text primary key,
  display_name text not null,
  effective_from date,
  effective_to date,
  is_active boolean not null default true,
  label_source text not null default 'therassistant_internal',
  official_description text,
  official_description_source text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.place_of_service_codes (
  code text primary key,
  name text not null,
  description text,
  effective_from date,
  effective_to date,
  is_active boolean not null default true,
  source_name text not null default 'CMS',
  source_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.code_modifiers (
  system text not null,
  code text not null,
  display_name text not null,
  description text,
  effective_from date,
  effective_to date,
  is_active boolean not null default true,
  label_source text not null default 'therassistant_internal',
  metadata jsonb not null default '{}'::jsonb,
  primary key (system, code)
);

create table if not exists public.ncci_ptp_edits (
  version text not null,
  column1_code text not null,
  column2_code text not null,
  effective_from date not null,
  effective_to date,
  modifier_indicator text,
  edit_rationale text,
  source_name text not null default 'CMS NCCI',
  source_url text,
  loaded_at timestamptz not null default now(),
  primary key (version, column1_code, column2_code)
);

create table if not exists public.mue_limits (
  version text not null,
  code text not null,
  mue_value numeric,
  adjudication_indicator text,
  rationale text,
  effective_from date not null,
  effective_to date,
  source_name text not null default 'CMS MUE',
  source_url text,
  loaded_at timestamptz not null default now(),
  primary key (version, code)
);

create table if not exists public.rvu_rates (
  year integer not null,
  code text not null,
  modifier text not null default '',
  work_rvu numeric,
  pe_rvu_facility numeric,
  pe_rvu_nonfacility numeric,
  malpractice_rvu numeric,
  status_code text,
  conversion_factor numeric,
  source_name text not null default 'CMS PFS',
  source_url text,
  loaded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (year, code, modifier)
);

create index if not exists icd10_codes_code_compact_idx on public.icd10_codes (code_compact);
create index if not exists icd10_codes_effective_idx on public.icd10_codes (effective_from, effective_to);
create index if not exists icd10_codes_description_trgm_idx on public.icd10_codes using gin (description extensions.gin_trgm_ops);
create index if not exists hcpcs_codes_code_idx on public.hcpcs_codes (code);
create index if not exists hcpcs_codes_effective_idx on public.hcpcs_codes (effective_from, effective_to);
create index if not exists hcpcs_codes_short_trgm_idx on public.hcpcs_codes using gin (coalesce(short_description,'') extensions.gin_trgm_ops);
create index if not exists hcpcs_codes_long_trgm_idx on public.hcpcs_codes using gin (coalesce(long_description,'') extensions.gin_trgm_ops);
create index if not exists cpt_codes_name_trgm_idx on public.cpt_codes using gin (display_name extensions.gin_trgm_ops);
create index if not exists pos_codes_name_trgm_idx on public.place_of_service_codes using gin (name extensions.gin_trgm_ops);
create index if not exists ncci_ptp_pair_idx on public.ncci_ptp_edits (column1_code, column2_code, effective_from);
create index if not exists mue_limits_code_idx on public.mue_limits (code, effective_from);
create index if not exists rvu_rates_code_idx on public.rvu_rates (code, year);

alter table public.reference_code_systems enable row level security;
alter table public.icd10_codes enable row level security;
alter table public.hcpcs_codes enable row level security;
alter table public.cpt_codes enable row level security;
alter table public.place_of_service_codes enable row level security;
alter table public.code_modifiers enable row level security;
alter table public.ncci_ptp_edits enable row level security;
alter table public.mue_limits enable row level security;
alter table public.rvu_rates enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'reference_code_systems','icd10_codes','hcpcs_codes','cpt_codes',
    'place_of_service_codes','code_modifiers','ncci_ptp_edits','mue_limits','rvu_rates'
  ]
  loop
    execute format('drop policy if exists authenticated_reference_read on public.%I', t);
    execute format('create policy authenticated_reference_read on public.%I for select to authenticated using (true)', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create or replace function public.search_icd10_codes(
  p_search text,
  p_service_date date default current_date,
  p_limit integer default 20
)
returns table (
  code text,
  name text,
  version text,
  effective_from date,
  effective_to date
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select i.code, i.description as name, i.version, i.effective_from, i.effective_to
  from public.icd10_codes i
  where i.effective_from <= coalesce(p_service_date, current_date)
    and (i.effective_to is null or i.effective_to >= coalesce(p_service_date, current_date))
    and (
      i.code_compact ilike replace(upper(trim(coalesce(p_search,''))), '.', '') || '%'
      or i.code ilike upper(trim(coalesce(p_search,''))) || '%'
      or i.description ilike '%' || trim(coalesce(p_search,'')) || '%'
    )
  order by
    case
      when i.code = upper(trim(coalesce(p_search,''))) then 0
      when i.code_compact = replace(upper(trim(coalesce(p_search,''))), '.', '') then 1
      when i.code ilike upper(trim(coalesce(p_search,''))) || '%' then 2
      else 3
    end,
    similarity(i.description, trim(coalesce(p_search,''))) desc,
    i.code
  limit least(greatest(coalesce(p_limit,20),1),50);
$$;

create or replace function public.search_procedure_codes(
  p_search text,
  p_service_date date default current_date,
  p_limit integer default 20
)
returns table (
  code text,
  name text,
  system text,
  version text,
  effective_from date,
  effective_to date,
  description_source text
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with candidates as (
    select
      c.code,
      c.display_name as name,
      'CPT'::text as system,
      null::text as version,
      c.effective_from,
      c.effective_to,
      c.label_source as description_source,
      case
        when c.code = upper(trim(coalesce(p_search,''))) then 0
        when c.code ilike upper(trim(coalesce(p_search,''))) || '%' then 1
        else 3
      end as rank
    from public.cpt_codes c
    where c.is_active
      and (c.effective_from is null or c.effective_from <= coalesce(p_service_date,current_date))
      and (c.effective_to is null or c.effective_to >= coalesce(p_service_date,current_date))
      and (
        c.code ilike upper(trim(coalesce(p_search,''))) || '%'
        or c.display_name ilike '%' || trim(coalesce(p_search,'')) || '%'
      )
    union all
    select
      h.code,
      coalesce(h.long_description, h.short_description, h.code) as name,
      'HCPCS'::text as system,
      h.version,
      h.effective_from,
      h.effective_to,
      'CMS'::text as description_source,
      case
        when h.code = upper(trim(coalesce(p_search,''))) then 0
        when h.code ilike upper(trim(coalesce(p_search,''))) || '%' then 1
        else 3
      end as rank
    from public.hcpcs_codes h
    where h.effective_from <= coalesce(p_service_date,current_date)
      and (h.effective_to is null or h.effective_to >= coalesce(p_service_date,current_date))
      and (
        h.code ilike upper(trim(coalesce(p_search,''))) || '%'
        or coalesce(h.short_description,'') ilike '%' || trim(coalesce(p_search,'')) || '%'
        or coalesce(h.long_description,'') ilike '%' || trim(coalesce(p_search,'')) || '%'
      )
  )
  select code, name, system, version, effective_from, effective_to, description_source
  from candidates
  order by rank, code
  limit least(greatest(coalesce(p_limit,20),1),50);
$$;

create or replace function public.search_place_of_service_codes(
  p_search text default '',
  p_limit integer default 30
)
returns table (code text, name text, description text)
language sql
stable
security invoker
set search_path = public
as $$
  select p.code, p.name, p.description
  from public.place_of_service_codes p
  where p.is_active
    and (
      trim(coalesce(p_search,'')) = ''
      or p.code ilike trim(coalesce(p_search,'')) || '%'
      or p.name ilike '%' || trim(coalesce(p_search,'')) || '%'
      or coalesce(p.description,'') ilike '%' || trim(coalesce(p_search,'')) || '%'
    )
  order by case when p.code = trim(coalesce(p_search,'')) then 0 else 1 end, p.code
  limit least(greatest(coalesce(p_limit,30),1),100);
$$;

grant execute on function public.search_icd10_codes(text,date,integer) to authenticated;
grant execute on function public.search_procedure_codes(text,date,integer) to authenticated;
grant execute on function public.search_place_of_service_codes(text,integer) to authenticated;

create or replace view public.reference_library_status as
select 'ICD-10-CM'::text as library, count(*)::bigint as row_count, max(loaded_at) as last_loaded_at from public.icd10_codes
union all
select 'HCPCS Level II', count(*)::bigint, max(loaded_at) from public.hcpcs_codes
union all
select 'CPT (internal labels / licensed descriptions when available)', count(*)::bigint, max(updated_at) from public.cpt_codes
union all
select 'Place of Service', count(*)::bigint, max(updated_at) from public.place_of_service_codes
union all
select 'Modifiers', count(*)::bigint, null::timestamptz from public.code_modifiers
union all
select 'NCCI PTP', count(*)::bigint, max(loaded_at) from public.ncci_ptp_edits
union all
select 'MUE', count(*)::bigint, max(loaded_at) from public.mue_limits
union all
select 'Medicare RVU', count(*)::bigint, max(loaded_at) from public.rvu_rates;

grant select on public.reference_library_status to authenticated;

insert into public.reference_code_systems
(system,version,display_name,release_date,effective_from,effective_to,source_name,source_url,status)
values
('ICD10CM','FY2026_APR','ICD-10-CM April 1, 2026','2026-01-29','2026-04-01','2026-09-30','CDC/NCHS','https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/2026-update/','active'),
('ICD10CM','FY2027_OCT','ICD-10-CM FY2027','2026-06-16','2026-10-01','2027-09-30','CDC/NCHS','https://ftp.cdc.gov/pub/health_statistics/nchs/publications/ICD10CM/2027/','staged'),
('HCPCS','2026_JUL','HCPCS Level II July 2026','2026-06-17','2026-07-01','2026-09-30','CMS','https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update','active'),
('HCPCS','2026_OCT','HCPCS Level II October 2026','2026-09-10','2026-10-01','2026-12-31','CMS','https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update','staged')
on conflict (system,version) do update set
 display_name=excluded.display_name, release_date=excluded.release_date, effective_from=excluded.effective_from,
 effective_to=excluded.effective_to, source_name=excluded.source_name, source_url=excluded.source_url, status=excluded.status;

insert into public.cpt_codes (code,display_name,label_source) values
('90785','Interactive complexity add-on','therassistant_internal'),
('90791','Behavioral health diagnostic evaluation','therassistant_internal'),
('90792','Psychiatric diagnostic evaluation with medical component','therassistant_internal'),
('90832','Individual psychotherapy – 30-minute range','therassistant_internal'),
('90833','Psychotherapy add-on – 30-minute range with E/M','therassistant_internal'),
('90834','Individual psychotherapy – 45-minute range','therassistant_internal'),
('90836','Psychotherapy add-on – 45-minute range with E/M','therassistant_internal'),
('90837','Individual psychotherapy – 60-minute range','therassistant_internal'),
('90838','Psychotherapy add-on – 60-minute range with E/M','therassistant_internal'),
('90839','Psychotherapy for crisis – initial service','therassistant_internal'),
('90840','Psychotherapy for crisis – additional time','therassistant_internal'),
('90846','Family psychotherapy without patient present','therassistant_internal'),
('90847','Family psychotherapy with patient present','therassistant_internal'),
('90849','Multiple-family group psychotherapy','therassistant_internal'),
('90853','Group psychotherapy','therassistant_internal'),
('90863','Medication management add-on to psychotherapy','therassistant_internal'),
('96116','Neurobehavioral status examination – initial hour','therassistant_internal'),
('96121','Neurobehavioral status examination – additional hour','therassistant_internal'),
('96130','Psychological testing evaluation – initial hour','therassistant_internal'),
('96131','Psychological testing evaluation – additional hour','therassistant_internal'),
('96132','Neuropsychological testing evaluation – initial hour','therassistant_internal'),
('96133','Neuropsychological testing evaluation – additional hour','therassistant_internal'),
('96136','Testing administration/scoring by qualified professional – initial unit','therassistant_internal'),
('96137','Testing administration/scoring by qualified professional – additional unit','therassistant_internal'),
('96138','Testing administration/scoring by technician – initial unit','therassistant_internal'),
('96139','Testing administration/scoring by technician – additional unit','therassistant_internal'),
('96146','Automated psychological/neuropsychological test administration','therassistant_internal'),
('99202','New patient outpatient E/M – level 2','therassistant_internal'),
('99203','New patient outpatient E/M – level 3','therassistant_internal'),
('99204','New patient outpatient E/M – level 4','therassistant_internal'),
('99205','New patient outpatient E/M – level 5','therassistant_internal'),
('99211','Established patient outpatient E/M – level 1','therassistant_internal'),
('99212','Established patient outpatient E/M – level 2','therassistant_internal'),
('99213','Established patient outpatient E/M – level 3','therassistant_internal'),
('99214','Established patient outpatient E/M – level 4','therassistant_internal'),
('99215','Established patient outpatient E/M – level 5','therassistant_internal')
on conflict (code) do update set display_name=excluded.display_name,label_source=excluded.label_source,updated_at=now();

insert into public.code_modifiers (system,code,display_name,description,label_source) values
('CPT','25','Separate E/M service on the same date','Internal operational label; verify payer rules.','therassistant_internal'),
('CPT','59','Distinct procedural service','Internal operational label; verify payer rules.','therassistant_internal'),
('CPT','93','Synchronous audio-only telemedicine','Internal operational label; verify payer rules.','therassistant_internal'),
('CPT','95','Synchronous telehealth service','Internal operational label; verify payer rules.','therassistant_internal'),
('HCPCS','GT','Interactive telehealth service','Internal operational label; verify payer rules.','therassistant_internal'),
('HCPCS','AJ','Clinical social worker','Internal operational label; verify payer rules.','therassistant_internal'),
('HCPCS','HO','Master-level credential/service indicator','Internal operational label; verify payer rules.','therassistant_internal'),
('HCPCS','HN','Bachelor-level credential/service indicator','Internal operational label; verify payer rules.','therassistant_internal'),
('HCPCS','SA','Nonphysician practitioner service indicator','Internal operational label; verify payer rules.','therassistant_internal')
on conflict (system,code) do update set display_name=excluded.display_name,description=excluded.description,label_source=excluded.label_source;

insert into public.place_of_service_codes(code,name,description,source_url) values
('01','Pharmacy','Location where drugs and medically related items or services are dispensed or provided directly to patients.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('02','Telehealth Provided Other than in Patient''s Home','Telehealth location when the patient is not in the home.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('03','School','Educational facility where services are provided.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('04','Homeless Shelter','Temporary housing location for individuals experiencing homelessness.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('05','Indian Health Service Free-standing Facility','Free-standing IHS facility.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('06','Indian Health Service Provider-based Facility','Provider-based IHS facility.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('07','Tribal 638 Free-standing Facility','Free-standing tribal facility operating under a 638 agreement.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('08','Tribal 638 Provider-based Facility','Provider-based tribal facility operating under a 638 agreement.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('09','Prison / Correctional Facility','Correctional or detention facility.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('10','Telehealth Provided in Patient''s Home','Telehealth location when the patient is in the home.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('11','Office','Professional office or similar ambulatory setting.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('12','Home','Private residence where the patient receives care.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('13','Assisted Living Facility','Residential assisted living facility.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('14','Group Home','Shared residence where supervision and supportive services are provided.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('15','Mobile Unit','Mobile facility or unit used to deliver services.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('16','Temporary Lodging','Temporary accommodation not otherwise represented by another POS code.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('17','Walk-in Retail Health Clinic','Retail-based walk-in health clinic.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('18','Place of Employment / Worksite','Worksite setting where health services are provided.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('19','Off Campus-Outpatient Hospital','Off-campus hospital outpatient department.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('20','Urgent Care Facility','Freestanding urgent care setting.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('21','Inpatient Hospital','General inpatient hospital setting.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('22','On Campus-Outpatient Hospital','On-campus hospital outpatient department.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('23','Emergency Room – Hospital','Hospital emergency department.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('24','Ambulatory Surgical Center','Freestanding ambulatory surgical center.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('25','Birthing Center','Freestanding birthing center.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('26','Military Treatment Facility','Facility operated by the Uniformed Services.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('27','Outreach Site / Street','Non-permanent street or outreach location for services to unsheltered individuals.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('31','Skilled Nursing Facility','Skilled nursing facility.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('32','Nursing Facility','Nursing facility.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('33','Custodial Care Facility','Long-term custodial care facility.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('34','Hospice','Inpatient or facility-based hospice setting.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('41','Ambulance - Land','Land ambulance.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('42','Ambulance – Air or Water','Air or water ambulance.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('49','Independent Clinic','Independent outpatient clinic.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('50','Federally Qualified Health Center','Federally Qualified Health Center.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('51','Inpatient Psychiatric Facility','24-hour inpatient psychiatric facility.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('52','Psychiatric Facility - Partial Hospitalization','Psychiatric partial hospitalization setting.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('53','Community Mental Health Center','Community mental health center.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('54','Intermediate Care Facility / Individuals with Intellectual Disabilities','Intermediate care facility for individuals with intellectual disabilities.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('55','Residential Substance Abuse Treatment Facility','Residential substance use disorder treatment setting.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('56','Psychiatric Residential Treatment Center','Psychiatric residential treatment setting.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('57','Non-residential Substance Abuse Treatment Facility','Ambulatory substance use disorder treatment setting.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('58','Non-residential Opioid Treatment Facility','Ambulatory opioid treatment facility.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('60','Mass Immunization Center','Mass immunization setting.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('61','Comprehensive Inpatient Rehabilitation Facility','Comprehensive inpatient rehabilitation setting.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('62','Comprehensive Outpatient Rehabilitation Facility','Comprehensive outpatient rehabilitation setting.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('65','End-Stage Renal Disease Treatment Facility','Dialysis treatment facility.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('66','Programs of All-Inclusive Care for the Elderly (PACE) Center','PACE center.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('71','Public Health Clinic','State or local public health clinic.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('72','Rural Health Clinic','Certified rural health clinic.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('81','Independent Laboratory','Independent clinical laboratory.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets'),
('99','Other Place of Service','Other service location not represented by another POS code.','https://www.cms.gov/medicare/coding-billing/place-of-service-codes/code-sets')
on conflict (code) do update set name=excluded.name,description=excluded.description,source_url=excluded.source_url,updated_at=now();

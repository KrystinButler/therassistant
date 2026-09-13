begin;

revoke delete, truncate, references, trigger
  on table public.encounters,
           public.encounter_diagnoses,
           public.encounter_service_lines,
           public.encounter_readiness_checks
  from anon;

commit;

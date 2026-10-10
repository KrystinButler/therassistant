alter table public.encounters
  alter column appointment_id drop not null;

comment on column public.encounters.appointment_id is
  'Optional appointment linkage. Null is valid for direct clinical documentation created without a scheduled encounter.';

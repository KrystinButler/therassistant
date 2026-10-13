alter table public.appointments
  add column if not exists telehealth_provider text,
  add column if not exists telehealth_room_name text,
  add column if not exists telehealth_room_expires_at timestamptz;

create unique index if not exists appointments_telehealth_room_name_unique
  on public.appointments (telehealth_room_name)
  where telehealth_room_name is not null;

alter table public.appointments
  add constraint appointments_telehealth_session_complete
  check (
    (telehealth_provider is null and telehealth_room_name is null and telehealth_room_expires_at is null)
    or
    (telehealth_provider is not null and telehealth_room_name is not null and telehealth_url is not null and telehealth_room_expires_at is not null)
  );

comment on column public.appointments.telehealth_provider is 'Server-managed telehealth provider identifier. Null indicates a legacy/manual URL.';
comment on column public.appointments.telehealth_room_name is 'Random provider room identifier. Never include patient, provider, or appointment PHI.';
comment on column public.appointments.telehealth_room_expires_at is 'Expiration for the server-managed telehealth room.';
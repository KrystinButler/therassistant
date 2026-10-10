-- Dedicated safety-screening records. Keep C-SSRS separate from PHQ/GAD outcome measures.
create table if not exists public.clinical_safety_screenings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  provider_id uuid references public.providers(id) on delete set null,
  encounter_id uuid references public.encounters(id) on delete set null,
  instrument text not null check (instrument = 'C-SSRS'),
  score_text text,
  risk_level text not null check (risk_level in ('low','moderate','acute_high')),
  assessed_on date not null,
  source text not null default 'patient_reported' check (source in ('clinician_entered','patient_reported')),
  narrative text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clinical_safety_screenings_patient_date_idx
  on public.clinical_safety_screenings(tenant_id, client_id, instrument, assessed_on desc, created_at desc);

alter table public.clinical_safety_screenings enable row level security;

drop policy if exists clinical_safety_screenings_select on public.clinical_safety_screenings;
create policy clinical_safety_screenings_select on public.clinical_safety_screenings for select to authenticated
  using (private.has_tenant_read_access(tenant_id));

drop policy if exists clinical_safety_screenings_insert on public.clinical_safety_screenings;
create policy clinical_safety_screenings_insert on public.clinical_safety_screenings for insert to authenticated
  with check (private.has_tenant_write_access(tenant_id));

drop policy if exists clinical_safety_screenings_update on public.clinical_safety_screenings;
create policy clinical_safety_screenings_update on public.clinical_safety_screenings for update to authenticated
  using (private.has_tenant_write_access(tenant_id))
  with check (private.has_tenant_write_access(tenant_id));

drop policy if exists clinical_safety_screenings_delete on public.clinical_safety_screenings;
create policy clinical_safety_screenings_delete on public.clinical_safety_screenings for delete to authenticated
  using (private.has_tenant_write_access(tenant_id));

grant select, insert, update, delete on table public.clinical_safety_screenings to authenticated;

-- Psychotherapy notes are stored outside the ordinary clinical note body and are not exposed to billing/client roles.
create or replace function private.has_psychotherapy_note_access(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.tenant_users tu
    join public.tenant_user_roles tur
      on tur.tenant_id = tu.tenant_id
     and tur.user_id = tu.user_id
    where tu.tenant_id = p_tenant_id
      and tu.user_id = auth.uid()
      and tu.status = 'active'::public.user_status_enum
      and tur.role = 'clinician'::public.system_role_enum
  );
$$;

revoke all on function private.has_psychotherapy_note_access(uuid) from public, anon;
grant execute on function private.has_psychotherapy_note_access(uuid) to authenticated;

create table if not exists public.psychotherapy_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  encounter_id uuid not null references public.encounters(id) on delete cascade,
  provider_id uuid references public.providers(id) on delete set null,
  note_text text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, encounter_id)
);

create index if not exists psychotherapy_notes_client_date_idx
  on public.psychotherapy_notes(tenant_id, client_id, updated_at desc);

alter table public.psychotherapy_notes enable row level security;

drop policy if exists psychotherapy_notes_select on public.psychotherapy_notes;
create policy psychotherapy_notes_select on public.psychotherapy_notes for select to authenticated
  using ((select private.has_psychotherapy_note_access(tenant_id)));

drop policy if exists psychotherapy_notes_insert on public.psychotherapy_notes;
create policy psychotherapy_notes_insert on public.psychotherapy_notes for insert to authenticated
  with check ((select private.has_psychotherapy_note_access(tenant_id)));

drop policy if exists psychotherapy_notes_update on public.psychotherapy_notes;
create policy psychotherapy_notes_update on public.psychotherapy_notes for update to authenticated
  using ((select private.has_psychotherapy_note_access(tenant_id)))
  with check ((select private.has_psychotherapy_note_access(tenant_id)));

drop policy if exists psychotherapy_notes_delete on public.psychotherapy_notes;
create policy psychotherapy_notes_delete on public.psychotherapy_notes for delete to authenticated
  using ((select private.has_psychotherapy_note_access(tenant_id)));

grant select, insert, update, delete on table public.psychotherapy_notes to authenticated;

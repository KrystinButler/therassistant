create table if not exists public.smart_phrases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  owner_user_id uuid default auth.uid() references auth.users(id) on delete cascade,
  shortcut text not null,
  label text not null,
  content text not null,
  category text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint smart_phrases_shortcut_format check (shortcut ~ '^\.[A-Za-z0-9_-]{1,40}$')
);

create unique index if not exists smart_phrases_scope_shortcut_uidx
on public.smart_phrases (
  tenant_id,
  coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
  lower(shortcut)
);

create index if not exists smart_phrases_tenant_active_idx
on public.smart_phrases (tenant_id, is_active, shortcut);

alter table public.smart_phrases enable row level security;

drop policy if exists smart_phrases_tenant_select on public.smart_phrases;
create policy smart_phrases_tenant_select
on public.smart_phrases for select
to authenticated
using (
  private.has_tenant_read_access(tenant_id)
  and (owner_user_id is null or owner_user_id = (select auth.uid()))
);

drop policy if exists smart_phrases_tenant_insert on public.smart_phrases;
create policy smart_phrases_tenant_insert
on public.smart_phrases for insert
to authenticated
with check (
  private.has_tenant_write_access(tenant_id)
  and (owner_user_id is null or owner_user_id = (select auth.uid()))
);

drop policy if exists smart_phrases_tenant_update on public.smart_phrases;
create policy smart_phrases_tenant_update
on public.smart_phrases for update
to authenticated
using (
  private.has_tenant_write_access(tenant_id)
  and (owner_user_id is null or owner_user_id = (select auth.uid()))
)
with check (
  private.has_tenant_write_access(tenant_id)
  and (owner_user_id is null or owner_user_id = (select auth.uid()))
);

drop policy if exists smart_phrases_tenant_delete on public.smart_phrases;
create policy smart_phrases_tenant_delete
on public.smart_phrases for delete
to authenticated
using (
  private.has_tenant_write_access(tenant_id)
  and (owner_user_id is null or owner_user_id = (select auth.uid()))
);

create table if not exists public.clinical_note_structured_data (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  clinical_note_id uuid not null references public.clinical_notes(id) on delete cascade,
  encounter_id uuid not null references public.encounters(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  provider_id uuid references public.providers(id) on delete set null,
  selections jsonb not null default '{}'::jsonb,
  generated_narrative text,
  carry_forward_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinical_note_id)
);

create index if not exists clinical_note_structured_client_idx
on public.clinical_note_structured_data (tenant_id, client_id, updated_at desc);

create index if not exists clinical_note_structured_encounter_idx
on public.clinical_note_structured_data (tenant_id, encounter_id);

alter table public.clinical_note_structured_data enable row level security;

drop policy if exists clinical_note_structured_select on public.clinical_note_structured_data;
create policy clinical_note_structured_select
on public.clinical_note_structured_data for select
to authenticated
using (private.has_tenant_read_access(tenant_id));

drop policy if exists clinical_note_structured_insert on public.clinical_note_structured_data;
create policy clinical_note_structured_insert
on public.clinical_note_structured_data for insert
to authenticated
with check (private.has_tenant_write_access(tenant_id));

drop policy if exists clinical_note_structured_update on public.clinical_note_structured_data;
create policy clinical_note_structured_update
on public.clinical_note_structured_data for update
to authenticated
using (private.has_tenant_write_access(tenant_id))
with check (private.has_tenant_write_access(tenant_id));

drop policy if exists clinical_note_structured_delete on public.clinical_note_structured_data;
create policy clinical_note_structured_delete
on public.clinical_note_structured_data for delete
to authenticated
using (private.has_tenant_write_access(tenant_id));

grant select, insert, update, delete on public.smart_phrases to authenticated;
grant select, insert, update, delete on public.clinical_note_structured_data to authenticated;

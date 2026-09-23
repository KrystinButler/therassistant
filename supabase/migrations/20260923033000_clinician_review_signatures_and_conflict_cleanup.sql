-- Remove the superseded outcome/review workflow. These objects had no production rows.
drop function if exists public.sign_treatment_plan_review(uuid);
drop table if exists public.treatment_plan_review_goals restrict;
drop table if exists public.treatment_plan_reviews restrict;
drop table if exists public.patient_outcome_scores restrict;

create table if not exists public.provider_user_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade default auth.uid(),
  status text not null default 'active' check (status in ('active','inactive')),
  linked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider_id),
  unique (tenant_id, user_id)
);

create index if not exists provider_user_links_provider_idx on public.provider_user_links(provider_id);
create index if not exists provider_user_links_user_idx on public.provider_user_links(user_id);

alter table public.provider_user_links enable row level security;

drop policy if exists provider_user_links_self_select on public.provider_user_links;
create policy provider_user_links_self_select
on public.provider_user_links for select
to authenticated
using (
  user_id = (select auth.uid())
  and private.has_tenant_read_access(tenant_id)
);

drop policy if exists provider_user_links_self_insert on public.provider_user_links;
create policy provider_user_links_self_insert
on public.provider_user_links for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and private.has_tenant_write_access(tenant_id)
  and exists (
    select 1 from public.tenant_user_roles tur
    where tur.tenant_id = provider_user_links.tenant_id
      and tur.user_id = (select auth.uid())
      and tur.role = 'clinician'::public.system_role_enum
  )
);

drop policy if exists provider_user_links_self_update on public.provider_user_links;
create policy provider_user_links_self_update
on public.provider_user_links for update
to authenticated
using (
  user_id = (select auth.uid())
  and private.has_tenant_write_access(tenant_id)
)
with check (
  user_id = (select auth.uid())
  and private.has_tenant_write_access(tenant_id)
);

drop policy if exists provider_user_links_self_delete on public.provider_user_links;
create policy provider_user_links_self_delete
on public.provider_user_links for delete
to authenticated
using (
  user_id = (select auth.uid())
  and private.has_tenant_write_access(tenant_id)
);

create or replace function public.validate_provider_user_link()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_provider public.providers%rowtype;
  v_profile public.user_profiles%rowtype;
begin
  if auth.uid() is null or new.user_id <> (select auth.uid()) then
    raise exception 'Clinician account links can only be managed by the linked user';
  end if;

  if not private.has_tenant_write_access(new.tenant_id) then
    raise exception 'You do not have access to this practice';
  end if;

  if not exists (
    select 1
    from public.tenant_user_roles tur
    where tur.tenant_id = new.tenant_id
      and tur.user_id = (select auth.uid())
      and tur.role = 'clinician'::public.system_role_enum
  ) then
    raise exception 'A clinician role is required to link an account to a provider';
  end if;

  select * into v_provider
  from public.providers
  where id = new.provider_id
    and tenant_id = new.tenant_id
    and provider_status = 'active';

  if not found then
    raise exception 'Active provider not found in this practice';
  end if;

  select * into v_profile
  from public.user_profiles
  where id = (select auth.uid());

  if v_profile.id is null
     or v_provider.email is null
     or v_profile.email is null
     or lower(v_provider.email::text) <> lower(v_profile.email::text) then
    raise exception 'The clinician login email must match the provider email before accounts can be linked';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_provider_user_link on public.provider_user_links;
create trigger validate_provider_user_link
before insert or update on public.provider_user_links
for each row execute function public.validate_provider_user_link();

create table if not exists public.treatment_plan_review_signatures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  review_draft_id uuid not null unique references public.treatment_plan_review_drafts(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  source_plan_id uuid not null references public.treatment_plans(id) on delete restrict,
  provider_id uuid not null references public.providers(id) on delete restrict,
  signer_user_id uuid not null references public.user_profiles(id) on delete restrict,
  provider_name_snapshot text not null,
  provider_credentials_snapshot text,
  signer_email_snapshot text,
  signature_text text not null,
  attestation_accepted boolean not null,
  attestation_text text not null,
  signed_text_snapshot text not null,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint treatment_plan_review_signature_attested check (attestation_accepted = true)
);

create index if not exists review_signatures_patient_idx on public.treatment_plan_review_signatures(tenant_id, client_id, signed_at desc);
create index if not exists review_signatures_client_idx on public.treatment_plan_review_signatures(client_id);
create index if not exists review_signatures_plan_idx on public.treatment_plan_review_signatures(source_plan_id);
create index if not exists review_signatures_provider_idx on public.treatment_plan_review_signatures(provider_id);
create index if not exists review_signatures_signer_idx on public.treatment_plan_review_signatures(signer_user_id);

alter table public.treatment_plan_review_signatures enable row level security;

drop policy if exists review_signatures_tenant_select on public.treatment_plan_review_signatures;
create policy review_signatures_tenant_select
on public.treatment_plan_review_signatures for select
to authenticated
using (private.has_tenant_read_access(tenant_id));

drop policy if exists review_signatures_self_insert on public.treatment_plan_review_signatures;
create policy review_signatures_self_insert
on public.treatment_plan_review_signatures for insert
to authenticated
with check (
  signer_user_id = (select auth.uid())
  and private.has_tenant_write_access(tenant_id)
);

create or replace function public.prepare_treatment_plan_review_signature()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_draft public.treatment_plan_review_drafts%rowtype;
  v_provider public.providers%rowtype;
  v_profile public.user_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to sign a treatment plan review';
  end if;

  select * into v_draft
  from public.treatment_plan_review_drafts
  where id = new.review_draft_id;

  if not found then
    raise exception 'Treatment plan review draft not found';
  end if;

  if v_draft.provider_id is null then
    raise exception 'A responsible provider must be assigned before the review can be signed';
  end if;

  if position('[CLINICIAN' in v_draft.draft_text) > 0 then
    raise exception 'Complete all clinician review prompts before signing';
  end if;

  if not exists (
    select 1 from public.tenant_user_roles tur
    where tur.tenant_id = v_draft.tenant_id
      and tur.user_id = (select auth.uid())
      and tur.role = 'clinician'::public.system_role_enum
  ) then
    raise exception 'A clinician role is required to sign this treatment plan review';
  end if;

  if not exists (
    select 1 from public.provider_user_links pul
    where pul.tenant_id = v_draft.tenant_id
      and pul.provider_id = v_draft.provider_id
      and pul.user_id = (select auth.uid())
      and pul.status = 'active'
  ) then
    raise exception 'Your clinician account is not linked to the responsible provider';
  end if;

  if coalesce(trim(new.signature_text), '') = '' then
    raise exception 'Signature text is required';
  end if;

  if new.attestation_accepted is distinct from true then
    raise exception 'Clinical attestation must be accepted before signing';
  end if;

  select * into v_provider
  from public.providers
  where id = v_draft.provider_id
    and tenant_id = v_draft.tenant_id;

  if not found then
    raise exception 'Responsible provider not found';
  end if;

  select * into v_profile
  from public.user_profiles
  where id = (select auth.uid());

  new.tenant_id := v_draft.tenant_id;
  new.client_id := v_draft.client_id;
  new.source_plan_id := v_draft.source_plan_id;
  new.provider_id := v_draft.provider_id;
  new.signer_user_id := (select auth.uid());
  new.provider_name_snapshot := trim(concat_ws(' ', v_provider.first_name, v_provider.last_name));
  new.provider_credentials_snapshot := nullif(trim(coalesce(v_provider.credentials, '')), '');
  new.signer_email_snapshot := nullif(trim(coalesce(v_profile.email::text, '')), '');
  new.signature_text := trim(new.signature_text);
  new.attestation_text := 'I attest that I reviewed and edited this treatment plan review and that it accurately reflects my clinical assessment as of the review date.';
  new.signed_text_snapshot := v_draft.draft_text;
  new.evidence_snapshot := v_draft.evidence_snapshot;
  new.signed_at := now();

  return new;
end;
$$;

drop trigger if exists prepare_treatment_plan_review_signature on public.treatment_plan_review_signatures;
create trigger prepare_treatment_plan_review_signature
before insert on public.treatment_plan_review_signatures
for each row execute function public.prepare_treatment_plan_review_signature();

create or replace function public.prevent_signed_review_draft_changes()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  v_id := case when tg_op = 'DELETE' then old.id else new.id end;

  if exists (
    select 1
    from public.treatment_plan_review_signatures s
    where s.review_draft_id = v_id
  ) then
    raise exception 'Signed treatment plan reviews are immutable';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists prevent_signed_review_draft_changes on public.treatment_plan_review_drafts;
create trigger prevent_signed_review_draft_changes
before update or delete on public.treatment_plan_review_drafts
for each row execute function public.prevent_signed_review_draft_changes();

create or replace function public.link_current_user_to_provider(p_provider_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_provider public.providers%rowtype;
  v_profile public.user_profiles%rowtype;
  v_link public.provider_user_links%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;

  select * into v_provider
  from public.providers
  where id = p_provider_id;

  if not found then raise exception 'Provider not found'; end if;
  if not private.has_tenant_write_access(v_provider.tenant_id) then raise exception 'You do not have access to this practice'; end if;

  if not exists (
    select 1 from public.tenant_user_roles tur
    where tur.tenant_id = v_provider.tenant_id
      and tur.user_id = (select auth.uid())
      and tur.role = 'clinician'::public.system_role_enum
  ) then
    raise exception 'Your account must have the Clinician role before it can be linked to a provider';
  end if;

  select * into v_profile
  from public.user_profiles
  where id = (select auth.uid());

  if v_profile.id is null then raise exception 'User profile not found'; end if;

  if v_provider.email is null or v_profile.email is null
     or lower(v_provider.email::text) <> lower(v_profile.email::text) then
    raise exception 'The clinician login email must match the provider email before accounts can be linked';
  end if;

  insert into public.provider_user_links(tenant_id, provider_id, user_id, status)
  values(v_provider.tenant_id, v_provider.id, (select auth.uid()), 'active')
  on conflict (tenant_id, provider_id)
  do update set user_id = excluded.user_id, status = 'active', updated_at = now()
  returning * into v_link;

  return jsonb_build_object(
    'linked', true,
    'provider_id', v_provider.id,
    'provider_name', trim(concat_ws(' ', v_provider.first_name, v_provider.last_name))
  );
end;
$$;

create or replace function public.review_signature_readiness(p_review_draft_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_draft public.treatment_plan_review_drafts%rowtype;
  v_provider public.providers%rowtype;
  v_profile public.user_profiles%rowtype;
  v_signed public.treatment_plan_review_signatures%rowtype;
  v_has_role boolean := false;
  v_linked boolean := false;
  v_email_match boolean := false;
begin
  select * into v_draft
  from public.treatment_plan_review_drafts
  where id = p_review_draft_id;

  if not found then raise exception 'Treatment plan review draft not found'; end if;

  select * into v_signed
  from public.treatment_plan_review_signatures
  where review_draft_id = v_draft.id;

  if v_signed.id is not null then
    return jsonb_build_object(
      'can_sign', false, 'reason', 'already_signed', 'signed', true,
      'signed_at', v_signed.signed_at, 'provider_id', v_signed.provider_id,
      'provider_name', v_signed.provider_name_snapshot
    );
  end if;

  if v_draft.provider_id is null then
    return jsonb_build_object('can_sign', false, 'reason', 'provider_required', 'signed', false);
  end if;

  select * into v_provider
  from public.providers
  where id = v_draft.provider_id and tenant_id = v_draft.tenant_id;

  select * into v_profile
  from public.user_profiles
  where id = (select auth.uid());

  select exists (
    select 1 from public.tenant_user_roles tur
    where tur.tenant_id = v_draft.tenant_id
      and tur.user_id = (select auth.uid())
      and tur.role = 'clinician'::public.system_role_enum
  ) into v_has_role;

  select exists (
    select 1 from public.provider_user_links pul
    where pul.tenant_id = v_draft.tenant_id
      and pul.provider_id = v_draft.provider_id
      and pul.user_id = (select auth.uid())
      and pul.status = 'active'
  ) into v_linked;

  v_email_match :=
    v_provider.email is not null
    and v_profile.email is not null
    and lower(v_provider.email::text) = lower(v_profile.email::text);

  return jsonb_build_object(
    'can_sign', v_has_role and v_linked,
    'reason', case
      when not v_has_role then 'clinician_role_required'
      when not v_linked and not v_email_match then 'email_mismatch'
      when not v_linked then 'provider_not_linked'
      else 'ready'
    end,
    'signed', false,
    'provider_id', v_provider.id,
    'provider_name', trim(concat_ws(' ', v_provider.first_name, v_provider.last_name)),
    'clinician_role', v_has_role,
    'linked', v_linked,
    'email_match', v_email_match
  );
end;
$$;

create or replace function public.sign_treatment_plan_review(
  p_review_draft_id uuid,
  p_signature_text text,
  p_attestation_accepted boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_draft public.treatment_plan_review_drafts%rowtype;
  v_signature public.treatment_plan_review_signatures%rowtype;
begin
  select * into v_draft
  from public.treatment_plan_review_drafts
  where id = p_review_draft_id;

  if not found then raise exception 'Treatment plan review draft not found'; end if;

  insert into public.treatment_plan_review_signatures(
    tenant_id, review_draft_id, client_id, source_plan_id, provider_id,
    signer_user_id, provider_name_snapshot, signature_text,
    attestation_accepted, attestation_text, signed_text_snapshot, evidence_snapshot
  ) values(
    v_draft.tenant_id, v_draft.id, v_draft.client_id, v_draft.source_plan_id,
    coalesce(v_draft.provider_id, '00000000-0000-0000-0000-000000000000'::uuid),
    (select auth.uid()), '', p_signature_text, p_attestation_accepted, '',
    v_draft.draft_text, v_draft.evidence_snapshot
  )
  returning * into v_signature;

  return jsonb_build_object(
    'signed', true,
    'signature_id', v_signature.id,
    'signed_at', v_signature.signed_at,
    'provider_name', v_signature.provider_name_snapshot
  );
end;
$$;

revoke all on public.provider_user_links from anon;
revoke all on public.treatment_plan_review_signatures from anon;
grant select, insert, update, delete on public.provider_user_links to authenticated;
grant select, insert on public.treatment_plan_review_signatures to authenticated;
revoke update, delete on public.treatment_plan_review_signatures from authenticated;

revoke all on function public.link_current_user_to_provider(uuid) from public;
revoke all on function public.review_signature_readiness(uuid) from public;
revoke all on function public.sign_treatment_plan_review(uuid,text,boolean) from public;
grant execute on function public.link_current_user_to_provider(uuid) to authenticated;
grant execute on function public.review_signature_readiness(uuid) to authenticated;
grant execute on function public.sign_treatment_plan_review(uuid,text,boolean) to authenticated;

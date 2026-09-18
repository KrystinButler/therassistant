
create table public.credentialing_requirement_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  payer_id uuid not null references public.payers(id),
  payer_plan_id uuid references public.payer_plans(id),
  application_type text,
  provider_type text,
  state text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credentialing_requirement_templates_name_check
    check (nullif(btrim(name), '') is not null),
  constraint credentialing_requirement_templates_state_check
    check (state is null or char_length(btrim(state)) between 2 and 50)
);

create table public.credentialing_requirement_template_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null references public.credentialing_requirement_templates(id) on delete cascade,
  requirement_key text not null,
  requirement_name text not null,
  category text,
  due_offset_days integer,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credentialing_requirement_template_items_key_check
    check (nullif(btrim(requirement_key), '') is not null),
  constraint credentialing_requirement_template_items_name_check
    check (nullif(btrim(requirement_name), '') is not null),
  constraint credentialing_requirement_template_items_due_offset_check
    check (due_offset_days is null or due_offset_days between 0 and 365),
  constraint credentialing_requirement_template_items_template_key_key
    unique (template_id, requirement_key)
);

create unique index uq_credentialing_requirement_template_scope
on public.credentialing_requirement_templates (
  tenant_id,
  payer_id,
  coalesce(payer_plan_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(lower(application_type), ''),
  coalesce(lower(provider_type), ''),
  coalesce(upper(state), ''),
  lower(name)
);

create index idx_credentialing_requirement_templates_scope
on public.credentialing_requirement_templates (
  tenant_id, payer_id, payer_plan_id, is_active
);

create index idx_credentialing_requirement_template_items_template
on public.credentialing_requirement_template_items (
  tenant_id, template_id, sort_order
);

create or replace function private.credentialing_requirement_template_scope_guard()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
begin
  if tg_table_name = 'credentialing_requirement_templates' then
    new.name := btrim(new.name);
    new.application_type := nullif(btrim(new.application_type), '');
    new.provider_type := nullif(btrim(new.provider_type), '');
    new.state := case
      when nullif(btrim(new.state), '') is null then null
      else upper(btrim(new.state))
    end;

    if new.payer_plan_id is not null and not exists (
      select 1
      from public.payer_plans pp
      where pp.id = new.payer_plan_id
        and pp.payer_id = new.payer_id
    ) then
      raise exception 'requirement template payer plan does not belong to payer'
        using errcode = '22023';
    end if;
  elsif tg_table_name = 'credentialing_requirement_template_items' then
    select t.tenant_id into v_tenant_id
    from public.credentialing_requirement_templates t
    where t.id = new.template_id;

    if v_tenant_id is null or v_tenant_id <> new.tenant_id then
      raise exception 'requirement template item tenant mismatch'
        using errcode = '22023';
    end if;

    new.requirement_key := lower(regexp_replace(btrim(new.requirement_key), '[^a-zA-Z0-9]+', '_', 'g'));
    new.requirement_key := trim(both '_' from new.requirement_key);
    new.requirement_name := btrim(new.requirement_name);
    new.category := nullif(btrim(new.category), '');
  end if;

  return new;
end;
$function$;

create trigger credentialing_requirement_template_scope_guard
before insert or update on public.credentialing_requirement_templates
for each row execute function private.credentialing_requirement_template_scope_guard();

create trigger credentialing_requirement_template_item_scope_guard
before insert or update on public.credentialing_requirement_template_items
for each row execute function private.credentialing_requirement_template_scope_guard();

create trigger trg_set_timestamps
before insert or update on public.credentialing_requirement_templates
for each row execute function public.set_timestamps();

create trigger trg_set_timestamps
before insert or update on public.credentialing_requirement_template_items
for each row execute function public.set_timestamps();

create trigger trg_audit_row_changes
after insert or update or delete on public.credentialing_requirement_templates
for each row execute function public.audit_row_change();

create trigger trg_audit_row_changes
after insert or update or delete on public.credentialing_requirement_template_items
for each row execute function public.audit_row_change();

alter table public.credentialing_requirement_templates enable row level security;
alter table public.credentialing_requirement_template_items enable row level security;

create policy credentialing_requirement_templates_tenant_select
on public.credentialing_requirement_templates
for select to authenticated
using (private.has_tenant_read_access(tenant_id));

create policy credentialing_requirement_templates_tenant_insert
on public.credentialing_requirement_templates
for insert to authenticated
with check (private.has_tenant_write_access(tenant_id));

create policy credentialing_requirement_templates_tenant_update
on public.credentialing_requirement_templates
for update to authenticated
using (private.has_tenant_write_access(tenant_id))
with check (private.has_tenant_write_access(tenant_id));

create policy credentialing_requirement_templates_tenant_delete
on public.credentialing_requirement_templates
for delete to authenticated
using (private.has_tenant_write_access(tenant_id));

create policy credentialing_requirement_template_items_tenant_select
on public.credentialing_requirement_template_items
for select to authenticated
using (private.has_tenant_read_access(tenant_id));

create policy credentialing_requirement_template_items_tenant_insert
on public.credentialing_requirement_template_items
for insert to authenticated
with check (private.has_tenant_write_access(tenant_id));

create policy credentialing_requirement_template_items_tenant_update
on public.credentialing_requirement_template_items
for update to authenticated
using (private.has_tenant_write_access(tenant_id))
with check (private.has_tenant_write_access(tenant_id));

create policy credentialing_requirement_template_items_tenant_delete
on public.credentialing_requirement_template_items
for delete to authenticated
using (private.has_tenant_write_access(tenant_id));

revoke all on table public.credentialing_requirement_templates from public, anon;
revoke all on table public.credentialing_requirement_template_items from public, anon;
grant select, insert, update, delete on table public.credentialing_requirement_templates to authenticated;
grant select, insert, update, delete on table public.credentialing_requirement_template_items to authenticated;
grant all on table public.credentialing_requirement_templates to service_role;
grant all on table public.credentialing_requirement_template_items to service_role;

create or replace function public.apply_matching_credentialing_requirement_templates(
  p_tenant_id uuid,
  p_application_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = public, private, auth, pg_temp
as $function$
declare
  v_inserted integer := 0;
begin
  if auth.uid() is null or not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'Tenant write access required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.credentialing_applications a
    where a.id = p_application_id
      and a.tenant_id = p_tenant_id
  ) then
    raise exception 'Credentialing application not found for tenant'
      using errcode = '22023';
  end if;

  with matching as (
    select
      i.requirement_key,
      i.requirement_name,
      i.category,
      i.due_offset_days,
      i.notes,
      i.sort_order,
      t.id as template_id,
      (
        case when t.payer_plan_id is not null then 1 else 0 end +
        case when t.application_type is not null then 1 else 0 end +
        case when t.provider_type is not null then 1 else 0 end +
        case when t.state is not null then 1 else 0 end
      ) as specificity
    from public.credentialing_applications a
    join public.provider_payer_enrollments e
      on e.id = a.enrollment_id
     and e.tenant_id = a.tenant_id
    join public.providers p
      on p.id = e.provider_id
     and p.tenant_id = e.tenant_id
    left join public.practice_locations pl
      on pl.id = e.practice_location_id
     and pl.tenant_id = e.tenant_id
    join public.credentialing_requirement_templates t
      on t.tenant_id = a.tenant_id
     and t.payer_id = e.payer_id
     and t.is_active = true
     and (
       t.payer_plan_id is null
       or t.payer_plan_id = e.payer_plan_id
     )
     and (
       t.application_type is null
       or lower(t.application_type) = lower(a.application_type)
     )
     and (
       t.provider_type is null
       or lower(t.provider_type) = lower(coalesce(p.primary_specialty, ''))
       or lower(coalesce(p.credentials, '')) = lower(t.provider_type)
       or lower(coalesce(p.credentials, '')) like '% ' || lower(t.provider_type) || '%'
       or lower(coalesce(p.credentials, '')) like lower(t.provider_type) || ',%'
       or lower(coalesce(p.credentials, '')) like '%, ' || lower(t.provider_type) || '%'
     )
     and (
       t.state is null
       or upper(t.state) = upper(coalesce(pl.state, ''))
     )
    join public.credentialing_requirement_template_items i
      on i.template_id = t.id
     and i.tenant_id = t.tenant_id
    where a.id = p_application_id
      and a.tenant_id = p_tenant_id
  ),
  chosen as (
    select distinct on (requirement_key)
      requirement_key,
      requirement_name,
      category,
      due_offset_days,
      notes,
      sort_order,
      specificity,
      template_id
    from matching
    order by requirement_key, specificity desc, sort_order, template_id
  )
  insert into public.credentialing_requirements (
    tenant_id,
    application_id,
    requirement_key,
    requirement_name,
    category,
    status,
    due_date,
    notes
  )
  select
    p_tenant_id,
    p_application_id,
    c.requirement_key,
    c.requirement_name,
    c.category,
    'missing'::public.credentialing_requirement_status_enum,
    case
      when c.due_offset_days is null then null
      else current_date + c.due_offset_days
    end,
    c.notes
  from chosen c
  where not exists (
    select 1
    from public.credentialing_requirements cr
    where cr.application_id = p_application_id
      and cr.requirement_key = c.requirement_key
  );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

create or replace function public.create_credentialing_case(
  p_tenant_id uuid,
  p_provider_id uuid,
  p_payer_id uuid,
  p_payer_plan_id uuid default null,
  p_practice_entity_id uuid default null,
  p_practice_location_id uuid default null,
  p_payer_contract_id uuid default null,
  p_application_type text default 'initial',
  p_priority public.workqueue_priority_enum default 'normal',
  p_notes text default null
)
returns table(enrollment_id uuid, application_id uuid)
language plpgsql
security invoker
set search_path = public, private, auth, pg_temp
as $function$
declare
  v_enrollment_id uuid;
  v_application_id uuid;
begin
  if auth.uid() is null or not private.has_tenant_write_access(p_tenant_id) then
    raise exception 'Tenant write access required'
      using errcode = '42501';
  end if;

  v_enrollment_id := public.upsert_scoped_provider_enrollment(
    p_tenant_id := p_tenant_id,
    p_provider_id := p_provider_id,
    p_payer_id := p_payer_id,
    p_payer_plan_id := p_payer_plan_id,
    p_practice_entity_id := p_practice_entity_id,
    p_practice_location_id := p_practice_location_id,
    p_payer_contract_id := p_payer_contract_id,
    p_enrollment_status := 'in_progress',
    p_notes := p_notes
  );

  if exists (
    select 1
    from public.credentialing_applications ca
    where ca.tenant_id = p_tenant_id
      and ca.enrollment_id = v_enrollment_id
      and ca.status not in ('complete','denied','withdrawn','terminated','closed')
  ) then
    raise exception 'An active credentialing application already exists for this scope'
      using errcode = '23505';
  end if;

  insert into public.credentialing_applications (
    tenant_id,
    enrollment_id,
    application_type,
    status,
    priority,
    notes
  )
  values (
    p_tenant_id,
    v_enrollment_id,
    coalesce(nullif(btrim(p_application_type), ''), 'initial'),
    'intake',
    coalesce(p_priority, 'normal'),
    nullif(btrim(p_notes), '')
  )
  returning id into v_application_id;

  perform public.apply_matching_credentialing_requirement_templates(
    p_tenant_id,
    v_application_id
  );

  return query select v_enrollment_id, v_application_id;
end;
$function$;

revoke all on function public.apply_matching_credentialing_requirement_templates(uuid, uuid)
from public, anon;
grant execute on function public.apply_matching_credentialing_requirement_templates(uuid, uuid)
to authenticated, service_role;

revoke all on function public.create_credentialing_case(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, public.workqueue_priority_enum, text
) from public, anon;
grant execute on function public.create_credentialing_case(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, public.workqueue_priority_enum, text
) to authenticated, service_role;


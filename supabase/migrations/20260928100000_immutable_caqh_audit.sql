create extension if not exists pgcrypto;

create schema if not exists audit;

revoke all on schema audit from public, anon, authenticated;
grant usage on schema audit to service_role;

create table if not exists audit.api_events (
  sequence_id bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  correlation_id uuid not null,
  direction text not null
    check (direction in ('inbound', 'outbound')),
  integration text not null default 'CAQH'
    check (integration = 'CAQH'),
  action char(1) not null
    check (action in ('C', 'R', 'U', 'D')),
  recorded_at timestamptz(6) not null,
  agent_type text not null
    check (agent_type in ('user', 'client', 'system')),
  agent_id text not null
    check (length(btrim(agent_id)) between 1 and 255),
  entity_type text not null
    check (entity_type in ('Practitioner', 'Organization')),
  entity_id text not null
    check (length(btrim(entity_id)) between 1 and 255),
  outcome char(1) not null
    check (outcome in ('0', '4', '8')),
  outcome_description text,
  http_method text not null
    check (http_method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  endpoint text not null
    check (
      length(endpoint) between 1 and 2048
      and position('?' in endpoint) = 0
      and position('#' in endpoint) = 0
    ),
  http_status integer
    check (http_status is null or http_status between 100 and 599),
  request_sha256 text
    check (request_sha256 is null or request_sha256 ~ '^[0-9a-f]{64}$'),
  response_sha256 text
    check (response_sha256 is null or response_sha256 ~ '^[0-9a-f]{64}$'),
  duration_ms integer
    check (duration_ms is null or duration_ms >= 0),
  fhir_audit_event jsonb not null,
  previous_hash text
    check (previous_hash is null or previous_hash ~ '^[0-9a-f]{64}$'),
  event_hash text not null unique
    check (event_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz(6) not null default clock_timestamp(),
  constraint api_events_practitioner_npi_format
    check (
      entity_type <> 'Practitioner'
      or entity_id ~ '^[0-9]{10}$'
    ),
  constraint api_events_fhir_resource_type
    check (fhir_audit_event ->> 'resourceType' = 'AuditEvent')
);

create index if not exists api_events_tenant_recorded_idx
  on audit.api_events (tenant_id, recorded_at desc);

create index if not exists api_events_entity_idx
  on audit.api_events (tenant_id, entity_type, entity_id, recorded_at desc);

create index if not exists api_events_correlation_idx
  on audit.api_events (correlation_id);

revoke all on audit.api_events from public, anon, authenticated, service_role;

create or replace function audit.reject_api_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'audit.api_events is append-only'
    using errcode = '55000';
end;
$$;

revoke all on function audit.reject_api_event_mutation() from public;

drop trigger if exists api_events_reject_update_delete on audit.api_events;
create trigger api_events_reject_update_delete
before update or delete on audit.api_events
for each statement
execute function audit.reject_api_event_mutation();

drop trigger if exists api_events_reject_truncate on audit.api_events;
create trigger api_events_reject_truncate
before truncate on audit.api_events
for each statement
execute function audit.reject_api_event_mutation();

create or replace function audit.compute_caqh_event_hash(
  p_previous_hash text,
  p_id uuid,
  p_tenant_id uuid,
  p_correlation_id uuid,
  p_direction text,
  p_http_method text,
  p_endpoint text,
  p_http_status integer,
  p_request_sha256 text,
  p_response_sha256 text,
  p_duration_ms integer,
  p_fhir_audit_event jsonb
)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select encode(
    digest(
      convert_to(
        coalesce(p_previous_hash, '') || '|' ||
        jsonb_build_object(
          'id', p_id::text,
          'tenantId', p_tenant_id::text,
          'correlationId', p_correlation_id::text,
          'direction', p_direction,
          'httpMethod', p_http_method,
          'endpoint', p_endpoint,
          'httpStatus', p_http_status,
          'requestSha256', p_request_sha256,
          'responseSha256', p_response_sha256,
          'durationMs', p_duration_ms,
          'auditEvent', p_fhir_audit_event
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function audit.compute_caqh_event_hash(
  text, uuid, uuid, uuid, text, text, text, integer, text, text, integer, jsonb
) from public, anon, authenticated, service_role;

create or replace function audit.append_caqh_event(
  p_tenant_id uuid,
  p_correlation_id uuid,
  p_direction text,
  p_action char(1),
  p_agent_type text,
  p_agent_id text,
  p_entity_type text,
  p_entity_id text,
  p_outcome char(1),
  p_outcome_description text,
  p_http_method text,
  p_endpoint text,
  p_http_status integer,
  p_request_sha256 text,
  p_response_sha256 text,
  p_duration_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, audit
as $$
declare
  v_id uuid := gen_random_uuid();
  v_recorded timestamptz(6) := clock_timestamp();
  v_recorded_iso text;
  v_previous_hash text;
  v_event_hash text;
  v_subtype text;
  v_fhir jsonb;
begin
  if p_direction not in ('inbound', 'outbound') then
    raise exception 'Invalid audit direction';
  end if;

  if p_action not in ('C', 'R', 'U', 'D') then
    raise exception 'Invalid FHIR AuditEvent action';
  end if;

  if p_outcome not in ('0', '4', '8') then
    raise exception 'Invalid FHIR AuditEvent outcome';
  end if;

  if p_agent_type not in ('user', 'client', 'system') then
    raise exception 'Invalid audit agent type';
  end if;

  if p_entity_type not in ('Practitioner', 'Organization') then
    raise exception 'Invalid audit entity type';
  end if;

  if p_entity_type = 'Practitioner' and p_entity_id !~ '^[0-9]{10}$' then
    raise exception 'Practitioner audit entity must be a 10-digit NPI';
  end if;

  if upper(p_http_method) not in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE') then
    raise exception 'Invalid HTTP method';
  end if;

  if p_endpoint is null
    or length(p_endpoint) > 2048
    or position('?' in p_endpoint) > 0
    or position('#' in p_endpoint) > 0
  then
    raise exception 'Audit endpoint must omit query string and fragment';
  end if;

  perform pg_advisory_xact_lock(hashtext('therassistant-caqh-audit-chain'));

  select e.event_hash
    into v_previous_hash
    from audit.api_events e
   order by e.sequence_id desc
   limit 1;

  v_recorded_iso :=
    to_char(
      v_recorded at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    );

  v_subtype := case p_action
    when 'C' then 'create'
    when 'R' then 'read'
    when 'U' then 'update'
    when 'D' then 'delete'
  end;

  v_fhir := jsonb_build_object(
    'resourceType', 'AuditEvent',
    'id', v_id::text,
    'type', jsonb_build_object(
      'system', 'http://terminology.hl7.org/CodeSystem/audit-event-type',
      'code', 'rest',
      'display', 'RESTful Operation'
    ),
    'subtype', jsonb_build_array(
      jsonb_build_object(
        'system', 'http://hl7.org/fhir/restful-interaction',
        'code', v_subtype,
        'display', v_subtype
      )
    ),
    'action', p_action,
    'recorded', v_recorded_iso,
    'outcome', p_outcome,
    'agent', jsonb_build_array(
      jsonb_build_object(
        'who', jsonb_build_object(
          'identifier', jsonb_build_object(
            'system', case p_agent_type
              when 'user' then 'urn:therassistant:user'
              when 'client' then 'urn:therassistant:oauth-client'
              else 'urn:therassistant:system'
            end,
            'value', p_agent_id
          )
        ),
        'altId', p_agent_id,
        'requestor', true
      )
    ),
    'source', jsonb_build_object(
      'observer', jsonb_build_object(
        'identifier', jsonb_build_object(
          'system', 'urn:therassistant:system',
          'value', 'ehr-api-gateway'
        ),
        'display', 'Therassistant EHR API Gateway'
      )
    ),
    'entity', jsonb_build_array(
      jsonb_build_object(
        'what', jsonb_build_object(
          'identifier', jsonb_build_object(
            'system', case p_entity_type
              when 'Practitioner' then 'http://hl7.org/fhir/sid/us-npi'
              else 'urn:therassistant:organization'
            end,
            'value', p_entity_id
          ),
          'display', p_entity_type
        ),
        'description', concat(
          'CAQH ',
          p_direction,
          ' API interaction for ',
          p_entity_type
        )
      )
    )
  );

  if p_outcome_description is not null and btrim(p_outcome_description) <> '' then
    v_fhir := v_fhir || jsonb_build_object(
      'outcomeDesc',
      left(p_outcome_description, 1000)
    );
  end if;

  v_event_hash := audit.compute_caqh_event_hash(
    v_previous_hash,
    v_id,
    p_tenant_id,
    p_correlation_id,
    p_direction,
    upper(p_http_method),
    p_endpoint,
    p_http_status,
    p_request_sha256,
    p_response_sha256,
    p_duration_ms,
    v_fhir
  );

  insert into audit.api_events (
    id,
    tenant_id,
    correlation_id,
    direction,
    integration,
    action,
    recorded_at,
    agent_type,
    agent_id,
    entity_type,
    entity_id,
    outcome,
    outcome_description,
    http_method,
    endpoint,
    http_status,
    request_sha256,
    response_sha256,
    duration_ms,
    fhir_audit_event,
    previous_hash,
    event_hash
  )
  values (
    v_id,
    p_tenant_id,
    p_correlation_id,
    p_direction,
    'CAQH',
    p_action,
    v_recorded,
    p_agent_type,
    btrim(p_agent_id),
    p_entity_type,
    btrim(p_entity_id),
    p_outcome,
    nullif(btrim(p_outcome_description), ''),
    upper(p_http_method),
    p_endpoint,
    p_http_status,
    p_request_sha256,
    p_response_sha256,
    p_duration_ms,
    v_fhir,
    v_previous_hash,
    v_event_hash
  );

  return v_fhir;
end;
$$;

revoke all on function audit.append_caqh_event(
  uuid, uuid, text, char, text, text, text, text, char, text, text, text,
  integer, text, text, integer
) from public, anon, authenticated;

grant execute on function audit.append_caqh_event(
  uuid, uuid, text, char, text, text, text, text, char, text, text, text,
  integer, text, text, integer
) to service_role;

create or replace function audit.verify_caqh_chain()
returns table (
  sequence_id bigint,
  valid boolean,
  stored_hash text,
  expected_hash text,
  stored_previous_hash text,
  expected_previous_hash text
)
language sql
stable
security definer
set search_path = pg_catalog, audit
as $$
  with ordered as (
    select
      e.*,
      lag(e.event_hash) over (order by e.sequence_id) as expected_previous_hash
    from audit.api_events e
  ),
  checked as (
    select
      o.sequence_id,
      o.event_hash as stored_hash,
      audit.compute_caqh_event_hash(
        o.expected_previous_hash,
        o.id,
        o.tenant_id,
        o.correlation_id,
        o.direction,
        o.http_method,
        o.endpoint,
        o.http_status,
        o.request_sha256,
        o.response_sha256,
        o.duration_ms,
        o.fhir_audit_event
      ) as expected_hash,
      o.previous_hash as stored_previous_hash,
      o.expected_previous_hash
    from ordered o
  )
  select
    c.sequence_id,
    (
      c.stored_hash = c.expected_hash
      and coalesce(c.stored_previous_hash, '') =
          coalesce(c.expected_previous_hash, '')
    ) as valid,
    c.stored_hash,
    c.expected_hash,
    c.stored_previous_hash,
    c.expected_previous_hash
  from checked c
  order by c.sequence_id;
$$;

revoke all on function audit.verify_caqh_chain()
from public, anon, authenticated;

grant execute on function audit.verify_caqh_chain()
to service_role;

create or replace function audit.caqh_chain_is_valid()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, audit
as $$
  select coalesce(bool_and(v.valid), true)
  from audit.verify_caqh_chain() v;
$$;

revoke all on function audit.caqh_chain_is_valid()
from public, anon, authenticated;

grant execute on function audit.caqh_chain_is_valid()
to service_role;

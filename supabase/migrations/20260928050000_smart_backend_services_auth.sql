create schema if not exists private;

create table if not exists private.smart_backend_clients (
  client_id text primary key,
  jwks_uri text not null,
  allowed_scopes text[] not null default '{}'::text[],
  allowed_algorithms text[] not null default array['RS384','ES384']::text[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint smart_backend_clients_client_id_nonempty
    check (length(btrim(client_id)) between 1 and 200),
  constraint smart_backend_clients_jwks_https
    check (jwks_uri ~ '^https://'),
  constraint smart_backend_clients_algorithms_allowed
    check (allowed_algorithms <@ array['RS384','ES384','RS256']::text[])
);

create table if not exists private.smart_client_assertion_jti (
  client_id text not null
    references private.smart_backend_clients(client_id)
    on delete cascade,
  jti text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (client_id, jti),
  constraint smart_assertion_jti_nonempty
    check (length(btrim(jti)) between 1 and 200)
);

create index if not exists smart_client_assertion_jti_expires_idx
  on private.smart_client_assertion_jti (expires_at);

create table if not exists private.smart_access_tokens (
  token_hash text primary key,
  client_id text not null
    references private.smart_backend_clients(client_id)
    on delete cascade,
  scopes text[] not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  constraint smart_access_tokens_hash_format
    check (token_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists smart_access_tokens_expires_idx
  on private.smart_access_tokens (expires_at);

create index if not exists smart_access_tokens_client_idx
  on private.smart_access_tokens (client_id, expires_at);

revoke all on schema private from public;
revoke all on private.smart_backend_clients from public, anon, authenticated;
revoke all on private.smart_client_assertion_jti from public, anon, authenticated;
revoke all on private.smart_access_tokens from public, anon, authenticated;

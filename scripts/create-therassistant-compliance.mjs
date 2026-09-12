import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required",
  );
}

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL,
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS user_profiles
  (
    id uuid PRIMARY KEY,

    display_name text NOT NULL,

    email text,

    status text NOT NULL
      DEFAULT 'active',

    created_at timestamptz NOT NULL
      DEFAULT now(),

    updated_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE TABLE IF NOT EXISTS tenant_users
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    user_profile_id uuid NOT NULL
      REFERENCES user_profiles(id)
      ON DELETE CASCADE,

    status text NOT NULL
      DEFAULT 'active',

    created_at timestamptz NOT NULL
      DEFAULT now(),

    updated_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE UNIQUE INDEX IF NOT EXISTS
    tenant_users_unique_idx
  ON tenant_users
  (
    tenant_id,
    user_profile_id
  );


  CREATE TABLE IF NOT EXISTS tenant_user_roles
  (
    id uuid PRIMARY KEY,

    tenant_user_id uuid NOT NULL
      REFERENCES tenant_users(id)
      ON DELETE CASCADE,

    role text NOT NULL,

    created_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE UNIQUE INDEX IF NOT EXISTS
    tenant_user_roles_unique_idx
  ON tenant_user_roles
  (
    tenant_user_id,
    role
  );


  CREATE TABLE IF NOT EXISTS audit_logs
  (
    id uuid PRIMARY KEY,

    tenant_id uuid
      REFERENCES tenants(id),

    user_profile_id uuid
      REFERENCES user_profiles(id),

    action text NOT NULL,

    entity_type text,

    entity_id text,

    route text,

    method text,

    status_code integer,

    metadata jsonb NOT NULL
      DEFAULT '{}'::jsonb,

    created_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE INDEX IF NOT EXISTS
    audit_logs_created_idx
  ON audit_logs(created_at DESC);


  CREATE INDEX IF NOT EXISTS
    audit_logs_entity_idx
  ON audit_logs
  (
    entity_type,
    entity_id
  );


  CREATE TABLE IF NOT EXISTS phi_access_logs
  (
    id uuid PRIMARY KEY,

    tenant_id uuid
      REFERENCES tenants(id),

    user_profile_id uuid
      REFERENCES user_profiles(id),

    client_id uuid
      REFERENCES clients(id),

    claim_id uuid
      REFERENCES professional_claims(id),

    access_type text NOT NULL,

    route text,

    created_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE INDEX IF NOT EXISTS
    phi_access_logs_created_idx
  ON phi_access_logs(created_at DESC);


  CREATE INDEX IF NOT EXISTS
    phi_access_logs_client_idx
  ON phi_access_logs(client_id);
`);

console.log(
  "Compliance tables ready.",
);

await pool.end();

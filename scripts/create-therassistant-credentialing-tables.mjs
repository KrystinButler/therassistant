import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not available",
  );
}

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL,
});

const sql = `
CREATE TABLE IF NOT EXISTS provider_identifiers
(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL
    REFERENCES tenants(id)
    ON DELETE CASCADE,

  provider_id uuid NOT NULL
    REFERENCES providers(id)
    ON DELETE CASCADE,

  payer_id uuid
    REFERENCES payers(id),

  identifier_type text NOT NULL,
  identifier_value text NOT NULL,

  state text,

  status text NOT NULL
    DEFAULT 'active',

  effective_date date,
  expiration_date date,

  source text,
  notes text,

  created_at timestamptz NOT NULL
    DEFAULT now(),

  updated_at timestamptz NOT NULL
    DEFAULT now()
);


CREATE TABLE IF NOT EXISTS provider_payer_enrollments
(
  id uuid PRIMARY KEY,

  tenant_id uuid NOT NULL
    REFERENCES tenants(id)
    ON DELETE CASCADE,

  provider_id uuid NOT NULL
    REFERENCES providers(id)
    ON DELETE CASCADE,

  payer_id uuid NOT NULL
    REFERENCES payers(id),

  payer_plan_id uuid
    REFERENCES payer_plans(id),

  enrollment_type text NOT NULL
    DEFAULT 'individual',

  participation_status text NOT NULL
    DEFAULT 'not_enrolled',

  application_status text NOT NULL
    DEFAULT 'not_started',

  group_affiliation text NOT NULL
    DEFAULT 'not_affiliated',

  required_action text,

  effective_date date,
  termination_date date,

  reference_number text,

  submitted_at timestamptz,
  approved_at timestamptz,

  notes text,

  created_at timestamptz NOT NULL
    DEFAULT now(),

  updated_at timestamptz NOT NULL
    DEFAULT now()
);


CREATE TABLE IF NOT EXISTS payer_aliases
(
  id uuid PRIMARY KEY,

  payer_id uuid NOT NULL
    REFERENCES payers(id)
    ON DELETE CASCADE,

  alias text NOT NULL,

  normalized_alias text,

  created_at timestamptz NOT NULL
    DEFAULT now()
);


CREATE TABLE IF NOT EXISTS billing_company_practice_links
(
  id uuid PRIMARY KEY,

  billing_company_tenant_id uuid NOT NULL
    REFERENCES tenants(id)
    ON DELETE CASCADE,

  practice_tenant_id uuid NOT NULL
    REFERENCES tenants(id)
    ON DELETE CASCADE,

  status text NOT NULL
    DEFAULT 'active',

  effective_date date,

  termination_date date,

  created_at timestamptz NOT NULL
    DEFAULT now(),

  updated_at timestamptz NOT NULL
    DEFAULT now()
);


CREATE INDEX IF NOT EXISTS
provider_identifiers_provider_idx
ON provider_identifiers(provider_id);


CREATE INDEX IF NOT EXISTS
provider_payer_enrollments_provider_idx
ON provider_payer_enrollments(provider_id);


CREATE INDEX IF NOT EXISTS
provider_payer_enrollments_payer_idx
ON provider_payer_enrollments(payer_id);


CREATE UNIQUE INDEX IF NOT EXISTS
provider_payer_enrollment_unique_idx
ON provider_payer_enrollments
(
  provider_id,
  payer_id,
  enrollment_type
);


CREATE INDEX IF NOT EXISTS
payer_aliases_payer_idx
ON payer_aliases(payer_id);


CREATE UNIQUE INDEX IF NOT EXISTS
billing_company_practice_unique_idx
ON billing_company_practice_links
(
  billing_company_tenant_id,
  practice_tenant_id
);
`;

await pool.query(sql);

console.log(
  "Credentialing operational tables ready.",
);

await pool.end();

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
  CREATE TABLE IF NOT EXISTS
  medicaid_programs
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    payer_id uuid NOT NULL
      REFERENCES payers(id)
      ON DELETE CASCADE,

    program_code text NOT NULL,

    program_name text NOT NULL,

    state text NOT NULL
      DEFAULT 'CO',

    status text NOT NULL
      DEFAULT 'active',

    description text,

    demo_only boolean NOT NULL
      DEFAULT true,

    effective_date date,

    termination_date date,

    created_at timestamptz NOT NULL
      DEFAULT now(),

    updated_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE UNIQUE INDEX IF NOT EXISTS
    medicaid_program_unique_idx
  ON medicaid_programs
  (
    tenant_id,
    payer_id,
    program_code
  );


  CREATE TABLE IF NOT EXISTS
  medicaid_coding_rules
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    medicaid_program_id uuid NOT NULL
      REFERENCES medicaid_programs(id)
      ON DELETE CASCADE,

    cpt_code text NOT NULL,

    service_description text,

    requires_active_eligibility boolean NOT NULL
      DEFAULT true,

    requires_diagnosis boolean NOT NULL
      DEFAULT true,

    requires_rendering_npi boolean NOT NULL
      DEFAULT true,

    requires_signed_note_for_billing boolean NOT NULL
      DEFAULT true,

    authorization_behavior text NOT NULL
      DEFAULT 'follow_benefit_response',

    allowed_place_of_service jsonb NOT NULL
      DEFAULT '[]'::jsonb,

    guidance_text text,

    demo_only boolean NOT NULL
      DEFAULT true,

    created_at timestamptz NOT NULL
      DEFAULT now(),

    updated_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE UNIQUE INDEX IF NOT EXISTS
    medicaid_coding_rule_unique_idx
  ON medicaid_coding_rules
  (
    medicaid_program_id,
    cpt_code
  );
`);

console.log(
  "Medicaid decision-support tables ready.",
);

await pool.end();

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
  CREATE TABLE IF NOT EXISTS claim_batches
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    batch_number text NOT NULL,

    batch_status text NOT NULL
      DEFAULT 'open',

    claim_count integer NOT NULL
      DEFAULT 0,

    total_charge_cents bigint NOT NULL
      DEFAULT 0,

    created_at timestamptz NOT NULL
      DEFAULT now(),

    submitted_at timestamptz,

    updated_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE UNIQUE INDEX IF NOT EXISTS
    claim_batches_number_idx
  ON claim_batches(batch_number);


  CREATE TABLE IF NOT EXISTS claim_batch_items
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    claim_batch_id uuid NOT NULL
      REFERENCES claim_batches(id)
      ON DELETE CASCADE,

    claim_id uuid NOT NULL
      REFERENCES professional_claims(id)
      ON DELETE CASCADE,

    sequence_number integer NOT NULL,

    created_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE UNIQUE INDEX IF NOT EXISTS
    claim_batch_claim_unique_idx
  ON claim_batch_items
  (
    claim_batch_id,
    claim_id
  );


  CREATE TABLE IF NOT EXISTS claim_submissions
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    claim_batch_id uuid NOT NULL
      REFERENCES claim_batches(id)
      ON DELETE CASCADE,

    submission_type text NOT NULL
      DEFAULT '837P',

    submission_status text NOT NULL
      DEFAULT 'created',

    clearinghouse_batch_id text,

    submitted_at timestamptz,

    created_at timestamptz NOT NULL
      DEFAULT now(),

    updated_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE TABLE IF NOT EXISTS submission_responses
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    claim_submission_id uuid NOT NULL
      REFERENCES claim_submissions(id)
      ON DELETE CASCADE,

    response_type text NOT NULL,

    response_status text NOT NULL,

    control_number text,

    response_text text,

    received_at timestamptz NOT NULL
      DEFAULT now(),

    created_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE INDEX IF NOT EXISTS
    claim_batch_items_claim_idx
  ON claim_batch_items(claim_id);


  CREATE INDEX IF NOT EXISTS
    claim_submissions_batch_idx
  ON claim_submissions(claim_batch_id);
`);

console.log(
  "Claim submission tables ready.",
);

await pool.end();

import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS mailroom_items
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    received_date date NOT NULL,

    sender_name text,

    payer_id uuid
      REFERENCES payers(id),

    document_type text NOT NULL,

    subject text NOT NULL,

    status text NOT NULL
      DEFAULT 'received',

    priority text NOT NULL
      DEFAULT 'normal',

    source_channel text,

    document_url text,

    client_id uuid
      REFERENCES clients(id),

    claim_id uuid
      REFERENCES professional_claims(id),

    provider_id uuid
      REFERENCES providers(id),

    authorization_id uuid
      REFERENCES authorizations(id),

    notes text,

    routed_at timestamptz,

    completed_at timestamptz,

    created_at timestamptz NOT NULL
      DEFAULT now(),

    updated_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE INDEX IF NOT EXISTS
    mailroom_status_idx
  ON mailroom_items(status);


  CREATE INDEX IF NOT EXISTS
    mailroom_claim_idx
  ON mailroom_items(claim_id);


  CREATE TABLE IF NOT EXISTS import_batches
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    import_type text NOT NULL,

    file_name text NOT NULL,

    status text NOT NULL
      DEFAULT 'uploaded',

    total_rows integer NOT NULL
      DEFAULT 0,

    valid_rows integer NOT NULL
      DEFAULT 0,

    invalid_rows integer NOT NULL
      DEFAULT 0,

    notes text,

    validated_at timestamptz,

    created_at timestamptz NOT NULL
      DEFAULT now(),

    updated_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE TABLE IF NOT EXISTS import_rows
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    import_batch_id uuid NOT NULL
      REFERENCES import_batches(id)
      ON DELETE CASCADE,

    row_number integer NOT NULL,

    raw_data jsonb NOT NULL
      DEFAULT '{}'::jsonb,

    validation_status text NOT NULL
      DEFAULT 'pending',

    target_object_type text,

    created_at timestamptz NOT NULL
      DEFAULT now(),

    updated_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE TABLE IF NOT EXISTS import_validation_errors
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    import_batch_id uuid NOT NULL
      REFERENCES import_batches(id)
      ON DELETE CASCADE,

    import_row_id uuid NOT NULL
      REFERENCES import_rows(id)
      ON DELETE CASCADE,

    field_name text,

    error_code text NOT NULL,

    error_message text NOT NULL,

    created_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE INDEX IF NOT EXISTS
    import_rows_batch_idx
  ON import_rows(import_batch_id);


  CREATE INDEX IF NOT EXISTS
    import_validation_errors_batch_idx
  ON import_validation_errors(import_batch_id);
`);

console.log(
  "Mailroom and import-validation tables ready.",
);

await pool.end();

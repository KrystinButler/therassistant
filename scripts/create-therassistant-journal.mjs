import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS patient_journal_entries
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    client_id uuid NOT NULL
      REFERENCES clients(id)
      ON DELETE CASCADE,

    entry_date date NOT NULL,

    entry_text text NOT NULL,

    mood_rating integer,

    visibility text NOT NULL
      DEFAULT 'shared_with_provider',

    tags jsonb NOT NULL
      DEFAULT '[]'::jsonb,

    submitted_at timestamptz NOT NULL
      DEFAULT now(),

    created_at timestamptz NOT NULL
      DEFAULT now(),

    updated_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE TABLE IF NOT EXISTS journal_provider_reviews
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    journal_entry_id uuid NOT NULL
      REFERENCES patient_journal_entries(id)
      ON DELETE CASCADE,

    provider_id uuid
      REFERENCES providers(id),

    review_status text NOT NULL
      DEFAULT 'reviewed',

    review_note text,

    reviewed_at timestamptz,

    imported_to_note boolean NOT NULL
      DEFAULT false,

    imported_note_id uuid
      REFERENCES clinical_notes(id),

    created_at timestamptz NOT NULL
      DEFAULT now(),

    updated_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE UNIQUE INDEX IF NOT EXISTS
    journal_review_entry_unique_idx
  ON journal_provider_reviews(journal_entry_id);


  CREATE INDEX IF NOT EXISTS
    journal_client_date_idx
  ON patient_journal_entries
  (
    client_id,
    entry_date DESC
  );
`);

console.log(
  "Patient journal tables ready.",
);

await pool.end();

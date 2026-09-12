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
  payer_timely_filing_rules
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    payer_id uuid NOT NULL
      REFERENCES payers(id)
      ON DELETE CASCADE,

    filing_days integer NOT NULL,

    corrected_claim_days integer NOT NULL,

    reconsideration_days integer NOT NULL,

    effective_date date,

    source_note text,

    created_at timestamptz NOT NULL
      DEFAULT now(),

    updated_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE UNIQUE INDEX IF NOT EXISTS
    payer_timely_filing_rule_unique_idx
  ON payer_timely_filing_rules
  (
    tenant_id,
    payer_id
  );


  CREATE TABLE IF NOT EXISTS
  claim_follow_up_actions
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    claim_id uuid NOT NULL
      REFERENCES professional_claims(id)
      ON DELETE CASCADE,

    related_claim_id uuid
      REFERENCES professional_claims(id),

    action_type text NOT NULL,

    action_status text NOT NULL
      DEFAULT 'open',

    deadline_date date,

    reference_number text,

    reason text,

    notes text,

    requested_at timestamptz,

    submitted_at timestamptz,

    completed_at timestamptz,

    created_at timestamptz NOT NULL
      DEFAULT now(),

    updated_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE INDEX IF NOT EXISTS
    claim_follow_up_claim_idx
  ON claim_follow_up_actions
  (
    claim_id,
    created_at DESC
  );


  CREATE INDEX IF NOT EXISTS
    claim_follow_up_deadline_idx
  ON claim_follow_up_actions
  (
    deadline_date
  );


  CREATE TABLE IF NOT EXISTS
  overpayment_reviews
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    claim_id uuid NOT NULL
      REFERENCES professional_claims(id)
      ON DELETE CASCADE,

    payer_id uuid
      REFERENCES payers(id),

    detected_date date NOT NULL,

    detected_amount_cents bigint NOT NULL,

    overpayment_status text NOT NULL
      DEFAULT 'review_required',

    reason text,

    refund_due_date date,

    notes text,

    created_at timestamptz NOT NULL
      DEFAULT now(),

    updated_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE INDEX IF NOT EXISTS
    overpayment_claim_idx
  ON overpayment_reviews
  (
    claim_id
  );


  CREATE TABLE IF NOT EXISTS
  refunds
  (
    id uuid PRIMARY KEY,

    tenant_id uuid NOT NULL
      REFERENCES tenants(id)
      ON DELETE CASCADE,

    overpayment_review_id uuid NOT NULL
      REFERENCES overpayment_reviews(id)
      ON DELETE CASCADE,

    claim_id uuid NOT NULL
      REFERENCES professional_claims(id),

    payer_id uuid
      REFERENCES payers(id),

    amount_cents bigint NOT NULL,

    refund_status text NOT NULL
      DEFAULT 'pending',

    refund_method text,

    reference_number text,

    issued_date date,

    notes text,

    created_at timestamptz NOT NULL
      DEFAULT now(),

    updated_at timestamptz NOT NULL
      DEFAULT now()
  );


  CREATE INDEX IF NOT EXISTS
    refunds_claim_idx
  ON refunds(claim_id);
`);

console.log(
  "Advanced claim follow-up tables ready.",
);

await pool.end();

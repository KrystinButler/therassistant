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

const IDS = {
  tenant:
    "10000000-0000-4000-8000-000000000002",

  payers: {
    aetna:
      "30000000-0000-4000-8000-000000000001",

    uhc:
      "30000000-0000-4000-8000-000000000004",
  },

  clients: {
    jordan:
      "40000000-0000-4000-8000-000000000001",

    casey:
      "40000000-0000-4000-8000-000000000004",
  },

  claims: {
    jordan:
      "70000000-0000-4000-8000-000000000001",

    casey:
      "70000000-0000-4000-8000-000000000003",
  },

  lines: {
    jordan:
      "71000000-0000-4000-8000-000000000001",

    casey:
      "71000000-0000-4000-8000-000000000003",
  },

  contracts: {
    aetna:
      "d0000000-0000-4000-8000-000000000001",

    uhc:
      "d0000000-0000-4000-8000-000000000002",
  },

  schedules: {
    aetna:
      "d1000000-0000-4000-8000-000000000001",

    uhc:
      "d1000000-0000-4000-8000-000000000002",
  },

  feeLines: {
    aetna:
      "d2000000-0000-4000-8000-000000000001",

    uhc:
      "d2000000-0000-4000-8000-000000000002",
  },

  eraFiles: {
    aetna:
      "d3000000-0000-4000-8000-000000000001",

    uhc:
      "d3000000-0000-4000-8000-000000000002",
  },

  eraClaims: {
    jordan:
      "d4000000-0000-4000-8000-000000000001",

    casey:
      "d4000000-0000-4000-8000-000000000002",
  },

  eraLines: {
    jordan:
      "d5000000-0000-4000-8000-000000000001",

    casey:
      "d5000000-0000-4000-8000-000000000002",
  },

  eraAdjustments: {
    jordan:
      "d6000000-0000-4000-8000-000000000001",

    casey:
      "d6000000-0000-4000-8000-000000000002",
  },

  matches: {
    jordan:
      "d7000000-0000-4000-8000-000000000001",

    casey:
      "d7000000-0000-4000-8000-000000000002",
  },

  adjustments: {
    jordan:
      "d8000000-0000-4000-8000-000000000001",

    casey:
      "d8000000-0000-4000-8000-000000000002",
  },

  adjustmentAllocations: {
    jordan:
      "d9000000-0000-4000-8000-000000000001",

    casey:
      "d9000000-0000-4000-8000-000000000002",
  },
};

const client =
  await pool.connect();

try {
  await client.query("BEGIN");

  console.log(
    "Seeding payer contracts...",
  );

  await client.query(
    `
      INSERT INTO payer_contracts
      (
        id,
        tenant_id,
        payer_id,
        contract_name,
        status,
        effective_date,
        notes
      )
      VALUES
      (
        $1,
        $3,
        $4,
        'Aetna Behavioral Health Demo Contract',
        'active',
        '2026-01-01',
        'Synthetic contract for payment and fee schedule demonstration.'
      ),
      (
        $2,
        $3,
        $5,
        'UnitedHealthcare Behavioral Health Demo Contract',
        'active',
        '2026-01-01',
        'Synthetic contract used to demonstrate underpayment detection.'
      )
      ON CONFLICT (id)
      DO NOTHING
    `,
    [
      IDS.contracts.aetna,
      IDS.contracts.uhc,
      IDS.tenant,
      IDS.payers.aetna,
      IDS.payers.uhc,
    ],
  );


  console.log(
    "Seeding fee schedules...",
  );

  await client.query(
    `
      INSERT INTO fee_schedules
      (
        id,
        tenant_id,
        payer_contract_id,
        name,
        status,
        effective_date
      )
      VALUES
      (
        $1,
        $3,
        $4,
        'Aetna 2026 Behavioral Health',
        'active',
        '2026-01-01'
      ),
      (
        $2,
        $3,
        $5,
        'UHC 2026 Behavioral Health',
        'active',
        '2026-01-01'
      )
      ON CONFLICT (id)
      DO NOTHING
    `,
    [
      IDS.schedules.aetna,
      IDS.schedules.uhc,
      IDS.tenant,
      IDS.contracts.aetna,
      IDS.contracts.uhc,
    ],
  );


  await client.query(
    `
      INSERT INTO fee_schedule_lines
      (
        id,
        tenant_id,
        fee_schedule_id,
        cpt_code,
        modifier,
        rate_cents,
        unit_type
      )
      VALUES
      (
        $1,
        $3,
        $4,
        '90837',
        NULL,
        15000,
        'service'
      ),
      (
        $2,
        $3,
        $5,
        '90837',
        NULL,
        15000,
        'service'
      )
      ON CONFLICT (id)
      DO NOTHING
    `,
    [
      IDS.feeLines.aetna,
      IDS.feeLines.uhc,
      IDS.tenant,
      IDS.schedules.aetna,
      IDS.schedules.uhc,
    ],
  );


  console.log(
    "Seeding ERA files...",
  );

  await client.query(
    `
      INSERT INTO era_files
      (
        id,
        tenant_id,
        payer_id,
        file_name,
        storage_path,
        check_or_trace_number,
        payment_amount_cents,
        status,
        raw_metadata
      )
      VALUES
      (
        $1,
        $3,
        $4,
        'AETNA_835_DEMO_20260910.edi',
        '/demo/era/aetna-20260910.edi',
        'TR-AET-1001',
        12000,
        'posted',
        '{
          "format": "835",
          "demo": true
        }'::jsonb
      ),
      (
        $2,
        $3,
        $5,
        'UHC_835_DEMO_20260910.edi',
        '/demo/era/uhc-20260910.edi',
        'TR-UHC-4004',
        10500,
        'exception',
        '{
          "format": "835",
          "demo": true,
          "exception": "underpayment"
        }'::jsonb
      )
      ON CONFLICT (id)
      DO NOTHING
    `,
    [
      IDS.eraFiles.aetna,
      IDS.eraFiles.uhc,
      IDS.tenant,
      IDS.payers.aetna,
      IDS.payers.uhc,
    ],
  );


  console.log(
    "Seeding ERA claims...",
  );

  await client.query(
    `
      INSERT INTO era_claims
      (
        id,
        tenant_id,
        era_file_id,
        payer_claim_number,
        patient_control_number,
        client_id,
        claim_id,
        charge_amount_cents,
        paid_amount_cents,
        status,
        raw_data
      )
      VALUES
      (
        $1,
        $3,
        $4,
        'AET-900001',
        'TE-JE-090226',
        $6,
        $8,
        18000,
        12000,
        'matched',
        '{
          "demo": true,
          "postingOutcome": "clean"
        }'::jsonb
      ),
      (
        $2,
        $3,
        $5,
        'UHC-900003',
        'TE-CM-090426',
        $7,
        $9,
        18000,
        10500,
        'matched_exception',
        '{
          "demo": true,
          "postingOutcome": "underpayment_review"
        }'::jsonb
      )
      ON CONFLICT (id)
      DO NOTHING
    `,
    [
      IDS.eraClaims.jordan,
      IDS.eraClaims.casey,
      IDS.tenant,
      IDS.eraFiles.aetna,
      IDS.eraFiles.uhc,
      IDS.clients.jordan,
      IDS.clients.casey,
      IDS.claims.jordan,
      IDS.claims.casey,
    ],
  );


  console.log(
    "Seeding ERA service lines...",
  );

  await client.query(
    `
      INSERT INTO era_service_lines
      (
        id,
        tenant_id,
        era_claim_id,
        claim_line_id,
        service_date,
        cpt_code,
        charge_amount_cents,
        paid_amount_cents,
        raw_data
      )
      VALUES
      (
        $1,
        $3,
        $4,
        $6,
        '2026-09-02',
        '90837',
        18000,
        12000,
        '{"demo":true}'::jsonb
      ),
      (
        $2,
        $3,
        $5,
        $7,
        '2026-09-04',
        '90837',
        18000,
        10500,
        '{"demo":true}'::jsonb
      )
      ON CONFLICT (id)
      DO NOTHING
    `,
    [
      IDS.eraLines.jordan,
      IDS.eraLines.casey,
      IDS.tenant,
      IDS.eraClaims.jordan,
      IDS.eraClaims.casey,
      IDS.lines.jordan,
      IDS.lines.casey,
    ],
  );


  console.log(
    "Seeding ERA adjustments...",
  );

  await client.query(
    `
      INSERT INTO era_adjustments
      (
        id,
        tenant_id,
        era_claim_id,
        era_service_line_id,
        group_code,
        carc_code,
        rarc_code,
        amount_cents
      )
      VALUES
      (
        $1,
        $3,
        $4,
        $6,
        'CO',
        '45',
        NULL,
        3000
      ),
      (
        $2,
        $3,
        $5,
        $7,
        'CO',
        '45',
        NULL,
        3000
      )
      ON CONFLICT (id)
      DO NOTHING
    `,
    [
      IDS.eraAdjustments.jordan,
      IDS.eraAdjustments.casey,
      IDS.tenant,
      IDS.eraClaims.jordan,
      IDS.eraClaims.casey,
      IDS.eraLines.jordan,
      IDS.eraLines.casey,
    ],
  );


  console.log(
    "Seeding ERA matches...",
  );

  await client.query(
    `
      INSERT INTO era_matches
      (
        id,
        tenant_id,
        era_claim_id,
        claim_id,
        match_status,
        confidence
      )
      VALUES
      (
        $1,
        $3,
        $4,
        $6,
        'confirmed',
        1.00
      ),
      (
        $2,
        $3,
        $5,
        $7,
        'confirmed',
        1.00
      )
      ON CONFLICT (id)
      DO NOTHING
    `,
    [
      IDS.matches.jordan,
      IDS.matches.casey,
      IDS.tenant,
      IDS.eraClaims.jordan,
      IDS.eraClaims.casey,
      IDS.claims.jordan,
      IDS.claims.casey,
    ],
  );


  console.log(
    "Seeding posted adjustments...",
  );

  await client.query(
    `
      INSERT INTO adjustments
      (
        id,
        tenant_id,
        client_id,
        claim_id,
        payer_id,
        adjustment_type,
        adjustment_status,
        adjustment_date,
        amount_cents,
        reason,
        carc_code,
        posted_at
      )
      VALUES
      (
        $1,
        $3,
        $4,
        $6,
        $8,
        'contractual',
        'posted',
        '2026-09-10',
        3000,
        'Contractual adjustment from ERA.',
        '45',
        '2026-09-10T16:10:00Z'
      ),
      (
        $2,
        $3,
        $5,
        $7,
        $9,
        'contractual',
        'posted',
        '2026-09-10',
        3000,
        'Contractual adjustment from ERA. Remaining variance requires underpayment review.',
        '45',
        '2026-09-10T17:10:00Z'
      )
      ON CONFLICT (id)
      DO NOTHING
    `,
    [
      IDS.adjustments.jordan,
      IDS.adjustments.casey,
      IDS.tenant,
      IDS.clients.jordan,
      IDS.clients.casey,
      IDS.claims.jordan,
      IDS.claims.casey,
      IDS.payers.aetna,
      IDS.payers.uhc,
    ],
  );


  await client.query(
    `
      INSERT INTO adjustment_allocations
      (
        id,
        tenant_id,
        adjustment_id,
        client_id,
        claim_id,
        claim_line_id,
        amount_cents
      )
      VALUES
      (
        $1,
        $3,
        $4,
        $6,
        $8,
        $10,
        3000
      ),
      (
        $2,
        $3,
        $5,
        $7,
        $9,
        $11,
        3000
      )
      ON CONFLICT (id)
      DO NOTHING
    `,
    [
      IDS.adjustmentAllocations.jordan,
      IDS.adjustmentAllocations.casey,
      IDS.tenant,
      IDS.adjustments.jordan,
      IDS.adjustments.casey,
      IDS.clients.jordan,
      IDS.clients.casey,
      IDS.claims.jordan,
      IDS.claims.casey,
      IDS.lines.jordan,
      IDS.lines.casey,
    ],
  );


  await client.query("COMMIT");

  console.log(
    "Remittance demo seed complete.",
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

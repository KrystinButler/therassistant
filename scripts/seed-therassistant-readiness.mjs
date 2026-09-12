import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not available",
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const IDS = {
  tenant:
    "10000000-0000-4000-8000-000000000002",

  clients: {
    jordan:
      "40000000-0000-4000-8000-000000000001",

    morgan:
      "40000000-0000-4000-8000-000000000002",

    taylor:
      "40000000-0000-4000-8000-000000000003",

    casey:
      "40000000-0000-4000-8000-000000000004",
  },

  policies: {
    jordan:
      "41000000-0000-4000-8000-000000000001",

    morgan:
      "41000000-0000-4000-8000-000000000002",

    taylor:
      "41000000-0000-4000-8000-000000000003",

    casey:
      "41000000-0000-4000-8000-000000000004",
  },

  appointments: {
    jordan:
      "50000000-0000-4000-8000-000000000001",

    taylor:
      "50000000-0000-4000-8000-000000000003",
  },

  payers: {
    aetna:
      "30000000-0000-4000-8000-000000000001",

    medicaid:
      "30000000-0000-4000-8000-000000000003",
  },

  diagnoses: {
    jordan:
      "b0000000-0000-4000-8000-000000000001",

    morgan:
      "b0000000-0000-4000-8000-000000000002",

    taylor:
      "b0000000-0000-4000-8000-000000000003",

    casey:
      "b0000000-0000-4000-8000-000000000004",
  },

  checkins: {
    jordan:
      "b1000000-0000-4000-8000-000000000001",
  },

  eligibility: {
    jordan:
      "b2000000-0000-4000-8000-000000000001",

    taylor:
      "b2000000-0000-4000-8000-000000000002",
  },

  benefits: {
    jordan:
      "b3000000-0000-4000-8000-000000000001",

    taylor:
      "b3000000-0000-4000-8000-000000000002",
  },

  authorization:
    "b4000000-0000-4000-8000-000000000001",

  authorizationUnit:
    "b5000000-0000-4000-8000-000000000001",
};

const client = await pool.connect();

try {
  await client.query("BEGIN");

  console.log(
    "Seeding active diagnoses...",
  );

  await client.query(
    `
      INSERT INTO client_diagnoses
      (
        id,
        tenant_id,
        client_id,
        diagnosis_code,
        description,
        diagnosis_status,
        onset_date
      )
      VALUES
        (
          $1, $5, $6,
          'F41.1',
          'Generalized anxiety disorder',
          'active',
          '2026-07-01'
        ),
        (
          $2, $5, $7,
          'F33.1',
          'Major depressive disorder, recurrent, moderate',
          'active',
          '2026-07-15'
        ),
        (
          $3, $5, $8,
          'F43.23',
          'Adjustment disorder with mixed anxiety and depressed mood',
          'active',
          '2026-08-01'
        ),
        (
          $4, $5, $9,
          'F32.1',
          'Major depressive disorder, single episode, moderate',
          'active',
          '2026-07-10'
        )
      ON CONFLICT (id) DO NOTHING
    `,
    [
      IDS.diagnoses.jordan,
      IDS.diagnoses.morgan,
      IDS.diagnoses.taylor,
      IDS.diagnoses.casey,
      IDS.tenant,
      IDS.clients.jordan,
      IDS.clients.morgan,
      IDS.clients.taylor,
      IDS.clients.casey,
    ],
  );


  console.log(
    "Seeding historical client check-in...",
  );

  await client.query(
    `
      INSERT INTO client_checkins
      (
        id,
        tenant_id,
        appointment_id,
        client_id,
        on_my_way_at,
        arrived_at,
        checked_in_at,
        responses
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        '2026-09-02T15:35:00Z',
        '2026-09-02T15:50:00Z',
        '2026-09-02T15:52:00Z',
        '{
          "demographicsConfirmed": true,
          "insuranceConfirmed": true,
          "contactInformationConfirmed": true,
          "questionnaireComplete": true,
          "billingInformationReviewed": true
        }'::jsonb
      )
      ON CONFLICT (id) DO NOTHING
    `,
    [
      IDS.checkins.jordan,
      IDS.tenant,
      IDS.appointments.jordan,
      IDS.clients.jordan,
    ],
  );


  console.log(
    "Seeding eligibility checks...",
  );

  await client.query(
    `
      INSERT INTO eligibility_checks
      (
        id,
        tenant_id,
        client_id,
        insurance_policy_id,
        payer_id,
        service_date,
        eligibility_status,
        response_source,
        raw_response,
        notes
      )
      VALUES
      (
        $1,
        $7,
        $8,
        $9,
        $10,
        '2026-09-02',
        'active',
        'demo_270_271',
        '{
          "coverageActive": true,
          "demo": true
        }'::jsonb,
        'Coverage active for the demonstrated service date.'
      ),
      (
        $2,
        $7,
        $11,
        $12,
        $13,
        '2026-09-15',
        'active',
        'demo_medicaid_eligibility',
        '{
          "coverageActive": true,
          "program": "Health First Colorado",
          "demo": true
        }'::jsonb,
        'Active Medicaid coverage. Authorization utilization requires review before the upcoming service.'
      )
      ON CONFLICT (id) DO NOTHING
    `,
    [
      IDS.eligibility.jordan,
      IDS.eligibility.taylor,

      IDS.tenant,

      IDS.clients.jordan,
      IDS.policies.jordan,
      IDS.payers.aetna,

      IDS.tenant,

      IDS.clients.taylor,
      IDS.policies.taylor,
      IDS.payers.medicaid,
    ],
  );


  console.log(
    "Seeding eligibility benefits...",
  );

  await client.query(
    `
      INSERT INTO eligibility_benefits
      (
        id,
        tenant_id,
        eligibility_check_id,
        benefit_type,
        cpt_code,
        copay_cents,
        coinsurance_percent,
        deductible_remaining_cents,
        oop_remaining_cents,
        authorization_required,
        network_status,
        notes
      )
      VALUES
      (
        $1,
        $3,
        $4,
        'behavioral_health_outpatient',
        '90837',
        3000,
        0,
        0,
        175000,
        false,
        'in_network',
        'Synthetic commercial behavioral health benefit.'
      ),
      (
        $2,
        $3,
        $5,
        'behavioral_health_outpatient',
        '90837',
        0,
        0,
        0,
        0,
        true,
        'in_network',
        'Synthetic Medicaid demo benefit. Authorization utilization review is required for this scenario.'
      )
      ON CONFLICT (id) DO NOTHING
    `,
    [
      IDS.benefits.jordan,
      IDS.benefits.taylor,

      IDS.tenant,

      IDS.eligibility.jordan,
      IDS.eligibility.taylor,
    ],
  );


  console.log(
    "Seeding Medicaid authorization...",
  );

  await client.query(
    `
      INSERT INTO authorizations
      (
        id,
        tenant_id,
        client_id,
        payer_id,
        authorization_number,
        status,
        start_date,
        end_date,
        notes
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        'DEMO-AUTH-90837-001',
        'active',
        '2026-08-01',
        '2026-09-30',
        'Synthetic authorization created to demonstrate utilization tracking and expiration warnings.'
      )
      ON CONFLICT (id) DO NOTHING
    `,
    [
      IDS.authorization,
      IDS.tenant,
      IDS.clients.taylor,
      IDS.payers.medicaid,
    ],
  );


  await client.query(
    `
      INSERT INTO authorization_units
      (
        id,
        tenant_id,
        authorization_id,
        cpt_code,
        authorized_units,
        used_units,
        remaining_units
      )
      VALUES
      (
        $1,
        $2,
        $3,
        '90837',
        12,
        11,
        1
      )
      ON CONFLICT (id) DO NOTHING
    `,
    [
      IDS.authorizationUnit,
      IDS.tenant,
      IDS.authorization,
    ],
  );


  console.log(
    "Seeding client balance summaries...",
  );

  await client.query(
    `
      INSERT INTO client_balance_summaries
      (
        client_id,
        tenant_id,
        open_balance_cents,
        credit_balance_cents,
        last_calculated_at
      )
      VALUES
        ($1, $5, 0, 0, now()),
        ($2, $5, 18000, 0, now()),
        ($3, $5, 0, 0, now()),
        ($4, $5, 4500, 0, now())
      ON CONFLICT (client_id)
      DO UPDATE SET
        open_balance_cents =
          EXCLUDED.open_balance_cents,
        credit_balance_cents =
          EXCLUDED.credit_balance_cents,
        last_calculated_at = now()
    `,
    [
      IDS.clients.jordan,
      IDS.clients.morgan,
      IDS.clients.taylor,
      IDS.clients.casey,
      IDS.tenant,
    ],
  );


  await client.query("COMMIT");

  console.log("");
  console.log(
    "Readiness seed completed successfully.",
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

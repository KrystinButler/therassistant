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

  client:
    "40000000-0000-4000-8000-000000000001",

  provider:
    "20000000-0000-4000-8000-000000000001",

  payer:
    "30000000-0000-4000-8000-000000000001",

  treatmentPlan:
    "51000000-0000-4000-8000-000000000001",

  appointment:
    "c0000000-0000-4000-8000-000000000001",

  note:
    "c1000000-0000-4000-8000-000000000001",

  signature:
    "c2000000-0000-4000-8000-000000000001",

  charge:
    "c3000000-0000-4000-8000-000000000001",
};

const client =
  await pool.connect();

try {
  await client.query("BEGIN");

  await client.query(
    `
      INSERT INTO appointments
      (
        id,
        tenant_id,
        client_id,
        provider_id,
        starts_at,
        ends_at,
        appointment_status,
        location_type,
        service_type,
        cpt_code,
        notes,
        completed_at
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        '2026-09-08T16:00:00Z',
        '2026-09-08T16:53:00Z',
        'completed',
        'telehealth',
        'psychotherapy',
        '90837',
        'Synthetic completed appointment for charge-to-claim demonstration.',
        '2026-09-08T16:53:00Z'
      )
      ON CONFLICT (id)
      DO NOTHING
    `,
    [
      IDS.appointment,
      IDS.tenant,
      IDS.client,
      IDS.provider,
    ],
  );

  await client.query(
    `
      INSERT INTO clinical_notes
      (
        id,
        tenant_id,
        client_id,
        appointment_id,
        provider_id,
        treatment_plan_id,
        note_type,
        note_status,
        service_date,
        start_time,
        end_time,
        duration_minutes,
        cpt_code,
        diagnosis_code,
        goal_addressed,
        note_text,
        locked_at
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        'progress_note',
        'signed',
        '2026-09-08',
        '10:00',
        '10:53',
        53,
        '90837',
        'F41.1',
        'Reduce frequency and intensity of anxiety symptoms.',
        'Client practiced grounding and cognitive restructuring strategies and reviewed progress toward treatment goals.',
        '2026-09-08T17:05:00Z'
      )
      ON CONFLICT (id)
      DO NOTHING
    `,
    [
      IDS.note,
      IDS.tenant,
      IDS.client,
      IDS.appointment,
      IDS.provider,
      IDS.treatmentPlan,
    ],
  );

  await client.query(
    `
      INSERT INTO clinical_note_signatures
      (
        id,
        tenant_id,
        clinical_note_id,
        signer_id,
        signed_at,
        signature_text
      )
      VALUES
      (
        $1,
        $2,
        $3,
        NULL,
        '2026-09-08T17:05:00Z',
        'Jamie Parker, LCSW'
      )
      ON CONFLICT (id)
      DO NOTHING
    `,
    [
      IDS.signature,
      IDS.tenant,
      IDS.note,
    ],
  );

  await client.query(
    `
      INSERT INTO charge_capture_items
      (
        id,
        tenant_id,
        client_id,
        appointment_id,
        clinical_note_id,
        provider_id,
        payer_id,
        service_date,
        cpt_code,
        diagnosis_code,
        place_of_service,
        charge_amount_cents,
        charge_status,
        block_reason
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        '2026-09-08',
        '90837',
        'F41.1',
        '10',
        18000,
        'captured',
        NULL
      )
      ON CONFLICT (id)
      DO NOTHING
    `,
    [
      IDS.charge,
      IDS.tenant,
      IDS.client,
      IDS.appointment,
      IDS.note,
      IDS.provider,
      IDS.payer,
    ],
  );

  await client.query("COMMIT");

  console.log(
    "Charge-to-claim demo record ready.",
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required",
  );
}

const pool =
  new Pool({
    connectionString:
      process.env.DATABASE_URL,
  });

const client =
  await pool.connect();

try {
  await client.query("BEGIN");


  const taylorResult =
    await client.query(`
      SELECT
        id,
        tenant_id

      FROM clients

      WHERE
        first_name = 'Taylor'
        AND last_name = 'Brooks'

      LIMIT 1
    `);


  if (!taylorResult.rows.length) {
    throw new Error(
      "Taylor Brooks demo client was not found.",
    );
  }


  const taylor =
    taylorResult.rows[0];


  const providerResult =
    await client.query(
      `
        SELECT id

        FROM providers

        WHERE tenant_id = $1

        ORDER BY
          CASE
            WHEN provider_status =
              'active'
            THEN 0
            ELSE 1
          END,
          created_at

        LIMIT 1
      `,
      [
        taylor.tenant_id,
      ],
    );


  if (!providerResult.rows.length) {
    throw new Error(
      "No demo provider was found.",
    );
  }


  const providerId =
    providerResult.rows[0].id;


  const upcoming =
    await client.query(
      `
        SELECT id

        FROM appointments

        WHERE
          client_id = $1

          AND starts_at >=
            '2026-09-11T00:00:00Z'

          AND appointment_status
            NOT IN (
              'cancelled',
              'no_show'
            )

        ORDER BY starts_at

        LIMIT 1
      `,
      [
        taylor.id,
      ],
    );


  if (!upcoming.rows.length) {
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
          notes
        )
        VALUES
        (
          'dc000000-0000-4000-8000-000000000001',
          $1,
          $2,
          $3,
          '2026-09-12T16:00:00Z',
          '2026-09-12T16:53:00Z',
          'scheduled',
          'telehealth',
          'psychotherapy',
          '90837',
          'Synthetic appointment for patient portal and mobile check-in demonstration.'
        )

        ON CONFLICT (id)
        DO NOTHING
      `,
      [
        taylor.tenant_id,
        taylor.id,
        providerId,
      ],
    );

    console.log(
      "Created Taylor Brooks patient-portal appointment.",
    );
  } else {
    console.log(
      `Using existing upcoming Taylor Brooks appointment ${upcoming.rows[0].id}.`,
    );
  }


  await client.query("COMMIT");
} catch (error) {
  await client.query(
    "ROLLBACK",
  );

  throw error;
} finally {
  client.release();

  await pool.end();
}

import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not available");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const IDS = {
  tenants: {
    billing: "10000000-0000-4000-8000-000000000001",
    frontRange: "10000000-0000-4000-8000-000000000002",
    summit: "10000000-0000-4000-8000-000000000003",
  },

  providers: {
    jamie: "20000000-0000-4000-8000-000000000001",
    alex: "20000000-0000-4000-8000-000000000002",
  },

  payers: {
    aetna: "30000000-0000-4000-8000-000000000001",
    anthem: "30000000-0000-4000-8000-000000000002",
    medicaid: "30000000-0000-4000-8000-000000000003",
    uhc: "30000000-0000-4000-8000-000000000004",
  },

  plans: {
    aetnaOpenChoice: "31000000-0000-4000-8000-000000000001",
    anthemPpo: "31000000-0000-4000-8000-000000000002",
    medicaidColorado: "31000000-0000-4000-8000-000000000003",
    uhcChoice: "31000000-0000-4000-8000-000000000004",
  },

  clients: {
    jordan: "40000000-0000-4000-8000-000000000001",
    morgan: "40000000-0000-4000-8000-000000000002",
    taylor: "40000000-0000-4000-8000-000000000003",
    casey: "40000000-0000-4000-8000-000000000004",
  },

  policies: {
    jordan: "41000000-0000-4000-8000-000000000001",
    morgan: "41000000-0000-4000-8000-000000000002",
    taylor: "41000000-0000-4000-8000-000000000003",
    casey: "41000000-0000-4000-8000-000000000004",
  },

  appointments: {
    jordan: "50000000-0000-4000-8000-000000000001",
    morgan: "50000000-0000-4000-8000-000000000002",
    taylor: "50000000-0000-4000-8000-000000000003",
    casey: "50000000-0000-4000-8000-000000000004",
  },

  treatmentPlans: {
    jordan: "51000000-0000-4000-8000-000000000001",
    morgan: "51000000-0000-4000-8000-000000000002",
    taylor: "51000000-0000-4000-8000-000000000003",
    casey: "51000000-0000-4000-8000-000000000004",
  },

  goals: {
    jordan: "52000000-0000-4000-8000-000000000001",
    morgan: "52000000-0000-4000-8000-000000000002",
    taylor: "52000000-0000-4000-8000-000000000003",
    casey: "52000000-0000-4000-8000-000000000004",
  },

  notes: {
    jordan: "53000000-0000-4000-8000-000000000001",
    morgan: "53000000-0000-4000-8000-000000000002",
    taylor: "53000000-0000-4000-8000-000000000003",
    casey: "53000000-0000-4000-8000-000000000004",
  },

  signatures: {
    jordan: "54000000-0000-4000-8000-000000000001",
    morgan: "54000000-0000-4000-8000-000000000002",
    taylor: "54000000-0000-4000-8000-000000000003",
    casey: "54000000-0000-4000-8000-000000000004",
  },

  charges: {
    jordan: "60000000-0000-4000-8000-000000000001",
    morgan: "60000000-0000-4000-8000-000000000002",
    taylor: "60000000-0000-4000-8000-000000000003",
    casey: "60000000-0000-4000-8000-000000000004",
    jamieIssue: "60000000-0000-4000-8000-000000000005",
  },

  claims: {
    jordan: "70000000-0000-4000-8000-000000000001",
    morgan: "70000000-0000-4000-8000-000000000002",
    casey: "70000000-0000-4000-8000-000000000003",
    jamieIssue: "70000000-0000-4000-8000-000000000004",
  },

  claimLines: {
    jordan: "71000000-0000-4000-8000-000000000001",
    morgan: "71000000-0000-4000-8000-000000000002",
    casey: "71000000-0000-4000-8000-000000000003",
    jamieIssue: "71000000-0000-4000-8000-000000000004",
  },

  diagnoses: {
    jordan: "72000000-0000-4000-8000-000000000001",
    morgan: "72000000-0000-4000-8000-000000000002",
    casey: "72000000-0000-4000-8000-000000000003",
    jamieIssue: "72000000-0000-4000-8000-000000000004",
  },

  statusHistory: {
    jordan1: "73000000-0000-4000-8000-000000000001",
    jordan2: "73000000-0000-4000-8000-000000000002",
    morgan1: "73000000-0000-4000-8000-000000000003",
    morgan2: "73000000-0000-4000-8000-000000000004",
    casey1: "73000000-0000-4000-8000-000000000005",
    jamie1: "73000000-0000-4000-8000-000000000006",
  },

  claimNotes: {
    morgan: "74000000-0000-4000-8000-000000000001",
    casey: "74000000-0000-4000-8000-000000000002",
    jamie: "74000000-0000-4000-8000-000000000003",
  },

  denials: {
    morgan: "80000000-0000-4000-8000-000000000001",
  },

  appeals: {
    morgan: "81000000-0000-4000-8000-000000000001",
  },

  payments: {
    jordan: "90000000-0000-4000-8000-000000000001",
    casey: "90000000-0000-4000-8000-000000000002",
  },

  allocations: {
    jordan: "91000000-0000-4000-8000-000000000001",
    casey: "91000000-0000-4000-8000-000000000002",
  },

  work: {
    denial: "a0000000-0000-4000-8000-000000000001",
    credentialing: "a0000000-0000-4000-8000-000000000002",
    underpayment: "a0000000-0000-4000-8000-000000000003",
    authorization: "a0000000-0000-4000-8000-000000000004",
    documentation: "a0000000-0000-4000-8000-000000000005",
  },

  workHistory: {
    denial: "a1000000-0000-4000-8000-000000000001",
    credentialing: "a1000000-0000-4000-8000-000000000002",
    underpayment: "a1000000-0000-4000-8000-000000000003",
  },
};

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function seed() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    console.log("Seeding tenants...");

    await client.query(`
      INSERT INTO tenants
        (id, name, tenant_type, status, timezone, settings)
      VALUES
        ($1, 'Therassistant Revenue Cycle Services', 'billing_company', 'active', 'America/Denver',
          '{"demo":true,"multiPractice":true}'::jsonb),
        ($2, 'Front Range Behavioral Health', 'practice', 'active', 'America/Denver',
          '{"demo":true,"specialty":"behavioral_health"}'::jsonb),
        ($3, 'Summit Mental Health', 'practice', 'active', 'America/Denver',
          '{"demo":true,"specialty":"behavioral_health"}'::jsonb)
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.tenants.billing,
      IDS.tenants.frontRange,
      IDS.tenants.summit,
    ]);

    console.log("Seeding payers and plans...");

    await client.query(`
      INSERT INTO payers
        (id, name, normalized_name, payer_type, clearinghouse_payer_id)
      VALUES
        ($1, 'Aetna', 'AETNA', 'commercial', '60054'),
        ($2, 'Anthem Blue Cross Blue Shield', 'ANTHEM BCBS', 'commercial', '00805'),
        ($3, 'Health First Colorado', 'COLORADO MEDICAID', 'medicaid', 'CO_TXIX'),
        ($4, 'UnitedHealthcare', 'UNITEDHEALTHCARE', 'commercial', '87726')
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.payers.aetna,
      IDS.payers.anthem,
      IDS.payers.medicaid,
      IDS.payers.uhc,
    ]);

    await client.query(`
      INSERT INTO payer_plans
        (id, payer_id, name, plan_type)
      VALUES
        ($1, $5, 'Open Choice PPO', 'PPO'),
        ($2, $6, 'Pathway PPO', 'PPO'),
        ($3, $7, 'Health First Colorado Medicaid', 'Medicaid'),
        ($4, $8, 'Choice Plus', 'PPO')
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.plans.aetnaOpenChoice,
      IDS.plans.anthemPpo,
      IDS.plans.medicaidColorado,
      IDS.plans.uhcChoice,
      IDS.payers.aetna,
      IDS.payers.anthem,
      IDS.payers.medicaid,
      IDS.payers.uhc,
    ]);

    console.log("Seeding providers...");

    await client.query(`
      INSERT INTO providers
        (
          id, tenant_id, first_name, last_name, credentials,
          provider_status, individual_npi, taxonomy_code,
          email, phone
        )
      VALUES
        (
          $1, $3, 'Jamie', 'Parker', 'LCSW',
          'active', '1234567890', '1041C0700X',
          'jamie.parker@example.test', '303-555-0101'
        ),
        (
          $2, $3, 'Alex', 'Rivera', 'LPC',
          'active', '1098765432', '101YP2500X',
          'alex.rivera@example.test', '303-555-0102'
        )
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.providers.jamie,
      IDS.providers.alex,
      IDS.tenants.frontRange,
    ]);

    console.log("Seeding clients...");

    await client.query(`
      INSERT INTO clients
        (
          id, tenant_id, first_name, last_name, preferred_name,
          date_of_birth, email, phone, city, state, postal_code,
          client_status, registration_status,
          billing_readiness_status, search_name, metadata
        )
      VALUES
        (
          $1, $5, 'Jordan', 'Ellis', 'Jordan',
          '1992-04-18', 'jordan.ellis@example.test', '303-555-0201',
          'Arvada', 'CO', '80003',
          'active', 'complete', 'ready',
          'ellis jordan',
          '{"demoScenario":"clean_revenue_cycle"}'::jsonb
        ),
        (
          $2, $5, 'Morgan', 'Reed', 'Morgan',
          '1987-11-03', 'morgan.reed@example.test', '303-555-0202',
          'Lakewood', 'CO', '80226',
          'active', 'complete', 'needs_follow_up',
          'reed morgan',
          '{"demoScenario":"denial_appeal"}'::jsonb
        ),
        (
          $3, $5, 'Taylor', 'Brooks', 'Taylor',
          '1995-07-29', 'taylor.brooks@example.test', '303-555-0203',
          'Denver', 'CO', '80204',
          'active', 'complete', 'authorization_review',
          'brooks taylor',
          '{"demoScenario":"medicaid_authorization"}'::jsonb
        ),
        (
          $4, $5, 'Casey', 'Martin', 'Casey',
          '1979-01-15', 'casey.martin@example.test', '303-555-0204',
          'Westminster', 'CO', '80031',
          'active', 'complete', 'payment_review',
          'martin casey',
          '{"demoScenario":"underpayment"}'::jsonb
        )
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.clients.jordan,
      IDS.clients.morgan,
      IDS.clients.taylor,
      IDS.clients.casey,
      IDS.tenants.frontRange,
    ]);

    console.log("Seeding insurance policies...");

    await client.query(`
      INSERT INTO client_insurance_policies
        (
          id, tenant_id, client_id, payer_id, payer_plan_id,
          insurance_order, status, member_id, group_number,
          subscriber_name, relationship_to_subscriber,
          effective_date, metadata
        )
      VALUES
        (
          $1, $9, $5, $10, $13,
          1, 'active', 'AET100001', 'GRP-A100',
          'Jordan Ellis', 'self', '2026-01-01',
          '{"networkStatus":"in_network"}'::jsonb
        ),
        (
          $2, $9, $6, $11, $14,
          1, 'active', 'ANT200002', 'GRP-B200',
          'Morgan Reed', 'self', '2026-01-01',
          '{"networkStatus":"in_network"}'::jsonb
        ),
        (
          $3, $9, $7, $12, $15,
          1, 'active', 'CO300003', null,
          'Taylor Brooks', 'self', '2026-01-01',
          '{"networkStatus":"in_network","program":"Health First Colorado"}'::jsonb
        ),
        (
          $4, $9, $8, $16, $17,
          1, 'active', 'UHC400004', 'GRP-D400',
          'Casey Martin', 'self', '2026-01-01',
          '{"networkStatus":"in_network"}'::jsonb
        )
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.policies.jordan,
      IDS.policies.morgan,
      IDS.policies.taylor,
      IDS.policies.casey,
      IDS.clients.jordan,
      IDS.clients.morgan,
      IDS.clients.taylor,
      IDS.clients.casey,
      IDS.tenants.frontRange,
      IDS.payers.aetna,
      IDS.payers.anthem,
      IDS.payers.medicaid,
      IDS.plans.aetnaOpenChoice,
      IDS.plans.anthemPpo,
      IDS.plans.medicaidColorado,
      IDS.payers.uhc,
      IDS.plans.uhcChoice,
    ]);

    console.log("Seeding treatment plans...");

    await client.query(`
      INSERT INTO treatment_plans
        (
          id, tenant_id, client_id, provider_id,
          status, effective_date, review_due_date,
          signed_at, plan_text
        )
      VALUES
        (
          $1, $13, $5, $14,
          'active', '2026-07-01', '2026-10-01',
          '2026-07-01T15:00:00Z',
          'Reduce anxiety symptoms and improve coping skills.'
        ),
        (
          $2, $13, $6, $14,
          'active', '2026-07-15', '2026-10-15',
          '2026-07-15T15:00:00Z',
          'Improve mood regulation and daily functioning.'
        ),
        (
          $3, $13, $7, $15,
          'active', '2026-08-01', '2026-11-01',
          '2026-08-01T15:00:00Z',
          'Improve emotional regulation and reduce functional impairment.'
        ),
        (
          $4, $13, $8, $15,
          'active', '2026-07-10', '2026-10-10',
          '2026-07-10T15:00:00Z',
          'Increase coping skills and reduce depressive symptoms.'
        )
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.treatmentPlans.jordan,
      IDS.treatmentPlans.morgan,
      IDS.treatmentPlans.taylor,
      IDS.treatmentPlans.casey,
      IDS.clients.jordan,
      IDS.clients.morgan,
      IDS.clients.taylor,
      IDS.clients.casey,
      IDS.tenants.frontRange,
      IDS.providers.jamie,
      IDS.providers.alex,
    ]);

    await client.query(`
      INSERT INTO treatment_plan_goals
        (
          id, tenant_id, treatment_plan_id,
          goal_text, objective_text, status
        )
      VALUES
        ($1, $9, $5,
          'Reduce frequency and intensity of anxiety symptoms.',
          'Client will use two coping skills at least four days per week.',
          'active'),
        ($2, $9, $6,
          'Improve mood stability.',
          'Client will identify and challenge unhelpful thought patterns.',
          'active'),
        ($3, $9, $7,
          'Improve emotional regulation.',
          'Client will practice grounding strategies between sessions.',
          'active'),
        ($4, $9, $8,
          'Reduce depressive symptoms.',
          'Client will increase engagement in planned healthy activities.',
          'active')
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.goals.jordan,
      IDS.goals.morgan,
      IDS.goals.taylor,
      IDS.goals.casey,
      IDS.treatmentPlans.jordan,
      IDS.treatmentPlans.morgan,
      IDS.treatmentPlans.taylor,
      IDS.treatmentPlans.casey,
      IDS.tenants.frontRange,
    ]);

    console.log("Seeding appointments...");

    await client.query(`
      INSERT INTO appointments
        (
          id, tenant_id, client_id, provider_id,
          starts_at, ends_at, appointment_status,
          location_type, service_type, cpt_code,
          notes, completed_at
        )
      VALUES
        (
          $1, $9, $5, $10,
          '2026-09-02T16:00:00Z', '2026-09-02T16:53:00Z',
          'completed', 'telehealth', 'psychotherapy', '90837',
          'Routine psychotherapy follow-up.',
          '2026-09-02T16:53:00Z'
        ),
        (
          $2, $9, $6, $10,
          '2026-09-03T17:00:00Z', '2026-09-03T17:53:00Z',
          'completed', 'office', 'psychotherapy', '90837',
          'Routine psychotherapy visit.',
          '2026-09-03T17:53:00Z'
        ),
        (
          $3, $9, $7, $11,
          '2026-09-15T15:00:00Z', '2026-09-15T15:53:00Z',
          'scheduled', 'telehealth', 'psychotherapy', '90837',
          'Medicaid client; authorization review required before service.',
          null
        ),
        (
          $4, $9, $8, $11,
          '2026-09-04T18:00:00Z', '2026-09-04T18:53:00Z',
          'completed', 'telehealth', 'psychotherapy', '90837',
          'Routine psychotherapy follow-up.',
          '2026-09-04T18:53:00Z'
        )
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.appointments.jordan,
      IDS.appointments.morgan,
      IDS.appointments.taylor,
      IDS.appointments.casey,
      IDS.clients.jordan,
      IDS.clients.morgan,
      IDS.clients.taylor,
      IDS.clients.casey,
      IDS.tenants.frontRange,
      IDS.providers.jamie,
      IDS.providers.alex,
    ]);

    console.log("Seeding clinical notes...");

    await client.query(`
      INSERT INTO clinical_notes
        (
          id, tenant_id, client_id, appointment_id,
          provider_id, treatment_plan_id,
          note_type, note_status, service_date,
          start_time, end_time, duration_minutes,
          cpt_code, diagnosis_code, goal_addressed,
          note_text, locked_at
        )
      VALUES
        (
          $1, $13, $5, $9, $14, $17,
          'progress_note', 'signed', '2026-09-02',
          '10:00', '10:53', 53,
          '90837', 'F41.1',
          'Reduce frequency and intensity of anxiety symptoms.',
          'Client reviewed recent anxiety triggers and practiced grounding and cognitive restructuring strategies.',
          '2026-09-02T17:10:00Z'
        ),
        (
          $2, $13, $6, $10, $14, $18,
          'progress_note', 'signed', '2026-09-03',
          '11:00', '11:53', 53,
          '90837', 'F33.1',
          'Improve mood stability.',
          'Client discussed mood symptoms and identified behavioral activation strategies.',
          '2026-09-03T18:05:00Z'
        ),
        (
          $3, $13, $7, $11, $15, $19,
          'progress_note', 'draft', '2026-09-15',
          '09:00', '09:53', 53,
          '90837', 'F43.23',
          'Improve emotional regulation.',
          'Draft note reserved for upcoming Medicaid authorization demonstration.',
          null
        ),
        (
          $4, $13, $8, $12, $15, $20,
          'progress_note', 'signed', '2026-09-04',
          '12:00', '12:53', 53,
          '90837', 'F32.1',
          'Reduce depressive symptoms.',
          'Client reviewed progress with behavioral activation and activity scheduling.',
          '2026-09-04T19:10:00Z'
        )
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.notes.jordan,
      IDS.notes.morgan,
      IDS.notes.taylor,
      IDS.notes.casey,
      IDS.clients.jordan,
      IDS.clients.morgan,
      IDS.clients.taylor,
      IDS.clients.casey,
      IDS.appointments.jordan,
      IDS.appointments.morgan,
      IDS.appointments.taylor,
      IDS.appointments.casey,
      IDS.tenants.frontRange,
      IDS.providers.jamie,
      IDS.providers.alex,
      IDS.treatmentPlans.jordan,
      IDS.treatmentPlans.morgan,
      IDS.treatmentPlans.taylor,
      IDS.treatmentPlans.casey,
    ]);

    await client.query(`
      INSERT INTO clinical_note_signatures
        (
          id, tenant_id, clinical_note_id,
          signed_at, signature_text
        )
      VALUES
        ($1, $9, $5, '2026-09-02T17:10:00Z', 'Jamie Parker, LCSW'),
        ($2, $9, $6, '2026-09-03T18:05:00Z', 'Jamie Parker, LCSW'),
        ($3, $9, $7, '2026-09-04T19:10:00Z', 'Alex Rivera, LPC')
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.signatures.jordan,
      IDS.signatures.morgan,
      IDS.signatures.casey,
      IDS.notes.jordan,
      IDS.notes.morgan,
      IDS.notes.casey,
      IDS.tenants.frontRange,
    ]);

    console.log("Seeding charges...");

    await client.query(`
      INSERT INTO charge_capture_items
        (
          id, tenant_id, client_id, appointment_id,
          clinical_note_id, provider_id, payer_id,
          service_date, cpt_code, diagnosis_code,
          place_of_service, charge_amount_cents,
          charge_status, block_reason
        )
      VALUES
        (
          $1, $14, $5, $9, $10, $11, $15,
          '2026-09-02', '90837', 'F41.1',
          '10', 18000, 'ready_for_claim', null
        ),
        (
          $2, $14, $6, $12, $13, $11, $16,
          '2026-09-03', '90837', 'F33.1',
          '11', 18000, 'ready_for_claim', null
        ),
        (
          $3, $14, $7, $17, $18, $19, $20,
          '2026-09-15', '90837', 'F43.23',
          '10', 18000, 'captured',
          'Authorization review required before claim creation.'
        ),
        (
          $4, $14, $8, $21, $22, $19, $23,
          '2026-09-04', '90837', 'F32.1',
          '10', 18000, 'ready_for_claim', null
        ),
        (
          $24, $14, $5, $9, $10, $11, $16,
          '2026-09-09', '90837', 'F41.1',
          '10', 18000, 'captured',
          'Rendering provider enrollment with payer requires remediation.'
        )
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.charges.jordan,
      IDS.charges.morgan,
      IDS.charges.taylor,
      IDS.charges.casey,
      IDS.clients.jordan,
      IDS.clients.morgan,
      IDS.clients.taylor,
      IDS.clients.casey,
      IDS.appointments.jordan,
      IDS.notes.jordan,
      IDS.providers.jamie,
      IDS.appointments.morgan,
      IDS.notes.morgan,
      IDS.tenants.frontRange,
      IDS.payers.aetna,
      IDS.payers.anthem,
      IDS.appointments.taylor,
      IDS.notes.taylor,
      IDS.providers.alex,
      IDS.payers.medicaid,
      IDS.appointments.casey,
      IDS.notes.casey,
      IDS.payers.uhc,
      IDS.charges.jamieIssue,
    ]);

    console.log("Seeding claims...");

    await client.query(`
      INSERT INTO professional_claims
        (
          id, tenant_id, charge_id, client_id,
          rendering_provider_id, billing_provider_id,
          payer_id, claim_status,
          service_date_from, service_date_to,
          total_charge_cents, patient_control_number,
          payer_claim_number, clearinghouse_claim_id,
          submitted_at, accepted_at, paid_at, metadata
        )
      VALUES
        (
          $1, $9, $5, $10, $11, $11, $14,
          'paid', '2026-09-02', '2026-09-02',
          18000, 'TE-JE-090226',
          'AET-900001', 'CH-100001',
          '2026-09-03T14:00:00Z',
          '2026-09-03T15:00:00Z',
          '2026-09-10T16:00:00Z',
          '{"scenario":"clean_revenue_cycle"}'::jsonb
        ),
        (
          $2, $9, $6, $12, $11, $11, $15,
          'denied', '2026-09-03', '2026-09-03',
          18000, 'TE-MR-090326',
          'ANT-900002', 'CH-100002',
          '2026-09-04T14:00:00Z',
          '2026-09-04T15:00:00Z',
          null,
          '{"scenario":"denial_appeal"}'::jsonb
        ),
        (
          $3, $9, $7, $13, $16, $16, $17,
          'paid_under_review', '2026-09-04', '2026-09-04',
          18000, 'TE-CM-090426',
          'UHC-900003', 'CH-100003',
          '2026-09-05T14:00:00Z',
          '2026-09-05T15:00:00Z',
          '2026-09-10T17:00:00Z',
          '{"scenario":"underpayment"}'::jsonb
        ),
        (
          $4, $9, $8, $10, $11, $11, $15,
          'validation_failed', '2026-09-09', '2026-09-09',
          18000, 'TE-JP-090926',
          null, null, null, null, null,
          '{"scenario":"credentialing_impact","validationIssue":"provider_payer_enrollment"}'::jsonb
        )
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.claims.jordan,
      IDS.claims.morgan,
      IDS.claims.casey,
      IDS.claims.jamieIssue,
      IDS.charges.jordan,
      IDS.charges.morgan,
      IDS.charges.casey,
      IDS.charges.jamieIssue,
      IDS.tenants.frontRange,
      IDS.clients.jordan,
      IDS.clients.morgan,
      IDS.clients.casey,
      IDS.providers.jamie,
      IDS.payers.aetna,
      IDS.payers.anthem,
      IDS.providers.alex,
      IDS.payers.uhc,
    ]);

    await client.query(`
      INSERT INTO professional_claim_lines
        (
          id, tenant_id, claim_id, service_date,
          cpt_code, diagnosis_pointer, units,
          charge_amount_cents, allowed_amount_cents,
          paid_amount_cents, adjustment_amount_cents
        )
      VALUES
        ($1, $9, $5, '2026-09-02', '90837', '1', 1, 18000, 15000, 12000, 3000),
        ($2, $9, $6, '2026-09-03', '90837', '1', 1, 18000, 0, 0, 0),
        ($3, $9, $7, '2026-09-04', '90837', '1', 1, 18000, 15000, 10500, 3000),
        ($4, $9, $8, '2026-09-09', '90837', '1', 1, 18000, 0, 0, 0)
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.claimLines.jordan,
      IDS.claimLines.morgan,
      IDS.claimLines.casey,
      IDS.claimLines.jamieIssue,
      IDS.claims.jordan,
      IDS.claims.morgan,
      IDS.claims.casey,
      IDS.claims.jamieIssue,
      IDS.tenants.frontRange,
    ]);

    await client.query(`
      INSERT INTO claim_diagnoses
        (id, tenant_id, claim_id, diagnosis_code, pointer_order)
      VALUES
        ($1, $9, $5, 'F41.1', 1),
        ($2, $9, $6, 'F33.1', 1),
        ($3, $9, $7, 'F32.1', 1),
        ($4, $9, $8, 'F41.1', 1)
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.diagnoses.jordan,
      IDS.diagnoses.morgan,
      IDS.diagnoses.casey,
      IDS.diagnoses.jamieIssue,
      IDS.claims.jordan,
      IDS.claims.morgan,
      IDS.claims.casey,
      IDS.claims.jamieIssue,
      IDS.tenants.frontRange,
    ]);

    console.log("Seeding claim status history...");

    await client.query(`
      INSERT INTO claim_status_history
        (
          id, tenant_id, claim_id,
          old_status, new_status, reason
        )
      VALUES
        ($1, $7, $8, 'ready_for_batch', 'submitted', 'Submitted through clearinghouse.'),
        ($2, $7, $8, 'submitted', 'paid', 'ERA received and payment posted.'),
        ($3, $7, $9, 'ready_for_batch', 'submitted', 'Submitted through clearinghouse.'),
        ($4, $7, $9, 'submitted', 'denied', 'Payer denied claim; denial routed to Work Center.'),
        ($5, $7, $10, 'submitted', 'paid_under_review', 'Payment received below expected allowed amount.'),
        ($6, $7, $11, 'ready_for_validation', 'validation_failed', 'Rendering provider payer enrollment issue detected.')
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.statusHistory.jordan1,
      IDS.statusHistory.jordan2,
      IDS.statusHistory.morgan1,
      IDS.statusHistory.morgan2,
      IDS.statusHistory.casey1,
      IDS.statusHistory.jamie1,
      IDS.tenants.frontRange,
      IDS.claims.jordan,
      IDS.claims.morgan,
      IDS.claims.casey,
      IDS.claims.jamieIssue,
    ]);

    await client.query(`
      INSERT INTO claim_notes
        (id, tenant_id, claim_id, visibility, note_text)
      VALUES
        ($1, $4, $5, 'internal',
          'Denial reviewed. Appeal prepared with supporting clinical documentation.'),
        ($2, $4, $6, 'internal',
          'Payment variance identified. Expected allowed amount exceeds posted payment.'),
        ($3, $4, $7, 'internal',
          'Claim validation stopped because provider payer enrollment requires remediation.')
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.claimNotes.morgan,
      IDS.claimNotes.casey,
      IDS.claimNotes.jamie,
      IDS.tenants.frontRange,
      IDS.claims.morgan,
      IDS.claims.casey,
      IDS.claims.jamieIssue,
    ]);

    console.log("Seeding denials and appeal...");

    await client.query(`
      INSERT INTO denials
        (
          id, tenant_id, claim_id, client_id,
          payer_id, denial_date, denial_status,
          denial_category, workability,
          carc_code, rarc_code,
          amount_cents, reason
        )
      VALUES
        (
          $1, $5, $2, $3, $4,
          '2026-09-09', 'appeal_in_progress',
          'authorization', 'workable',
          '197', 'N130',
          18000,
          'Precertification/authorization/notification absent. Appeal initiated based on reviewed documentation.'
        )
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.denials.morgan,
      IDS.claims.morgan,
      IDS.clients.morgan,
      IDS.payers.anthem,
      IDS.tenants.frontRange,
    ]);

    await client.query(`
      INSERT INTO appeals
        (
          id, tenant_id, denial_id, claim_id,
          appeal_status, appeal_level,
          deadline_date, submitted_at,
          outcome, notes
        )
      VALUES
        (
          $1, $4, $2, $3,
          'submitted', 'first_level',
          '2026-10-09',
          '2026-09-11T16:00:00Z',
          null,
          'First-level appeal submitted with supporting treatment and clinical documentation.'
        )
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.appeals.morgan,
      IDS.denials.morgan,
      IDS.claims.morgan,
      IDS.tenants.frontRange,
    ]);

    console.log("Seeding payments...");

    await client.query(`
      INSERT INTO payments
        (
          id, tenant_id, client_id, payer_id,
          payment_source, payment_method,
          payment_status, payment_date,
          amount_cents, trace_number,
          notes, posted_at
        )
      VALUES
        (
          $1, $7, $3, $8,
          'payer', 'eft',
          'posted', '2026-09-10',
          12000, 'TR-AET-1001',
          'Aetna EFT payment from ERA.',
          '2026-09-10T16:10:00Z'
        ),
        (
          $2, $7, $4, $9,
          'payer', 'eft',
          'posted', '2026-09-10',
          10500, 'TR-UHC-4004',
          'UHC payment posted. Underpayment variance remains under review.',
          '2026-09-10T17:10:00Z'
        )
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.payments.jordan,
      IDS.payments.casey,
      IDS.clients.jordan,
      IDS.clients.casey,
      IDS.payers.aetna,
      IDS.payers.uhc,
      IDS.tenants.frontRange,
    ]);

    await client.query(`
      INSERT INTO payment_allocations
        (
          id, tenant_id, payment_id,
          client_id, claim_id, claim_line_id,
          amount_cents
        )
      VALUES
        ($1, $7, $3, $4, $5, $6, 12000),
        ($2, $7, $8, $9, $10, $11, 10500)
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.allocations.jordan,
      IDS.allocations.casey,
      IDS.payments.jordan,
      IDS.clients.jordan,
      IDS.claims.jordan,
      IDS.claimLines.jordan,
      IDS.tenants.frontRange,
      IDS.payments.casey,
      IDS.clients.casey,
      IDS.claims.casey,
      IDS.claimLines.casey,
    ]);

    console.log("Seeding claim balances...");

    await client.query(`
      INSERT INTO claim_balance_summaries
        (
          claim_id, tenant_id,
          total_charge_cents, paid_amount_cents,
          adjustment_amount_cents, open_balance_cents,
          last_calculated_at
        )
      VALUES
        ($1, $5, 18000, 12000, 6000, 0, now()),
        ($2, $5, 18000, 0, 0, 18000, now()),
        ($3, $5, 18000, 10500, 3000, 4500, now()),
        ($4, $5, 18000, 0, 0, 18000, now())
      ON CONFLICT (claim_id) DO UPDATE SET
        total_charge_cents = EXCLUDED.total_charge_cents,
        paid_amount_cents = EXCLUDED.paid_amount_cents,
        adjustment_amount_cents = EXCLUDED.adjustment_amount_cents,
        open_balance_cents = EXCLUDED.open_balance_cents,
        last_calculated_at = now()
    `, [
      IDS.claims.jordan,
      IDS.claims.morgan,
      IDS.claims.casey,
      IDS.claims.jamieIssue,
      IDS.tenants.frontRange,
    ]);

    console.log("Seeding Work Center...");

    await client.query(`
      INSERT INTO workqueue_items
        (
          id, tenant_id, workqueue_type,
          workqueue_status, priority,
          source_object_type, source_object_id,
          title, description, due_date
        )
      VALUES
        (
          $1, $6, 'denial',
          'open', 'high',
          'claim', $7,
          'Work Anthem denial for Morgan Reed',
          'Review CARC 197 / RARC N130 and monitor first-level appeal.',
          '2026-09-18'
        ),
        (
          $2, $6, 'credentialing',
          'open', 'urgent',
          'claim', $8,
          'Provider enrollment blocking claim',
          'Jamie Parker payer enrollment issue is preventing claim submission.',
          '2026-09-14'
        ),
        (
          $3, $6, 'underpayment',
          'open', 'high',
          'claim', $9,
          'Review payment variance for Casey Martin',
          'Posted payment is below the expected allowed amount. Contract review required.',
          '2026-09-16'
        ),
        (
          $4, $6, 'authorization',
          'open', 'urgent',
          'client', $10,
          'Medicaid authorization review for Taylor Brooks',
          'Review authorization requirements before the upcoming service date.',
          '2026-09-14'
        ),
        (
          $5, $6, 'documentation',
          'open', 'normal',
          'clinical_note', $11,
          'Upcoming clinical note requires completion',
          'Taylor Brooks has an upcoming Medicaid visit with a draft note workflow.',
          '2026-09-15'
        )
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.work.denial,
      IDS.work.credentialing,
      IDS.work.underpayment,
      IDS.work.authorization,
      IDS.work.documentation,
      IDS.tenants.frontRange,
      IDS.claims.morgan,
      IDS.claims.jamieIssue,
      IDS.claims.casey,
      IDS.clients.taylor,
      IDS.notes.taylor,
    ]);

    await client.query(`
      INSERT INTO workqueue_history
        (
          id, tenant_id, workqueue_item_id,
          old_status, new_status,
          old_priority, new_priority, note
        )
      VALUES
        (
          $1, $4, $5,
          null, 'open',
          null, 'high',
          'Denial automatically routed to revenue cycle workqueue.'
        ),
        (
          $2, $4, $6,
          null, 'open',
          null, 'urgent',
          'Claim validation generated credentialing remediation task.'
        ),
        (
          $3, $4, $7,
          null, 'open',
          null, 'high',
          'Payment variance generated underpayment review task.'
        )
      ON CONFLICT (id) DO NOTHING
    `, [
      IDS.workHistory.denial,
      IDS.workHistory.credentialing,
      IDS.workHistory.underpayment,
      IDS.tenants.frontRange,
      IDS.work.denial,
      IDS.work.credentialing,
      IDS.work.underpayment,
    ]);

    await client.query("COMMIT");

    console.log("");
    console.log("Demo seed completed successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  await seed();
} finally {
  await pool.end();
}

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/clients", async (req, res, next) => {
  try {
    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim()
        : "";

    const status =
      typeof req.query.status === "string"
        ? req.query.status.trim()
        : "";

    const searchLike = `%${search}%`;

    const result = await db.execute(sql`
      SELECT
        c.id,
        c.first_name AS "firstName",
        c.middle_name AS "middleName",
        c.last_name AS "lastName",
        c.preferred_name AS "preferredName",
        c.date_of_birth AS "dateOfBirth",
        c.client_status AS "clientStatus",
        c.registration_status AS "registrationStatus",
        c.billing_readiness_status AS "billingReadinessStatus",
        c.email,
        c.phone,

        p.name AS "payerName",
        pp.name AS "planName",
        cip.member_id AS "memberId",

        (
          SELECT MIN(a.starts_at)
          FROM appointments a
          WHERE a.client_id = c.id
            AND a.starts_at >= now()
            AND a.appointment_status = 'scheduled'
        ) AS "nextAppointment",

        COALESCE(
          (
            SELECT SUM(cbs.open_balance_cents)
            FROM professional_claims pc2
            JOIN claim_balance_summaries cbs
              ON cbs.claim_id = pc2.id
            WHERE pc2.client_id = c.id
          ),
          0
        )::int AS "openBalanceCents"

      FROM clients c

      LEFT JOIN client_insurance_policies cip
        ON cip.client_id = c.id
        AND cip.insurance_order = 1
        AND cip.status = 'active'

      LEFT JOIN payers p
        ON p.id = cip.payer_id

      LEFT JOIN payer_plans pp
        ON pp.id = cip.payer_plan_id

      WHERE c.deleted_at IS NULL

        AND (
          ${search} = ''
          OR CONCAT_WS(
            ' ',
            c.first_name,
            c.middle_name,
            c.last_name,
            c.preferred_name,
            c.email,
            c.phone
          ) ILIKE ${searchLike}
        )

        AND (
          ${status} = ''
          OR c.client_status = ${status}
        )

      ORDER BY c.last_name, c.first_name
    `);

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});


router.get("/clients/:id", async (req, res, next) => {
  try {
    const id = req.params.id;

    const clientResult = await db.execute(sql`
      SELECT
        c.*,
        t.name AS "tenantName"
      FROM clients c
      LEFT JOIN tenants t
        ON t.id = c.tenant_id
      WHERE c.id = ${id}::uuid
      LIMIT 1
    `);

    if (!clientResult.rows.length) {
      return res.status(404).json({
        error: "Client not found",
      });
    }

    const [
      insurance,
      appointments,
      treatmentPlans,
      clinicalNotes,
      charges,
      claims,
      payments,
      denials,
      workItems,
    ] = await Promise.all([
      db.execute(sql`
        SELECT
          cip.*,
          p.name AS "payerName",
          pp.name AS "planName"
        FROM client_insurance_policies cip
        LEFT JOIN payers p
          ON p.id = cip.payer_id
        LEFT JOIN payer_plans pp
          ON pp.id = cip.payer_plan_id
        WHERE cip.client_id = ${id}::uuid
        ORDER BY cip.insurance_order
      `),

      db.execute(sql`
        SELECT
          a.*,
          CONCAT(pr.first_name, ' ', pr.last_name) AS "providerName",
          pr.credentials AS "providerCredentials"
        FROM appointments a
        LEFT JOIN providers pr
          ON pr.id = a.provider_id
        WHERE a.client_id = ${id}::uuid
        ORDER BY a.starts_at DESC
      `),

      db.execute(sql`
        SELECT
          tp.*,
          CONCAT(pr.first_name, ' ', pr.last_name) AS "providerName"
        FROM treatment_plans tp
        LEFT JOIN providers pr
          ON pr.id = tp.provider_id
        WHERE tp.client_id = ${id}::uuid
        ORDER BY tp.effective_date DESC
      `),

      db.execute(sql`
        SELECT
          cn.*,
          CONCAT(pr.first_name, ' ', pr.last_name) AS "providerName",
          cns.signed_at AS "signedAt",
          cns.signature_text AS "signatureText"
        FROM clinical_notes cn
        LEFT JOIN providers pr
          ON pr.id = cn.provider_id
        LEFT JOIN clinical_note_signatures cns
          ON cns.clinical_note_id = cn.id
        WHERE cn.client_id = ${id}::uuid
        ORDER BY cn.service_date DESC
      `),

      db.execute(sql`
        SELECT
          cc.*,
          p.name AS "payerName",
          CONCAT(pr.first_name, ' ', pr.last_name) AS "providerName"
        FROM charge_capture_items cc
        LEFT JOIN payers p
          ON p.id = cc.payer_id
        LEFT JOIN providers pr
          ON pr.id = cc.provider_id
        WHERE cc.client_id = ${id}::uuid
        ORDER BY cc.service_date DESC
      `),

      db.execute(sql`
        SELECT
          pc.*,
          p.name AS "payerName",
          COALESCE(cbs.paid_amount_cents, 0) AS "paidAmountCents",
          COALESCE(cbs.adjustment_amount_cents, 0) AS "adjustmentAmountCents",
          COALESCE(cbs.open_balance_cents, pc.total_charge_cents) AS "openBalanceCents"
        FROM professional_claims pc
        LEFT JOIN payers p
          ON p.id = pc.payer_id
        LEFT JOIN claim_balance_summaries cbs
          ON cbs.claim_id = pc.id
        WHERE pc.client_id = ${id}::uuid
        ORDER BY pc.service_date_from DESC
      `),

      db.execute(sql`
        SELECT
          py.*,
          p.name AS "payerName"
        FROM payments py
        LEFT JOIN payers p
          ON p.id = py.payer_id
        WHERE py.client_id = ${id}::uuid
        ORDER BY py.payment_date DESC
      `),

      db.execute(sql`
        SELECT
          d.*,
          p.name AS "payerName",
          pc.patient_control_number AS "patientControlNumber"
        FROM denials d
        LEFT JOIN payers p
          ON p.id = d.payer_id
        LEFT JOIN professional_claims pc
          ON pc.id = d.claim_id
        WHERE d.client_id = ${id}::uuid
        ORDER BY d.denial_date DESC
      `),

      db.execute(sql`
        SELECT *
        FROM workqueue_items
        WHERE
          (
            source_object_type = 'client'
            AND source_object_id = ${id}::uuid
          )
          OR source_object_id IN (
            SELECT id
            FROM professional_claims
            WHERE client_id = ${id}::uuid
          )
          OR source_object_id IN (
            SELECT id
            FROM clinical_notes
            WHERE client_id = ${id}::uuid
          )
        ORDER BY created_at DESC
      `),
    ]);

    res.json({
      client: clientResult.rows[0],
      insurancePolicies: insurance.rows,
      appointments: appointments.rows,
      treatmentPlans: treatmentPlans.rows,
      clinicalNotes: clinicalNotes.rows,
      charges: charges.rows,
      claims: claims.rows,
      payments: payments.rows,
      denials: denials.rows,
      workItems: workItems.rows,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

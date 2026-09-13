import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/claims", async (req, res, next) => {
  try {
    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim()
        : "";

    const status =
      typeof req.query.status === "string"
        ? req.query.status.trim()
        : "";

    const payer =
      typeof req.query.payer === "string"
        ? req.query.payer.trim()
        : "";

    const provider =
      typeof req.query.provider === "string"
        ? req.query.provider.trim()
        : "";

    const searchLike = `%${search}%`;

    const result = await db.execute(sql`
      SELECT
        pc.id,
        pc.patient_control_number AS "patientControlNumber",
        pc.payer_claim_number AS "payerClaimNumber",
        pc.clearinghouse_claim_id AS "clearinghouseClaimId",
        pc.claim_status AS "claimStatus",
        pc.service_date_from AS "serviceDateFrom",
        pc.service_date_to AS "serviceDateTo",
        pc.total_charge_cents AS "totalChargeCents",

        c.id AS "clientId",
        CONCAT(c.first_name, ' ', c.last_name) AS "clientName",

        p.id AS "payerId",
        p.name AS "payerName",

        rp.id AS "renderingProviderId",
        CONCAT(rp.first_name, ' ', rp.last_name) AS "renderingProviderName",
        rp.credentials AS "renderingProviderCredentials",

        bp.id AS "billingProviderId",
        CONCAT(bp.first_name, ' ', bp.last_name) AS "billingProviderName",
        bp.credentials AS "billingProviderCredentials",

        COALESCE(cbs.paid_amount_cents, 0) AS "paidAmountCents",
        COALESCE(cbs.adjustment_amount_cents, 0) AS "adjustmentAmountCents",
        COALESCE(cbs.open_balance_cents, pc.total_charge_cents) AS "openBalanceCents",

        (
          SELECT count(*)::int
          FROM denials d
          WHERE d.claim_id = pc.id
        ) AS "denialCount"

      FROM professional_claims pc

      JOIN clients c
        ON c.id = pc.client_id

      LEFT JOIN payers p
        ON p.id = pc.payer_id

      LEFT JOIN providers rp
        ON rp.id = pc.rendering_provider_id

      LEFT JOIN providers bp
        ON bp.id = pc.billing_provider_id

      LEFT JOIN claim_balance_summaries cbs
        ON cbs.claim_id = pc.id

      WHERE
        (
          ${search} = ''
          OR CONCAT_WS(
            ' ',
            pc.patient_control_number,
            pc.payer_claim_number,
            pc.clearinghouse_claim_id,
            c.first_name,
            c.last_name,
            p.name
          ) ILIKE ${searchLike}
        )

        AND (
          ${status} = ''
          OR pc.claim_status = ${status}
        )

        AND (
          ${payer} = ''
          OR pc.payer_id::text = ${payer}
        )

        AND (
          ${provider} = ''
          OR pc.rendering_provider_id::text = ${provider}
          OR pc.billing_provider_id::text = ${provider}
        )

      ORDER BY pc.service_date_from DESC NULLS LAST
    `);

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});


router.get("/claims/:id", async (req, res, next) => {
  try {
    const id = req.params.id;

    const claim = await db.execute(sql`
      SELECT
        pc.*,

        CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
        c.date_of_birth AS "clientDateOfBirth",

        p.name AS "payerName",

        CONCAT(rp.first_name, ' ', rp.last_name) AS "renderingProviderName",
        rp.credentials AS "renderingProviderCredentials",

        CONCAT(bp.first_name, ' ', bp.last_name) AS "billingProviderName",
        bp.credentials AS "billingProviderCredentials"

      FROM professional_claims pc

      JOIN clients c
        ON c.id = pc.client_id

      LEFT JOIN payers p
        ON p.id = pc.payer_id

      LEFT JOIN providers rp
        ON rp.id = pc.rendering_provider_id

      LEFT JOIN providers bp
        ON bp.id = pc.billing_provider_id

      WHERE pc.id = ${id}::uuid
      LIMIT 1
    `);

    if (!claim.rows.length) {
      return res.status(404).json({
        error: "Claim not found",
      });
    }

    const [
      lines,
      diagnoses,
      statusHistory,
      notes,
      payments,
      balance,
      denials,
      appeals,
      workItems,
      charge,
    ] = await Promise.all([
      db.execute(sql`
        SELECT *
        FROM professional_claim_lines
        WHERE claim_id = ${id}::uuid
        ORDER BY service_date, created_at
      `),

      db.execute(sql`
        SELECT *
        FROM claim_diagnoses
        WHERE claim_id = ${id}::uuid
        ORDER BY pointer_order
      `),

      db.execute(sql`
        SELECT *
        FROM claim_status_history
        WHERE claim_id = ${id}::uuid
        ORDER BY created_at
      `),

      db.execute(sql`
        SELECT *
        FROM claim_notes
        WHERE claim_id = ${id}::uuid
        ORDER BY created_at DESC
      `),

      db.execute(sql`
        SELECT
          py.*,
          pa.id AS "allocationId",
          pa.claim_line_id AS "claimLineId",
          pa.amount_cents AS "allocatedAmountCents"
        FROM payment_allocations pa
        JOIN payments py
          ON py.id = pa.payment_id
        WHERE pa.claim_id = ${id}::uuid
        ORDER BY py.payment_date DESC
      `),

      db.execute(sql`
        SELECT *
        FROM claim_balance_summaries
        WHERE claim_id = ${id}::uuid
        LIMIT 1
      `),

      db.execute(sql`
        SELECT
          d.*,
          p.name AS "payerName"
        FROM denials d
        LEFT JOIN payers p
          ON p.id = d.payer_id
        WHERE d.claim_id = ${id}::uuid
        ORDER BY d.denial_date DESC
      `),

      db.execute(sql`
        SELECT *
        FROM appeals
        WHERE claim_id = ${id}::uuid
        ORDER BY created_at DESC
      `),

      db.execute(sql`
        SELECT *
        FROM workqueue_items
        WHERE source_object_id = ${id}::uuid
        ORDER BY created_at DESC
      `),

      db.execute(sql`
        SELECT cc.*
        FROM charge_capture_items cc
        JOIN professional_claims pc
          ON pc.charge_id = cc.id
        WHERE pc.id = ${id}::uuid
        LIMIT 1
      `),
    ]);

    res.json({
      claim: claim.rows[0],
      charge: charge.rows[0] ?? null,
      lines: lines.rows,
      diagnoses: diagnoses.rows,
      statusHistory: statusHistory.rows,
      notes: notes.rows,
      payments: payments.rows,
      balance: balance.rows[0] ?? null,
      denials: denials.rows,
      appeals: appeals.rows,
      workItems: workItems.rows,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

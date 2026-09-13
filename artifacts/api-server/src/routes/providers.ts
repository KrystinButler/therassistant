import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get("/providers", async (_req, res, next) => {
  try {
    const result = await db.execute(sql`
      SELECT
        pr.id,
        pr.first_name AS "firstName",
        pr.last_name AS "lastName",
        pr.credentials,
        pr.provider_status AS "providerStatus",
        pr.individual_npi AS "individualNpi",
        pr.taxonomy_code AS "taxonomyCode",
        pr.email,
        pr.phone,

        (
          SELECT count(*)::int
          FROM professional_claims pc
          WHERE pc.rendering_provider_id = pr.id
             OR pc.billing_provider_id = pr.id
        ) AS "claimCount",

        (
          SELECT count(*)::int
          FROM workqueue_items w
          WHERE w.workqueue_status = 'open'
            AND (
              w.source_object_id IN (
                SELECT pc2.id
                FROM professional_claims pc2
                WHERE pc2.rendering_provider_id = pr.id
                   OR pc2.billing_provider_id = pr.id
              )
              OR w.description ILIKE '%' || pr.first_name || '%'
            )
        ) AS "openIssueCount"

      FROM providers pr
      ORDER BY pr.last_name, pr.first_name
    `);

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});


router.get("/providers/:id", async (req, res, next) => {
  try {
    const id = req.params.id;

    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({
        error: "Invalid provider id",
      });
    }

    const provider = await db.execute(sql`
      SELECT *
      FROM providers
      WHERE id = ${id}::uuid
      LIMIT 1
    `);

    if (!provider.rows.length) {
      return res.status(404).json({
        error: "Provider not found",
      });
    }

    const [
      appointments,
      notes,
      charges,
      renderingClaims,
      billingClaims,
      workItems,
    ] = await Promise.all([
      db.execute(sql`
        SELECT
          a.*,
          CONCAT(c.first_name, ' ', c.last_name) AS "clientName"
        FROM appointments a
        JOIN clients c
          ON c.id = a.client_id
        WHERE a.provider_id = ${id}::uuid
        ORDER BY a.starts_at DESC
      `),

      db.execute(sql`
        SELECT
          cn.*,
          CONCAT(c.first_name, ' ', c.last_name) AS "clientName"
        FROM clinical_notes cn
        JOIN clients c
          ON c.id = cn.client_id
        WHERE cn.provider_id = ${id}::uuid
        ORDER BY cn.service_date DESC
      `),

      db.execute(sql`
        SELECT
          cc.*,
          CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
          p.name AS "payerName"
        FROM charge_capture_items cc
        JOIN clients c
          ON c.id = cc.client_id
        LEFT JOIN payers p
          ON p.id = cc.payer_id
        WHERE cc.provider_id = ${id}::uuid
        ORDER BY cc.service_date DESC
      `),

      db.execute(sql`
        SELECT
          pc.*,
          CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
          p.name AS "payerName",
          COALESCE(cbs.open_balance_cents, pc.total_charge_cents) AS "openBalanceCents"
        FROM professional_claims pc
        JOIN clients c
          ON c.id = pc.client_id
        LEFT JOIN payers p
          ON p.id = pc.payer_id
        LEFT JOIN claim_balance_summaries cbs
          ON cbs.claim_id = pc.id
        WHERE pc.rendering_provider_id = ${id}::uuid
        ORDER BY pc.service_date_from DESC
      `),

      db.execute(sql`
        SELECT
          pc.*,
          CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
          p.name AS "payerName",
          COALESCE(cbs.open_balance_cents, pc.total_charge_cents) AS "openBalanceCents"
        FROM professional_claims pc
        JOIN clients c
          ON c.id = pc.client_id
        LEFT JOIN payers p
          ON p.id = pc.payer_id
        LEFT JOIN claim_balance_summaries cbs
          ON cbs.claim_id = pc.id
        WHERE pc.billing_provider_id = ${id}::uuid
        ORDER BY pc.service_date_from DESC
      `),

      db.execute(sql`
        SELECT DISTINCT w.*
        FROM workqueue_items w
        WHERE
          w.source_object_id IN (
            SELECT pc.id
            FROM professional_claims pc
            WHERE pc.rendering_provider_id = ${id}::uuid
               OR pc.billing_provider_id = ${id}::uuid
          )
          OR w.description ILIKE (
            '%' ||
            (
              SELECT first_name
              FROM providers
              WHERE id = ${id}::uuid
            ) ||
            '%'
          )
        ORDER BY w.created_at DESC
      `),
    ]);

    return res.json({
      provider: provider.rows[0],
      appointments: appointments.rows,
      clinicalNotes: notes.rows,
      charges: charges.rows,
      renderingClaims: renderingClaims.rows,
      billingClaims: billingClaims.rows,
      workItems: workItems.rows,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

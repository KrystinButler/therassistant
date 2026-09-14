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
              (w.source_object_type = 'provider' AND w.source_object_id = pr.id)
              OR w.source_object_id IN (
                SELECT pc2.id
                FROM professional_claims pc2
                WHERE pc2.rendering_provider_id = pr.id
                   OR pc2.billing_provider_id = pr.id
              )
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
      identifiers,
      payerEnrollments,
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
          (w.source_object_type = 'provider' AND w.source_object_id = ${id}::uuid)
          OR w.source_object_id IN (
            SELECT pc.id
            FROM professional_claims pc
            WHERE pc.rendering_provider_id = ${id}::uuid
               OR pc.billing_provider_id = ${id}::uuid
          )
        ORDER BY w.created_at DESC
      `),

      db.execute(sql`
        SELECT
          pi.*,
          p.name AS "payerName"
        FROM provider_identifiers pi
        LEFT JOIN payers p ON p.id = pi.payer_id
        WHERE pi.provider_id = ${id}::uuid
        ORDER BY pi.identifier_type, pi.created_at
      `),

      db.execute(sql`
        SELECT
          ppe.*,
          p.name AS "payerName"
        FROM provider_payer_enrollments ppe
        LEFT JOIN payers p ON p.id = ppe.payer_id
        WHERE ppe.provider_id = ${id}::uuid
        ORDER BY p.name, ppe.created_at
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
      identifiers: identifiers.rows,
      payerEnrollments: payerEnrollments.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/providers/:id/identifiers", async (req, res, next) => {
  try {
    const providerId = req.params.id;
    const identifierType = typeof req.body?.identifier_type === "string"
      ? req.body.identifier_type.trim()
      : "";
    const identifierValue = typeof req.body?.identifier_value === "string"
      ? req.body.identifier_value.trim()
      : "";
    const payerId = typeof req.body?.payer_id === "string" && req.body.payer_id
      ? req.body.payer_id
      : null;
    const effectiveDate = typeof req.body?.effective_date === "string" && req.body.effective_date
      ? req.body.effective_date
      : null;
    const terminationDate = typeof req.body?.termination_date === "string" && req.body.termination_date
      ? req.body.termination_date
      : null;

    if (!UUID_PATTERN.test(providerId)) {
      return res.status(400).json({ error: "Invalid provider id" });
    }
    if (!identifierType || !identifierValue) {
      return res.status(400).json({ error: "Identifier type and value are required" });
    }
    if (payerId && !UUID_PATTERN.test(payerId)) {
      return res.status(400).json({ error: "Invalid payer id" });
    }

    const result = await db.execute(sql`
      INSERT INTO provider_identifiers (
        tenant_id,
        provider_id,
        identifier_type,
        identifier_value,
        payer_id,
        effective_date,
        termination_date
      )
      SELECT
        pr.tenant_id,
        pr.id,
        ${identifierType},
        ${identifierValue},
        ${payerId}::uuid,
        ${effectiveDate}::date,
        ${terminationDate}::date
      FROM providers pr
      JOIN tenants t ON t.id = pr.tenant_id
      WHERE pr.id = ${providerId}::uuid
        AND COALESCE((t.settings ->> 'demo')::boolean, false) = true
      RETURNING *
    `);

    if (!result.rows.length) {
      return res.status(404).json({ error: "Demo provider not found" });
    }

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

export default router;

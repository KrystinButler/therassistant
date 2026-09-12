import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/dashboard", async (_req, res, next) => {
  try {
    const summary = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM clients WHERE deleted_at IS NULL) AS "totalClients",
        (SELECT count(*)::int FROM providers WHERE provider_status = 'active') AS "activeProviders",
        (
          SELECT count(*)::int
          FROM professional_claims
          WHERE claim_status NOT IN ('paid', 'closed')
        ) AS "openClaims",
        (
          SELECT count(*)::int
          FROM professional_claims
          WHERE claim_status = 'denied'
        ) AS "deniedClaims",
        (
          SELECT count(*)::int
          FROM workqueue_items
          WHERE workqueue_status = 'open'
        ) AS "openWorkItems",
        COALESCE(
          (
            SELECT sum(open_balance_cents)::int
            FROM claim_balance_summaries
          ),
          0
        ) AS "totalOpenBalanceCents"
    `);

    const recentWork = await db.execute(sql`
      SELECT
        w.id,
        w.workqueue_type AS "workqueueType",
        w.workqueue_status AS "workqueueStatus",
        w.priority,
        w.source_object_type AS "sourceObjectType",
        w.source_object_id AS "sourceObjectId",
        w.title,
        w.description,
        w.due_date AS "dueDate",
        w.created_at AS "createdAt"
      FROM workqueue_items w
      WHERE w.workqueue_status = 'open'
      ORDER BY
        CASE w.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          ELSE 4
        END,
        w.due_date NULLS LAST,
        w.created_at DESC
      LIMIT 8
    `);

    const recentClaims = await db.execute(sql`
      SELECT
        pc.id,
        pc.patient_control_number AS "patientControlNumber",
        pc.claim_status AS "claimStatus",
        pc.service_date_from AS "serviceDate",
        pc.total_charge_cents AS "totalChargeCents",
        COALESCE(cbs.open_balance_cents, pc.total_charge_cents) AS "openBalanceCents",
        CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
        p.name AS "payerName"
      FROM professional_claims pc
      JOIN clients c
        ON c.id = pc.client_id
      LEFT JOIN payers p
        ON p.id = pc.payer_id
      LEFT JOIN claim_balance_summaries cbs
        ON cbs.claim_id = pc.id
      ORDER BY pc.updated_at DESC
      LIMIT 8
    `);

    res.json({
      ...(summary.rows[0] ?? {}),
      recentWorkItems: recentWork.rows,
      recentClaims: recentClaims.rows,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

import { requireAuthenticatedTenant } from "../../middlewares/auth";

const router: IRouter = Router();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function includeInactiveRecords(value: unknown) {
  return value === "true";
}

function singleParam(value: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value;
}

router.get("/v1/payers", requireAuthenticatedTenant, async (req, res, next) => {
  try {
    const includeInactive = includeInactiveRecords(req.query.includeInactive);
    const result = await db.execute(sql`
      SELECT
        p.id,
        p.name,
        p.normalized_name AS "normalizedName",
        p.payer_type AS "payerType",
        p.clearinghouse_payer_id AS "clearinghousePayerId",
        p.adapter_key AS "adapterKey",
        p.active,
        p.effective_from AS "effectiveFrom",
        p.effective_to AS "effectiveTo",
        p.source_updated_at AS "sourceUpdatedAt"
      FROM payers p
      WHERE (
        ${includeInactive}::boolean
        OR (
          p.active = true
          AND (p.effective_from IS NULL OR p.effective_from <= CURRENT_DATE)
          AND (p.effective_to IS NULL OR p.effective_to >= CURRENT_DATE)
        )
      )
      ORDER BY p.name
    `);

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

router.get("/v1/payers/:payerId/plans", requireAuthenticatedTenant, async (req, res, next) => {
  try {
    const payerId = singleParam(req.params.payerId);
    const includeInactive = includeInactiveRecords(req.query.includeInactive);

    if (!UUID_PATTERN.test(payerId)) {
      return res.status(400).json({ error: "Invalid payer id" });
    }

    const result = await db.execute(sql`
      SELECT
        pp.id,
        pp.payer_id AS "payerId",
        pp.external_plan_id AS "externalPlanId",
        pp.name,
        pp.plan_type AS "planType",
        pp.product_type AS "productType",
        pp.market_segment AS "marketSegment",
        pp.state,
        pp.active,
        pp.effective_from AS "effectiveFrom",
        pp.effective_to AS "effectiveTo",
        pp.source_updated_at AS "sourceUpdatedAt"
      FROM payer_plans pp
      WHERE pp.payer_id = ${payerId}::uuid
        AND pp.state = 'CO'
        AND (
          ${includeInactive}::boolean
          OR (
            pp.active = true
            AND (pp.effective_from IS NULL OR pp.effective_from <= CURRENT_DATE)
            AND (pp.effective_to IS NULL OR pp.effective_to >= CURRENT_DATE)
          )
        )
      ORDER BY pp.name
    `);

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

router.get("/v1/plans/:planId/networks", requireAuthenticatedTenant, async (req, res, next) => {
  try {
    const planId = singleParam(req.params.planId);
    const includeInactive = includeInactiveRecords(req.query.includeInactive);

    if (!UUID_PATTERN.test(planId)) {
      return res.status(400).json({ error: "Invalid plan id" });
    }

    const result = await db.execute(sql`
      SELECT
        pn.id,
        pn.plan_id AS "planId",
        pn.external_network_id AS "externalNetworkId",
        pn.name,
        pn.active,
        pn.effective_from AS "effectiveFrom",
        pn.effective_to AS "effectiveTo",
        pn.source_updated_at AS "sourceUpdatedAt"
      FROM payer_networks pn
      JOIN payer_plans pp ON pp.id = pn.plan_id
      WHERE pn.plan_id = ${planId}::uuid
        AND pp.state = 'CO'
        AND (
          ${includeInactive}::boolean
          OR (
            pn.active = true
            AND (pn.effective_from IS NULL OR pn.effective_from <= CURRENT_DATE)
            AND (pn.effective_to IS NULL OR pn.effective_to >= CURRENT_DATE)
          )
        )
      ORDER BY pn.name
    `);

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

export default router;

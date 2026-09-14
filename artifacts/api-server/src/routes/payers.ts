import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTRACT_STATUSES = new Set(["draft", "active", "pending", "expired", "terminated", "superseded"]);

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

router.post("/payers/:payerId/plans", async (req, res, next) => {
  try {
    const payerId = req.params.payerId;
    const name = text(req.body?.name);
    const planType = text(req.body?.plan_type);
    if (!UUID_PATTERN.test(payerId)) return res.status(400).json({ error: "Invalid payer id" });
    if (!name) return res.status(400).json({ error: "Plan name is required" });

    const result = await db.execute(sql`
      INSERT INTO payer_plans (payer_id, name, plan_type)
      SELECT ${payerId}::uuid, ${name}, ${planType}
      WHERE EXISTS (SELECT 1 FROM payers WHERE id = ${payerId}::uuid)
        AND EXISTS (
          SELECT 1 FROM tenants
          WHERE COALESCE((settings ->> 'demo')::boolean, false) = true
        )
      RETURNING *
    `);
    if (!result.rows.length) return res.status(404).json({ error: "Payer not found" });
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.post("/payers/:payerId/contracts", async (req, res, next) => {
  try {
    const payerId = req.params.payerId;
    const contractName = text(req.body?.contract_name);
    const status = text(req.body?.status) ?? "draft";
    const effectiveDate = text(req.body?.effective_date);
    const terminationDate = text(req.body?.termination_date);
    const notes = text(req.body?.notes);
    if (!UUID_PATTERN.test(payerId)) return res.status(400).json({ error: "Invalid payer id" });
    if (!contractName) return res.status(400).json({ error: "Contract name is required" });
    if (!CONTRACT_STATUSES.has(status)) return res.status(400).json({ error: "Invalid contract status" });

    const result = await db.execute(sql`
      INSERT INTO payer_contracts (
        tenant_id, payer_id, contract_name, status,
        effective_date, termination_date, notes
      )
      SELECT
        t.id, ${payerId}::uuid, ${contractName}, ${status}::contract_status_enum,
        ${effectiveDate}::date, ${terminationDate}::date, ${notes}
      FROM tenants t
      WHERE COALESCE((t.settings ->> 'demo')::boolean, false) = true
        AND EXISTS (SELECT 1 FROM payers WHERE id = ${payerId}::uuid)
      LIMIT 1
      RETURNING *
    `);
    if (!result.rows.length) return res.status(404).json({ error: "Demo tenant or payer not found" });
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.patch("/payers/:payerId/contracts/:contractId", async (req, res, next) => {
  try {
    const { payerId, contractId } = req.params;
    if (!UUID_PATTERN.test(payerId) || !UUID_PATTERN.test(contractId)) {
      return res.status(400).json({ error: "Invalid payer or contract id" });
    }
    const status = text(req.body?.status);
    if (status && !CONTRACT_STATUSES.has(status)) return res.status(400).json({ error: "Invalid contract status" });
    const effectiveDate = text(req.body?.effective_date);
    const terminationDate = text(req.body?.termination_date);
    const notes = text(req.body?.notes);

    const result = await db.execute(sql`
      UPDATE payer_contracts pc
      SET
        status = COALESCE(${status}::contract_status_enum, pc.status),
        effective_date = CASE WHEN ${effectiveDate}::text IS NULL THEN pc.effective_date ELSE ${effectiveDate}::date END,
        termination_date = CASE WHEN ${terminationDate}::text IS NULL THEN pc.termination_date ELSE ${terminationDate}::date END,
        notes = COALESCE(${notes}, pc.notes),
        updated_at = now()
      FROM tenants t
      WHERE pc.id = ${contractId}::uuid
        AND pc.payer_id = ${payerId}::uuid
        AND t.id = pc.tenant_id
        AND COALESCE((t.settings ->> 'demo')::boolean, false) = true
      RETURNING pc.*
    `);
    if (!result.rows.length) return res.status(404).json({ error: "Demo contract not found" });
    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.post("/payers/:payerId/contracts/:contractId/fee-schedules", async (req, res, next) => {
  try {
    const { payerId, contractId } = req.params;
    const name = text(req.body?.name);
    const status = text(req.body?.status) ?? "draft";
    const effectiveDate = text(req.body?.effective_date);
    const terminationDate = text(req.body?.termination_date);
    if (!UUID_PATTERN.test(payerId) || !UUID_PATTERN.test(contractId)) {
      return res.status(400).json({ error: "Invalid payer or contract id" });
    }
    if (!name) return res.status(400).json({ error: "Fee schedule name is required" });
    if (!CONTRACT_STATUSES.has(status)) return res.status(400).json({ error: "Invalid fee schedule status" });

    const result = await db.execute(sql`
      INSERT INTO fee_schedules (
        tenant_id, payer_contract_id, name, status, effective_date, termination_date
      )
      SELECT
        pc.tenant_id, pc.id, ${name}, ${status}::contract_status_enum,
        ${effectiveDate}::date, ${terminationDate}::date
      FROM payer_contracts pc
      JOIN tenants t ON t.id = pc.tenant_id
      WHERE pc.id = ${contractId}::uuid
        AND pc.payer_id = ${payerId}::uuid
        AND COALESCE((t.settings ->> 'demo')::boolean, false) = true
      RETURNING *
    `);
    if (!result.rows.length) return res.status(404).json({ error: "Demo contract not found" });
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.post("/payers/:payerId/fee-schedules/:scheduleId/lines", async (req, res, next) => {
  try {
    const { payerId, scheduleId } = req.params;
    const cptCode = text(req.body?.cpt_code);
    const modifier = text(req.body?.modifier);
    const unitType = text(req.body?.unit_type);
    const rate = Number(req.body?.rate_cents);
    if (!UUID_PATTERN.test(payerId) || !UUID_PATTERN.test(scheduleId)) {
      return res.status(400).json({ error: "Invalid payer or fee schedule id" });
    }
    if (!cptCode || !Number.isFinite(rate) || rate < 0) {
      return res.status(400).json({ error: "CPT code and non-negative rate are required" });
    }

    const result = await db.execute(sql`
      INSERT INTO fee_schedule_lines (
        tenant_id, fee_schedule_id, cpt_code, modifier, rate_cents, unit_type
      )
      SELECT
        fs.tenant_id, fs.id, ${cptCode}, ${modifier}, ${Math.round(rate)}, ${unitType}
      FROM fee_schedules fs
      JOIN payer_contracts pc ON pc.id = fs.payer_contract_id
      JOIN tenants t ON t.id = fs.tenant_id
      WHERE fs.id = ${scheduleId}::uuid
        AND pc.payer_id = ${payerId}::uuid
        AND COALESCE((t.settings ->> 'demo')::boolean, false) = true
      RETURNING *
    `);
    if (!result.rows.length) return res.status(404).json({ error: "Demo fee schedule not found" });
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

export default router;

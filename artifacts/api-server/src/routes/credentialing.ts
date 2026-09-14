import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ENROLLMENT_STATUSES = new Set([
  "not_started",
  "in_progress",
  "submitted",
  "approved",
  "denied",
  "terminated",
  "expired",
  "needs_revalidation",
  "unknown",
]);

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

router.patch("/credentialing/enrollments/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ error: "Invalid enrollment id" });
    }

    const requestedStatus = optionalText(req.body?.enrollment_status);
    if (requestedStatus && !ENROLLMENT_STATUSES.has(requestedStatus)) {
      return res.status(400).json({ error: "Invalid enrollment status" });
    }

    const effectiveDate = optionalText(req.body?.effective_date);
    const revalidationDueDate = optionalText(req.body?.revalidation_due_date);
    const terminationDate = optionalText(req.body?.termination_date);
    const payerProviderId = optionalText(req.body?.payer_provider_id);
    const notes = optionalText(req.body?.notes);
    const reason = optionalText(req.body?.reason) ?? "Credentialing workflow update";

    const result = await db.execute(sql`
      WITH current_row AS (
        SELECT ppe.*
        FROM provider_payer_enrollments ppe
        JOIN tenants t ON t.id = ppe.tenant_id
        WHERE ppe.id = ${id}::uuid
          AND COALESCE((t.settings ->> 'demo')::boolean, false) = true
      ),
      updated AS (
        UPDATE provider_payer_enrollments ppe
        SET
          enrollment_status = COALESCE(
            ${requestedStatus}::provider_enrollment_status_enum,
            ppe.enrollment_status
          ),
          effective_date = CASE
            WHEN ${effectiveDate}::text IS NULL THEN ppe.effective_date
            ELSE ${effectiveDate}::date
          END,
          revalidation_due_date = CASE
            WHEN ${revalidationDueDate}::text IS NULL THEN ppe.revalidation_due_date
            ELSE ${revalidationDueDate}::date
          END,
          termination_date = CASE
            WHEN ${terminationDate}::text IS NULL THEN ppe.termination_date
            ELSE ${terminationDate}::date
          END,
          payer_provider_id = COALESCE(${payerProviderId}, ppe.payer_provider_id),
          notes = COALESCE(${notes}, ppe.notes),
          updated_at = now()
        FROM current_row c
        WHERE ppe.id = c.id
        RETURNING ppe.*
      ),
      history AS (
        INSERT INTO status_history (
          tenant_id,
          target_type,
          target_id,
          old_status,
          new_status,
          reason
        )
        SELECT
          u.tenant_id,
          'provider_payer_enrollment',
          u.id,
          c.enrollment_status::text,
          u.enrollment_status::text,
          ${reason}
        FROM updated u
        JOIN current_row c ON c.id = u.id
        WHERE c.enrollment_status IS DISTINCT FROM u.enrollment_status
        RETURNING id
      ),
      revalidation_work AS (
        INSERT INTO workqueue_items (
          tenant_id,
          workqueue_type,
          workqueue_status,
          priority,
          source_object_type,
          source_object_id,
          title,
          description,
          due_date
        )
        SELECT
          u.tenant_id,
          'credentialing_issue',
          'open',
          CASE
            WHEN u.revalidation_due_date < current_date THEN 'urgent'::workqueue_priority_enum
            ELSE 'high'::workqueue_priority_enum
          END,
          'provider',
          u.provider_id,
          p.name || ' revalidation ' ||
            CASE
              WHEN u.revalidation_due_date < current_date THEN 'overdue'
              ELSE 'due soon'
            END,
          CASE
            WHEN u.revalidation_due_date IS NULL
              THEN 'Provider revalidation requires action.'
            ELSE 'Provider revalidation is due ' || u.revalidation_due_date::text || '.'
          END,
          u.revalidation_due_date
        FROM updated u
        JOIN payers p ON p.id = u.payer_id
        WHERE (
          u.enrollment_status = 'needs_revalidation'
          OR (
            u.enrollment_status = 'approved'
            AND u.revalidation_due_date IS NOT NULL
            AND u.revalidation_due_date <= current_date + 90
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM workqueue_items w
          WHERE w.tenant_id = u.tenant_id
            AND w.workqueue_type = 'credentialing_issue'
            AND w.source_object_type = 'provider'
            AND w.source_object_id = u.provider_id
            AND w.workqueue_status NOT IN ('completed', 'cancelled')
            AND w.title ILIKE p.name || ' revalidation%'
        )
        RETURNING id
      )
      SELECT
        u.*,
        p.name AS "payerName",
        (SELECT count(*)::int FROM history) AS "historyRowsCreated",
        (SELECT count(*)::int FROM revalidation_work) AS "workItemsCreated"
      FROM updated u
      JOIN payers p ON p.id = u.payer_id
    `);

    if (!result.rows.length) {
      return res.status(404).json({ error: "Demo enrollment not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.post("/credentialing/sync-revalidation", async (_req, res, next) => {
  try {
    const result = await db.execute(sql`
      INSERT INTO workqueue_items (
        tenant_id,
        workqueue_type,
        workqueue_status,
        priority,
        source_object_type,
        source_object_id,
        title,
        description,
        due_date
      )
      SELECT
        ppe.tenant_id,
        'credentialing_issue',
        'open',
        CASE
          WHEN ppe.revalidation_due_date < current_date THEN 'urgent'::workqueue_priority_enum
          ELSE 'high'::workqueue_priority_enum
        END,
        'provider',
        ppe.provider_id,
        p.name || ' revalidation ' ||
          CASE
            WHEN ppe.revalidation_due_date < current_date THEN 'overdue'
            ELSE 'due soon'
          END,
        'Provider revalidation is due ' || ppe.revalidation_due_date::text || '.',
        ppe.revalidation_due_date
      FROM provider_payer_enrollments ppe
      JOIN tenants t ON t.id = ppe.tenant_id
      JOIN payers p ON p.id = ppe.payer_id
      WHERE COALESCE((t.settings ->> 'demo')::boolean, false) = true
        AND ppe.revalidation_due_date IS NOT NULL
        AND ppe.enrollment_status IN ('approved', 'needs_revalidation')
        AND ppe.revalidation_due_date <= current_date + 90
        AND NOT EXISTS (
          SELECT 1
          FROM workqueue_items w
          WHERE w.tenant_id = ppe.tenant_id
            AND w.workqueue_type = 'credentialing_issue'
            AND w.source_object_type = 'provider'
            AND w.source_object_id = ppe.provider_id
            AND w.workqueue_status NOT IN ('completed', 'cancelled')
            AND w.title ILIKE p.name || ' revalidation%'
        )
      RETURNING id
    `);

    return res.json({ created: result.rows.length });
  } catch (error) {
    return next(error);
  }
});

export default router;

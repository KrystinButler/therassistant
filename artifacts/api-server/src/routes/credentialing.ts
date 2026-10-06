import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  discrepancyForExpectation,
  lookupNppesProvider,
} from "../lib/credentialing-directory";

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

router.get("/credentialing/directory-monitor", async (_req, res, next) => {
  try {
    const result = await db.execute(sql`
      SELECT
        e.id AS "expectationId",
        e.tenant_id AS "tenantId",
        e.provider_id AS "providerId",
        e.payer_id AS "payerId",
        e.source_key AS "sourceKey",
        e.expected_participation AS "expectedParticipation",
        e.expected_location_text AS "expectedLocationText",
        e.active,
        CONCAT(pr.first_name, ' ', pr.last_name) AS "providerName",
        pr.npi AS "providerNpi",
        p.name AS "payerName",
        s.id AS "latestSnapshotId",
        s.directory_status AS "directoryStatus",
        s.provider_name AS "directoryProviderName",
        s.specialty_text AS "directorySpecialty",
        s.location_text AS "directoryLocation",
        s.network_text AS "directoryNetwork",
        s.checked_at AS "lastCheckedAt",
        d.id AS "openDiscrepancyId",
        d.discrepancy_type AS "discrepancyType",
        d.summary AS "discrepancySummary"
      FROM credentialing_directory_expectations e
      JOIN providers pr ON pr.id = e.provider_id
      LEFT JOIN payers p ON p.id = e.payer_id
      LEFT JOIN LATERAL (
        SELECT s2.*
        FROM credentialing_directory_snapshots s2
        WHERE s2.tenant_id = e.tenant_id
          AND s2.provider_id = e.provider_id
          AND s2.source_key = e.source_key
          AND s2.payer_id IS NOT DISTINCT FROM e.payer_id
        ORDER BY s2.checked_at DESC
        LIMIT 1
      ) s ON true
      LEFT JOIN LATERAL (
        SELECT d2.*
        FROM credentialing_directory_discrepancies d2
        WHERE d2.tenant_id = e.tenant_id
          AND d2.provider_id = e.provider_id
          AND d2.expectation_id = e.id
          AND d2.status = 'open'
        ORDER BY d2.last_detected_at DESC
        LIMIT 1
      ) d ON true
      WHERE e.active = true
      ORDER BY pr.last_name, pr.first_name, p.name NULLS FIRST, e.source_key
    `);

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/credentialing/directory-expectations", async (req, res, next) => {
  try {
    const providerId = optionalText(req.body?.provider_id);
    const payerId = optionalText(req.body?.payer_id);
    const sourceKey = optionalText(req.body?.source_key);
    const expectedParticipation =
      typeof req.body?.expected_participation === "boolean"
        ? req.body.expected_participation
        : null;
    const expectedLocationText = optionalText(req.body?.expected_location_text);
    const notes = optionalText(req.body?.notes);

    if (!providerId || !UUID_PATTERN.test(providerId)) {
      return res.status(400).json({ error: "Valid provider_id is required" });
    }
    if (payerId && !UUID_PATTERN.test(payerId)) {
      return res.status(400).json({ error: "Invalid payer_id" });
    }
    if (!sourceKey) {
      return res.status(400).json({ error: "source_key is required" });
    }

    const provider = await db.execute(sql`
      SELECT id, tenant_id
      FROM providers
      WHERE id = ${providerId}::uuid
      LIMIT 1
    `);

    if (!provider.rows.length) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const tenantId = String((provider.rows[0] as Record<string, unknown>).tenant_id);

    const result = await db.execute(sql`
      INSERT INTO credentialing_directory_expectations (
        tenant_id,
        provider_id,
        payer_id,
        source_key,
        expected_participation,
        expected_location_text,
        notes,
        active
      )
      VALUES (
        ${tenantId}::uuid,
        ${providerId}::uuid,
        ${payerId}::uuid,
        ${sourceKey},
        ${expectedParticipation},
        ${expectedLocationText},
        ${notes},
        true
      )
      ON CONFLICT (tenant_id, provider_id, payer_id, source_key)
      DO UPDATE SET
        expected_participation = EXCLUDED.expected_participation,
        expected_location_text = EXCLUDED.expected_location_text,
        notes = EXCLUDED.notes,
        active = true,
        updated_at = now()
      RETURNING *
    `);

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.post("/credentialing/providers/:id/nppes-check", async (req, res, next) => {
  try {
    const providerId = req.params.id;
    if (!UUID_PATTERN.test(providerId)) {
      return res.status(400).json({ error: "Invalid provider id" });
    }

    const providerResult = await db.execute(sql`
      SELECT
        id,
        tenant_id,
        npi,
        first_name,
        last_name
      FROM providers
      WHERE id = ${providerId}::uuid
      LIMIT 1
    `);

    if (!providerResult.rows.length) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const provider = providerResult.rows[0] as Record<string, unknown>;
    const npi = typeof provider.npi === "string" ? provider.npi : "";
    const tenantId = String(provider.tenant_id);

    const observation = await lookupNppesProvider(npi);

    const snapshot = await db.execute(sql`
      INSERT INTO credentialing_directory_snapshots (
        tenant_id,
        provider_id,
        payer_id,
        expectation_id,
        source_key,
        source_record_id,
        directory_status,
        provider_npi,
        provider_name,
        specialty_text,
        location_text,
        network_text,
        source_updated_at,
        checked_at,
        raw_result
      )
      VALUES (
        ${tenantId}::uuid,
        ${providerId}::uuid,
        NULL,
        NULL,
        ${observation.sourceKey},
        ${observation.sourceRecordId},
        ${observation.directoryStatus},
        ${observation.providerNpi},
        ${observation.providerName},
        ${observation.specialtyText},
        ${observation.locationText},
        ${observation.networkText},
        ${observation.sourceUpdatedAt}::timestamptz,
        ${observation.checkedAt}::timestamptz,
        ${JSON.stringify(observation.rawResult)}::jsonb
      )
      RETURNING id
    `);

    const snapshotId = String((snapshot.rows[0] as Record<string, unknown>).id);
    const discrepancy = discrepancyForExpectation({
      expectedParticipation: true,
      observation,
    });

    let discrepancyId: string | null = null;

    if (discrepancy) {
      const discrepancyResult = await db.execute(sql`
        INSERT INTO credentialing_directory_discrepancies (
          tenant_id,
          provider_id,
          payer_id,
          expectation_id,
          snapshot_id,
          source_key,
          discrepancy_type,
          status,
          summary,
          details,
          first_detected_at,
          last_detected_at
        )
        VALUES (
          ${tenantId}::uuid,
          ${providerId}::uuid,
          NULL,
          NULL,
          ${snapshotId}::uuid,
          'nppes',
          ${discrepancy.type},
          'open',
          ${discrepancy.summary},
          ${JSON.stringify({ npi, observation })}::jsonb,
          now(),
          now()
        )
        RETURNING id
      `);

      discrepancyId = String(
        (discrepancyResult.rows[0] as Record<string, unknown>).id,
      );
    }

    return res.json({
      providerId,
      snapshotId,
      discrepancyId,
      observation,
      claimImpact: "none",
    });
  } catch (error) {
    return next(error);
  }
});

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

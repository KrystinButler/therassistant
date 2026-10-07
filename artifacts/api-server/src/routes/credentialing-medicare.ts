import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  discrepancyForExpectation,
  lookupCmsMedicareEnrollment,
} from "../lib/credentialing-directory";

const router: IRouter = Router();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.post("/credentialing/providers/:id/medicare-enrollment-check", async (req, res, next) => {
  try {
    const providerId = req.params.id;
    if (!UUID_PATTERN.test(providerId)) {
      return res.status(400).json({ error: "Invalid provider id" });
    }

    const providerResult = await db.execute(sql`
      SELECT id, tenant_id, npi
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
    const observation = await lookupCmsMedicareEnrollment(npi);

    const expectationResult = await db.execute(sql`
      SELECT id, expected_participation
      FROM credentialing_directory_expectations
      WHERE tenant_id = ${tenantId}::uuid
        AND provider_id = ${providerId}::uuid
        AND payer_id IS NULL
        AND source_key = 'cms_pecos_ffs'
        AND active = true
      LIMIT 1
    `);

    const expectation = expectationResult.rows[0] as Record<string, unknown> | undefined;
    const expectationId = expectation ? String(expectation.id) : null;
    const expectedParticipation =
      typeof expectation?.expected_participation === "boolean"
        ? expectation.expected_participation
        : true;

    const snapshotResult = await db.execute(sql`
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
        ${expectationId}::uuid,
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

    const snapshotId = String(
      (snapshotResult.rows[0] as Record<string, unknown>).id,
    );
    const discrepancy = discrepancyForExpectation({
      expectedParticipation,
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
          ${expectationId}::uuid,
          ${snapshotId}::uuid,
          'cms_pecos_ffs',
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
      source: "CMS PECOS Medicare Fee-for-Service Public Provider Enrollment",
      snapshotId,
      discrepancyId,
      observation,
      enrollmentRecordUpdated: false,
      claimImpact: "none",
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

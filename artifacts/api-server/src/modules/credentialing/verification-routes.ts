import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

import {
  getTenantAuthContext,
  requireAuthenticatedTenant,
} from "../../middlewares/auth";
import { enqueueVerification } from "./queue";

const router: IRouter = Router();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value.trim())
    ? value.trim()
    : null;
}

function optionalUuid(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return uuid(value) ?? undefined;
}

router.post(
  "/v1/participation-verifications",
  requireAuthenticatedTenant,
  async (req, res, next) => {
    try {
      const { tenantId, userId } = getTenantAuthContext(req);
      const providerId = uuid(req.body?.provider_id ?? req.body?.providerId);
      const organizationId = optionalUuid(
        req.body?.organization_id ?? req.body?.organizationId,
      );
      const practiceLocationId = optionalUuid(
        req.body?.practice_location_id ?? req.body?.practiceLocationId,
      );
      const payerId = uuid(req.body?.payer_id ?? req.body?.payerId);
      const planId = uuid(req.body?.plan_id ?? req.body?.planId);
      const networkId = optionalUuid(req.body?.network_id ?? req.body?.networkId);

      if (!providerId || !payerId || !planId) {
        return res.status(400).json({
          error: "provider_id, payer_id, and plan_id are required UUIDs",
        });
      }
      if (organizationId === undefined || practiceLocationId === undefined || networkId === undefined) {
        return res.status(400).json({ error: "Invalid optional UUID" });
      }

      const providerResult = await db.execute(sql`
        SELECT id, tenant_id, individual_npi, taxonomy_code
        FROM providers
        WHERE id = ${providerId}::uuid
          AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `);
      if (!providerResult.rows.length) {
        return res.status(404).json({ error: "Provider not found in tenant" });
      }
      const provider = providerResult.rows[0] as Record<string, unknown>;
      if (typeof provider.individual_npi !== "string" || !/^\d{10}$/.test(provider.individual_npi)) {
        return res.status(422).json({ error: "Provider requires a valid Type 1 individual_npi" });
      }

      let organizationNpi: string | null = null;
      if (organizationId) {
        const organization = await db.execute(sql`
          SELECT id, group_npi
          FROM practice_entities
          WHERE id = ${organizationId}::uuid
            AND tenant_id = ${tenantId}::uuid
          LIMIT 1
        `);
        if (!organization.rows.length) {
          return res.status(404).json({ error: "Organization not found in tenant" });
        }
        const groupNpi = (organization.rows[0] as Record<string, unknown>).group_npi;
        organizationNpi = typeof groupNpi === "string" ? groupNpi : null;
      }

      if (practiceLocationId) {
        const location = await db.execute(sql`
          SELECT id
          FROM practice_locations
          WHERE id = ${practiceLocationId}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND (${organizationId}::uuid IS NULL OR practice_entity_id = ${organizationId}::uuid)
          LIMIT 1
        `);
        if (!location.rows.length) {
          return res.status(404).json({ error: "Practice location not found in selected tenant/organization" });
        }
      }

      const catalog = await db.execute(sql`
        SELECT
          pp.id AS plan_id,
          pp.payer_id,
          pn.id AS network_id,
          pn.plan_id AS network_plan_id
        FROM payer_plans pp
        LEFT JOIN payer_networks pn
          ON pn.id = ${networkId}::uuid
        WHERE pp.id = ${planId}::uuid
          AND pp.payer_id = ${payerId}::uuid
          AND pp.state = 'CO'
          AND pp.active = true
          AND (pp.effective_from IS NULL OR pp.effective_from <= CURRENT_DATE)
          AND (pp.effective_to IS NULL OR pp.effective_to >= CURRENT_DATE)
          AND (
            ${networkId}::uuid IS NULL
            OR (pn.plan_id = pp.id AND pn.active = true)
          )
        LIMIT 1
      `);
      if (!catalog.rows.length) {
        return res.status(422).json({ error: "Selected plan/network is not valid for this payer" });
      }

      const created = await db.execute(sql`
        INSERT INTO participation_verification_runs (
          tenant_id, provider_id, organization_id, practice_location_id,
          payer_id, plan_id, network_id, status, created_by_user_id
        )
        VALUES (
          ${tenantId}::uuid, ${providerId}::uuid, ${organizationId}::uuid,
          ${practiceLocationId}::uuid, ${payerId}::uuid, ${planId}::uuid,
          ${networkId}::uuid, 'IN_PROGRESS', ${userId}::uuid
        )
        RETURNING id, status, requested_at
      `);
      const run = created.rows[0] as Record<string, unknown>;
      const verificationId = String(run.id);

      await db.execute(sql`
        INSERT INTO audit_logs (
          tenant_id, actor_id, action, target_type, target_id, metadata
        ) VALUES (
          ${tenantId}::uuid, ${userId}::uuid, 'VERIFICATION_REQUESTED',
          'participation_verification_run', ${verificationId},
          ${JSON.stringify({ providerId, organizationId, practiceLocationId, payerId, planId, networkId, organizationNpi })}::jsonb
        )
      `);

      try {
        await enqueueVerification(verificationId, tenantId);
      } catch (queueError) {
        await db.execute(sql`
          UPDATE participation_verification_runs
          SET status = 'UNABLE_TO_VERIFY',
              confidence = 'LOW',
              failure_code = 'SOURCE_UNAVAILABLE',
              failure_detail = 'Verification queue was unavailable.',
              completed_at = now(),
              verified_at = now()
          WHERE id = ${verificationId}::uuid
            AND tenant_id = ${tenantId}::uuid
        `);
        throw queueError;
      }

      return res.status(202).json({
        verificationId,
        status: "IN_PROGRESS",
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/v1/participation-verifications/:id",
  requireAuthenticatedTenant,
  async (req, res, next) => {
    try {
      const { tenantId } = getTenantAuthContext(req);
      const id = uuid(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid verification id" });

      const runResult = await db.execute(sql`
        SELECT r.*, p.name AS payer_name, pp.name AS plan_name, pn.name AS network_name,
               pr.individual_npi AS provider_npi,
               pe.group_npi AS organization_npi
        FROM participation_verification_runs r
        JOIN providers pr ON pr.id = r.provider_id
        JOIN payers p ON p.id = r.payer_id
        JOIN payer_plans pp ON pp.id = r.plan_id
        LEFT JOIN payer_networks pn ON pn.id = r.network_id
        LEFT JOIN practice_entities pe ON pe.id = r.organization_id
        WHERE r.id = ${id}::uuid
          AND r.tenant_id = ${tenantId}::uuid
        LIMIT 1
      `);
      if (!runResult.rows.length) return res.status(404).json({ error: "Verification not found" });

      const [evidence, matches] = await Promise.all([
        db.execute(sql`
          SELECT * FROM participation_verification_evidence
          WHERE verification_id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
          ORDER BY retrieved_at, created_at
        `),
        db.execute(sql`
          SELECT * FROM participation_verification_matches
          WHERE verification_id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
          ORDER BY created_at, match_type
        `),
      ]);

      return res.json({
        ...runResult.rows[0],
        evidence: evidence.rows,
        matches: matches.rows,
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/v1/providers/:providerId/participation",
  requireAuthenticatedTenant,
  async (req, res, next) => {
    try {
      const { tenantId } = getTenantAuthContext(req);
      const providerId = uuid(req.params.providerId);
      if (!providerId) return res.status(400).json({ error: "Invalid provider id" });

      const result = await db.execute(sql`
        SELECT DISTINCT ON (payer_id, plan_id, network_id)
          *
        FROM participation_verification_runs
        WHERE tenant_id = ${tenantId}::uuid
          AND provider_id = ${providerId}::uuid
          AND status <> 'IN_PROGRESS'
        ORDER BY payer_id, plan_id, network_id, verified_at DESC NULLS LAST, requested_at DESC
      `);
      return res.json(result.rows);
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/v1/providers/:providerId/verification-history",
  requireAuthenticatedTenant,
  async (req, res, next) => {
    try {
      const { tenantId } = getTenantAuthContext(req);
      const providerId = uuid(req.params.providerId);
      if (!providerId) return res.status(400).json({ error: "Invalid provider id" });

      const result = await db.execute(sql`
        SELECT *
        FROM participation_verification_runs
        WHERE tenant_id = ${tenantId}::uuid
          AND provider_id = ${providerId}::uuid
        ORDER BY requested_at DESC
        LIMIT 200
      `);
      return res.json(result.rows);
    } catch (error) {
      return next(error);
    }
  },
);

export default router;

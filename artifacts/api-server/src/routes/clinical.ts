import {
  Router,
  type IRouter,
} from "express";

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

import {
  getTenantAuthContext,
  requireAuthenticatedTenant,
} from "../middlewares/auth";

const router: IRouter = Router();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasAnyRole(
  roles: string[],
  allowedRoles: string[],
) {
  return allowedRoles.some((role) => roles.includes(role));
}


router.get(
  "/clinical",
  requireAuthenticatedTenant,
  async (req, res, next) => {
    try {
      const { userId, tenantId, roles } =
        getTenantAuthContext(req);

      const isClinicalAdmin = hasAnyRole(roles, [
        "platform_admin",
        "practice_admin",
      ]);
      const isClinician = roles.includes("clinician");

      if (!isClinicalAdmin && !isClinician) {
        return res.status(403).json({
          error: "Clinical note access denied",
        });
      }

      const providerScope = isClinicalAdmin
        ? sql``
        : sql`
            AND EXISTS (
              SELECT 1
              FROM provider_user_links pul
              WHERE pul.tenant_id = cn.tenant_id
                AND pul.user_id = ${userId}::uuid
                AND pul.provider_id = cn.provider_id
                AND pul.status = 'active'
            )
          `;

      const result = await db.execute(sql`
        SELECT
          cn.id,

          cn.client_id
            AS "clientId",

          cn.appointment_id
            AS "appointmentId",

          cn.provider_id
            AS "providerId",

          cn.treatment_plan_id
            AS "treatmentPlanId",

          cn.note_type
            AS "noteType",

          cn.note_status
            AS "noteStatus",

          cn.service_date
            AS "serviceDate",

          cn.start_time
            AS "startTime",

          cn.end_time
            AS "endTime",

          cn.duration_minutes
            AS "durationMinutes",

          cn.cpt_code
            AS "cptCode",

          cn.diagnosis_code
            AS "diagnosisCode",

          cn.goal_addressed
            AS "goalAddressed",

          cn.note_text
            AS "noteText",

          cn.locked_at
            AS "lockedAt",

          CONCAT(
            c.first_name,
            ' ',
            c.last_name
          ) AS "clientName",

          CONCAT(
            pr.first_name,
            ' ',
            pr.last_name
          ) AS "providerName",

          pr.credentials
            AS "providerCredentials",

          cci.id
            AS "chargeId",

          cci.charge_status
            AS "chargeStatus",

          cci.block_reason
            AS "chargeBlockReason",

          cci.charge_amount_cents
            AS "chargeAmountCents",

          CASE
            WHEN cn.note_status = 'signed'
              THEN true
            ELSE false
          END AS "documentationComplete"

        FROM clinical_notes cn

        JOIN clients c
          ON c.id = cn.client_id
         AND c.tenant_id = cn.tenant_id

        LEFT JOIN providers pr
          ON pr.id = cn.provider_id
         AND pr.tenant_id = cn.tenant_id

        LEFT JOIN charge_capture_items cci
          ON cci.clinical_note_id = cn.id
         AND cci.tenant_id = cn.tenant_id

        WHERE cn.tenant_id = ${tenantId}::uuid
          AND cn.note_type <> 'psychotherapy'
          ${providerScope}

        ORDER BY
          cn.service_date DESC NULLS LAST,
          cn.updated_at DESC
      `);

      return res.json(result.rows);
    } catch (error) {
      return next(error);
    }
  },
);


router.post(
  "/clinical-notes/:id/sign",
  requireAuthenticatedTenant,
  async (req, res, next) => {
    try {
      const { userId, tenantId, roles } =
        getTenantAuthContext(req);

      if (!roles.includes("clinician")) {
        return res.status(403).json({
          error: "Clinical note signing denied",
        });
      }

      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;

      if (!id || !UUID_PATTERN.test(id)) {
        return res.status(404).json({
          error: "Clinical note not found",
        });
      }

      const noteResult = await db.execute(sql`
        SELECT
          cn.*,

          CONCAT(
            pr.first_name,
            ' ',
            pr.last_name
          ) AS "providerName",

          pr.credentials
            AS "providerCredentials"

        FROM clinical_notes cn

        LEFT JOIN providers pr
          ON pr.id = cn.provider_id
         AND pr.tenant_id = cn.tenant_id

        WHERE cn.id = ${id}::uuid
          AND cn.tenant_id = ${tenantId}::uuid
          AND cn.note_type <> 'psychotherapy'
          AND EXISTS (
            SELECT 1
            FROM provider_user_links pul
            WHERE pul.tenant_id = cn.tenant_id
              AND pul.user_id = ${userId}::uuid
              AND pul.provider_id = cn.provider_id
              AND pul.status = 'active'
          )
        LIMIT 1
      `);

      if (!noteResult.rows.length) {
        return res.status(404).json({
          error: "Clinical note not found",
        });
      }

      const note =
        noteResult.rows[0] as Record<
          string,
          any
        >;

      if (note.note_status === "signed") {
        return res.json({
          message: "Note already signed",
          note,
        });
      }

      const serviceDate =
        note.service_date
          ? new Date(
              `${note.service_date}T12:00:00`,
            )
          : null;

      if (
        serviceDate &&
        serviceDate >
          new Date()
      ) {
        return res.status(409).json({
          error:
            "Future-dated clinical notes cannot be signed.",
        });
      }

      const signatureText =
        typeof req.body?.signatureText ===
          "string" &&
        req.body.signatureText.trim()
          ? req.body.signatureText.trim()
          : `${note.providerName || "Provider"}${
              note.providerCredentials
                ? `, ${note.providerCredentials}`
                : ""
            }`;

      const signed = await db.transaction(
        async (tx) => {
          const updateResult = await tx.execute(sql`
            UPDATE clinical_notes cn

            SET
              note_status = 'signed',
              locked_at = now(),
              updated_at = now()

            WHERE cn.id = ${id}::uuid
              AND cn.tenant_id = ${tenantId}::uuid
              AND cn.note_type <> 'psychotherapy'
              AND EXISTS (
                SELECT 1
                FROM provider_user_links pul
                WHERE pul.tenant_id = cn.tenant_id
                  AND pul.user_id = ${userId}::uuid
                  AND pul.provider_id = cn.provider_id
                  AND pul.status = 'active'
              )
            RETURNING cn.id
          `);

          if (!updateResult.rows.length) {
            return false;
          }

          await tx.execute(sql`
            INSERT INTO clinical_note_signatures
            (
              tenant_id,
              clinical_note_id,
              signer_id,
              signed_at,
              signature_text,
              provider_id
            )

            SELECT
              cn.tenant_id,
              cn.id,
              ${userId}::uuid,
              now(),
              ${signatureText},
              cn.provider_id

            FROM clinical_notes cn

            WHERE cn.id = ${id}::uuid
              AND cn.tenant_id = ${tenantId}::uuid
              AND cn.note_type <> 'psychotherapy'
              AND EXISTS (
                SELECT 1
                FROM provider_user_links pul
                WHERE pul.tenant_id = cn.tenant_id
                  AND pul.user_id = ${userId}::uuid
                  AND pul.provider_id = cn.provider_id
                  AND pul.status = 'active'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM clinical_note_signatures cns
                WHERE cns.clinical_note_id = cn.id
                  AND cns.tenant_id = cn.tenant_id
              )
          `);

          await tx.execute(sql`
            UPDATE charge_capture_items cci

            SET
              updated_at = now(),

              block_reason =
                CASE
                  WHEN block_reason =
                    'Clinical note is not signed.'
                  THEN NULL
                  ELSE block_reason
                END

            WHERE cci.tenant_id = ${tenantId}::uuid
              AND cci.clinical_note_id = ${id}::uuid
          `);

          return true;
        },
      );

      if (!signed) {
        return res.status(404).json({
          error: "Clinical note not found",
        });
      }

      const updated =
        await db.execute(sql`
          SELECT cn.*
          FROM clinical_notes cn
          WHERE cn.id = ${id}::uuid
            AND cn.tenant_id = ${tenantId}::uuid
            AND cn.note_type <> 'psychotherapy'
            AND EXISTS (
              SELECT 1
              FROM provider_user_links pul
              WHERE pul.tenant_id = cn.tenant_id
                AND pul.user_id = ${userId}::uuid
                AND pul.provider_id = cn.provider_id
                AND pul.status = 'active'
            )
          LIMIT 1
        `);

      if (!updated.rows.length) {
        return res.status(404).json({
          error: "Clinical note not found",
        });
      }

      return res.json({
        message:
          "Clinical note signed and locked.",
        note: updated.rows[0],
      });
    } catch (error) {
      return next(error);
    }
  },
);


export default router;
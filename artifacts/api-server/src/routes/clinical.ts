import {
  Router,
  type IRouter,
} from "express";

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();


router.get(
  "/clinical",
  async (_req, res, next) => {
    try {
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

        LEFT JOIN providers pr
          ON pr.id = cn.provider_id

        LEFT JOIN charge_capture_items cci
          ON cci.clinical_note_id = cn.id

        ORDER BY
          cn.service_date DESC NULLS LAST,
          cn.updated_at DESC
      `);

      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  },
);


router.post(
  "/clinical-notes/:id/sign",
  async (req, res, next) => {
    try {
      const id = req.params.id;

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

        WHERE cn.id = ${id}::uuid
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

      await db.transaction(
        async (tx) => {
          await tx.execute(sql`
            UPDATE clinical_notes

            SET
              note_status = 'signed',
              locked_at = now(),
              updated_at = now()

            WHERE id = ${id}::uuid
          `);

          await tx.execute(sql`
            INSERT INTO clinical_note_signatures
            (
              tenant_id,
              clinical_note_id,
              signer_id,
              signed_at,
              signature_text
            )

            SELECT
              cn.tenant_id,
              cn.id,
              NULL,
              now(),
              ${signatureText}

            FROM clinical_notes cn

            WHERE cn.id = ${id}::uuid

              AND NOT EXISTS (
                SELECT 1
                FROM clinical_note_signatures cns
                WHERE cns.clinical_note_id =
                  cn.id
              )
          `);

          await tx.execute(sql`
            UPDATE charge_capture_items

            SET
              updated_at = now(),

              block_reason =
                CASE
                  WHEN block_reason =
                    'Clinical note is not signed.'
                  THEN NULL
                  ELSE block_reason
                END

            WHERE clinical_note_id =
              ${id}::uuid
          `);
        },
      );

      const updated =
        await db.execute(sql`
          SELECT *
          FROM clinical_notes
          WHERE id = ${id}::uuid
          LIMIT 1
        `);

      res.json({
        message:
          "Clinical note signed and locked.",
        note: updated.rows[0],
      });
    } catch (error) {
      next(error);
    }
  },
);


export default router;

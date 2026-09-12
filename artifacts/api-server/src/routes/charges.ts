import {
  randomUUID,
} from "node:crypto";

import {
  Router,
  type IRouter,
} from "express";

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();


router.get(
  "/charges",
  async (_req, res, next) => {
    try {
      const result = await db.execute(sql`
        SELECT
          cc.id,

          cc.client_id
            AS "clientId",

          cc.appointment_id
            AS "appointmentId",

          cc.clinical_note_id
            AS "clinicalNoteId",

          cc.provider_id
            AS "providerId",

          cc.payer_id
            AS "payerId",

          cc.service_date
            AS "serviceDate",

          cc.cpt_code
            AS "cptCode",

          cc.modifier1,

          cc.modifier2,

          cc.diagnosis_code
            AS "diagnosisCode",

          cc.place_of_service
            AS "placeOfService",

          cc.charge_amount_cents
            AS "chargeAmountCents",

          cc.charge_status
            AS "chargeStatus",

          cc.block_reason
            AS "blockReason",

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

          p.name
            AS "payerName",

          cn.note_status
            AS "noteStatus",

          pc.id
            AS "claimId",

          pc.claim_status
            AS "claimStatus",

          CASE
            WHEN pc.id IS NOT NULL
              THEN 'claim_created'

            WHEN cc.block_reason IS NOT NULL
              THEN 'blocked'

            WHEN cn.id IS NULL
              THEN 'missing_note'

            WHEN cn.note_status <> 'signed'
              THEN 'unsigned_note'

            WHEN cc.diagnosis_code IS NULL
              OR cc.diagnosis_code = ''
              THEN 'missing_diagnosis'

            WHEN cc.payer_id IS NULL
              THEN 'missing_payer'

            WHEN cc.provider_id IS NULL
              THEN 'missing_provider'

            WHEN cc.charge_status =
              'ready_for_claim'
              THEN 'ready'

            ELSE 'needs_validation'
          END AS "readiness"

        FROM charge_capture_items cc

        JOIN clients c
          ON c.id = cc.client_id

        LEFT JOIN providers pr
          ON pr.id = cc.provider_id

        LEFT JOIN payers p
          ON p.id = cc.payer_id

        LEFT JOIN clinical_notes cn
          ON cn.id =
            cc.clinical_note_id

        LEFT JOIN professional_claims pc
          ON pc.charge_id = cc.id

        ORDER BY
          cc.service_date DESC,
          c.last_name,
          c.first_name
      `);

      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  },
);


router.post(
  "/charges/:id/validate",
  async (req, res, next) => {
    try {
      const id = req.params.id;

      const result =
        await db.execute(sql`
          SELECT
            cc.*,

            cn.note_status,

            pc.id
              AS existing_claim_id

          FROM charge_capture_items cc

          LEFT JOIN clinical_notes cn
            ON cn.id =
              cc.clinical_note_id

          LEFT JOIN professional_claims pc
            ON pc.charge_id = cc.id

          WHERE cc.id =
            ${id}::uuid

          LIMIT 1
        `);

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Charge not found",
        });
      }

      const charge =
        result.rows[0] as Record<
          string,
          any
        >;

      if (charge.existing_claim_id) {
        return res.json({
          valid: true,
          message:
            "Claim already exists for this charge.",
          claimId:
            charge.existing_claim_id,
        });
      }

      const issues: string[] = [];

      if (!charge.clinical_note_id) {
        issues.push(
          "Clinical note is missing.",
        );
      } else if (
        charge.note_status !== "signed"
      ) {
        issues.push(
          "Clinical note is not signed.",
        );
      }

      if (
        !charge.diagnosis_code
      ) {
        issues.push(
          "Diagnosis code is missing.",
        );
      }

      if (!charge.payer_id) {
        issues.push(
          "Payer is missing.",
        );
      }

      if (!charge.provider_id) {
        issues.push(
          "Rendering provider is missing.",
        );
      }

      /*
       * Preserve existing enrollment or authorization
       * blocks until those workflows resolve them.
       */
      if (
        charge.block_reason &&
        /enrollment|credential|authorization/i.test(
          charge.block_reason,
        )
      ) {
        issues.push(
          charge.block_reason,
        );
      }

      const uniqueIssues = [
        ...new Set(issues),
      ];

      if (uniqueIssues.length) {
        const blockReason =
          uniqueIssues.join(" ");

        await db.execute(sql`
          UPDATE charge_capture_items

          SET
            charge_status = 'captured',
            block_reason =
              ${blockReason},
            updated_at = now()

          WHERE id = ${id}::uuid
        `);

        return res.status(409).json({
          valid: false,
          issues: uniqueIssues,
        });
      }

      await db.execute(sql`
        UPDATE charge_capture_items

        SET
          charge_status =
            'ready_for_claim',
          block_reason = NULL,
          updated_at = now()

        WHERE id = ${id}::uuid
      `);

      res.json({
        valid: true,
        message:
          "Charge passed validation and is ready for claim creation.",
      });
    } catch (error) {
      next(error);
    }
  },
);


router.post(
  "/charges/:id/create-claim",
  async (req, res, next) => {
    try {
      const id = req.params.id;

      const result =
        await db.execute(sql`
          SELECT
            cc.*,

            cn.note_status,

            pc.id
              AS existing_claim_id

          FROM charge_capture_items cc

          LEFT JOIN clinical_notes cn
            ON cn.id =
              cc.clinical_note_id

          LEFT JOIN professional_claims pc
            ON pc.charge_id = cc.id

          WHERE cc.id =
            ${id}::uuid

          LIMIT 1
        `);

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Charge not found",
        });
      }

      const charge =
        result.rows[0] as Record<
          string,
          any
        >;

      if (charge.existing_claim_id) {
        return res.json({
          message:
            "Claim already exists.",
          claimId:
            charge.existing_claim_id,
        });
      }

      if (
        charge.charge_status !==
          "ready_for_claim" ||
        charge.block_reason
      ) {
        return res.status(409).json({
          error:
            "Charge must pass validation before a claim can be created.",
        });
      }

      if (
        charge.note_status !==
        "signed"
      ) {
        return res.status(409).json({
          error:
            "Clinical documentation must be signed before claim creation.",
        });
      }

      const claimId = randomUUID();
      const lineId = randomUUID();
      const diagnosisId =
        randomUUID();
      const historyId =
        randomUUID();

      const serviceDate =
        String(
          charge.service_date,
        );

      const controlNumber =
        `TA-${serviceDate.replace(
          /-/g,
          "",
        )}-${String(charge.id)
          .slice(0, 8)
          .toUpperCase()}`;

      await db.transaction(
        async (tx) => {
          await tx.execute(sql`
            INSERT INTO professional_claims
            (
              id,
              tenant_id,
              charge_id,
              client_id,
              rendering_provider_id,
              billing_provider_id,
              payer_id,
              claim_status,
              service_date_from,
              service_date_to,
              total_charge_cents,
              patient_control_number,
              metadata
            )
            VALUES
            (
              ${claimId}::uuid,
              ${charge.tenant_id}::uuid,
              ${charge.id}::uuid,
              ${charge.client_id}::uuid,
              ${charge.provider_id}::uuid,
              ${charge.provider_id}::uuid,
              ${charge.payer_id}::uuid,
              'ready_for_validation',
              ${serviceDate}::date,
              ${serviceDate}::date,
              ${Number(
                charge.charge_amount_cents,
              )},
              ${controlNumber},
              '{
                "createdFromChargeCapture": true,
                "demo": true
              }'::jsonb
            )
          `);

          await tx.execute(sql`
            INSERT INTO professional_claim_lines
            (
              id,
              tenant_id,
              claim_id,
              service_date,
              cpt_code,
              modifier1,
              modifier2,
              diagnosis_pointer,
              units,
              charge_amount_cents,
              allowed_amount_cents,
              paid_amount_cents,
              adjustment_amount_cents
            )
            VALUES
            (
              ${lineId}::uuid,
              ${charge.tenant_id}::uuid,
              ${claimId}::uuid,
              ${serviceDate}::date,
              ${charge.cpt_code},
              ${charge.modifier1},
              ${charge.modifier2},
              '1',
              1,
              ${Number(
                charge.charge_amount_cents,
              )},
              0,
              0,
              0
            )
          `);

          if (
            charge.diagnosis_code
          ) {
            await tx.execute(sql`
              INSERT INTO claim_diagnoses
              (
                id,
                tenant_id,
                claim_id,
                diagnosis_code,
                pointer_order
              )
              VALUES
              (
                ${diagnosisId}::uuid,
                ${charge.tenant_id}::uuid,
                ${claimId}::uuid,
                ${charge.diagnosis_code},
                1
              )
            `);
          }

          await tx.execute(sql`
            INSERT INTO claim_balance_summaries
            (
              claim_id,
              tenant_id,
              total_charge_cents,
              paid_amount_cents,
              adjustment_amount_cents,
              open_balance_cents,
              last_calculated_at
            )
            VALUES
            (
              ${claimId}::uuid,
              ${charge.tenant_id}::uuid,
              ${Number(
                charge.charge_amount_cents,
              )},
              0,
              0,
              ${Number(
                charge.charge_amount_cents,
              )},
              now()
            )
          `);

          await tx.execute(sql`
            INSERT INTO claim_status_history
            (
              id,
              tenant_id,
              claim_id,
              old_status,
              new_status,
              reason,
              created_at
            )
            VALUES
            (
              ${historyId}::uuid,
              ${charge.tenant_id}::uuid,
              ${claimId}::uuid,
              NULL,
              'ready_for_validation',
              'Claim created from validated charge capture item.',
              now()
            )
          `);
        },
      );

      res.status(201).json({
        message:
          "Professional claim created.",
        claimId,
        patientControlNumber:
          controlNumber,
      });
    } catch (error) {
      next(error);
    }
  },
);


export default router;

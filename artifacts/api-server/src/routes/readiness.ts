import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

/* =========================================================
   SCHEDULE
   ========================================================= */

router.get("/schedule", async (_req, res, next) => {
  try {
    const result = await db.execute(sql`
      SELECT
        a.id,
        a.client_id AS "clientId",
        a.provider_id AS "providerId",
        a.starts_at AS "startsAt",
        a.ends_at AS "endsAt",
        a.appointment_status AS "appointmentStatus",
        a.location_type AS "locationType",
        a.service_type AS "serviceType",
        a.cpt_code AS "cptCode",

        CONCAT(c.first_name, ' ', c.last_name)
          AS "clientName",

        c.registration_status
          AS "registrationStatus",

        c.billing_readiness_status
          AS "billingReadinessStatus",

        CONCAT(
          pr.first_name,
          ' ',
          pr.last_name
        ) AS "providerName",

        pr.credentials
          AS "providerCredentials",

        ci.on_my_way_at
          AS "onMyWayAt",

        ci.arrived_at
          AS "arrivedAt",

        ci.checked_in_at
          AS "checkedInAt",

        ec.eligibility_status
          AS "eligibilityStatus",

        p.name
          AS "payerName",

        eb.network_status
          AS "networkStatus",

        eb.authorization_required
          AS "authorizationRequired",

        auth.authorization_number
          AS "authorizationNumber",

        auth.status
          AS "authorizationStatus",

        auth.end_date
          AS "authorizationEndDate",

        au.authorized_units
          AS "authorizedUnits",

        au.used_units
          AS "usedUnits",

        au.remaining_units
          AS "remainingUnits",

        CASE
          WHEN a.appointment_status = 'completed'
            THEN 'completed'

          WHEN ec.id IS NULL
            THEN 'needs_eligibility'

          WHEN ec.eligibility_status <> 'active'
            THEN 'coverage_issue'

          WHEN COALESCE(
            eb.authorization_required,
            false
          ) = true
          AND auth.id IS NULL
            THEN 'authorization_required'

          WHEN COALESCE(
            eb.authorization_required,
            false
          ) = true
          AND COALESCE(
            au.remaining_units,
            0
          ) <= 1
            THEN 'authorization_low_units'

          WHEN c.registration_status <> 'complete'
            THEN 'registration_incomplete'

          ELSE 'ready'
        END AS "readinessStatus"

      FROM appointments a

      JOIN clients c
        ON c.id = a.client_id

      LEFT JOIN providers pr
        ON pr.id = a.provider_id

      LEFT JOIN client_checkins ci
        ON ci.appointment_id = a.id

      LEFT JOIN LATERAL (
        SELECT ec2.*
        FROM eligibility_checks ec2
        WHERE ec2.client_id = a.client_id
          AND ec2.service_date <= a.starts_at::date
        ORDER BY
          ec2.service_date DESC,
          ec2.created_at DESC
        LIMIT 1
      ) ec ON true

      LEFT JOIN payers p
        ON p.id = ec.payer_id

      LEFT JOIN LATERAL (
        SELECT eb2.*
        FROM eligibility_benefits eb2
        WHERE
          eb2.eligibility_check_id = ec.id
          AND (
            eb2.cpt_code = a.cpt_code
            OR eb2.cpt_code IS NULL
          )
        ORDER BY
          CASE
            WHEN eb2.cpt_code = a.cpt_code
              THEN 0
            ELSE 1
          END,
          eb2.updated_at DESC
        LIMIT 1
      ) eb ON true

      LEFT JOIN LATERAL (
        SELECT auth2.*
        FROM authorizations auth2
        WHERE auth2.client_id = a.client_id
          AND (
            auth2.payer_id = ec.payer_id
            OR auth2.payer_id IS NULL
          )
          AND (
            auth2.start_date IS NULL
            OR auth2.start_date <= a.starts_at::date
          )
          AND (
            auth2.end_date IS NULL
            OR auth2.end_date >= a.starts_at::date
          )
        ORDER BY
          auth2.end_date ASC NULLS LAST,
          auth2.updated_at DESC
        LIMIT 1
      ) auth ON true

      LEFT JOIN LATERAL (
        SELECT au2.*
        FROM authorization_units au2
        WHERE au2.authorization_id = auth.id
          AND (
            au2.cpt_code = a.cpt_code
            OR au2.cpt_code IS NULL
          )
        ORDER BY
          CASE
            WHEN au2.cpt_code = a.cpt_code
              THEN 0
            ELSE 1
          END
        LIMIT 1
      ) au ON true

      ORDER BY a.starts_at
    `);

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});


/* =========================================================
   PRE-SESSION DASHBOARD
   ========================================================= */

router.get(
  "/schedule/:id/pre-session",
  async (req, res, next) => {
    try {
      const id = req.params.id;

      const appointment = await db.execute(sql`
        SELECT
          a.*,

          CONCAT(
            c.first_name,
            ' ',
            c.last_name
          ) AS "clientName",

          c.date_of_birth
            AS "clientDateOfBirth",

          c.registration_status
            AS "registrationStatus",

          c.billing_readiness_status
            AS "billingReadinessStatus",

          CONCAT(
            pr.first_name,
            ' ',
            pr.last_name
          ) AS "providerName",

          pr.credentials
            AS "providerCredentials"

        FROM appointments a

        JOIN clients c
          ON c.id = a.client_id

        LEFT JOIN providers pr
          ON pr.id = a.provider_id

        WHERE a.id = ${id}::uuid
        LIMIT 1
      `);

      if (!appointment.rows.length) {
        return res.status(404).json({
          error: "Appointment not found",
        });
      }

      const appt =
        appointment.rows[0] as Record<
          string,
          any
        >;

      const clientId = appt.client_id;

      const [
        checkin,
        diagnoses,
        insurance,
        eligibility,
        authorization,
        treatmentPlans,
        recentNotes,
        workItems,
      ] = await Promise.all([
        db.execute(sql`
          SELECT *
          FROM client_checkins
          WHERE appointment_id = ${id}::uuid
          LIMIT 1
        `),

        db.execute(sql`
          SELECT *
          FROM client_diagnoses
          WHERE client_id = ${clientId}::uuid
            AND diagnosis_status = 'active'
          ORDER BY created_at DESC
        `),

        db.execute(sql`
          SELECT
            cip.*,
            p.name AS "payerName",
            pp.name AS "planName"
          FROM client_insurance_policies cip
          LEFT JOIN payers p
            ON p.id = cip.payer_id
          LEFT JOIN payer_plans pp
            ON pp.id = cip.payer_plan_id
          WHERE cip.client_id = ${clientId}::uuid
            AND cip.status = 'active'
          ORDER BY cip.insurance_order
        `),

        db.execute(sql`
          SELECT
            ec.*,
            p.name AS "payerName",
            eb.benefit_type AS "benefitType",
            eb.cpt_code AS "benefitCptCode",
            eb.copay_cents AS "copayCents",
            eb.coinsurance_percent
              AS "coinsurancePercent",
            eb.deductible_remaining_cents
              AS "deductibleRemainingCents",
            eb.oop_remaining_cents
              AS "oopRemainingCents",
            eb.authorization_required
              AS "authorizationRequired",
            eb.network_status
              AS "networkStatus",
            eb.notes
              AS "benefitNotes"

          FROM eligibility_checks ec

          LEFT JOIN payers p
            ON p.id = ec.payer_id

          LEFT JOIN LATERAL (
            SELECT eb2.*
            FROM eligibility_benefits eb2
            WHERE
              eb2.eligibility_check_id = ec.id
              AND (
                eb2.cpt_code = ${appt.cpt_code}
                OR eb2.cpt_code IS NULL
              )
            ORDER BY
              CASE
                WHEN eb2.cpt_code =
                  ${appt.cpt_code}
                  THEN 0
                ELSE 1
              END
            LIMIT 1
          ) eb ON true

          WHERE ec.client_id =
            ${clientId}::uuid

          ORDER BY
            ec.service_date DESC,
            ec.created_at DESC

          LIMIT 1
        `),

        db.execute(sql`
          SELECT
            a.*,
            p.name AS "payerName",
            au.cpt_code AS "unitCptCode",
            au.authorized_units
              AS "authorizedUnits",
            au.used_units
              AS "usedUnits",
            au.remaining_units
              AS "remainingUnits"

          FROM authorizations a

          LEFT JOIN payers p
            ON p.id = a.payer_id

          LEFT JOIN LATERAL (
            SELECT au2.*
            FROM authorization_units au2
            WHERE
              au2.authorization_id = a.id
              AND (
                au2.cpt_code = ${appt.cpt_code}
                OR au2.cpt_code IS NULL
              )
            ORDER BY
              CASE
                WHEN au2.cpt_code =
                  ${appt.cpt_code}
                  THEN 0
                ELSE 1
              END
            LIMIT 1
          ) au ON true

          WHERE a.client_id =
            ${clientId}::uuid

          ORDER BY
            a.end_date ASC NULLS LAST,
            a.updated_at DESC

          LIMIT 1
        `),

        db.execute(sql`
          SELECT
            tp.*,
            CONCAT(
              pr.first_name,
              ' ',
              pr.last_name
            ) AS "providerName",

            COALESCE(
              json_agg(
                json_build_object(
                  'id', tpg.id,
                  'goalText',
                    tpg.goal_text,
                  'objectiveText',
                    tpg.objective_text,
                  'status',
                    tpg.status
                )
              ) FILTER (
                WHERE tpg.id IS NOT NULL
              ),
              '[]'::json
            ) AS goals

          FROM treatment_plans tp

          LEFT JOIN providers pr
            ON pr.id = tp.provider_id

          LEFT JOIN treatment_plan_goals tpg
            ON tpg.treatment_plan_id =
              tp.id

          WHERE tp.client_id =
            ${clientId}::uuid
            AND tp.status = 'active'

          GROUP BY
            tp.id,
            pr.first_name,
            pr.last_name

          ORDER BY tp.effective_date DESC
        `),

        db.execute(sql`
          SELECT
            cn.*,
            CONCAT(
              pr.first_name,
              ' ',
              pr.last_name
            ) AS "providerName"

          FROM clinical_notes cn

          LEFT JOIN providers pr
            ON pr.id = cn.provider_id

          WHERE cn.client_id =
            ${clientId}::uuid

          ORDER BY
            cn.service_date DESC NULLS LAST,
            cn.created_at DESC

          LIMIT 5
        `),

        db.execute(sql`
          SELECT *
          FROM workqueue_items
          WHERE workqueue_status = 'open'
            AND (
              (
                source_object_type = 'client'
                AND source_object_id =
                  ${clientId}::uuid
              )
              OR source_object_id IN (
                SELECT pc.id
                FROM professional_claims pc
                WHERE pc.client_id =
                  ${clientId}::uuid
              )
              OR source_object_id IN (
                SELECT cn.id
                FROM clinical_notes cn
                WHERE cn.client_id =
                  ${clientId}::uuid
              )
            )
          ORDER BY
            CASE priority
              WHEN 'urgent' THEN 1
              WHEN 'high' THEN 2
              ELSE 3
            END,
            due_date NULLS LAST
        `),
      ]);

      res.json({
        appointment: appt,
        checkin: checkin.rows[0] ?? null,
        diagnoses: diagnoses.rows,
        insurancePolicies: insurance.rows,
        eligibility:
          eligibility.rows[0] ?? null,
        authorization:
          authorization.rows[0] ?? null,
        treatmentPlans:
          treatmentPlans.rows,
        recentNotes:
          recentNotes.rows,
        workItems:
          workItems.rows,
      });
    } catch (error) {
      return next(error);
    }
  },
);


/* =========================================================
   ELIGIBILITY WORKQUEUE
   ========================================================= */

router.get(
  "/eligibility",
  async (_req, res, next) => {
    try {
      const result = await db.execute(sql`
        SELECT
          ec.id,

          ec.client_id
            AS "clientId",

          ec.service_date
            AS "serviceDate",

          ec.eligibility_status
            AS "eligibilityStatus",

          ec.response_source
            AS "responseSource",

          ec.notes,

          CONCAT(
            c.first_name,
            ' ',
            c.last_name
          ) AS "clientName",

          cip.member_id
            AS "memberId",

          p.name
            AS "payerName",

          pp.name
            AS "planName",

          eb.benefit_type
            AS "benefitType",

          eb.cpt_code
            AS "cptCode",

          eb.copay_cents
            AS "copayCents",

          eb.coinsurance_percent
            AS "coinsurancePercent",

          eb.deductible_remaining_cents
            AS "deductibleRemainingCents",

          eb.oop_remaining_cents
            AS "oopRemainingCents",

          eb.authorization_required
            AS "authorizationRequired",

          eb.network_status
            AS "networkStatus",

          eb.notes
            AS "benefitNotes"

        FROM eligibility_checks ec

        JOIN clients c
          ON c.id = ec.client_id

        LEFT JOIN client_insurance_policies cip
          ON cip.id =
            ec.insurance_policy_id

        LEFT JOIN payers p
          ON p.id = ec.payer_id

        LEFT JOIN payer_plans pp
          ON pp.id = cip.payer_plan_id

        LEFT JOIN LATERAL (
          SELECT eb2.*
          FROM eligibility_benefits eb2
          WHERE eb2.eligibility_check_id =
            ec.id
          ORDER BY eb2.updated_at DESC
          LIMIT 1
        ) eb ON true

        ORDER BY
          ec.service_date DESC,
          c.last_name,
          c.first_name
      `);

      return res.json(result.rows);
    } catch (error) {
      return next(error);
    }
  },
);


/* =========================================================
   AUTHORIZATION WORKQUEUE
   ========================================================= */

router.get(
  "/authorizations",
  async (_req, res, next) => {
    try {
      const result = await db.execute(sql`
        SELECT
          a.id,

          a.client_id
            AS "clientId",

          a.authorization_number
            AS "authorizationNumber",

          a.status,

          a.start_date
            AS "startDate",

          a.end_date
            AS "endDate",

          a.notes,

          CONCAT(
            c.first_name,
            ' ',
            c.last_name
          ) AS "clientName",

          p.name
            AS "payerName",

          au.cpt_code
            AS "cptCode",

          au.authorized_units
            AS "authorizedUnits",

          au.used_units
            AS "usedUnits",

          au.remaining_units
            AS "remainingUnits",

          CASE
            WHEN a.end_date IS NOT NULL
              AND a.end_date <
                CURRENT_DATE
              THEN 'expired'

            WHEN a.end_date IS NOT NULL
              AND a.end_date <=
                CURRENT_DATE + 30
              THEN 'expiring_soon'

            WHEN COALESCE(
              au.remaining_units,
              0
            ) <= 1
              THEN 'low_units'

            ELSE 'ok'
          END AS "utilizationAlert"

        FROM authorizations a

        JOIN clients c
          ON c.id = a.client_id

        LEFT JOIN payers p
          ON p.id = a.payer_id

        LEFT JOIN LATERAL (
          SELECT au2.*
          FROM authorization_units au2
          WHERE au2.authorization_id =
            a.id
          ORDER BY au2.updated_at DESC
          LIMIT 1
        ) au ON true

        ORDER BY
          CASE
            WHEN a.end_date IS NULL
              THEN 1
            ELSE 0
          END,
          a.end_date,
          c.last_name,
          c.first_name
      `);

      return res.json(result.rows);
    } catch (error) {
      return next(error);
    }
  },
);

export default router;

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/medicaid", async (_req, res, next) => {
  try {
    const [programs, codingRules] = await Promise.all([
      db.execute(sql`
        SELECT mp.*, p.name AS "payerName"
        FROM medicaid_programs mp
        JOIN payers p ON p.id = mp.payer_id
        ORDER BY mp.program_name
      `),
      db.execute(sql`
        SELECT
          mcr.*,
          mp.program_code AS "programCode",
          mp.program_name AS "programName",
          p.name AS "payerName"
        FROM medicaid_coding_rules mcr
        JOIN medicaid_programs mp
          ON mp.id = mcr.medicaid_program_id
        JOIN payers p
          ON p.id = mp.payer_id
        ORDER BY mp.program_name, mcr.cpt_code
      `),
    ]);

    return res.json({
      programs: programs.rows,
      codingRules: codingRules.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/claim-submission", async (_req, res, next) => {
  try {
    const [claims, batches, submissions, responses] =
      await Promise.all([
        db.execute(sql`
          SELECT
            pc.*,
            CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
            p.name AS "payerName"
          FROM professional_claims pc
          JOIN clients c ON c.id = pc.client_id
          LEFT JOIN payers p ON p.id = pc.payer_id
          WHERE pc.claim_status NOT IN ('paid', 'closed')
          ORDER BY pc.service_date_from DESC NULLS LAST
        `),
        db.execute(sql`
          SELECT *
          FROM claim_batches
          ORDER BY created_at DESC
        `),
        db.execute(sql`
          SELECT
            cs.*,
            cb.batch_number AS "batchNumber",
            cb.batch_status AS "batchStatus"
          FROM claim_submissions cs
          JOIN claim_batches cb
            ON cb.id = cs.claim_batch_id
          ORDER BY cs.created_at DESC
        `),
        db.execute(sql`
          SELECT
            sr.*,
            cb.batch_number AS "batchNumber"
          FROM submission_responses sr
          JOIN claim_submissions cs
            ON cs.id = sr.claim_submission_id
          JOIN claim_batches cb
            ON cb.id = cs.claim_batch_id
          ORDER BY sr.received_at DESC
        `),
      ]);

    return res.json({
      claims: claims.rows,
      batches: batches.rows,
      submissions: submissions.rows,
      responses: responses.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/claim-follow-up", async (_req, res, next) => {
  try {
    const [
      actions,
      timelyFilingRules,
      overpayments,
      refunds,
    ] = await Promise.all([
      db.execute(sql`
        SELECT
          cfa.*,
          pc.patient_control_number AS "patientControlNumber",
          pc.claim_status AS "claimStatus",
          CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
          p.name AS "payerName"
        FROM claim_follow_up_actions cfa
        JOIN professional_claims pc
          ON pc.id = cfa.claim_id
        JOIN clients c
          ON c.id = pc.client_id
        LEFT JOIN payers p
          ON p.id = pc.payer_id
        ORDER BY
          cfa.deadline_date NULLS LAST,
          cfa.created_at DESC
      `),

      db.execute(sql`
        SELECT
          r.*,
          p.name AS "payerName"
        FROM payer_timely_filing_rules r
        JOIN payers p
          ON p.id = r.payer_id
        ORDER BY p.name
      `),

      db.execute(sql`
        SELECT
          o.*,
          pc.patient_control_number AS "patientControlNumber",
          CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
          p.name AS "payerName"
        FROM overpayment_reviews o
        JOIN professional_claims pc
          ON pc.id = o.claim_id
        JOIN clients c
          ON c.id = pc.client_id
        LEFT JOIN payers p
          ON p.id = o.payer_id
        ORDER BY o.detected_date DESC
      `),

      db.execute(sql`
        SELECT
          r.*,
          pc.patient_control_number AS "patientControlNumber",
          p.name AS "payerName"
        FROM refunds r
        JOIN professional_claims pc
          ON pc.id = r.claim_id
        LEFT JOIN payers p
          ON p.id = r.payer_id
        ORDER BY r.created_at DESC
      `),
    ]);

    return res.json({
      actions: actions.rows,
      timelyFilingRules: timelyFilingRules.rows,
      overpayments: overpayments.rows,
      refunds: refunds.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/payments-overview", async (_req, res, next) => {
  try {
    const [payments, eraFiles, adjustments] =
      await Promise.all([
        db.execute(sql`
          SELECT
            py.*,
            CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
            p.name AS "payerName",
            COALESCE((
              SELECT SUM(pa.amount_cents)
              FROM payment_allocations pa
              WHERE pa.payment_id = py.id
                AND pa.reversed_at IS NULL
            ), 0) AS "allocatedAmountCents"
          FROM payments py
          LEFT JOIN clients c
            ON c.id = py.client_id
          LEFT JOIN payers p
            ON p.id = py.payer_id
          ORDER BY
            py.payment_date DESC NULLS LAST,
            py.created_at DESC
        `),

        db.execute(sql`
          SELECT
            ef.*,
            p.name AS "payerName"
          FROM era_files ef
          LEFT JOIN payers p
            ON p.id = ef.payer_id
          ORDER BY ef.created_at DESC
        `),

        db.execute(sql`
          SELECT
            a.*,
            CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
            p.name AS "payerName",
            pc.patient_control_number AS "patientControlNumber"
          FROM adjustments a
          LEFT JOIN clients c ON c.id = a.client_id
          LEFT JOIN payers p ON p.id = a.payer_id
          LEFT JOIN professional_claims pc ON pc.id = a.claim_id
          ORDER BY
            a.adjustment_date DESC NULLS LAST,
            a.created_at DESC
        `),
      ]);

    return res.json({
      payments: payments.rows,
      eraFiles: eraFiles.rows,
      adjustments: adjustments.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/ar-denials", async (_req, res, next) => {
  try {
    const [openBalances, denials, appeals] =
      await Promise.all([
        db.execute(sql`
          SELECT
            pc.id AS "claimId",
            pc.patient_control_number AS "patientControlNumber",
            pc.claim_status AS "claimStatus",
            pc.service_date_from AS "serviceDate",
            pc.total_charge_cents AS "totalChargeCents",
            cbs.paid_amount_cents AS "paidAmountCents",
            cbs.adjustment_amount_cents AS "adjustmentAmountCents",
            cbs.open_balance_cents AS "openBalanceCents",
            CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
            p.name AS "payerName"
          FROM claim_balance_summaries cbs
          JOIN professional_claims pc
            ON pc.id = cbs.claim_id
          JOIN clients c
            ON c.id = pc.client_id
          LEFT JOIN payers p
            ON p.id = pc.payer_id
          WHERE cbs.open_balance_cents <> 0
          ORDER BY pc.service_date_from DESC NULLS LAST
        `),

        db.execute(sql`
          SELECT
            d.*,
            pc.patient_control_number AS "patientControlNumber",
            CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
            p.name AS "payerName"
          FROM denials d
          JOIN professional_claims pc
            ON pc.id = d.claim_id
          JOIN clients c
            ON c.id = d.client_id
          LEFT JOIN payers p
            ON p.id = d.payer_id
          ORDER BY
            d.denial_date DESC NULLS LAST,
            d.created_at DESC
        `),

        db.execute(sql`
          SELECT
            a.*,
            pc.patient_control_number AS "patientControlNumber",
            CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
            p.name AS "payerName"
          FROM appeals a
          JOIN professional_claims pc
            ON pc.id = a.claim_id
          JOIN clients c
            ON c.id = pc.client_id
          LEFT JOIN payers p
            ON p.id = pc.payer_id
          ORDER BY
            a.deadline_date NULLS LAST,
            a.created_at DESC
        `),
      ]);

    return res.json({
      openBalances: openBalances.rows,
      denials: denials.rows,
      appeals: appeals.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/credentialing", async (_req, res, next) => {
  try {
    const [enrollments, identifiers] =
      await Promise.all([
        db.execute(sql`
          SELECT
            ppe.*,
            CONCAT(pr.first_name, ' ', pr.last_name) AS "providerName",
            pr.credentials AS "providerCredentials",
            p.name AS "payerName",
            pp.name AS "planName"
          FROM provider_payer_enrollments ppe
          JOIN providers pr ON pr.id = ppe.provider_id
          JOIN payers p ON p.id = ppe.payer_id
          LEFT JOIN payer_plans pp ON pp.id = ppe.payer_plan_id
          ORDER BY pr.last_name, pr.first_name, p.name
        `),

        db.execute(sql`
          SELECT
            pi.*,
            CONCAT(pr.first_name, ' ', pr.last_name) AS "providerName",
            p.name AS "payerName"
          FROM provider_identifiers pi
          JOIN providers pr ON pr.id = pi.provider_id
          LEFT JOIN payers p ON p.id = pi.payer_id
          ORDER BY
            pr.last_name,
            pr.first_name,
            pi.identifier_type
        `),
      ]);

    return res.json({
      enrollments: enrollments.rows,
      identifiers: identifiers.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/payers-contracts", async (_req, res, next) => {
  try {
    const [
      payers,
      contracts,
      feeSchedules,
      feeScheduleLines,
    ] = await Promise.all([
      db.execute(sql`
        SELECT *
        FROM payers
        ORDER BY name
      `),

      db.execute(sql`
        SELECT
          pc.*,
          p.name AS "payerName"
        FROM payer_contracts pc
        JOIN payers p ON p.id = pc.payer_id
        ORDER BY p.name, pc.contract_name
      `),

      db.execute(sql`
        SELECT
          fs.*,
          pc.contract_name AS "contractName",
          p.name AS "payerName"
        FROM fee_schedules fs
        JOIN payer_contracts pc
          ON pc.id = fs.payer_contract_id
        JOIN payers p
          ON p.id = pc.payer_id
        ORDER BY p.name, fs.name
      `),

      db.execute(sql`
        SELECT
          fsl.*,
          fs.name AS "feeScheduleName",
          pc.contract_name AS "contractName",
          p.name AS "payerName"
        FROM fee_schedule_lines fsl
        JOIN fee_schedules fs
          ON fs.id = fsl.fee_schedule_id
        JOIN payer_contracts pc
          ON pc.id = fs.payer_contract_id
        JOIN payers p
          ON p.id = pc.payer_id
        ORDER BY
          p.name,
          fs.name,
          fsl.cpt_code
      `),
    ]);

    return res.json({
      payers: payers.rows,
      contracts: contracts.rows,
      feeSchedules: feeSchedules.rows,
      feeScheduleLines: feeScheduleLines.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/mailroom", async (_req, res, next) => {
  try {
    const result = await db.execute(sql`
      SELECT
        mi.*,
        p.name AS "payerName",
        CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
        pc.patient_control_number AS "patientControlNumber",
        CONCAT(pr.first_name, ' ', pr.last_name) AS "providerName"
      FROM mailroom_items mi
      LEFT JOIN payers p ON p.id = mi.payer_id
      LEFT JOIN clients c ON c.id = mi.client_id
      LEFT JOIN professional_claims pc ON pc.id = mi.claim_id
      LEFT JOIN providers pr ON pr.id = mi.provider_id
      ORDER BY
        mi.received_date DESC,
        mi.created_at DESC
    `);

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

router.get("/imports", async (_req, res, next) => {
  try {
    const [batches, validationErrors] =
      await Promise.all([
        db.execute(sql`
          SELECT *
          FROM import_batches
          ORDER BY created_at DESC
        `),

        db.execute(sql`
          SELECT
            ive.*,
            ib.file_name AS "fileName",
            ib.import_type AS "importType",
            ir.row_number AS "rowNumber",
            ir.validation_status AS "rowValidationStatus"
          FROM import_validation_errors ive
          JOIN import_batches ib
            ON ib.id = ive.import_batch_id
          JOIN import_rows ir
            ON ir.id = ive.import_row_id
          ORDER BY
            ib.created_at DESC,
            ir.row_number,
            ive.created_at
        `),
      ]);

    return res.json({
      batches: batches.rows,
      validationErrors: validationErrors.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/journal", async (_req, res, next) => {
  try {
    const [entries, reviews] =
      await Promise.all([
        db.execute(sql`
          SELECT
            pje.*,
            CONCAT(c.first_name, ' ', c.last_name) AS "clientName"
          FROM patient_journal_entries pje
          JOIN clients c ON c.id = pje.client_id
          ORDER BY
            pje.entry_date DESC,
            pje.submitted_at DESC
        `),

        db.execute(sql`
          SELECT
            jpr.*,
            CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
            CONCAT(pr.first_name, ' ', pr.last_name) AS "providerName"
          FROM journal_provider_reviews jpr
          JOIN patient_journal_entries pje
            ON pje.id = jpr.journal_entry_id
          JOIN clients c
            ON c.id = pje.client_id
          LEFT JOIN providers pr
            ON pr.id = jpr.provider_id
          ORDER BY
            jpr.reviewed_at DESC NULLS LAST,
            jpr.created_at DESC
        `),
      ]);

    return res.json({
      entries: entries.rows,
      reviews: reviews.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/reports", async (_req, res, next) => {
  try {
    const [
      summary,
      payerPerformance,
      credentialing,
    ] = await Promise.all([
      db.execute(sql`
        SELECT
          (
            SELECT COUNT(*)::int
            FROM clients
            WHERE deleted_at IS NULL
          ) AS "clients",

          (
            SELECT COUNT(*)::int
            FROM providers
            WHERE provider_status = 'active'
          ) AS "activeProviders",

          (
            SELECT COUNT(*)::int
            FROM professional_claims
          ) AS "claims",

          (
            SELECT COUNT(*)::int
            FROM denials
            WHERE denial_status NOT IN ('closed', 'resolved')
          ) AS "openDenials",

          COALESCE((
            SELECT SUM(open_balance_cents)::bigint
            FROM claim_balance_summaries
          ), 0) AS "openArCents",

          COALESCE((
            SELECT SUM(amount_cents)::bigint
            FROM payments
          ), 0) AS "paymentsCents",

          (
            SELECT COUNT(*)::int
            FROM workqueue_items
            WHERE workqueue_status = 'open'
          ) AS "openWorkItems"
      `),

      db.execute(sql`
        SELECT
          p.id,
          p.name,

          (
            SELECT COUNT(*)::int
            FROM professional_claims pc
            WHERE pc.payer_id = p.id
          ) AS "claimCount",

          COALESCE((
            SELECT SUM(pc.total_charge_cents)::bigint
            FROM professional_claims pc
            WHERE pc.payer_id = p.id
          ), 0) AS "chargeCents",

          COALESCE((
            SELECT SUM(cbs.open_balance_cents)::bigint
            FROM professional_claims pc
            JOIN claim_balance_summaries cbs
              ON cbs.claim_id = pc.id
            WHERE pc.payer_id = p.id
          ), 0) AS "openBalanceCents",

          (
            SELECT COUNT(*)::int
            FROM denials d
            WHERE d.payer_id = p.id
          ) AS "denialCount"

        FROM payers p
        ORDER BY p.name
      `),

      db.execute(sql`
        SELECT
          p.name AS "payerName",
          ppe.participation_status AS "participationStatus",
          COUNT(*)::int AS "providerCount"
        FROM provider_payer_enrollments ppe
        JOIN payers p
          ON p.id = ppe.payer_id
        GROUP BY
          p.name,
          ppe.participation_status
        ORDER BY
          p.name,
          ppe.participation_status
      `),
    ]);

    return res.json({
      ...(summary.rows[0] ?? {}),
      payerPerformance: payerPerformance.rows,
      credentialingSummary: credentialing.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/administration/compliance",
  async (_req, res, next) => {
    try {
      const [
        users,
        auditLogs,
        phiAccessLogs,
      ] = await Promise.all([
        db.execute(sql`
          SELECT
            tu.id AS "tenantUserId",
            t.name AS "tenantName",
            up.display_name AS "displayName",
            up.email,
            tu.status,
            COALESCE(
              STRING_AGG(
                tur.role,
                ', '
                ORDER BY tur.role
              ),
              ''
            ) AS roles
          FROM tenant_users tu
          JOIN tenants t
            ON t.id = tu.tenant_id
          JOIN user_profiles up
            ON up.id = tu.user_profile_id
          LEFT JOIN tenant_user_roles tur
            ON tur.tenant_user_id = tu.id
          GROUP BY
            tu.id,
            t.name,
            up.display_name,
            up.email,
            tu.status
          ORDER BY
            t.name,
            up.display_name
        `),

        db.execute(sql`
          SELECT
            al.*,
            t.name AS "tenantName",
            up.display_name AS "userName"
          FROM audit_logs al
          LEFT JOIN tenants t
            ON t.id = al.tenant_id
          LEFT JOIN user_profiles up
            ON up.id = al.user_profile_id
          ORDER BY al.created_at DESC
          LIMIT 100
        `),

        db.execute(sql`
          SELECT
            pal.*,
            t.name AS "tenantName",
            up.display_name AS "userName",
            CONCAT(c.first_name, ' ', c.last_name) AS "clientName",
            pc.patient_control_number AS "patientControlNumber"
          FROM phi_access_logs pal
          LEFT JOIN tenants t
            ON t.id = pal.tenant_id
          LEFT JOIN user_profiles up
            ON up.id = pal.user_profile_id
          LEFT JOIN clients c
            ON c.id = pal.client_id
          LEFT JOIN professional_claims pc
            ON pc.id = pal.claim_id
          ORDER BY pal.created_at DESC
          LIMIT 100
        `),
      ]);

      return res.json({
        users: users.rows,
        auditLogs: auditLogs.rows,
        phiAccessLogs: phiAccessLogs.rows,
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;

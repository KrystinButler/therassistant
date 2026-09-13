import {
  execFile,
} from "node:child_process";

import {
  existsSync,
} from "node:fs";

import {
  dirname,
  join,
} from "node:path";

import {
  promisify,
} from "node:util";

import {
  fileURLToPath,
} from "node:url";

import {
  Router,
  type IRouter,
} from "express";

import {
  db,
} from "@workspace/db";

import {
  sql,
} from "drizzle-orm";


const router: IRouter =
  Router();


const execFileAsync =
  promisify(
    execFile,
  );


function findWorkspaceRoot() {
  let current =
    dirname(
      fileURLToPath(
        import.meta.url,
      ),
    );


  for (
    let depth = 0;
    depth < 8;
    depth++
  ) {
    const candidate =
      join(
        current,
        "scripts",
        "reset-therassistant-demo.mjs",
      );


    if (
      existsSync(candidate)
    ) {
      return current;
    }


    const parent =
      dirname(current);


    if (
      parent === current
    ) {
      break;
    }


    current =
      parent;
  }


  throw new Error(
    "Unable to locate Therassistant workspace root.",
  );
}


/* =========================================================
   TENANT SWITCHER DATA
   ========================================================= */

router.get(
  "/demo-control/tenants",
  async (_req, res, next) => {
    try {
      const result =
        await db.execute(sql`
          SELECT
            t.id,

            t.name,

            t.tenant_type
              AS "tenantType",

            t.status,

            t.timezone,

            (
              SELECT COUNT(*)::int
              FROM clients c
              WHERE
                c.tenant_id =
                  t.id

                AND c.deleted_at
                  IS NULL
            ) AS "clientCount",

            (
              SELECT COUNT(*)::int
              FROM providers p
              WHERE p.tenant_id =
                t.id
            ) AS "providerCount",

            (
              SELECT COUNT(*)::int
              FROM professional_claims pc
              WHERE pc.tenant_id =
                t.id
            ) AS "claimCount"

          FROM tenants t

          ORDER BY
            CASE
              WHEN t.tenant_type =
                'billing_company'
              THEN 0
              ELSE 1
            END,

            t.name
        `);


      res.json(
        result.rows,
      );
    } catch (error) {
      return next(error);
    }
  },
);


/* =========================================================
   SELECTED WORKSPACE STATUS
   ========================================================= */

router.get(
  "/demo-control/status",
  async (req, res, next) => {
    try {
      const requested =
        typeof req.query
          .tenantId ===
          "string"
          ? req.query.tenantId
          : null;


      const defaultTenant =
        "10000000-0000-4000-8000-000000000002";


      const tenantId =
        requested ||
        defaultTenant;


      const tenantResult =
        await db.execute(sql`
          SELECT
            id,
            name,
            tenant_type
              AS "tenantType",
            status,
            timezone

          FROM tenants

          WHERE id =
            ${tenantId}::uuid

          LIMIT 1
        `);


      if (!tenantResult.rows.length) {
        return res.status(404).json({
          error:
            "Tenant not found.",
        });
      }


      const tenant =
        tenantResult.rows[0] as
          Record<string, any>;


      const summary =
        await db.execute(sql`
          SELECT
            (
              SELECT COUNT(*)::int
              FROM clients
              WHERE
                tenant_id =
                  ${tenantId}::uuid

                AND deleted_at
                  IS NULL
            ) AS "clients",

            (
              SELECT COUNT(*)::int
              FROM providers
              WHERE tenant_id =
                ${tenantId}::uuid
            ) AS "providers",

            (
              SELECT COUNT(*)::int
              FROM appointments
              WHERE tenant_id =
                ${tenantId}::uuid
            ) AS "appointments",

            (
              SELECT COUNT(*)::int
              FROM professional_claims
              WHERE tenant_id =
                ${tenantId}::uuid
            ) AS "claims",

            (
              SELECT COUNT(*)::int
              FROM payments
              WHERE tenant_id =
                ${tenantId}::uuid
            ) AS "payments",

            (
              SELECT COUNT(*)::int
              FROM workqueue_items
              WHERE
                tenant_id =
                  ${tenantId}::uuid

                AND workqueue_status =
                  'open'
            ) AS "openWorkItems",

            (
              SELECT COUNT(*)::int
              FROM denials
              WHERE
                tenant_id =
                  ${tenantId}::uuid

                AND denial_status
                  NOT IN (
                    'closed',
                    'resolved'
                  )
            ) AS "openDenials",

            (
              SELECT COUNT(*)::int
              FROM provider_payer_enrollments
              WHERE tenant_id =
                ${tenantId}::uuid
            ) AS "enrollments",

            (
              SELECT COUNT(*)::int
              FROM mailroom_items
              WHERE tenant_id =
                ${tenantId}::uuid
            ) AS "mailroom",

            (
              SELECT COUNT(*)::int
              FROM patient_journal_entries
              WHERE tenant_id =
                ${tenantId}::uuid
            ) AS "journalEntries"
        `);


      const links =
        await db.execute(sql`
          SELECT
            practice.id,

            practice.name,

            link.status

          FROM billing_company_practice_links link

          JOIN tenants practice
            ON practice.id =
              link.practice_tenant_id

          WHERE
            link.billing_company_tenant_id =
              ${tenantId}::uuid

          ORDER BY practice.name
        `);


      res.json({
        tenant,

        summary:
          summary.rows[0] ?? {},

        managedPractices:
          links.rows,

        operationalDemoTenantId:
          defaultTenant,
      });
    } catch (error) {
      return next(error);
    }
  },
);


/* =========================================================
   RESET SYNTHETIC DEMO
   ========================================================= */

router.post(
  "/demo-control/reset",
  async (req, res, next) => {
    try {
      if (
        req.body?.confirm !==
        "RESET_SYNTHETIC_DEMO"
      ) {
        return res.status(400).json({
          error:
            "Reset confirmation phrase is required.",
        });
      }


      const workspace =
        findWorkspaceRoot();


      const script =
        join(
          workspace,
          "scripts",
          "reset-therassistant-demo.mjs",
        );


      const {
        stdout,
        stderr,
      } =
        await execFileAsync(
          process.execPath,
          [
            script,
          ],
          {
            cwd:
              workspace,

            env:
              process.env,

            timeout:
              120_000,

            maxBuffer:
              10 * 1024 * 1024,
          },
        );


      if (stderr) {
        console.error(
          stderr,
        );
      }


      console.log(
        stdout,
      );


      res.json({
        message:
          "Synthetic Therassistant demo data has been restored to its starting state.",
      });
    } catch (error) {
      return next(error);
    }
  },
);


export default router;

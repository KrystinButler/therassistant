import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/workqueues", async (req, res, next) => {
  try {
    const status =
      typeof req.query.status === "string"
        ? req.query.status.trim()
        : "";

    const priority =
      typeof req.query.priority === "string"
        ? req.query.priority.trim()
        : "";

    const type =
      typeof req.query.type === "string"
        ? req.query.type.trim()
        : "";

    const result = await db.execute(sql`
      SELECT
        w.id,
        w.workqueue_type AS "workqueueType",
        w.workqueue_status AS "workqueueStatus",
        w.priority,
        w.source_object_type AS "sourceObjectType",
        w.source_object_id AS "sourceObjectId",
        w.title,
        w.description,
        w.due_date AS "dueDate",
        w.created_at AS "createdAt",
        w.updated_at AS "updatedAt",

        CASE
          WHEN w.source_object_type = 'claim' THEN (
            SELECT CONCAT(c.first_name, ' ', c.last_name)
            FROM professional_claims pc
            JOIN clients c
              ON c.id = pc.client_id
            WHERE pc.id = w.source_object_id
            LIMIT 1
          )

          WHEN w.source_object_type = 'client' THEN (
            SELECT CONCAT(c.first_name, ' ', c.last_name)
            FROM clients c
            WHERE c.id = w.source_object_id
            LIMIT 1
          )

          WHEN w.source_object_type = 'clinical_note' THEN (
            SELECT CONCAT(c.first_name, ' ', c.last_name)
            FROM clinical_notes cn
            JOIN clients c
              ON c.id = cn.client_id
            WHERE cn.id = w.source_object_id
            LIMIT 1
          )

          ELSE null
        END AS "relatedName",

        CASE
          WHEN w.source_object_type = 'claim' THEN (
            SELECT p.name
            FROM professional_claims pc
            LEFT JOIN payers p
              ON p.id = pc.payer_id
            WHERE pc.id = w.source_object_id
            LIMIT 1
          )
          ELSE null
        END AS "payerName"

      FROM workqueue_items w

      WHERE
        (
          ${status} = ''
          OR w.workqueue_status = ${status}
        )

        AND (
          ${priority} = ''
          OR w.priority = ${priority}
        )

        AND (
          ${type} = ''
          OR w.workqueue_type = ${type}
        )

      ORDER BY
        CASE w.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          ELSE 4
        END,
        w.due_date NULLS LAST,
        w.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});


router.get("/workqueues/:id/history", async (req, res, next) => {
  try {
    const id = req.params.id;

    const result = await db.execute(sql`
      SELECT *
      FROM workqueue_history
      WHERE workqueue_item_id = ${id}::uuid
      ORDER BY created_at
    `);

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

export default router;

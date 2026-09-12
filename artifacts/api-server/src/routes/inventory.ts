import { and, asc, count, eq, ilike, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, inventoryTable } from "@workspace/db";
import {
  CreateInventoryBody,
  CreateInventoryResponse,
  DeleteInventoryParams,
  GetInventoryFacetsResponse,
  GetInventoryParams,
  GetInventoryResponse,
  GetInventorySummaryResponse,
  ListInventoryQueryParams,
  ListInventoryResponse,
  UpdateInventoryBody,
  UpdateInventoryParams,
  UpdateInventoryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const toApiRecord = (record: typeof inventoryTable.$inferSelect) => ({
  ...record,
  schemaName: record.schemaName ?? null,
});

router.get("/inventory", async (req, res): Promise<void> => {
  const parsed = ListInventoryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { search, objectType, sourceSheet, limit, offset } = parsed.data;
  const filters = [];

  if (objectType) filters.push(eq(inventoryTable.objectType, objectType));
  if (sourceSheet) filters.push(eq(inventoryTable.sourceSheet, sourceSheet));
  if (search) {
    filters.push(
      or(
        ilike(inventoryTable.objectName, `%${search}%`),
        ilike(inventoryTable.sourceSheet, `%${search}%`),
      ),
    );
  }

  const records = await db
    .select()
    .from(inventoryTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(inventoryTable.objectName))
    .limit(limit)
    .offset(offset);

  res.json(ListInventoryResponse.parse(records.map(toApiRecord)));
});

router.post("/inventory", async (req, res): Promise<void> => {
  const parsed = CreateInventoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [record] = await db
    .insert(inventoryTable)
    .values({
      ...parsed.data,
      schemaName: parsed.data.schemaName ?? null,
      columnCount: parsed.data.columnCount ?? 0,
      rowCount: parsed.data.rowCount ?? 0,
      columns: parsed.data.columns ?? [],
      details: parsed.data.details ?? {},
    })
    .returning();

  res.status(201).json(CreateInventoryResponse.parse(toApiRecord(record)));
});

router.get("/inventory/summary", async (_req, res): Promise<void> => {
  const [totals] = await db
    .select({
      total: count(),
      totalColumns: sql<number>`coalesce(sum(${inventoryTable.columnCount}), 0)`,
      emptyTables: sql<number>`count(*) filter (where ${inventoryTable.objectType} = 'TABLE' and ${inventoryTable.rowCount} = 0)`,
    })
    .from(inventoryTable);
  const grouped = await db
    .select({
      objectType: inventoryTable.objectType,
      total: count(),
    })
    .from(inventoryTable)
    .groupBy(inventoryTable.objectType);

  const byType = new Map(
    grouped.map((group) => [group.objectType, Number(group.total)]),
  );
  res.json(
    GetInventorySummaryResponse.parse({
      total: Number(totals?.total ?? 0),
      tables: byType.get("TABLE") ?? 0,
      views: byType.get("VIEW") ?? 0,
      functions: byType.get("FUNCTION") ?? 0,
      triggers: byType.get("TRIGGER") ?? 0,
      enums: byType.get("ENUM") ?? 0,
      indexes: byType.get("INDEX") ?? 0,
      policies: byType.get("RLS_POLICY") ?? 0,
      roles: byType.get("ROLE") ?? 0,
      grants: byType.get("GRANT") ?? 0,
      totalColumns: Number(totals?.totalColumns ?? 0),
      emptyTables: Number(totals?.emptyTables ?? 0),
    }),
  );
});

router.get("/inventory/facets", async (_req, res): Promise<void> => {
  const [objectTypeRows, sourceSheetRows] = await Promise.all([
    db
      .selectDistinct({ objectType: inventoryTable.objectType })
      .from(inventoryTable)
      .orderBy(asc(inventoryTable.objectType)),
    db
      .selectDistinct({ sourceSheet: inventoryTable.sourceSheet })
      .from(inventoryTable)
      .orderBy(asc(inventoryTable.sourceSheet)),
  ]);

  res.json(
    GetInventoryFacetsResponse.parse({
      objectTypes: objectTypeRows.map((row) => row.objectType),
      sourceSheets: sourceSheetRows.map((row) => row.sourceSheet),
    }),
  );
});

router.get("/inventory/:id", async (req, res): Promise<void> => {
  const params = GetInventoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db
    .select()
    .from(inventoryTable)
    .where(eq(inventoryTable.id, params.data.id));
  if (!record) {
    res.status(404).json({ error: "Inventory record not found" });
    return;
  }
  res.json(GetInventoryResponse.parse(toApiRecord(record)));
});

router.patch("/inventory/:id", async (req, res): Promise<void> => {
  const params = UpdateInventoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateInventoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [record] = await db
    .update(inventoryTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(inventoryTable.id, params.data.id))
    .returning();
  if (!record) {
    res.status(404).json({ error: "Inventory record not found" });
    return;
  }
  res.json(UpdateInventoryResponse.parse(toApiRecord(record)));
});

router.delete("/inventory/:id", async (req, res): Promise<void> => {
  const params = DeleteInventoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db
    .delete(inventoryTable)
    .where(eq(inventoryTable.id, params.data.id))
    .returning({ id: inventoryTable.id });
  if (!record) {
    res.status(404).json({ error: "Inventory record not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
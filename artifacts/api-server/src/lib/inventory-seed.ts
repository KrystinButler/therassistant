import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { count } from "drizzle-orm";
import { db, inventoryTable } from "@workspace/db";

type SeedRecord = {
  objectType:
    | "TABLE"
    | "VIEW"
    | "FUNCTION"
    | "TRIGGER"
    | "ENUM"
    | "INDEX"
    | "RLS_POLICY"
    | "ROLE"
    | "GRANT";
  objectName: string;
  sourceSheet: string;
  schemaName: string | null;
  columnCount: number;
  rowCount: number;
  columns: string[];
  details: Record<string, string>;
};

const workbookRelativePath =
  "attached_assets/Therassistant_Supabase_Database_Inventory (version 1).xlsb.xlsx";
const workbookPath = [
  path.resolve(process.cwd(), workbookRelativePath),
  path.resolve(process.cwd(), "../../", workbookRelativePath),
].find((candidate) => existsSync(candidate));

if (!workbookPath) {
  throw new Error(`Unable to find uploaded workbook: ${workbookRelativePath}`);
}

const escapeXml = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const attr = (source: string, name: string) =>
  source.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";

const unzipXml = (entry: string) =>
  execFileSync("unzip", ["-p", workbookPath, entry], { encoding: "utf8" });

const textFromXml = (source: string) =>
  escapeXml(source.replace(/<[^>]+>/g, "").trim());

const parseSharedStrings = () => {
  const xml = unzipXml("xl/sharedStrings.xml");
  return Array.from(xml.matchAll(/<si>([\s\S]*?)<\/si>/g)).map((match) =>
    textFromXml(match[1]),
  );
};

const parseWorkbookSheets = () => {
  const workbookXml = unzipXml("xl/workbook.xml");
  const relationshipsXml = unzipXml("xl/_rels/workbook.xml.rels");
  const relationships = new Map(
    Array.from(
      relationshipsXml.matchAll(
        /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g,
      ),
    ).map((match) => [match[1], match[2]]),
  );

  return Array.from(
    workbookXml.matchAll(
      /<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/?>/g,
    ),
  ).map(([_, name, relationshipId]) => {
    const target = relationships.get(relationshipId) ?? "";
    return {
      name,
      entry: target.startsWith("/") ? target.slice(1) : `xl/${target}`,
    };
  });
};

const parseSheet = (
  entry: string,
  sharedStrings: string[],
): string[][] => {
  const xml = unzipXml(entry);
  return Array.from(xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)).map(
    (rowMatch) =>
      Array.from(
        rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g),
      ).map((cellMatch) => {
        const cellAttributes = cellMatch[1];
        const cellXml = cellMatch[2];
        const type = attr(cellAttributes, "t");
        const value =
          cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] ??
          cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ??
          "";
        return type === "s"
          ? sharedStrings[Number(value)] ?? ""
          : escapeXml(value);
      }),
  );
};

const numberOrZero = (value: string | undefined) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const listFromCell = (value: string | undefined) =>
  value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const rowDetails = (headers: string[], values: string[]) =>
  headers.slice(1).reduce<Record<string, string>>((details, header, index) => {
    if (header) details[header] = values[index + 1] ?? "";
    return details;
  }, {});

const parseWorkbook = (): SeedRecord[] => {
  const sharedStrings = parseSharedStrings();
  const sheets = parseWorkbookSheets();
  const rowsBySheet = new Map(
    sheets.map((sheet) => [
      sheet.name,
      parseSheet(sheet.entry, sharedStrings),
    ]),
  );
  const records: SeedRecord[] = [];

  const schemaIndex = rowsBySheet.get("Schema Index") ?? [];
  for (const row of schemaIndex.slice(1)) {
    if (row[0] !== "TABLE" || !row[1]) continue;
    records.push({
      objectType: "TABLE",
      objectName: row[1],
      sourceSheet: row[2] || row[1],
      schemaName: "public",
      columnCount: numberOrZero(row[3]),
      rowCount: numberOrZero(row[4]),
      columns: listFromCell(row[5]),
      details: {
        inventoryType: row[0] ?? "",
        worksheet: row[2] ?? "",
        sourceRowCount: row[4] ?? "0",
      },
    });
  }

  const addRows = (
    sheetName: string,
    objectType: SeedRecord["objectType"],
    build: (headers: string[], values: string[]) => SeedRecord | null,
  ) => {
    const rows = rowsBySheet.get(sheetName) ?? [];
    const headers = rows[0] ?? [];
    for (const row of rows.slice(1)) {
      const record = build(headers, row);
      if (record) records.push(record);
    }
  };

  addRows("Views", "VIEW", (_, row) =>
    row[0]
      ? {
          objectType: "VIEW",
          objectName: row[0],
          sourceSheet: "Views",
          schemaName: "public",
          columnCount: numberOrZero(row[1]),
          rowCount: 0,
          columns: listFromCell(row[2]),
          details: { columnCount: row[1] ?? "0" },
        }
      : null,
  );
  addRows("Functions", "FUNCTION", (headers, row) =>
    row[0]
      ? {
          objectType: "FUNCTION",
          objectName: row[0],
          sourceSheet: "Functions",
          schemaName: "public",
          columnCount: 0,
          rowCount: 0,
          columns: [],
          details: rowDetails(headers, row),
        }
      : null,
  );
  addRows("Triggers", "TRIGGER", (headers, row) =>
    row[0] && row[1]
      ? {
          objectType: "TRIGGER",
          objectName: `${row[0]}.${row[1]}`,
          sourceSheet: "Triggers",
          schemaName: "public",
          columnCount: 0,
          rowCount: 0,
          columns: [],
          details: rowDetails(headers, row),
        }
      : null,
  );
  addRows("Enums", "ENUM", (headers, row) =>
    row[0] && row[2]
      ? {
          objectType: "ENUM",
          objectName: `${row[0]}.${row[2]}`,
          sourceSheet: "Enums",
          schemaName: "public",
          columnCount: 0,
          rowCount: 0,
          columns: [],
          details: rowDetails(headers, row),
        }
      : null,
  );
  addRows("Indexes", "INDEX", (headers, row) =>
    row[0]
      ? {
          objectType: "INDEX",
          objectName: row[0],
          sourceSheet: "Indexes",
          schemaName: "public",
          columnCount: 0,
          rowCount: 0,
          columns: [],
          details: rowDetails(headers, row),
        }
      : null,
  );
  addRows("RLS Policies", "RLS_POLICY", (headers, row) =>
    row[0] && row[1]
      ? {
          objectType: "RLS_POLICY",
          objectName: `${row[0]}.${row[1]}`,
          sourceSheet: "RLS Policies",
          schemaName: "public",
          columnCount: 0,
          rowCount: 0,
          columns: [],
          details: rowDetails(headers, row),
        }
      : null,
  );
  addRows("Roles", "ROLE", (headers, row) =>
    row[1]
      ? {
          objectType: "ROLE",
          objectName: row[1],
          sourceSheet: "Roles",
          schemaName: null,
          columnCount: 0,
          rowCount: 0,
          columns: [],
          details: rowDetails(headers, row),
        }
      : null,
  );
  addRows("Grants", "GRANT", (headers, row) =>
    row[0] && row[1]
      ? {
          objectType: "GRANT",
          objectName: `${row[0]} · ${row[1]}`,
          sourceSheet: "Grants",
          schemaName: "public",
          columnCount: 0,
          rowCount: 0,
          columns: [],
          details: rowDetails(headers, row),
        }
      : null,
  );

  return records;
};

export async function seedInventoryIfEmpty(): Promise<void> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(inventoryTable);
  if (Number(total) > 0) return;

  const records = parseWorkbook();
  if (records.length === 0) return;
  await db.insert(inventoryTable).values(records);
}
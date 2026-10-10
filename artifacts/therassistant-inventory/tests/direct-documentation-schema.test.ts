import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildDirectDocumentationDraft } from "../src/domains/encounters/direct-documentation.ts";

test("direct documentation creates an encounter without fabricating an appointment", () => {
  const draft = buildDirectDocumentationDraft({
    clientId: "client-1",
    providerId: "provider-1",
    serviceType: "Clinical Note",
    serviceDate: "2026-10-10",
    locationType: "office",
  });
  assert.equal(draft.appointment_id, null);
});

test("database schema permits direct-documentation encounters without appointment_id", () => {
  const migrationsDir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
  const sql = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(`${migrationsDir}/${name}`, "utf8"))
    .join("\n");
  assert.match(sql, /alter\s+table\s+public\.encounters[\s\S]*?alter\s+column\s+appointment_id\s+drop\s+not\s+null/i);
});

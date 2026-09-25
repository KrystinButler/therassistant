import test from "node:test";import assert from "node:assert/strict";import {readFileSync,readdirSync} from "node:fs";
const repository=readFileSync(new URL("../src/domains/journal/repository.ts",import.meta.url),"utf8");
const panel=readFileSync(new URL("../src/domains/journal/JournalPanel.tsx",import.meta.url),"utf8");
const portal=readFileSync(new URL("../src/domains/portal/repository.ts",import.meta.url),"utf8");
const files=readdirSync(new URL("../../../supabase/migrations/",import.meta.url));
const migration=readFileSync(new URL("../../../supabase/migrations/"+files.find(f=>f.endsWith("_patient_only_journal_authoring.sql")),import.meta.url),"utf8");
test("staff cannot author journal entries through patient chart or staff repository",()=>{
  assert.doesNotMatch(panel,/addJournalEntry|Add Patient Entry|onClick=\{\(\) => void add\(/);
  assert.doesNotMatch(repository,/tenantInsert|addJournalEntry|buildJournalEntryValues/);
  assert.match(panel,/markJournalReviewed/);
  assert.match(panel,/flagJournalEntry/);
});
test("direct staff INSERT permission and staff authoring policy are revoked",()=>{
  assert.match(migration,/drop policy if exists "patient_journal_entries staff shared insert"/i);
  assert.match(migration,/revoke insert on public\.patient_journal_entries from authenticated/i);
  assert.match(portal,/portal_add_journal_entry/);
});

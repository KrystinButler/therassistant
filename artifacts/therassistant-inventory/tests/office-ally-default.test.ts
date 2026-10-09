import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  PLATFORM_CLEARINGHOUSE,
  officeAllyFunctionUrl,
} from "../src/domains/edi/office-ally";

test("Office Ally is the platform-managed EDI default with no practice setup", () => {
  assert.equal(PLATFORM_CLEARINGHOUSE.id, "office_ally");
  assert.equal(PLATFORM_CLEARINGHOUSE.name, "Office Ally");
  assert.equal(PLATFORM_CLEARINGHOUSE.platformManaged, true);
  assert.equal(PLATFORM_CLEARINGHOUSE.practiceSetupRequired, false);
  assert.deepEqual(PLATFORM_CLEARINGHOUSE.transactions, ["837P", "270/271", "276/277", "835"]);
});

test("practice configuration never asks users to configure Office Ally or clearinghouse credentials", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "../artifacts/therassistant-inventory/src/pages/practice-configuration.tsx"),
    "utf8",
  );
  assert.doesNotMatch(source, /Clearinghouse Settings/);
  assert.doesNotMatch(source, /label="Submitter ID"/);
  assert.doesNotMatch(source, /label="Receiver \/ Clearinghouse ID"/);
  assert.match(source, /Office Ally EDI transactions are connected automatically/);
});

test("browser routes EDI through the authenticated server function and never Office Ally directly", () => {
  assert.equal(
    officeAllyFunctionUrl("https://example.supabase.co/"),
    "https://example.supabase.co/functions/v1/office-ally-edi",
  );

  const source = fs.readFileSync(
    path.resolve(process.cwd(), "../artifacts/therassistant-inventory/src/domains/edi/office-ally.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /edi\.officeally\.io/i);
  assert.doesNotMatch(source, /OFFICE_ALLY_(?:API_KEY|AUTH_VALUE)/);
});

test("server adapter supports the four required transaction families without tenant credentials", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "../supabase/functions/office-ally-edi/index.ts"),
    "utf8",
  );
  for (const transaction of ["837P", "270/271", "276/277", "835"]) {
    assert.match(source, new RegExp(JSON.stringify(transaction).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(source, /Deno\.env\.get\("OFFICE_ALLY_API_BASE_URL"\)/);
  assert.match(source, /Deno\.env\.get\("OFFICE_ALLY_AUTH_HEADER"\)/);
  assert.match(source, /Deno\.env\.get\("OFFICE_ALLY_AUTH_VALUE"\)/);
  assert.doesNotMatch(source, /body\.(?:apiKey|api_key|password|token|secret)/);
});

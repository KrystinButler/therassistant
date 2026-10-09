import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  PLATFORM_CLEARINGHOUSE,
  officeAllyFunctionUrl,
} from "../src/domains/edi/office-ally";

test("Office Ally stays preconfigured while each practice owns its account", () => {
  assert.equal(PLATFORM_CLEARINGHOUSE.id, "office_ally");
  assert.equal(PLATFORM_CLEARINGHOUSE.name, "Office Ally");
  assert.equal(PLATFORM_CLEARINGHOUSE.platformConfigured, true);
  assert.equal(PLATFORM_CLEARINGHOUSE.accountOwnedBy, "practice");
  assert.equal(PLATFORM_CLEARINGHOUSE.practiceSetupRequired, true);
  assert.deepEqual(PLATFORM_CLEARINGHOUSE.transactions, ["837P", "270/271", "276/277", "835"]);
});

test("practice configuration asks only for the Office Ally connection, never EDI routing internals", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "../artifacts/therassistant-inventory/src/pages/practice-configuration.tsx"),
    "utf8",
  );
  assert.match(source, /OfficeAllyConnectionPanel/);
  assert.doesNotMatch(source, /Clearinghouse Settings/);
  assert.doesNotMatch(source, /label="Submitter ID"/);
  assert.doesNotMatch(source, /label="Receiver \/ Clearinghouse ID"/);
  assert.doesNotMatch(source, /Office Ally EDI transactions are connected automatically/);
});

test("Office Ally connection panel exposes test and production states without technical routing fields", () => {
  const panelPath = path.resolve(
    process.cwd(),
    "../artifacts/therassistant-inventory/src/domains/edi/OfficeAllyConnectionPanel.tsx",
  );
  assert.equal(fs.existsSync(panelPath), true);
  const source = fs.readFileSync(panelPath, "utf8");
  for (const text of ["Not connected", "Test ready", "Production connected", "Connection error"]) {
    assert.match(source, new RegExp(text, "i"));
  }
  assert.match(source, /Connect Office Ally/);
  assert.match(source, /Replace credentials/);
  assert.match(source, /Disconnect/);
  assert.match(source, /type="password"/);
  assert.match(source, /API Key/);
  assert.doesNotMatch(source, /endpoint|base url|http method|receiver id/i);
});

test("connection client sends credentials only to the tenant RPC and never persists them", () => {
  const clientPath = path.resolve(
    process.cwd(),
    "../artifacts/therassistant-inventory/src/domains/edi/office-ally-connection.ts",
  );
  assert.equal(fs.existsSync(clientPath), true);
  const source = fs.readFileSync(clientPath, "utf8");
  assert.match(source, /save_office_ally_connection/);
  assert.match(source, /disconnect_office_ally_connection/);
  assert.match(source, /get_office_ally_connection_status/);
  assert.match(source, /authorization_api_key/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test("browser routes EDI through the authenticated server function with an explicit environment", () => {
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
  assert.match(source, /environment:\s*request\.environment/);
});

test("server adapter supports all transaction families while keeping buyer credentials server-side", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "../supabase/functions/office-ally-edi/index.ts"),
    "utf8",
  );
  for (const transaction of ["837P", "270/271", "276/277", "835"]) {
    assert.match(source, new RegExp(JSON.stringify(transaction).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(source, /Deno\.env\.get\("OFFICE_ALLY_API_BASE_URL"\)/);
  assert.match(source, /headers\.set\("Authorization", apiKey\)/);
  assert.match(source, /resolveOfficeAllyConnection/);
  assert.doesNotMatch(source, /OFFICE_ALLY_AUTH_VALUE/);
  assert.doesNotMatch(source, /body\.(?:apiKey|api_key|password|token|secret)/);
});

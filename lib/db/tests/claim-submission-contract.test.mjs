import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaUrl = new URL("../src/schema/submissions.ts", import.meta.url);

test("claim submissions schema declares canonical EHR and X12 snapshot columns", async () => {
  const source = await readFile(schemaUrl, "utf8");
  for (const declaration of [
    'encounterId: uuid("encounter_id")',
    'clientId: uuid("client_id")',
    'practiceEntityId: uuid("practice_entity_id")',
    'providerLocationId: uuid("provider_location_id")',
    'insurancePolicyId: uuid("insurance_policy_id")',
    'x12Version: text("x12_version")',
    'transactionSetType: text("transaction_set_type")',
    'interchangeControlNumber: text("interchange_control_number")',
    'groupControlNumber: text("group_control_number")',
    'transactionSetControlNumber: text("transaction_set_control_number")',
    'submitterIdentifier: text("submitter_identifier")',
    'receiverIdentifier: text("receiver_identifier")',
    'x12Snapshot: jsonb("x12_snapshot")',
  ]) {
    assert.ok(source.includes(declaration), `Missing schema declaration: ${declaration}`);
  }
});

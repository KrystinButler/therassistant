import test from "node:test";
import assert from "node:assert/strict";
import type { Edi837PConfig } from "../src/domains/billing/claim-output";
import { defaultClaimFilingIndicator, resolvePayerEdiConfig } from "../src/domains/billing/payer-edi-defaults";

const blank = {
  payerIds: {},
  claimFilingIndicators: {},
  eraPayerIdentifiers: {},
} as Edi837PConfig;

test("known Colorado claim filing categories load without practice configuration", () => {
  const payers = [
    { id: "hfc", normalized_name: "health first colorado", payer_type: "government" },
    { id: "coaccess", normalized_name: "colorado access", payer_type: "medicaid_rae" },
    { id: "medicare", name: "Medicare", payer_type: "government" },
    { id: "tricare", name: "TRICARE", payer_type: "government" },
    { id: "anthem", name: "Anthem Blue Cross Blue Shield", payer_type: "commercial" },
    { id: "aetna", name: "Aetna", payer_type: "commercial" },
  ];
  const actual = resolvePayerEdiConfig(blank, payers);
  assert.deepEqual(actual.claimFilingIndicators, {
    hfc: "MC", coaccess: "MC", medicare: "MB",
    tricare: "CH", anthem: "BL", aetna: "CI",
  });
  assert.deepEqual(actual.payerIds, {});
  assert.deepEqual(actual.eraPayerIdentifiers, {});
});

test("existing partner-specific values override the shared catalog, without mutating saved settings", () => {
  const current = {
    ...blank,
    payerIds: { anthem: "PRIVATE-PARTNER" },
    claimFilingIndicators: { anthem: "FI" },
    eraPayerIdentifiers: { anthem: "INBOUND-ERA" },
  };
  const actual = resolvePayerEdiConfig(current, [{
    id: "anthem",
    name: "Anthem Blue Cross Blue Shield",
    payer_type: "commercial",
    clearinghouse_payer_id: "ANTHEM",
  }, {
    id: "coaccess",
    name: "Colorado Access",
    payer_type: "medicaid_rae",
  }]);
  assert.equal(actual.payerIds.anthem, "PRIVATE-PARTNER");
  assert.equal(actual.claimFilingIndicators.anthem, "FI");
  assert.equal(actual.eraPayerIdentifiers.anthem, "INBOUND-ERA");
  assert.equal(actual.claimFilingIndicators.coaccess, "MC");
  assert.equal(current.claimFilingIndicators.coaccess, undefined);
});

test("shared outbound payer ID appears automatically but never populates ERA mapping", () => {
  const actual = resolvePayerEdiConfig(blank, [{
    id: "anthem", name: "Anthem Blue Cross Blue Shield",
    payer_type: "commercial", clearinghouse_payer_id: "ANTHEM",
  }]);
  assert.equal(actual.payerIds.anthem, "ANTHEM");
  assert.equal(actual.eraPayerIdentifiers.anthem, undefined);
});

test("unknown government payer and missing IDs stay unconfigured rather than guessed", () => {
  const payer = { id: "unknown", name: "Unclassified Government", payer_type: "government" };
  assert.equal(defaultClaimFilingIndicator(payer), "");
  const actual = resolvePayerEdiConfig(blank, [payer]);
  assert.deepEqual(actual.payerIds, {});
  assert.deepEqual(actual.claimFilingIndicators, {});
  assert.deepEqual(actual.eraPayerIdentifiers, {});
});

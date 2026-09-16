import test from "node:test";
import assert from "node:assert/strict";

import { build837PText, buildCms1500Html } from "../src/domains/billing/claim-output";

const sample = {
  batch: { id: "batch-123", batch_name: "Aetna 2026-09-16" },
  claims: [{
    claim: {
      id: "claim-1",
      patient_control_number: "TH-1001",
      total_charge_cents: 15000,
      service_date_from: "2026-09-01",
      payerName: "Aetna",
      clientName: "Demo Patient",
      providerName: "Demo Provider",
    },
    lines: [{ cpt_code: "90837", charge_amount_cents: 15000, units: 1, diagnosis_pointer: "1", service_date: "2026-09-01" }],
    diagnoses: [{ diagnosis_code: "F41.1", pointer_order: 1 }],
  }],
};

test("837P demo export contains professional claim and service line segments", () => {
  const x12 = build837PText(sample);
  assert.match(x12, /ST\*837\*0001\*005010X222A1~/);
  assert.match(x12, /CLM\*TH-1001\*150\.00/);
  assert.match(x12, /SV1\*HC:90837\*150\.00/);
  assert.match(x12, /IEA\*1\*/);
});

test("CMS-1500 print output includes patient, payer and service line context", () => {
  const html = buildCms1500Html(sample.claims[0]);
  assert.match(html, /CMS-1500/);
  assert.match(html, /Demo Patient/);
  assert.match(html, /Aetna/);
  assert.match(html, /90837/);
});

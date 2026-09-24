import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSuperbillHtml, type SuperbillData } from "../src/domains/billing/superbill";

function fixture(): SuperbillData {
  return {
    encounter: { id: "visit-1", started_at: "2026-09-22T16:00:00Z" },
    client: { id: "patient-1", first_name: "Sample", last_name: "Patient", date_of_birth: "1990-04-02" },
    provider: { id: "provider-1", first_name: "Care", last_name: "Clinician", individual_npi: "1234567893", credentials: "LPC" },
    practice: { id: "practice-1", legal_name: "Sample Practice", tax_id: "000000001" },
    location: { id: "location-1", address_line1: "100 Main St", city: "Denver", state: "CO", postal_code: "80201", phone: "555-0100" },
    tenant: null,
    diagnoses: [{ diagnosis_code: "F41.1" }],
    charges: [{ id: "charge-1", encounter_id: "visit-1", client_id: "patient-1", billing_path: "private_pay", charge_status: "patient_responsibility", service_date: "2026-09-22", cpt_code: "90837", modifier1: "95", units: 1, charge_amount_cents: 17500 }],
  };
}
test("private-pay superbill includes patient, provider, diagnosis, line items and charges", () => {
  const output = buildSuperbillHtml(fixture());
  for (const part of ["Sample Practice", "Care Clinician", "Sample Patient", "F41.1", "90837", "$175.00", "Print / Save PDF", "not an insurance claim or proof of payment"]) {
    assert.ok(output.includes(part), part);
  }
});
test("superbill HTML escapes patient-supplied content", () => {
  const data = fixture();
  data.client.first_name = '<img src=x onerror=alert(1)>';
  const output = buildSuperbillHtml(data);
  assert.ok(output.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!output.includes("<img src=x"));
});
test("superbill rejects mixing patient, encounter or insurance-funded charges", () => {
  const data = fixture();
  data.charges.push({ ...data.charges[0], id: "bad", client_id: "another-patient" });
  assert.throws(() => buildSuperbillHtml(data), /only contain private-pay charges/);
  data.charges.pop();
  data.charges[0].billing_path = "insurance_claim";
  assert.throws(() => buildSuperbillHtml(data), /only contain private-pay charges/);
});
test("superbill flags incomplete practice and diagnosis fields rather than inventing data", () => {
  const data = fixture();
  data.practice = null;
  data.diagnoses = [];
  data.charges[0].diagnosis_code = null;
  const output = buildSuperbillHtml(data);
  assert.match(output, /Review before sharing/);
  assert.match(output, /Encounter diagnosis/);
});
test("Private Pay queue connects a Generate Superbill action to the real encounter", () => {
  const source = readFileSync(new URL("../src/domains/billing/BillingQueuePage.tsx", import.meta.url), "utf8");
  assert.match(source, /Generate Superbill/);
  assert.match(source, /getPrivatePaySuperbillData/);
  assert.match(source, /renderedSuperbills/);
});

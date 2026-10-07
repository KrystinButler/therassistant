import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const encounter = readFileSync(new URL("../src/domains/encounters/EncounterPage.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../src/domains/scheduling/PatientReviewDrawer.tsx", import.meta.url), "utf8");

test("encounter follows the manual's provider preparation-to-documentation flow", () => {
  for (const label of [
    "TODAY&apos;S FOCUS",
    "Active Progress Note",
    "Last Visit",
    "Treatment Plan",
    "Journal",
    "Documents",
    "Cite Check-In",
    "Cite Journal",
    "Coding & Service",
    "Signed clinical record → Charge Capture",
  ]) {
    assert.match(encounter, new RegExp(label.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&")));
  }
});

test("coding is required while eligibility remains advisory", () => {
  assert.match(encounter, /Add the visit diagnosis and procedure code before Sign &amp; Lock|Add the visit diagnosis and procedure code before Sign & Lock/);
  assert.match(encounter, /Eligibility verification does not hold billing/);
  assert.doesNotMatch(encounter, /Documentation Readiness & Signature/);
  assert.doesNotMatch(encounter, /<ExternalSummaryPanel/);
  assert.doesNotMatch(encounter, /id="encounter-billing-source"/);
  assert.doesNotMatch(encounter, /disabled=\{[^}]*billingFollowUpCount/);
});

test("pre-session drawer ends in Visit Readiness and Start Note", () => {
  assert.match(drawer, /title="Visit Readiness"/);
  assert.match(drawer, /> Open Chart</);
  assert.match(drawer, /starting \? "Starting\.\.\." : existingEncounter \? "Resume Note" : "Start Note"/);
});

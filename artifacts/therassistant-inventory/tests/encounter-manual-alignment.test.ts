import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const encounter = readFileSync(new URL("../src/domains/encounters/EncounterPage.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../src/domains/scheduling/PatientReviewDrawer.tsx", import.meta.url), "utf8");

test("encounter follows the manual's provider preparation-to-documentation flow", () => {
  for (const label of [
    "TODAY'S FOCUS",
    "Session & Note",
    "Treatment Plan",
    "Patient Info",
    "Attachments",
    "Active Progress Note",
    "PATIENT-SUBMITTED CONTEXT",
    "Import Check-In",
    "Import Session Journal",
    "Coding & Service",
    "Documentation Readiness & Signature",
    "Signed clinical record → Charge Capture",
  ]) {
    assert.match(encounter, new RegExp(label.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&")));
  }
});

test("billing follow-up is explicitly nonblocking for clinical signature", () => {
  assert.match(encounter, /Billing follow-up never prevents the provider from completing the clinical record/);
  assert.match(encounter, /You may still sign the clinical note/);
  assert.doesNotMatch(encounter, /disabled=\{[^}]*billingFollowUpCount/);
});

test("pre-session drawer ends in Visit Readiness and Start Note", () => {
  assert.match(drawer, /title="Visit Readiness"/);
  assert.match(drawer, /> Open Chart</);
  assert.match(drawer, /> \{starting \? "Starting\.\.\." : "Start Note"\}/);
});

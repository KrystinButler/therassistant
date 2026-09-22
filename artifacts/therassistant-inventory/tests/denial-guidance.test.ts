import test from "node:test";
import assert from "node:assert/strict";

import { buildAppealLetter } from "../src/domains/ar/appeal-template";
import { getDenialGuidance } from "../src/domains/ar/denial-guidance";
import { classifyDenialPolicy } from "../src/domains/ar/denials";

test("CARC guidance chooses common behavioral-health denial workflows", () => {
  assert.equal(getDenialGuidance({ carcCode: "29" }).action, "appeal");
  assert.equal(getDenialGuidance({ carcCode: "29" }).template, "timely_filing");
  assert.equal(getDenialGuidance({ carcCode: "109" }).action, "rebill_other_payer");
  assert.equal(getDenialGuidance({ carcCode: "152" }).template, "length_of_service");
});

test("CARC 16 and 96 require RARC context", () => {
  const missing = getDenialGuidance({ carcCode: "CO-16" });
  assert.equal(missing.requiresRarc, true);
  assert.ok(missing.warning);
  const complete = getDenialGuidance({ carcCode: "16", rarcCode: "N382" });
  assert.match(complete.summary, /N382/);
});

test("contract and credentialing CARCs follow the write-off lane", () => {
  assert.equal(getDenialGuidance({ carcCode: "170" }).action, "write_off_contract");
  assert.equal(classifyDenialPolicy("other", "CO-170"), "auto_writeoff");
  assert.equal(classifyDenialPolicy("credentialing"), "auto_writeoff");
});

test("appeal letter prefills claim context without inventing authorization facts", () => {
  const letter = buildAppealLetter({
    patientName: "Test Patient",
    memberId: "M123",
    payerName: "Example Plan",
    claimNumber: "CLM-1",
    serviceDate: "2026-09-01",
    cptCodes: ["90837"],
    carcCode: "197",
    rarcCode: "N130",
    denialCategory: "authorization",
  });
  assert.match(letter, /Test Patient/);
  assert.match(letter, /CLM-1/);
  assert.match(letter, /90837/);
  assert.match(letter, /CARC 197/);
  assert.match(letter, /RARC N130/);
  assert.doesNotMatch(letter, /Authorization number:/);
});

test("authorization facts are included only when present", () => {
  const letter = buildAppealLetter({
    patientName: "Test Patient",
    cptCodes: ["90792"],
    carcCode: "197",
    authorizationNumber: "AUTH-123",
    authorizationStartDate: "2026-08-01",
    authorizationEndDate: "2026-10-01",
  });
  assert.match(letter, /Authorization number: AUTH-123/);
});

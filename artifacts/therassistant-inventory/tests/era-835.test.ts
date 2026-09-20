import test from "node:test";
import assert from "node:assert/strict";

import {
  claimAdjustmentTotalCents,
  claimContractualAdjustmentCents,
  claimPatientResponsibilityCents,
  parse835,
  unsupportedAdjustmentGroups,
} from "../src/domains/payments/era-835.ts";

const paid835 = [
  "ST*835*0001",
  "BPR*I*80.00*C*ACH*CCP************20260920",
  "TRN*1*TRACE-1001*1512345678",
  "N1*PR*AETNA",
  "N1*PE*EXAMPLE BEHAVIORAL HEALTH",
  "CLP*TH-1001*1*100.00*80.00*20.00**PAYER-1001*11*1",
  "NM1*QC*1*PATIENT*DEMO",
  "SVC*HC:90837*100.00*80.00",
  "DTM*472*20260901",
  "CAS*PR*1*20.00",
  "SE*10*0001",
].join("~") + "~";

test("parses core 835 payment and claim adjudication segments", () => {
  const era = parse835(paid835);
  assert.equal(era.traceNumber, "TRACE-1001");
  assert.equal(era.paymentAmountCents, 8000);
  assert.equal(era.paymentMethodCode, "ACH");
  assert.equal(era.payerName, "AETNA");
  assert.equal(era.claims.length, 1);
  assert.equal(era.claims[0].patientControlNumber, "TH-1001");
  assert.equal(era.claims[0].paidAmountCents, 8000);
  assert.equal(era.claims[0].patientResponsibilityCents, 2000);
  assert.equal(era.claims[0].serviceLines[0].cptCode, "90837");
  assert.equal(era.claims[0].serviceLines[0].serviceDate, "2026-09-01");
  assert.equal(claimAdjustmentTotalCents(era.claims[0]), 2000);
  assert.equal(claimPatientResponsibilityCents(era.claims[0]), 2000);
});

test("separates contractual adjustments from patient responsibility", () => {
  const era = parse835([
    "ST*835*0002",
    "BPR*I*75.00*C*ACH*CCP************20260920",
    "TRN*1*TRACE-1002",
    "CLP*TH-1002*1*100.00*75.00*10.00**PAYER-1002",
    "CAS*CO*45*15.00",
    "CAS*PR*1*10.00",
    "SE*7*0002",
  ].join("~") + "~");

  const claim = era.claims[0];
  assert.equal(claimAdjustmentTotalCents(claim), 2500);
  assert.equal(claimContractualAdjustmentCents(claim), 1500);
  assert.equal(claimPatientResponsibilityCents(claim), 1000);
  assert.deepEqual(unsupportedAdjustmentGroups(claim), []);
});

test("identifies unsupported adjustment groups for review", () => {
  const era = parse835([
    "ST*835*0003",
    "BPR*I*70.00*C*ACH*CCP************20260920",
    "TRN*1*TRACE-1003",
    "CLP*TH-1003*1*100.00*70.00*0**PAYER-1003",
    "CAS*CO*45*20.00",
    "CAS*OA*23*10.00",
    "SE*7*0003",
  ].join("~") + "~");

  assert.deepEqual(unsupportedAdjustmentGroups(era.claims[0]), ["OA"]);
});

test("captures provider-level adjustments so automatic posting can be blocked", () => {
  const era = parse835([
    "ST*835*0004",
    "BPR*I*95.00*C*ACH*CCP************20260920",
    "TRN*1*TRACE-1004",
    "CLP*TH-1004*1*100.00*100.00*0**PAYER-1004",
    "PLB*1234567893*20260920*WO:ABC*-5.00",
    "SE*6*0004",
  ].join("~") + "~");

  assert.equal(era.providerLevelAdjustments.length, 1);
  assert.match(era.providerLevelAdjustments[0], /^PLB/);
});

test("rejects non-835 input and missing trace numbers", () => {
  assert.throws(() => parse835("ST*837*0001~SE*2*0001~"), /ST\*835/);
  assert.throws(
    () => parse835("ST*835*0001~BPR*I*0*C*ACH~CLP*TH-1*4*100*0*0~SE*4*0001~"),
    /trace number/i,
  );
});

export type Test835Scenario =
  | "paid"
  | "partial_patient"
  | "denied"
  | "unmatched"
  | "ambiguous"
  | "payer_mismatch"
  | "reversal";

export type Test835Context = {
  patientControlNumber: string;
  payerIdentifier: string;
  claimChargeCents: number;
  traceNumber: string;
  serviceDate: string;
  cptCode: string;
  paidAmountCents?: number;
  bprAmountCents?: number;
  payerClaimNumber?: string;
  denialCarcCode?: string;
  denialRarcCode?: string;
};

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

function x12Date(date: string) {
  return date.replace(/-/g, "");
}

export function buildTest835(
  scenario: Test835Scenario,
  context: Test835Context,
): string {
  const charge = context.claimChargeCents;
  let status = "1";
  let paid = 8000;
  let patient = 0;
  let payerIdentifier = context.payerIdentifier;
  let adjustments = [`CAS*CO*45*${dollars(Math.max(0, charge - paid))}`];
  const remarks: string[] = [];

  if (scenario === "partial_patient") {
    paid = 7000;
    patient = 1000;
    adjustments = ["CAS*CO*45*20.00", "CAS*PR*1*10.00"];
  } else if (scenario === "denied") {
    status = "4";
    paid = 0;
    patient = 0;
    adjustments = [`CAS*CO*${context.denialCarcCode ?? "197"}*${dollars(charge)}`];
    remarks.push(`LQ*HE*${context.denialRarcCode ?? "N130"}`);
  } else if (scenario === "payer_mismatch") {
    payerIdentifier = "WRONGPAYER";
  } else if (scenario === "reversal") {
    paid = charge;
    patient = 0;
    adjustments = ["CAS*CO*94*-10.00"];
  }

  if (typeof context.paidAmountCents === "number") {
    paid = context.paidAmountCents;
  }
  const bpr = typeof context.bprAmountCents === "number"
    ? context.bprAmountCents
    : paid;

  const segments = [
    "ST*835*0001",
    `BPR*I*${dollars(bpr)}*C*ACH*CCP************${x12Date(context.serviceDate)}`,
    `TRN*1*${context.traceNumber}`,
    `N1*PR*TEST PAYER*XV*${payerIdentifier}`,
    "N1*PE*THERASSISTANT TEST PRACTICE",
    `CLP*${context.patientControlNumber}*${status}*${dollars(charge)}*${dollars(paid)}*${dollars(patient)}**${context.payerClaimNumber ?? "TEST-PAYER-CLAIM"}*11*1`,
    "NM1*QC*1*TESTPATIENT*ROUTING",
    ...adjustments,
    `SVC*HC:${context.cptCode}*${dollars(charge)}*${dollars(paid)}`,
    `DTM*472*${x12Date(context.serviceDate)}`,
    ...remarks,
    "SE*12*0001",
  ];

  return `${segments.join("~")}~`;
}

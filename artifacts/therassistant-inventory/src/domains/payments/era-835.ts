export type Era835Adjustment = {
  groupCode: string;
  reasonCode: string;
  amountCents: number;
  quantity: number | null;
};

export type Era835ServiceLine = {
  cptCode: string;
  chargeAmountCents: number;
  paidAmountCents: number;
  serviceDate: string | null;
  adjustments: Era835Adjustment[];
  rawSegments: string[];
};

export type Era835Claim = {
  patientControlNumber: string;
  claimStatusCode: string;
  totalChargeCents: number;
  paidAmountCents: number;
  patientResponsibilityCents: number;
  payerClaimNumber: string;
  patientLastName: string;
  patientFirstName: string;
  adjustments: Era835Adjustment[];
  remarkCodes: string[];
  serviceLines: Era835ServiceLine[];
  rawSegments: string[];
};

export type Parsed835 = {
  transactionControlNumber: string;
  traceNumber: string;
  paymentAmountCents: number;
  paymentMethodCode: string;
  paymentDate: string | null;
  payerName: string;
  payerIdentifierQualifier: string;
  payerIdentifier: string;
  payeeName: string;
  claims: Era835Claim[];
  providerLevelAdjustments: string[];
  rawSegmentCount: number;
};

function moneyToCents(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const number = Number(text);
  if (!Number.isFinite(number)) throw new Error(`Invalid monetary amount: ${text}`);
  return Math.round(number * 100);
}

function formatX12Date(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d{8}$/.test(text)) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function splitSegments(raw: string) {
  const normalized = raw.replace(/^\uFEFF/, "").trim();
  if (!normalized) throw new Error("835 content is empty.");

  const elementSeparator = normalized.startsWith("ISA") && normalized.length > 3
    ? normalized[3]
    : "*";

  let segmentTerminator = "~";
  if (normalized.startsWith("ISA") && normalized.length > 105) {
    const candidate = normalized[105];
    if (candidate && !/[A-Za-z0-9]/.test(candidate)) segmentTerminator = candidate;
  }

  let rawSegments = normalized.split(segmentTerminator);
  if (rawSegments.length === 1) rawSegments = normalized.split(/\r?\n/);

  const segments = rawSegments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.split(elementSeparator).map((value) => value.trim()));

  return {
    segments,
    rawSegments: rawSegments.map((segment) => segment.trim()).filter(Boolean),
  };
}

function parseCas(elements: string[]): Era835Adjustment[] {
  const groupCode = String(elements[1] ?? "").trim().toUpperCase();
  const adjustments: Era835Adjustment[] = [];
  for (let index = 2; index < elements.length; index += 3) {
    const reasonCode = String(elements[index] ?? "").trim();
    const amount = String(elements[index + 1] ?? "").trim();
    const quantity = String(elements[index + 2] ?? "").trim();
    if (!reasonCode && !amount && !quantity) continue;
    adjustments.push({
      groupCode,
      reasonCode,
      amountCents: moneyToCents(amount || 0),
      quantity: quantity ? Number(quantity) : null,
    });
  }
  return adjustments;
}

export function parse835(raw: string): Parsed835 {
  const { segments, rawSegments } = splitSegments(raw);

  if (!segments.some((segment) => segment[0] === "ST" && segment[1] === "835")) {
    throw new Error("The file does not contain an ST*835 transaction.");
  }

  let transactionControlNumber = "";
  let traceNumber = "";
  let paymentAmountCents = 0;
  let paymentMethodCode = "";
  let paymentDate: string | null = null;
  let payerName = "";
  let payerIdentifierQualifier = "";
  let payerIdentifier = "";
  let payeeName = "";
  const providerLevelAdjustments: string[] = [];
  const claims: Era835Claim[] = [];

  let currentClaim: Era835Claim | null = null;
  let currentService: Era835ServiceLine | null = null;

  for (let index = 0; index < segments.length; index += 1) {
    const elements = segments[index];
    const tag = elements[0];
    const rawSegment = rawSegments[index] ?? elements.join("*");

    if (tag === "ST" && elements[1] === "835") {
      transactionControlNumber = String(elements[2] ?? "");
      continue;
    }
    if (tag === "BPR") {
      paymentAmountCents = moneyToCents(elements[2] ?? 0);
      paymentMethodCode = String(elements[4] ?? "").toUpperCase();
      paymentDate = formatX12Date(elements[16] ?? elements.at(-1));
      continue;
    }
    if (tag === "TRN" && elements[1] === "1") {
      traceNumber = String(elements[2] ?? "");
      continue;
    }
    if (tag === "N1" && elements[1] === "PR") {
      payerName = String(elements[2] ?? "");
      payerIdentifierQualifier = String(elements[3] ?? "");
      payerIdentifier = String(elements[4] ?? "");
      continue;
    }
    if (tag === "N1" && elements[1] === "PE") {
      payeeName = String(elements[2] ?? "");
      continue;
    }
    if (tag === "PLB") {
      providerLevelAdjustments.push(rawSegment);
      continue;
    }

    if (tag === "CLP") {
      currentService = null;
      currentClaim = {
        patientControlNumber: String(elements[1] ?? ""),
        claimStatusCode: String(elements[2] ?? ""),
        totalChargeCents: moneyToCents(elements[3] ?? 0),
        paidAmountCents: moneyToCents(elements[4] ?? 0),
        patientResponsibilityCents: moneyToCents(elements[5] ?? 0),
        payerClaimNumber: String(elements[7] ?? ""),
        patientLastName: "",
        patientFirstName: "",
        adjustments: [],
        remarkCodes: [],
        serviceLines: [],
        rawSegments: [rawSegment],
      };
      claims.push(currentClaim);
      continue;
    }

    if (!currentClaim) continue;
    currentClaim.rawSegments.push(rawSegment);

    if (tag === "NM1" && elements[1] === "QC") {
      currentClaim.patientLastName = String(elements[3] ?? "");
      currentClaim.patientFirstName = String(elements[4] ?? "");
      continue;
    }

    if (tag === "SVC") {
      const composite = String(elements[1] ?? "").split(":");
      currentService = {
        cptCode: composite[1] || composite[0] || "",
        chargeAmountCents: moneyToCents(elements[2] ?? 0),
        paidAmountCents: moneyToCents(elements[3] ?? 0),
        serviceDate: null,
        adjustments: [],
        rawSegments: [rawSegment],
      };
      currentClaim.serviceLines.push(currentService);
      continue;
    }

    if (currentService) currentService.rawSegments.push(rawSegment);

    if (tag === "DTM" && elements[1] === "472" && currentService) {
      currentService.serviceDate = formatX12Date(elements[2]);
      continue;
    }

    if (tag === "CAS") {
      const adjustments = parseCas(elements);
      if (currentService) currentService.adjustments.push(...adjustments);
      else currentClaim.adjustments.push(...adjustments);
      continue;
    }

    if (tag === "LQ" && elements[1] === "HE" && elements[2]) {
      currentClaim.remarkCodes.push(String(elements[2]));
    }
  }

  if (!traceNumber) throw new Error("835 trace number (TRN02) is missing.");
  if (!claims.length) throw new Error("835 contains no CLP claim adjudication segments.");
  if (paymentAmountCents < 0) throw new Error("835 BPR payment amount cannot be negative.");

  return {
    transactionControlNumber,
    traceNumber,
    paymentAmountCents,
    paymentMethodCode,
    paymentDate,
    payerName,
    payerIdentifierQualifier,
    payerIdentifier,
    payeeName,
    claims,
    providerLevelAdjustments,
    rawSegmentCount: segments.length,
  };
}

export function claimAdjustmentTotalCents(claim: Era835Claim) {
  return [
    ...claim.adjustments,
    ...claim.serviceLines.flatMap((line) => line.adjustments),
  ].reduce((sum, row) => sum + row.amountCents, 0);
}

export function claimPatientResponsibilityCents(claim: Era835Claim) {
  const casPr = [
    ...claim.adjustments,
    ...claim.serviceLines.flatMap((line) => line.adjustments),
  ]
    .filter((row) => row.groupCode === "PR")
    .reduce((sum, row) => sum + row.amountCents, 0);
  return Math.max(claim.patientResponsibilityCents, casPr);
}

export function claimContractualAdjustmentCents(claim: Era835Claim) {
  return [
    ...claim.adjustments,
    ...claim.serviceLines.flatMap((line) => line.adjustments),
  ]
    .filter((row) => row.groupCode === "CO")
    .reduce((sum, row) => sum + row.amountCents, 0);
}

export function unsupportedAdjustmentGroups(claim: Era835Claim) {
  return [...new Set([
    ...claim.adjustments,
    ...claim.serviceLines.flatMap((line) => line.adjustments),
  ].map((row) => row.groupCode).filter((group) => !["CO", "PR"].includes(group)))];
}

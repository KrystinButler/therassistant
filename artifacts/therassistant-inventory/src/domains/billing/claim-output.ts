type ClaimOutputRow = Record<string, unknown> & {
  id?: string;
  patient_control_number?: string;
  total_charge_cents?: number;
  service_date_from?: string;
  payerName?: string;
  clientName?: string;
  providerName?: string;
};

type ClaimLineRow = Record<string, unknown> & {
  cpt_code?: string;
  modifier1?: string | null;
  modifier2?: string | null;
  charge_amount_cents?: number;
  units?: number;
  diagnosis_pointer?: string;
  service_date?: string;
  place_of_service?: string | null;
};

type ClaimDiagnosisRow = Record<string, unknown> & {
  diagnosis_code?: string;
  pointer_order?: number;
};

type ContextRow = Record<string, unknown> & { id?: string };

export type Edi837PConfig = {
  submitterName: string;
  submitterId: string;
  receiverName: string;
  receiverId: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  billingProviderName: string;
  billingProviderNpi: string;
  billingProviderTaxId: string;
  billingProviderTaxonomy: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  usageIndicator: "P" | "T";
  payerIds: Record<string, string>;
};

export type ClaimOutputItem = {
  claim: ClaimOutputRow;
  lines: ClaimLineRow[];
  diagnoses: ClaimDiagnosisRow[];
  client: ContextRow | null;
  provider: ContextRow | null;
  payer: ContextRow | null;
  policy: ContextRow | null;
};

export type BatchOutputData = {
  batch: Record<string, unknown> & { id?: string };
  edi: Edi837PConfig;
  claims: ClaimOutputItem[];
};

function clean(value: unknown) {
  return String(value ?? "").replace(/[~*:^]/g, " ").replace(/\s+/g, " ").trim();
}

function compact(value: unknown) {
  return clean(value).replace(/[^A-Za-z0-9 .#\/-]/g, "");
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function date8(value: unknown) {
  return String(value ?? "").slice(0, 10).replaceAll("-", "");
}

function metadata(row?: ContextRow | null) {
  return row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
}

function payerEdiId(input: BatchOutputData, item: ClaimOutputItem) {
  const payerId = String(item.payer?.id ?? item.claim.payer_id ?? "");
  return clean(input.edi.payerIds[payerId] || item.payer?.clearinghouse_payer_id || "");
}

function numericControl(value: unknown) {
  const source = String(value ?? "therassistant");
  let hash = 0;
  for (const char of source) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000_000;
  return String(hash || 1).padStart(9, "0");
}

function isaId(value: unknown) {
  return clean(value).slice(0, 15).padEnd(15, " ");
}

function diagnosisCode(value: unknown) {
  return clean(value).replaceAll(".", "").toUpperCase();
}

function formatAmount(cents: unknown) {
  return (Number(cents ?? 0) / 100).toFixed(2);
}

function requireValue(errors: string[], value: unknown, label: string) {
  if (!clean(value)) errors.push(label);
}

export function validate837PExport(input: BatchOutputData) {
  const errors: string[] = [];
  const config = input.edi;

  for (const [label, value] of [
    ["Submitter name is not configured.", config.submitterName],
    ["Submitter ID is not configured.", config.submitterId],
    ["Receiver / clearinghouse name is not configured.", config.receiverName],
    ["Receiver / clearinghouse ID is not configured.", config.receiverId],
    ["EDI contact name is not configured.", config.contactName],
    ["Billing provider name is not configured.", config.billingProviderName],
    ["Billing provider NPI is not configured.", config.billingProviderNpi],
    ["Billing provider tax ID is not configured.", config.billingProviderTaxId],
    ["Billing provider taxonomy is not configured.", config.billingProviderTaxonomy],
    ["Billing provider address is not configured.", config.addressLine1],
    ["Billing provider city is not configured.", config.city],
    ["Billing provider state is not configured.", config.state],
    ["Billing provider ZIP code is not configured.", config.postalCode],
  ] as const) requireValue(errors, value, label);

  if (digits(config.billingProviderNpi).length !== 10) {
    errors.push("Billing provider NPI must contain 10 digits.");
  }
  if (digits(config.billingProviderTaxId).length !== 9) {
    errors.push("Billing provider tax ID must contain 9 digits.");
  }
  if (!input.claims.length) errors.push("The batch contains no claims.");

  const batchPayers = new Set<string>();
  for (const item of input.claims) {
    const control = clean(item.claim.patient_control_number ?? item.claim.id) || "Claim";
    const clientMeta = metadata(item.client);
    const pos = clean(item.lines[0]?.place_of_service);

    requireValue(errors, item.claim.patient_control_number, `${control}: patient control number is missing.`);
    requireValue(errors, item.client?.first_name, `${control}: patient first name is missing.`);
    requireValue(errors, item.client?.last_name, `${control}: patient last name is missing.`);
    requireValue(errors, item.client?.date_of_birth, `${control}: patient date of birth is missing.`);
    requireValue(errors, item.client?.address_line1, `${control}: patient street address is missing.`);
    requireValue(errors, item.client?.city, `${control}: patient city is missing.`);
    requireValue(errors, item.client?.state, `${control}: patient state is missing.`);
    requireValue(errors, item.client?.postal_code, `${control}: patient ZIP code is missing.`);
    if (!["M", "F"].includes(String(clientMeta.sex ?? ""))) {
      errors.push(`${control}: patient sex must be M or F for 837P export.`);
    }

    requireValue(errors, item.provider?.first_name, `${control}: rendering provider first name is missing.`);
    requireValue(errors, item.provider?.last_name, `${control}: rendering provider last name is missing.`);
    if (digits(item.provider?.individual_npi).length !== 10) {
      errors.push(`${control}: rendering provider NPI must contain 10 digits.`);
    }
    requireValue(errors, item.provider?.taxonomy_code, `${control}: rendering provider taxonomy is missing.`);

    requireValue(errors, item.payer?.name, `${control}: payer name is missing.`);
    const ediPayerId = payerEdiId(input, item);
    requireValue(errors, ediPayerId, `${control}: clearinghouse payer ID is not configured.`);
    if (ediPayerId) batchPayers.add(ediPayerId);

    requireValue(errors, item.policy?.member_id, `${control}: subscriber/member ID is missing.`);
    const relationship = String(item.policy?.relationship_to_subscriber ?? "").toLowerCase();
    if (relationship !== "self") {
      errors.push(`${control}: 837P export currently requires the patient to be the subscriber; dependent subscriber data needs structured address fields before export.`);
    }

    if (!item.lines.length) errors.push(`${control}: claim has no service lines.`);
    if (!item.diagnoses.length) errors.push(`${control}: claim has no diagnoses.`);
    if (!/^\d{2}$/.test(pos)) errors.push(`${control}: place of service must be a two-digit code.`);

    for (const [index, line] of item.lines.entries()) {
      const prefix = `${control} line ${index + 1}`;
      requireValue(errors, line.service_date, `${prefix}: service date is missing.`);
      requireValue(errors, line.cpt_code, `${prefix}: CPT/HCPCS code is missing.`);
      if (Number(line.units ?? 0) <= 0) errors.push(`${prefix}: units must be greater than zero.`);
      if (Number(line.charge_amount_cents ?? 0) <= 0) errors.push(`${prefix}: charge must be greater than zero.`);
      if (!/^\d{2}$/.test(clean(line.place_of_service))) {
        errors.push(`${prefix}: place of service must be a two-digit code.`);
      }
    }
  }

  if (batchPayers.size > 1) errors.push("An 837P batch must contain one clearinghouse payer ID.");
  return [...new Set(errors)];
}

export function build837PText(input: BatchOutputData, now = new Date()) {
  const errors = validate837PExport(input);
  if (errors.length) {
    throw new Error(`837P export is not ready:\n- ${errors.join("\n- ")}`);
  }

  const control = numericControl(input.batch.id);
  const groupControl = String(Number(control.slice(-6)) || 1);
  const interchangeDate = now.toISOString().slice(2, 10).replaceAll("-", "");
  const transactionDate = now.toISOString().slice(0, 10).replaceAll("-", "");
  const time = now.toISOString().slice(11, 16).replace(":", "");
  const transactionControl = "0001";
  const segments: string[] = [
    `ISA*00*          *00*          *ZZ*${isaId(input.edi.submitterId)}*ZZ*${isaId(input.edi.receiverId)}*${interchangeDate}*${time}*^*00501*${control}*0*${input.edi.usageIndicator}*:~`,
    `GS*HC*${clean(input.edi.submitterId)}*${clean(input.edi.receiverId)}*${transactionDate}*${time}*${groupControl}*X*005010X222A1~`,
  ];

  const tx: string[] = [
    `ST*837*${transactionControl}*005010X222A1~`,
    `BHT*0019*00*${control}*${transactionDate}*${time}*CH~`,
    `NM1*41*2*${compact(input.edi.submitterName)}*****46*${clean(input.edi.submitterId)}~`,
  ];

  const contactParts = [
    `PER*IC*${compact(input.edi.contactName)}`,
    digits(input.edi.contactPhone) ? `TE*${digits(input.edi.contactPhone)}` : "",
    clean(input.edi.contactEmail) ? `EM*${clean(input.edi.contactEmail)}` : "",
  ].filter(Boolean);
  tx.push(`${contactParts.join("*")}~`);
  tx.push(`NM1*40*2*${compact(input.edi.receiverName)}*****46*${clean(input.edi.receiverId)}~`);

  tx.push("HL*1**20*1~");
  tx.push(`PRV*BI*PXC*${clean(input.edi.billingProviderTaxonomy)}~`);
  tx.push(`NM1*85*2*${compact(input.edi.billingProviderName)}*****XX*${digits(input.edi.billingProviderNpi)}~`);
  tx.push(`N3*${compact(input.edi.addressLine1)}${input.edi.addressLine2 ? `*${compact(input.edi.addressLine2)}` : ""}~`);
  tx.push(`N4*${compact(input.edi.city)}*${clean(input.edi.state).toUpperCase()}*${digits(input.edi.postalCode)}~`);
  tx.push(`REF*EI*${digits(input.edi.billingProviderTaxId)}~`);

  let hl = 1;
  for (const item of input.claims) {
    hl += 1;
    const clientMeta = metadata(item.client);
    const payerId = payerEdiId(input, item);
    const pos = clean(item.lines[0]?.place_of_service);
    const controlNumber = clean(item.claim.patient_control_number ?? item.claim.id);
    const total = formatAmount(item.claim.total_charge_cents);

    tx.push(`HL*${hl}*1*22*0~`);
    tx.push("SBR*P*18*******CI~");
    tx.push(
      `NM1*IL*1*${compact(item.client?.last_name)}*${compact(item.client?.first_name)}****MI*${clean(item.policy?.member_id)}~`,
    );
    tx.push(`N3*${compact(item.client?.address_line1)}${item.client?.address_line2 ? `*${compact(item.client.address_line2)}` : ""}~`);
    tx.push(`N4*${compact(item.client?.city)}*${clean(item.client?.state).toUpperCase()}*${digits(item.client?.postal_code)}~`);
    tx.push(`DMG*D8*${date8(item.client?.date_of_birth)}*${clean(clientMeta.sex)}~`);
    tx.push(`NM1*PR*2*${compact(item.payer?.name)}*****PI*${payerId}~`);
    tx.push(`CLM*${controlNumber}*${total}***${pos}:B:1*Y*A*Y*Y~`);

    const sortedDx = [...item.diagnoses].sort(
      (a, b) => Number(a.pointer_order ?? 0) - Number(b.pointer_order ?? 0),
    );
    const hi = sortedDx.map((dx, index) =>
      `${index === 0 ? "ABK" : "ABF"}:${diagnosisCode(dx.diagnosis_code)}`,
    );
    tx.push(`HI*${hi.join("*")}~`);
    tx.push(
      `NM1*82*1*${compact(item.provider?.last_name)}*${compact(item.provider?.first_name)}****XX*${digits(item.provider?.individual_npi)}~`,
    );
    tx.push(`PRV*PE*PXC*${clean(item.provider?.taxonomy_code)}~`);

    for (const [lineIndex, line] of item.lines.entries()) {
      const amount = formatAmount(line.charge_amount_cents);
      const procedure = [
        "HC",
        clean(line.cpt_code),
        clean(line.modifier1),
        clean(line.modifier2),
      ].filter(Boolean).join(":");
      tx.push(`LX*${lineIndex + 1}~`);
      tx.push(
        `SV1*${procedure}*${amount}*UN*${Number(line.units ?? 1)}***${clean(line.diagnosis_pointer ?? "1")}~`,
      );
      tx.push(`DTP*472*D8*${date8(line.service_date)}~`);
    }
  }

  tx.push(`SE*${tx.length + 1}*${transactionControl}~`);
  segments.push(...tx);
  segments.push(`GE*1*${groupControl}~`);
  segments.push(`IEA*1*${control}~`);
  return segments.join("\n");
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildCms1500Html(item: ClaimOutputItem) {
  const diagnoses = [...item.diagnoses]
    .sort((a, b) => Number(a.pointer_order ?? 0) - Number(b.pointer_order ?? 0))
    .map((row) => escapeHtml(row.diagnosis_code))
    .filter(Boolean)
    .join(", ");
  const lines = item.lines
    .map((line) => {
      const dos = escapeHtml(line.service_date ?? item.claim.service_date_from);
      const charge = formatAmount(line.charge_amount_cents);
      return `<tr><td>${dos}</td><td>${escapeHtml(line.cpt_code)}</td><td>${escapeHtml(line.place_of_service ?? "")}</td><td>${escapeHtml(line.diagnosis_pointer ?? "1")}</td><td>${escapeHtml(line.units ?? 1)}</td><td>${charge}</td></tr>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<title>CMS-1500</title>
<style>
@page{size:8.5in 11in;margin:.25in}
body{margin:0;background:#fff}.cms1500{box-sizing:border-box;width:8in;min-height:10.5in;font:10px Arial,sans-serif;color:#111}
h1{font-size:16px;margin:0 0 8px}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px}.field{border:1px solid #555;padding:5px;min-height:24px}.label{font-size:8px;text-transform:uppercase;color:#555}table{width:100%;border-collapse:collapse}td,th{border:1px solid #555;padding:4px;text-align:left}th{font-size:8px;text-transform:uppercase}
</style>
</head>
<body><div class="cms1500">
<h1>CMS-1500 Claim Data</h1>
<div class="field-grid">
<div class="field"><div class="label">Patient</div>${escapeHtml(item.claim.clientName)}</div>
<div class="field"><div class="label">Payer</div>${escapeHtml(item.claim.payerName)}</div>
<div class="field"><div class="label">Rendering Provider</div>${escapeHtml(item.claim.providerName)}</div>
<div class="field"><div class="label">Patient Control Number</div>${escapeHtml(item.claim.patient_control_number)}</div>
<div class="field"><div class="label">Diagnosis Codes</div>${diagnoses || "—"}</div>
<div class="field"><div class="label">Total Charge</div>${formatAmount(item.claim.total_charge_cents)}</div>
</div>
<table><thead><tr><th>DOS</th><th>CPT / HCPCS</th><th>POS</th><th>Dx Ptr</th><th>Units</th><th>Charge</th></tr></thead><tbody>${lines}</tbody></table>
</div></body></html>`;
}

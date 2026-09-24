type RecordRow = Record<string, unknown> & { id?: string };
export type SuperbillData = {
  encounter: RecordRow;
  client: RecordRow;
  provider: RecordRow | null;
  practice: RecordRow | null;
  location: RecordRow | null;
  tenant: RecordRow | null;
  diagnoses: RecordRow[];
  charges: RecordRow[];
};

function text(value: unknown): string { return String(value ?? "").trim(); }
function safe(value: unknown): string {
  return text(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function person(row: RecordRow | null): string {
  return row ? [row.first_name, row.last_name].map(text).filter(Boolean).join(" ") : "";
}
function date(value: unknown): string {
  const valueText = text(value).slice(0, 10);
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(valueText);
  return match ? match[2] + "/" + match[3] + "/" + match[1] : valueText || "Not recorded";
}
function amount(value: unknown): string {
  const cents = Number(value ?? 0);
  return Number.isFinite(cents) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100) : "—";
}
function address(row: RecordRow | null): string {
  if (!row) return "";
  return [
    text(row.address_line1 ?? row.address_line_1),
    text(row.address_line2 ?? row.address_line_2),
    [row.city, row.state, row.postal_code ?? row.zip_code].map(text).filter(Boolean).join(", "),
  ].filter(Boolean).map(safe).join("<br>");
}
function field(label: string, value: string): string {
  return '<div class="field"><span>' + safe(label) + '</span><strong>' + (value || "Not recorded") + '</strong></div>';
}

export function buildSuperbillHtml(data: SuperbillData): string {
  if (!data.charges.length || data.charges.some((charge) =>
    charge.charge_status !== "patient_responsibility" || charge.billing_path !== "private_pay" ||
    String(charge.encounter_id ?? "") !== String(data.encounter.id ?? "") ||
    String(charge.client_id ?? "") !== String(data.client.id ?? ""),
  )) throw new Error("This superbill may only contain private-pay charges from one patient encounter.");
  const provider = data.provider;
  const practice = data.practice;
  const location = data.location;
  const practiceName = text(practice?.legal_name ?? practice?.dba_name ?? data.tenant?.name);
  const providerName = person(provider);
  const npi = text(provider?.individual_npi);
  const taxId = text(practice?.tax_id);
  const locationAddress = address(location);
  const diagnoses = data.diagnoses.map((row) => text(row.diagnosis_code)).filter(Boolean);
  // Charge-level diagnosis is an evidence-backed fallback, not an inferred diagnosis.
  if (!diagnoses.length) for (const charge of data.charges) {
    const code = text(charge.diagnosis_code);
    if (code && !diagnoses.includes(code)) diagnoses.push(code);
  }
  const warnings = [
    !practiceName && "Practice name",
    !taxId && "Practice tax ID",
    !locationAddress && "Practice address",
    !providerName && "Rendering provider name",
    !npi && "Rendering provider NPI",
    !text(data.client.date_of_birth) && "Patient date of birth",
    !diagnoses.length && "Encounter diagnosis",
    ...data.charges.flatMap((charge, i) => [
      !text(charge.cpt_code) && "Line " + (i + 1) + " procedure code",
      Number(charge.charge_amount_cents ?? 0) <= 0 && "Line " + (i + 1) + " charge amount",
    ]),
  ].filter(Boolean);
  const total = data.charges.reduce((sum, charge) => sum + Number(charge.charge_amount_cents ?? 0), 0);
  const lines = data.charges.map((charge) => (
    "<tr><td>" + safe(date(charge.service_date ?? data.encounter.started_at)) + "</td>" +
    "<td><strong>" + safe(charge.cpt_code) + "</strong></td>" +
    "<td>" + safe([charge.modifier1, charge.modifier2].map(text).filter(Boolean).join(", ") || "—") + "</td>" +
    "<td class=\"numeric\">" + safe(charge.units ?? 1) + "</td>" +
    "<td class=\"numeric\">" + safe(amount(charge.charge_amount_cents)) + "</td></tr>"
  )).join("");
  const diagnosisRows = diagnoses.length
    ? diagnoses.map((code, index) => "<span class=\"diagnosis\">" + (index + 1) + ". " + safe(code) + "</span>").join("")
    : '<span class="missing">No diagnosis recorded</span>';
  const warningBox = warnings.length
    ? '<section class="warnings"><strong>Review before sharing</strong><p>Missing or incomplete: ' + warnings.map(safe).join(", ") + '.</p></section>'
    : "";
  return [
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<title>Superbill — " + safe(person(data.client)) + "</title>",
    "<style>",
    "*,*::before,*::after{box-sizing:border-box}body{margin:0;background:#f3f5f1;color:#243c31;font:13px/1.5 Inter,Arial,sans-serif}",
    ".toolbar{position:sticky;top:0;background:#173927;color:#fff;padding:11px 24px;display:flex;justify-content:space-between;align-items:center;gap:15px}",
    ".toolbar button{background:#a4b6a6;color:#173927;border:0;border-radius:6px;padding:9px 16px;font:700 12px Inter,Arial;cursor:pointer}",
    ".page{max-width:820px;margin:24px auto;padding:35px 42px;background:#fff;box-shadow:0 5px 28px #1d3a2417}",
    "header{display:flex;justify-content:space-between;align-items:start;gap:22px;padding-bottom:19px;border-bottom:3px solid #a4b6a6}",
    "h1{font-size:25px;margin:0 0 5px;color:#173927;letter-spacing:-.04em}h2{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#587763;margin:0 0 12px}",
    ".muted{font-size:11px;color:#63766a}.practice{max-width:330px;text-align:right}.practice strong{display:block;font-size:15px;color:#173927}",
    ".grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px 25px}",
    ".field span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#63766a;margin-bottom:2px}",
    ".field strong{font-size:13px;font-weight:600;overflow-wrap:anywhere}.section{padding:22px 0;border-bottom:1px solid #e0e7df}",
    ".diagnoses{display:flex;gap:8px;flex-wrap:wrap}.diagnosis{padding:6px 10px;background:#eff4ee;border:1px solid #dce6df;border-radius:5px;font-weight:600}",
    "table{width:100%;border-collapse:collapse}th{text-align:left;font-size:10px;text-transform:uppercase;color:#587763;background:#eff4ee;padding:9px 10px}",
    "td{padding:11px 10px;border-bottom:1px solid #e0e7df;vertical-align:top}.numeric{text-align:right}",
    ".total{display:flex;justify-content:flex-end;align-items:baseline;gap:25px;margin-top:16px;font-weight:700;font-size:16px}",
    ".notes{margin-top:22px;padding:11px 13px;background:#f7f5ef;border-left:3px solid #a4b6a6;font-size:11px;color:#485c51}",
    ".warnings{margin:16px 0;padding:12px 14px;border:1px solid #eed8aa;background:#fff9ed;color:#715322;font-size:11px}",
    ".warnings p{margin:4px 0 0}.missing{color:#8e5636}",
    "@media(max-width:650px){.page{margin:0;padding:20px 16px}.grid{grid-template-columns:1fr}header{flex-direction:column}.practice{text-align:left}}",
    "@media print{body{background:#fff}.toolbar{display:none}.page{max-width:none;margin:0;padding:0;box-shadow:none}@page{size:letter;margin:.55in}.section{break-inside:avoid}.warnings{break-inside:avoid}}",
    "</style></head><body>",
    '<div class="toolbar"><span>Patient superbill · Print or save to PDF</span><button type="button" onclick="window.print()">Print / Save PDF</button></div>',
    '<main class="page"><header><div><h1>Superbill</h1><div class="muted">Private-pay service summary</div></div>',
    '<div class="practice"><strong>' + safe(practiceName || "Practice name missing") + '</strong>' + (locationAddress || "Practice address missing") + '</div></header>',
    warningBox,
    '<section class="section"><h2>Practice &amp; rendering provider</h2><div class="grid">',
    field("Provider", safe(providerName || "Not recorded") + (text(provider?.credentials) ? ", " + safe(provider?.credentials) : "")),
    field("Provider NPI", safe(npi)),
    field("Practice tax ID", safe(taxId)),
    field("Practice phone", safe(location?.phone)),
    '</div></section>',
    '<section class="section"><h2>Patient &amp; visit</h2><div class="grid">',
    field("Patient", safe(person(data.client))),
    field("Date of birth", safe(date(data.client.date_of_birth))),
    field("Patient address", address(data.client)),
    field("Encounter reference", safe(data.encounter.id)),
    '</div></section>',
    '<section class="section"><h2>Diagnosis codes</h2><div class="diagnoses">' + diagnosisRows + '</div></section>',
    '<section class="section"><h2>Services and charges</h2><table><thead><tr><th>Date of service</th><th>CPT / HCPCS</th><th>Modifier</th><th class="numeric">Units</th><th class="numeric">Amount</th></tr></thead><tbody>',
    lines,
    '</tbody></table><div class="total"><span>Total charges</span><span>' + safe(amount(total)) + '</span></div></section>',
    '<p class="notes">This document lists recorded private-pay services and charges for the indicated encounter. It is not an insurance claim or proof of payment. Payment amounts have not been verified against these charges; refer to the separate payment receipt or ledger before representing a paid amount.</p>',
    '</main></body></html>',
  ].join("");
}

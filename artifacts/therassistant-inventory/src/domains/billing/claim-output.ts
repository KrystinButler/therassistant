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
  charge_amount_cents?: number;
  units?: number;
  diagnosis_pointer?: string;
  service_date?: string;
};

type ClaimDiagnosisRow = Record<string, unknown> & {
  diagnosis_code?: string;
  pointer_order?: number;
};

export type ClaimOutputItem = {
  claim: ClaimOutputRow;
  lines: ClaimLineRow[];
  diagnoses: ClaimDiagnosisRow[];
};

export type BatchOutputData = {
  batch: Record<string, unknown> & { id?: string };
  claims: ClaimOutputItem[];
};

function clean(value: unknown) {
  return String(value ?? "").replace(/[~*:^]/g, " ").trim();
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function build837PText(input: BatchOutputData) {
  const rawControl = clean(input.batch.id).replace(/\D/g, "").slice(-9);
  const control = rawControl.padStart(9, "0") || "000000001";
  const segments: string[] = [
    `ISA*00*          *00*          *ZZ*THERASSISTANT   *ZZ*DEMO_PAYER      *260916*1200*^*00501*${control}*0*T*:~`,
    "GS*HC*THERASSISTANT*DEMO_PAYER*20260916*1200*1*X*005010X222A1~",
    "ST*837*0001*005010X222A1~",
    `BHT*0019*00*${control}*20260916*1200*CH~`,
  ];

  for (const [claimIndex, item] of input.claims.entries()) {
    const controlNumber = clean(item.claim.patient_control_number ?? item.claim.id);
    const total = (Number(item.claim.total_charge_cents ?? 0) / 100).toFixed(2);
    segments.push(`HL*${claimIndex + 1}**20*1~`);
    segments.push(`NM1*85*2*${clean(item.claim.providerName ?? "THERASSISTANT")}*****XX*DEMO~`);
    segments.push(`NM1*IL*1*${clean(item.claim.clientName ?? "PATIENT")}****MI*DEMO~`);
    segments.push(`CLM*${controlNumber}*${total}***11:B:1*Y*A*Y*Y~`);

    for (const [lineIndex, line] of item.lines.entries()) {
      const amount = (Number(line.charge_amount_cents ?? 0) / 100).toFixed(2);
      segments.push(`LX*${lineIndex + 1}~`);
      segments.push(
        `SV1*HC:${clean(line.cpt_code)}*${amount}*UN*${Number(line.units ?? 1)}***${clean(line.diagnosis_pointer ?? "1")}~`,
      );
    }
  }

  const transactionSegmentCount = segments.length - 2;
  segments.push(`SE*${transactionSegmentCount + 1}*0001~`);
  segments.push("GE*1*1~");
  segments.push(`IEA*1*${control}~`);
  return segments.join("\n");
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
      const charge = (Number(line.charge_amount_cents ?? 0) / 100).toFixed(2);
      return `<tr><td>${dos}</td><td>${escapeHtml(line.cpt_code)}</td><td>${escapeHtml(line.diagnosis_pointer ?? "1")}</td><td>${escapeHtml(line.units ?? 1)}</td><td>${charge}</td></tr>`;
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
<h1>CMS-1500</h1>
<div class="field-grid">
<div class="field"><div class="label">Patient</div>${escapeHtml(item.claim.clientName)}</div>
<div class="field"><div class="label">Payer</div>${escapeHtml(item.claim.payerName)}</div>
<div class="field"><div class="label">Rendering Provider</div>${escapeHtml(item.claim.providerName)}</div>
<div class="field"><div class="label">Patient Control Number</div>${escapeHtml(item.claim.patient_control_number)}</div>
<div class="field"><div class="label">Diagnosis Codes</div>${diagnoses || "—"}</div>
<div class="field"><div class="label">Total Charge</div>${(Number(item.claim.total_charge_cents ?? 0) / 100).toFixed(2)}</div>
</div>
<table><thead><tr><th>DOS</th><th>CPT / HCPCS</th><th>Dx Ptr</th><th>Units</th><th>Charge</th></tr></thead><tbody>${lines}</tbody></table>
</div></body></html>`;
}

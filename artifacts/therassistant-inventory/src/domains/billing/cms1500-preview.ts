import type { ClaimOutputItem, Edi837PConfig } from "./claim-output";

type Row = Record<string, unknown>;
type PreviewIssue = { box: string; message: string };

function text(value: unknown) {
  return String(value ?? "").trim();
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dollars(cents: unknown) {
  const amount = Number(cents);
  return Number.isFinite(amount) ? (amount / 100).toFixed(2) : "—";
}

function displayDate(value: unknown) {
  const source = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return source || "—";
  const [year, month, day] = source.split("-");
  return `${month}/${day}/${year}`;
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : {};
}

function metadata(row: Row | null | undefined) {
  return record(row?.metadata);
}

function personName(row: Row | null | undefined) {
  const last = text(row?.last_name);
  const first = text(row?.first_name);
  const middle = text(row?.middle_name);
  if (last && first) return `${last}, ${first}${middle ? ` ${middle}` : ""}`;
  return [first, middle, last].filter(Boolean).join(" ") || "—";
}

function address(row: Row | null | undefined) {
  const lines = [
    text(row?.address_line1),
    text(row?.address_line2),
    [text(row?.city), text(row?.state), text(row?.postal_code)].filter(Boolean).join(" "),
  ].filter(Boolean);
  return lines.length ? lines.map(escapeHtml).join("<br>") : "—";
}

function relationshipLabel(value: unknown) {
  const normalized = text(value).toLowerCase().replaceAll("_", " ");
  const labels: Record<string, string> = {
    self: "Self",
    spouse: "Spouse",
    child: "Child",
    "step child": "Stepchild",
    "foster child": "Foster child",
    ward: "Ward",
    employee: "Employee",
    "life partner": "Life partner",
    "significant other": "Significant other",
    mother: "Mother",
    father: "Father",
  };
  return labels[normalized] ?? (normalized ? normalized.replace(/\b\w/g, (char) => char.toUpperCase()) : "—");
}

function isSelfRelationship(value: unknown) {
  return text(value).toLowerCase() === "self";
}

function payerTypeFlags(item: ClaimOutputItem) {
  const source = `${text(item.payer?.payer_type)} ${text(item.payer?.name)}`.toLowerCase();
  const flag = (needles: string[]) => needles.some((needle) => source.includes(needle));
  return [
    ["Medicare", flag(["medicare"])],
    ["Medicaid", flag(["medicaid", "health first colorado"])],
    ["TRICARE", flag(["tricare", "champus"])],
    ["CHAMPVA", flag(["champva"])],
    ["Group Health", flag(["group health"])],
    ["FECA", flag(["feca", "workers compensation"])],
    ["Other", !flag(["medicare", "medicaid", "health first colorado", "tricare", "champus", "champva", "group health", "feca", "workers compensation"])],
  ] as const;
}

function issueMap(issues: PreviewIssue[]) {
  const map = new Map<string, string[]>();
  for (const issue of issues) {
    const current = map.get(issue.box) ?? [];
    current.push(issue.message);
    map.set(issue.box, current);
  }
  return map;
}

function box(
  boxNumber: string,
  label: string,
  value: unknown,
  issues: Map<string, string[]>,
  source?: string,
  className = "",
) {
  const messages = issues.get(boxNumber) ?? [];
  const classes = ["cms-box", className, messages.length ? "cms-warning" : ""].filter(Boolean).join(" ");
  const rendered = text(value) ? String(value) : "—";
  return `<div class="${classes}" data-cms-box="${escapeHtml(boxNumber)}"${source ? ` data-source="${escapeHtml(source)}"` : ""}>
    <div class="cms-box-label"><strong>${escapeHtml(boxNumber)}</strong> ${escapeHtml(label)}</div>
    <div class="cms-box-value">${rendered}</div>
    ${messages.map((message) => `<div class="cms-box-warning">⚠ ${escapeHtml(message)}</div>`).join("")}
  </div>`;
}

function validatePreview(item: ClaimOutputItem, edi: Edi837PConfig): PreviewIssue[] {
  const issues: PreviewIssue[] = [];
  const clientMeta = metadata(item.client);
  const relationship = item.policy?.relationship_to_subscriber;
  const subscriber = record(metadata(item.policy).subscriber);
  const providerNpi = text(item.provider?.individual_npi).replace(/\D/g, "");

  const requireBox = (boxNumber: string, value: unknown, message: string) => {
    if (!text(value)) issues.push({ box: boxNumber, message });
  };

  requireBox("1a", item.policy?.member_id, "Subscriber/member ID is missing.");
  requireBox("2", item.client?.first_name, "Patient first name is missing.");
  requireBox("2", item.client?.last_name, "Patient last name is missing.");
  requireBox("3", item.client?.date_of_birth, "Patient date of birth is missing.");
  if (!["M", "F"].includes(text(clientMeta.sex).toUpperCase())) {
    issues.push({ box: "3", message: "Patient sex is missing or invalid." });
  }
  requireBox("5", item.client?.address_line1, "Patient address is missing.");
  requireBox("5", item.client?.city, "Patient city is missing.");
  requireBox("5", item.client?.state, "Patient state is missing.");
  requireBox("5", item.client?.postal_code, "Patient ZIP code is missing.");

  if (!isSelfRelationship(relationship)) {
    requireBox("4", subscriber.first_name ?? item.policy?.subscriber_name, "Subscriber name is missing.");
    requireBox("7", subscriber.address_line1, "Subscriber address is missing.");
  }

  if (!item.diagnoses.length) issues.push({ box: "21", message: "At least one diagnosis is required." });
  if (item.diagnoses.length > 12) issues.push({ box: "21", message: "CMS-1500 supports up to 12 diagnosis pointers." });

  for (const [index, line] of item.lines.entries()) {
    const lineLabel = `Service line ${index + 1}`;
    requireBox("24A", line.service_date, `${lineLabel}: service date is missing.`);
    if (!/^\d{2}$/.test(text(line.place_of_service))) {
      issues.push({ box: "24B", message: `${lineLabel}: place of service must be a two-digit code.` });
    }
    requireBox("24D", line.cpt_code, `${lineLabel}: procedure code is missing.`);
    requireBox("24E", line.diagnosis_pointer, `${lineLabel}: diagnosis pointer is missing.`);
    if (Number(line.charge_amount_cents ?? 0) <= 0) {
      issues.push({ box: "24F", message: `${lineLabel}: charge amount must be greater than zero.` });
    }
    if (Number(line.units ?? 0) <= 0) {
      issues.push({ box: "24G", message: `${lineLabel}: units must be greater than zero.` });
    }
    if (providerNpi.length !== 10) {
      issues.push({ box: "24J", message: `${lineLabel}: rendering provider NPI must contain 10 digits.` });
    }
  }

  if (text(edi.billingProviderTaxId).replace(/\D/g, "").length !== 9) {
    issues.push({ box: "25", message: "Billing provider tax ID must contain 9 digits." });
  }
  requireBox("33", edi.billingProviderName, "Billing provider name is missing.");
  if (text(edi.billingProviderNpi).replace(/\D/g, "").length !== 10) {
    issues.push({ box: "33", message: "Billing provider NPI must contain 10 digits." });
  }

  return issues;
}

function chunks<T>(rows: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result.length ? result : [[]];
}

export function buildCms1500PreviewHtml(item: ClaimOutputItem, edi: Edi837PConfig) {
  const clientMeta = metadata(item.client);
  const claimMeta = metadata(item.claim);
  const policyMeta = metadata(item.policy);
  const subscriber = record(policyMeta.subscriber);
  const relationship = item.policy?.relationship_to_subscriber;
  const self = isSelfRelationship(relationship);
  const patientName = personName(item.client);
  const subscriberName = self
    ? patientName
    : [text(subscriber.last_name), text(subscriber.first_name)].filter(Boolean).join(", ")
      || text(item.policy?.subscriber_name)
      || "—";
  const subscriberAddress = self ? address(item.client) : address(subscriber);
  const subscriberDob = self ? item.client?.date_of_birth : (subscriber.dob ?? item.policy?.subscriber_dob);
  const subscriberSex = self ? clientMeta.sex : subscriber.sex;
  const providerNpi = text(item.provider?.individual_npi);
  const diagnoses = [...item.diagnoses]
    .sort((a, b) => Number(a.pointer_order ?? 0) - Number(b.pointer_order ?? 0));
  const diagnosisText = diagnoses
    .map((row, index) => `${String.fromCharCode(65 + index)}. ${escapeHtml(row.diagnosis_code)}`)
    .join(" &nbsp;&nbsp; ");
  const pages = chunks(item.lines, 6);
  const issues = validatePreview(item, edi);
  const issuesByBox = issueMap(issues);
  const flags = payerTypeFlags(item);
  const insuranceType = flags
    .map(([label, checked]) => `<span class="cms-check">${checked ? "☒" : "☐"} ${escapeHtml(label)}</span>`)
    .join("");
  const totalCharge = dollars(item.claim.total_charge_cents);
  const paid = item.claim.paid_amount_cents == null ? "—" : dollars(item.claim.paid_amount_cents);
  const controlNumber = text(item.claim.patient_control_number ?? item.claim.id);
  const billingAddress = [
    text(edi.addressLine1),
    text(edi.addressLine2),
    [text(edi.city), text(edi.state), text(edi.postalCode)].filter(Boolean).join(" "),
  ].filter(Boolean).map(escapeHtml).join("<br>") || "—";
  const serviceFacility = text(claimMeta.service_facility_name)
    ? escapeHtml(claimMeta.service_facility_name)
    : (item.lines[0]?.place_of_service ? `POS ${escapeHtml(item.lines[0].place_of_service)}` : "—");
  const serviceFacilityAddress = [
    text(claimMeta.service_facility_address_line1),
    text(claimMeta.service_facility_address_line2),
    [text(claimMeta.service_facility_city), text(claimMeta.service_facility_state), text(claimMeta.service_facility_postal_code)].filter(Boolean).join(" "),
  ].filter(Boolean).map(escapeHtml).join("<br>");
  const box32Value = [serviceFacility, serviceFacilityAddress].filter(Boolean).join("<br>");
  const referring = [text(claimMeta.referring_provider_last_name), text(claimMeta.referring_provider_first_name)].filter(Boolean).join(", ");
  const renderingName = personName(item.provider);
  const payerName = text(item.payer?.name) || "—";

  const issueSummary = issues.length
    ? `<div class="validation-panel"><strong>${issues.length} preview issue${issues.length === 1 ? "" : "s"} found</strong><div>Highlighted CMS-1500 fields need review before submission.</div></div>`
    : '<div class="validation-panel valid"><strong>Preview data complete</strong><div>No CMS-1500 preview fields are currently missing.</div></div>';

  const pageHtml = pages.map((pageLines, pageIndex) => {
    const warningCell = (boxNumber: string) => {
      const messages = issuesByBox.get(boxNumber) ?? [];
      return messages.length
        ? ` class="cms-warning-cell" title="${escapeHtml(messages.join(" "))}"`
        : "";
    };
    const serviceRows = Array.from({ length: 6 }, (_, rowIndex) => {
      const line = pageLines[rowIndex];
      const absoluteIndex = pageIndex * 6 + rowIndex;
      if (!line) {
        return '<tr class="service-empty"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
      }
      const modifiers = [line.modifier1, line.modifier2].map(text).filter(Boolean).join(" ");
      return `<tr>
        <td data-cms-box="24A"${warningCell("24A")}>${escapeHtml(displayDate(line.service_date ?? item.claim.service_date_from))}</td>
        <td data-cms-box="24B"${warningCell("24B")}>${escapeHtml(line.place_of_service ?? "")}</td>
        <td data-cms-box="24D"${warningCell("24D")}><strong>${escapeHtml(line.cpt_code ?? "")}</strong>${modifiers ? `<br><span class="small">${escapeHtml(modifiers)}</span>` : ""}</td>
        <td data-cms-box="24E"${warningCell("24E")}>${escapeHtml(line.diagnosis_pointer ?? "")}</td>
        <td data-cms-box="24F"${warningCell("24F")}>${escapeHtml(dollars(line.charge_amount_cents))}</td>
        <td data-cms-box="24G"${warningCell("24G")}>${escapeHtml(line.units ?? 1)}</td>
        <td data-cms-box="24J"${warningCell("24J")}>${escapeHtml(providerNpi || "—")}</td>
        <td>${absoluteIndex + 1}</td>
      </tr>`;
    }).join("");

    return `<section class="cms-page">
      <div class="page-meta">CMS-1500 Claim Preview (02/12) · Page ${pageIndex + 1} of ${pages.length}</div>
      <div class="preview-banner">CLAIM PREVIEW — NOT FOR PAPER SUBMISSION</div>
      ${pageIndex === 0 ? issueSummary : ""}
      <div class="cms-form">
        <div class="cms-row cms-grid-2">
          ${box("1", "Type of Health Insurance", insuranceType, issuesByBox, "Payer", "wide")}
          ${box("1a", "Insured's I.D. Number", escapeHtml(item.policy?.member_id ?? "—"), issuesByBox, "Insurance Policy")}
        </div>
        <div class="cms-row cms-grid-3">
          ${box("2", "Patient's Name", escapeHtml(patientName), issuesByBox, "Patient")}
          ${box("3", "Patient's Birth Date / Sex", `${escapeHtml(displayDate(item.client?.date_of_birth))} · ${escapeHtml(clientMeta.sex ?? "—")}`, issuesByBox, "Patient")}
          ${box("4", "Insured's Name", escapeHtml(subscriberName), issuesByBox, "Insurance Policy")}
        </div>
        <div class="cms-row cms-grid-3">
          ${box("5", "Patient's Address", address(item.client), issuesByBox, "Patient")}
          ${box("6", "Patient Relationship to Insured", escapeHtml(relationshipLabel(relationship)), issuesByBox, "Insurance Policy")}
          ${box("7", "Insured's Address", subscriberAddress, issuesByBox, "Insurance Policy")}
        </div>
        <div class="cms-row cms-grid-4">
          ${box("9", "Other Insured's Name", escapeHtml(claimMeta.other_insured_name ?? "—"), issuesByBox)}
          ${box("10", "Condition Related To", escapeHtml(claimMeta.condition_related_to ?? "—"), issuesByBox)}
          ${box("11", "Insured's Policy Group / FECA Number", escapeHtml(item.policy?.group_number ?? "—"), issuesByBox, "Insurance Policy")}
          ${box("11a", "Insured's DOB / Sex", `${escapeHtml(displayDate(subscriberDob))} · ${escapeHtml(subscriberSex ?? "—")}`, issuesByBox, "Insurance Policy")}
        </div>
        <div class="cms-row cms-grid-3">
          ${box("11c", "Insurance Plan / Program Name", escapeHtml(payerName), issuesByBox, "Payer")}
          ${box("12", "Patient or Authorized Person Signature", claimMeta.patient_signature_on_file === true ? "SIGNATURE ON FILE" : "Not recorded", issuesByBox)}
          ${box("13", "Insured or Authorized Person Signature", claimMeta.insured_signature_on_file === true ? "SIGNATURE ON FILE" : "Not recorded", issuesByBox)}
        </div>
        <div class="cms-row cms-grid-4">
          ${box("14", "Date of Current Illness / Injury / Pregnancy", escapeHtml(displayDate(claimMeta.onset_date)), issuesByBox)}
          ${box("15", "Other Date", escapeHtml(displayDate(claimMeta.other_date)), issuesByBox)}
          ${box("16", "Dates Patient Unable to Work", escapeHtml(claimMeta.unable_to_work_dates ?? "—"), issuesByBox)}
          ${box("17/17b", "Referring Provider / NPI", `${escapeHtml(referring || "—")}<br>${escapeHtml(claimMeta.referring_provider_npi ?? "")}`, issuesByBox)}
        </div>
        <div class="cms-row cms-grid-4">
          ${box("18", "Hospitalization Dates", escapeHtml(claimMeta.hospitalization_dates ?? "—"), issuesByBox)}
          ${box("19", "Additional Claim Information", escapeHtml(claimMeta.additional_claim_information ?? "—"), issuesByBox)}
          ${box("20", "Outside Lab", escapeHtml(claimMeta.outside_lab ?? "—"), issuesByBox)}
          ${box("23", "Prior Authorization Number", escapeHtml(claimMeta.prior_authorization_number ?? "—"), issuesByBox)}
        </div>
        <div class="cms-row cms-grid-2">
          ${box("21", "Diagnosis or Nature of Illness or Injury", diagnosisText || "—", issuesByBox, "Claim Diagnoses", "wide")}
          ${box("22", "Resubmission Code / Original Reference", `${escapeHtml(claimMeta.resubmission_code ?? "—")} / ${escapeHtml(claimMeta.original_reference_number ?? "—")}`, issuesByBox)}
        </div>

        <div class="service-title">24. Service Lines</div>
        <table class="service-table">
          <thead><tr>
            <th>24A<br>Date(s) of Service</th>
            <th>24B<br>POS</th>
            <th>24D<br>Procedures / Modifiers</th>
            <th>24E<br>Dx</th>
            <th>24F<br>$ Charges</th>
            <th>24G<br>Units</th>
            <th>24J<br>Rendering NPI</th>
            <th>Line</th>
          </tr></thead>
          <tbody>${serviceRows}</tbody>
        </table>

        <div class="cms-row cms-grid-3">
          ${box("25", "Federal Tax I.D. Number", escapeHtml(edi.billingProviderTaxId || "—"), issuesByBox, "Practice Configuration")}
          ${box("26", "Patient's Account Number", escapeHtml(controlNumber || "—"), issuesByBox, "Claim")}
          ${box("27", "Accept Assignment?", claimMeta.accept_assignment === true ? "YES" : claimMeta.accept_assignment === false ? "NO" : "—", issuesByBox)}
        </div>
        <div class="cms-row cms-grid-3">
          ${box("28", "Total Charge", `$${escapeHtml(totalCharge)}`, issuesByBox, "Claim")}
          ${box("29", "Amount Paid", paid === "—" ? "—" : `$${escapeHtml(paid)}`, issuesByBox, "Claim Ledger")}
          ${box("30", "Reserved for NUCC Use", "—", issuesByBox)}
        </div>
        <div class="cms-row cms-grid-3 footer-grid">
          ${box("31", "Rendering Provider", `${escapeHtml(renderingName)}<br>NPI ${escapeHtml(providerNpi || "—")}`, issuesByBox, "Provider 360")}
          ${box("32", "Service Facility Location", box32Value, issuesByBox, "Encounter / Claim")}
          ${box("33", "Billing Provider Info", `${escapeHtml(edi.billingProviderName || "—")}<br>${billingAddress}<br><strong>33a NPI:</strong> ${escapeHtml(edi.billingProviderNpi || "—")}`, issuesByBox, "Practice Configuration")}
        </div>
      </div>
    </section>`;
  }).join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>CMS-1500 Preview · ${escapeHtml(controlNumber || "Claim")}</title>
<style>
@page { size: Letter portrait; margin: 0.25in; }
* { box-sizing: border-box; }
body { margin: 0; background: #eceff1; color: #18202a; font-family: Arial, Helvetica, sans-serif; }
.cms-page { width: 8in; min-height: 10.35in; margin: 20px auto; background: #fff; padding: 0.14in; box-shadow: 0 2px 16px rgba(0,0,0,.12); break-after: page; }
.cms-page:last-child { break-after: auto; }
.page-meta { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 5px; color: #4b5563; }
.preview-banner { border: 2px solid #1f2937; padding: 6px 8px; text-align: center; font-weight: 800; letter-spacing: .08em; margin-bottom: 6px; }
.validation-panel { border: 1px solid #b45309; background: #fffbeb; padding: 7px 9px; margin-bottom: 6px; font-size: 10px; }
.validation-panel.valid { border-color: #4b5563; background: #f8fafc; }
.cms-form { border: 2px solid #6b2737; }
.cms-row { display: grid; border-bottom: 1px solid #6b2737; }
.cms-row:last-child { border-bottom: 0; }
.cms-grid-2 { grid-template-columns: 2fr 1fr; }
.cms-grid-3 { grid-template-columns: repeat(3, 1fr); }
.cms-grid-4 { grid-template-columns: repeat(4, 1fr); }
.cms-box { min-height: 52px; padding: 4px 5px; border-right: 1px solid #6b2737; overflow-wrap: anywhere; }
.cms-box:last-child { border-right: 0; }
.cms-box.wide { min-width: 0; }
.cms-box-label { font-size: 7.5px; text-transform: uppercase; letter-spacing: .02em; color: #6b2737; margin-bottom: 4px; }
.cms-box-value { font-size: 10px; line-height: 1.25; min-height: 15px; }
.cms-warning { background: #fff7ed; box-shadow: inset 0 0 0 2px #c2410c; }
.cms-box-warning { margin-top: 3px; color: #9a3412; font-size: 7.5px; font-weight: 700; }
.cms-check { display: inline-block; margin-right: 9px; margin-bottom: 2px; font-size: 9px; }
.service-title { padding: 4px 5px; color: #6b2737; font-size: 8px; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #6b2737; }
.service-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.service-table th, .service-table td { border-right: 1px solid #6b2737; border-bottom: 1px solid #6b2737; padding: 3px; vertical-align: top; text-align: left; }
.service-table th:last-child, .service-table td:last-child { border-right: 0; }
.service-table th { color: #6b2737; font-size: 7px; text-transform: uppercase; height: 30px; }
.service-table td { height: 34px; font-size: 9px; }
.service-table td.cms-warning-cell { background: #fff7ed; box-shadow: inset 0 0 0 2px #c2410c; }
.service-empty td { color: transparent; }
.small { font-size: 7.5px; color: #4b5563; }
.footer-grid .cms-box { min-height: 70px; }
@media print {
  body { background: #fff; }
  .cms-page { margin: 0; box-shadow: none; width: 8in; min-height: 10.35in; }
}
</style>
</head>
<body>${pageHtml}</body>
</html>`;
}

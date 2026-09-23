import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "../../components/status-badge";
import { dateTime } from "../../lib/format";
import {
  referenceSelect,
  tenantInsert,
  tenantRpc,
  tenantSelect,
  tenantUpdate,
  type Row,
} from "../../lib/tenant-data-client";

type DataRow = Row & { id: string };
type ImportType = "patients" | "historical_transactions";

type ImportBatch = DataRow & {
  import_name?: string | null;
  import_status?: string | null;
  import_type?: ImportType | null;
  source_system?: string | null;
  source_file_hash?: string | null;
  mapping_profile?: Record<string, unknown> | null;
  reconciliation?: Record<string, unknown> | null;
  rollback_status?: string | null;
  created_at?: string | null;
};

type ImportRow = DataRow & {
  import_batch_id?: string | null;
  row_number?: number | null;
  raw_data?: Record<string, unknown> | null;
  mapped_data?: Record<string, unknown> | null;
  row_status?: string | null;
  source_key?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  attempt_count?: number | null;
  error_message?: string | null;
  rollback_status?: string | null;
  rollback_error?: string | null;
};

type ImportError = DataRow & {
  import_batch_id?: string | null;
  import_row_id?: string | null;
  severity?: string | null;
  field_name?: string | null;
  message?: string | null;
};

type Payer = DataRow & { name?: string | null };

const PATIENT_TEMPLATE_HEADERS = [
  "source_key",
  "first_name",
  "last_name",
  "preferred_name",
  "date_of_birth",
  "sex",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "postal_code",
  "phone",
  "email",
  "billing_type",
  "primary_payer",
  "primary_member_id",
  "primary_group_number",
  "relationship_to_subscriber",
  "subscriber_first_name",
  "subscriber_last_name",
  "subscriber_dob",
  "subscriber_sex",
  "subscriber_address_line1",
  "subscriber_city",
  "subscriber_state",
  "subscriber_postal_code",
] as const;

const PATIENT_REQUIRED = [
  "first_name",
  "last_name",
  "date_of_birth",
  "sex",
  "address_line1",
  "city",
  "state",
  "postal_code",
  "phone",
  "email",
  "billing_type",
] as const;

const HISTORICAL_TEMPLATE_HEADERS = [
  "source_key",
  "client_source_key",
  "client_id",
  "transaction_type",
  "transaction_date",
  "amount",
  "payer",
  "description",
] as const;

const HISTORICAL_TYPES = new Set([
  "payment",
  "adjustment",
  "opening_balance",
  "credit",
  "refund",
  "transfer",
  "correction",
]);

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field.trim());
      field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }

  row.push(field.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function recordFromCsv(headers: string[], values: string[]) {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = values[index]?.trim() ?? "";
  });
  return record;
}

function personKey(firstName: string, lastName: string, dob: string) {
  return [firstName.trim().toLowerCase(), lastName.trim().toLowerCase(), dob.trim()].join("|");
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function sha256(value: string | ArrayBuffer) {
  const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredIssue(raw: Record<string, string>, field: string) {
  return !String(raw[field] ?? "").trim()
    ? { field, message: `${field.replaceAll("_", " ")} is required.` }
    : null;
}

export function ImportsPage() {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [clients, setClients] = useState<DataRow[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [sourceSystem, setSourceSystem] = useState("Legacy EHR");
  const [importType, setImportType] = useState<ImportType>("patients");
  const [loading, setLoading] = useState(true);
  const [staging, setStaging] = useState(false);
  const [working, setWorking] = useState<"import" | "reconcile" | "rollback" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [batchRows, importRows, validationRows, payerRows, clientRows] = await Promise.all([
        tenantSelect<ImportBatch>("import_batches", { order: "created_at.desc" }),
        tenantSelect<ImportRow>("import_rows", { order: "created_at.asc" }),
        tenantSelect<ImportError>("import_validation_errors", { order: "created_at.asc" }),
        referenceSelect<Payer>("payers", { order: "name.asc" }),
        tenantSelect<DataRow>("clients", { deleted_at: "is.null" }),
      ]);
      setBatches(batchRows);
      setRows(importRows);
      setErrors(validationRows);
      setPayers(payerRows);
      setClients(clientRows);
      if (!selectedBatchId && batchRows[0]) setSelectedBatchId(batchRows[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load import workspace.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selectedBatch = batches.find((batch) => batch.id === selectedBatchId) ?? null;
  const selectedRows = rows
    .filter((row) => row.import_batch_id === selectedBatchId)
    .sort((a, b) => Number(a.row_number ?? 0) - Number(b.row_number ?? 0));
  const selectedErrors = errors.filter((row) => row.import_batch_id === selectedBatchId);
  const retryableRows = selectedRows.filter((row) => ["valid", "failed"].includes(String(row.row_status ?? "")));

  const payerByName = useMemo(() => {
    const map = new Map<string, Payer>();
    for (const payer of payers) {
      const name = String(payer.name ?? "").trim().toLowerCase();
      if (name) map.set(name, payer);
    }
    return map;
  }, [payers]);

  const existingPatientKeys = useMemo(
    () => new Set(clients.map((client) => personKey(
      String(client.first_name ?? ""),
      String(client.last_name ?? ""),
      String(client.date_of_birth ?? ""),
    ))),
    [clients],
  );

  const clientByLegacyKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of clients) {
      const key = String(recordOf(client.metadata).legacy_source_key ?? "").trim();
      if (key) map.set(key, client.id);
    }
    return map;
  }, [clients]);

  function downloadTemplate() {
    const headers = importType === "patients" ? PATIENT_TEMPLATE_HEADERS : HISTORICAL_TEMPLATE_HEADERS;
    const example = importType === "patients"
      ? [
          "PT-1001", "Jane", "Doe", "Jane", "1990-01-15", "F",
          "123 Main St", "", "Denver", "CO", "80202", "3035551212",
          "jane@example.com", "self_pay", "", "", "", "", "", "", "", "", "", "", "", "",
        ]
      : [
          "TX-1001", "PT-1001", "", "opening_balance", "2026-01-01", "125.00", "", "Legacy opening balance",
        ];
    const csv = [headers.join(","), example.map(csvEscape).join(",")].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = importType === "patients"
      ? "therassistant-patient-import-template.csv"
      : "therassistant-historical-transactions-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function addValidationIssue(batchId: string, rowId: string, field: string | null, issue: string) {
    await tenantInsert<ImportError>("import_validation_errors", {
      import_batch_id: batchId,
      import_row_id: rowId,
      severity: "error",
      field_name: field,
      message: issue,
    });
  }

  async function stagePatientRows(
    batch: ImportBatch,
    headers: string[],
    parsed: string[][],
  ) {
    const missingHeaders = PATIENT_REQUIRED.filter((header) => !headers.includes(header));
    if (missingHeaders.length) {
      throw new Error(`Missing required patient CSV columns: ${missingHeaders.join(", ")}.`);
    }

    const withinFile = new Set<string>();
    let validCount = 0;
    let errorCount = 0;

    for (let index = 1; index < parsed.length; index += 1) {
      const raw = recordFromCsv(headers, parsed[index]);
      const issues: Array<{ field: string | null; message: string }> = [];
      for (const field of PATIENT_REQUIRED) {
        const issue = requiredIssue(raw, field);
        if (issue) issues.push(issue);
      }

      const billingType = (raw.billing_type ?? "").trim().toLowerCase();
      const first = raw.first_name ?? "";
      const last = raw.last_name ?? "";
      const dob = raw.date_of_birth ?? "";
      const sex = (raw.sex ?? "").toUpperCase();
      const payerName = raw.primary_payer ?? "";
      const payer = payerByName.get(payerName.trim().toLowerCase()) ?? null;
      const relationship = (raw.relationship_to_subscriber ?? "").trim().toLowerCase();

      if (!["insurance", "self_pay"].includes(billingType)) {
        issues.push({ field: "billing_type", message: "Billing type must be insurance or self_pay." });
      }
      if (dob && !validDate(dob)) issues.push({ field: "date_of_birth", message: "Date of birth must use YYYY-MM-DD." });
      if (sex && !["M", "F"].includes(sex)) issues.push({ field: "sex", message: "Sex must be M or F." });
      if (raw.state && raw.state.length !== 2) issues.push({ field: "state", message: "State must be a two-letter code." });
      if (raw.postal_code && !/^\d{5}(-?\d{4})?$/.test(raw.postal_code)) {
        issues.push({ field: "postal_code", message: "ZIP code must be 5 or 9 digits." });
      }

      if (billingType === "insurance") {
        for (const field of ["primary_payer", "primary_member_id", "relationship_to_subscriber"]) {
          const issue = requiredIssue(raw, field);
          if (issue) issues.push(issue);
        }
        if (payerName && !payer) {
          issues.push({ field: "primary_payer", message: `Payer "${payerName}" was not found in Therassistant.` });
        }
        if (relationship && !["self", "spouse", "child", "parent", "other"].includes(relationship)) {
          issues.push({ field: "relationship_to_subscriber", message: "Relationship must be self, spouse, child, parent, or other." });
        }
        if (relationship && relationship !== "self") {
          for (const field of [
            "subscriber_first_name", "subscriber_last_name", "subscriber_dob", "subscriber_sex",
            "subscriber_address_line1", "subscriber_city", "subscriber_state", "subscriber_postal_code",
          ]) {
            const issue = requiredIssue(raw, field);
            if (issue) issues.push(issue);
          }
        }
      }

      const key = personKey(first, last, dob);
      if (first && last && dob && existingPatientKeys.has(key)) {
        issues.push({ field: null, message: "Possible duplicate: a patient with the same name and DOB already exists." });
      }
      if (first && last && dob && withinFile.has(key)) {
        issues.push({ field: null, message: "Duplicate patient appears more than once in this CSV." });
      }
      if (first && last && dob) withinFile.add(key);

      const self = relationship === "self";
      const mapped = {
        source_key: raw.source_key || null,
        first_name: first,
        last_name: last,
        preferred_name: raw.preferred_name ?? "",
        date_of_birth: dob,
        sex,
        address_line1: raw.address_line1 ?? "",
        address_line2: raw.address_line2 ?? "",
        city: raw.city ?? "",
        state: (raw.state ?? "").toUpperCase(),
        postal_code: raw.postal_code ?? "",
        phone: raw.phone ?? "",
        email: raw.email ?? "",
        billing_type: billingType,
        primary_payer: payerName,
        primary_payer_id: billingType === "insurance" ? payer?.id ?? "" : "",
        primary_member_id: billingType === "insurance" ? raw.primary_member_id ?? "" : "",
        primary_group_number: billingType === "insurance" ? raw.primary_group_number ?? "" : "",
        relationship_to_subscriber: billingType === "insurance" ? relationship : "",
        subscriber_first_name: billingType === "insurance" ? raw.subscriber_first_name || (self ? first : "") : "",
        subscriber_last_name: billingType === "insurance" ? raw.subscriber_last_name || (self ? last : "") : "",
        subscriber_dob: billingType === "insurance" ? raw.subscriber_dob || (self ? dob : "") : "",
        subscriber_sex: billingType === "insurance" ? raw.subscriber_sex || (self ? sex : "") : "",
        subscriber_address_line1: billingType === "insurance" ? raw.subscriber_address_line1 || (self ? raw.address_line1 : "") : "",
        subscriber_city: billingType === "insurance" ? raw.subscriber_city || (self ? raw.city : "") : "",
        subscriber_state: billingType === "insurance" ? raw.subscriber_state || (self ? raw.state : "") : "",
        subscriber_postal_code: billingType === "insurance" ? raw.subscriber_postal_code || (self ? raw.postal_code : "") : "",
      };
      const fingerprint = await sha256(JSON.stringify(mapped));

      const importRow = await tenantInsert<ImportRow>("import_rows", {
        import_batch_id: batch.id,
        row_number: index,
        source_key: raw.source_key || null,
        row_fingerprint: fingerprint,
        raw_data: raw,
        mapped_data: mapped,
        row_status: issues.length ? "error" : "valid",
      });

      for (const issue of issues) {
        await addValidationIssue(batch.id, importRow.id, issue.field, issue.message);
      }

      if (issues.length) errorCount += 1;
      else validCount += 1;
    }
    return { validCount, errorCount };
  }

  async function stageHistoricalRows(
    batch: ImportBatch,
    headers: string[],
    parsed: string[][],
  ) {
    for (const required of ["source_key", "transaction_type", "transaction_date", "amount"]) {
      if (!headers.includes(required)) throw new Error(`Missing required historical transaction column: ${required}.`);
    }
    if (!headers.includes("client_source_key") && !headers.includes("client_id")) {
      throw new Error("Historical transactions require client_source_key or client_id.");
    }

    let validCount = 0;
    let errorCount = 0;
    for (let index = 1; index < parsed.length; index += 1) {
      const raw = recordFromCsv(headers, parsed[index]);
      const issues: Array<{ field: string | null; message: string }> = [];
      for (const field of ["source_key", "transaction_type", "transaction_date", "amount"]) {
        const issue = requiredIssue(raw, field);
        if (issue) issues.push(issue);
      }

      const transactionType = (raw.transaction_type ?? "").trim().toLowerCase();
      const amount = Number(raw.amount);
      const payerName = (raw.payer ?? "").trim();
      const payer = payerName ? payerByName.get(payerName.toLowerCase()) ?? null : null;
      const mappedClientId = raw.client_id || clientByLegacyKey.get(raw.client_source_key ?? "") || "";

      if (transactionType && !HISTORICAL_TYPES.has(transactionType)) {
        issues.push({ field: "transaction_type", message: "Unsupported historical transaction type." });
      }
      if (raw.transaction_date && !validDate(raw.transaction_date)) {
        issues.push({ field: "transaction_date", message: "Transaction date must use YYYY-MM-DD." });
      }
      if (!Number.isFinite(amount)) {
        issues.push({ field: "amount", message: "Amount must be numeric." });
      }
      if (!raw.client_source_key && !raw.client_id) {
        issues.push({ field: "client_source_key", message: "A patient mapping is required." });
      }
      if (payerName && !payer) {
        issues.push({ field: "payer", message: `Payer "${payerName}" was not found in Therassistant.` });
      }

      const mapped = {
        source_key: raw.source_key,
        client_source_key: raw.client_source_key || null,
        client_id: mappedClientId || null,
        transaction_type: transactionType,
        transaction_date: raw.transaction_date,
        amount_cents: Number.isFinite(amount) ? Math.round(amount * 100) : null,
        payer_id: payer?.id ?? null,
        description: raw.description || null,
      };
      const fingerprint = await sha256(JSON.stringify(mapped));

      const importRow = await tenantInsert<ImportRow>("import_rows", {
        import_batch_id: batch.id,
        row_number: index,
        source_key: raw.source_key,
        row_fingerprint: fingerprint,
        raw_data: raw,
        mapped_data: mapped,
        row_status: issues.length ? "error" : "valid",
      });

      for (const issue of issues) {
        await addValidationIssue(batch.id, importRow.id, issue.field, issue.message);
      }
      if (issues.length) errorCount += 1;
      else validCount += 1;
    }
    return { validCount, errorCount };
  }

  async function stageFile(file: File) {
    setStaging(true);
    setError(null);
    setMessage(null);

    try {
      if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Upload a CSV file.");
      const buffer = await file.arrayBuffer();
      const text = new TextDecoder().decode(buffer);
      const parsed = parseCsv(text);
      if (parsed.length < 2) throw new Error("The CSV must include a header row and at least one data row.");

      const originalHeaders = parsed[0].map((header) => header.trim());
      const headers = originalHeaders.map(normalizeHeader);
      const fileHash = await sha256(buffer);
      const mappingProfile = Object.fromEntries(originalHeaders.map((header, index) => [header, headers[index]]));

      let batch: ImportBatch;
      try {
        batch = await tenantInsert<ImportBatch>("import_batches", {
          import_name: file.name,
          import_status: "validating",
          import_type: importType,
          source_system: sourceSystem.trim() || "CSV",
          source_file_hash: fileHash,
          mapping_profile: mappingProfile,
        });
      } catch (err) {
        const messageText = err instanceof Error ? err.message : "";
        if (messageText.includes("import_batches_active_source_hash_uq")) {
          throw new Error("This source file has already been staged for this import type. Resume the existing batch instead of importing it again.");
        }
        throw err;
      }

      const result = importType === "patients"
        ? await stagePatientRows(batch, headers, parsed)
        : await stageHistoricalRows(batch, headers, parsed);

      await tenantUpdate<ImportBatch>("import_batches", batch.id, {
        import_status: result.errorCount ? "needs_review" : "ready",
      });

      setSelectedBatchId(batch.id);
      setMessage(`Staged ${result.validCount + result.errorCount} row(s): ${result.validCount} valid, ${result.errorCount} requiring review. No production records were created during staging.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to stage CSV.");
    } finally {
      setStaging(false);
    }
  }

  async function commitRows() {
    if (!selectedBatch || retryableRows.length === 0) return;
    setWorking("import");
    setError(null);
    setMessage(null);
    let imported = 0;
    let duplicate = 0;
    let failed = 0;

    try {
      const rpc = selectedBatch.import_type === "historical_transactions"
        ? "commit_historical_import_row"
        : "commit_patient_import_row";

      for (const row of retryableRows) {
        const result = await tenantRpc<Record<string, unknown>>(rpc, { p_import_row_id: row.id });
        const status = String(result.status ?? "");
        if (status === "imported") imported += 1;
        else if (status === "duplicate") duplicate += 1;
        else failed += 1;
      }
      setMessage(`Import pass complete: ${imported} imported, ${duplicate} duplicate, ${failed} failed. Completed rows are idempotent and will not be created twice on retry.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to import staged rows.");
    } finally {
      setWorking(null);
    }
  }

  async function reconcile() {
    if (!selectedBatch) return;
    setWorking("reconcile");
    setError(null);
    try {
      const result = await tenantRpc<Record<string, unknown>>("reconcile_import_batch", {
        p_batch_id: selectedBatch.id,
      });
      setMessage(`Reconciliation refreshed: ${JSON.stringify(result)}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reconcile import.");
    } finally {
      setWorking(null);
    }
  }

  async function rollback() {
    if (!selectedBatch) return;
    if (!window.confirm("Rollback records created by this import batch? Records with downstream dependencies will be preserved and reported as blocked.")) return;

    setWorking("rollback");
    setError(null);
    try {
      const result = await tenantRpc<Record<string, unknown>>("rollback_import_batch", {
        p_batch_id: selectedBatch.id,
      });
      setMessage(`Rollback result: ${JSON.stringify(result)}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to rollback import.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">DATA MIGRATION · CONTROLLED CUTOVER</div>
          <h1>Imports & Migration</h1>
          <p>Stage, validate, deduplicate, import, reconcile, resume, and rollback practice data without maintaining a parallel tracker.</p>
        </div>
        <button type="button" className="thera-action secondary" onClick={downloadTemplate}>Download Template</button>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}

      <section className="thera-card" style={{ marginBottom: 16 }}>
        <div className="thera-card-header">
          <div>
            <h2>Stage source data</h2>
            <p>A SHA-256 file fingerprint prevents accidental duplicate imports. Header mappings and every source row remain attached to the batch.</p>
          </div>
        </div>
        <div className="thera-form-grid">
          <label className="thera-field">
            <span className="thera-field-label">Import Type</span>
            <select className="thera-input" value={importType} onChange={(event) => setImportType(event.target.value as ImportType)}>
              <option value="patients">Patients</option>
              <option value="historical_transactions">Historical Transactions</option>
            </select>
          </label>
          <label className="thera-field">
            <span className="thera-field-label">Source System</span>
            <input className="thera-input" value={sourceSystem} onChange={(event) => setSourceSystem(event.target.value)} placeholder="Legacy EHR, billing system..." />
          </label>
          <label className="thera-field">
            <span className="thera-field-label">CSV File</span>
            <input
              className="thera-input"
              type="file"
              accept=".csv,text/csv"
              disabled={staging}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void stageFile(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        <div className="thera-table-subtext" style={{ marginTop: 10 }}>
          Patient imports support <strong>insurance</strong> and <strong>self_pay</strong>. Historical transactions map to imported patients by source key and preserve opening balances, payments, adjustments, credits, refunds, transfers, and corrections.
        </div>
        {staging && <div className="thera-state">Hashing, validating, and staging source rows...</div>}
      </section>

      <div className="thera-detail-grid">
        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Import Batches</h2><p>{batches.length} batch{batches.length === 1 ? "" : "es"}</p></div></div>
          {loading ? <div className="thera-state">Loading imports...</div> : batches.length === 0 ? (
            <div className="thera-empty">No imports have been staged.</div>
          ) : (
            <div className="thera-stack">
              {batches.map((batch) => {
                const batchRows = rows.filter((row) => row.import_batch_id === batch.id);
                return (
                  <button
                    type="button"
                    key={batch.id}
                    className={selectedBatchId === batch.id ? "thera-work-card active" : "thera-work-card"}
                    style={{ textAlign: "left", width: "100%" }}
                    onClick={() => setSelectedBatchId(batch.id)}
                  >
                    <div className="thera-work-card-top">
                      <strong>{String(batch.import_name ?? "Import")}</strong>
                      <StatusBadge value={String(batch.import_status ?? "unknown")} />
                    </div>
                    <div>{String(batch.import_type ?? "patients").replaceAll("_", " ")} · {String(batch.source_system ?? "CSV")} · {batchRows.length} rows</div>
                    <div className="thera-table-subtext">{batch.created_at ? dateTime(String(batch.created_at)) : "—"}</div>
                    {batch.rollback_status && batch.rollback_status !== "not_requested" && <div className="thera-table-subtext">Rollback: {batch.rollback_status}</div>}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="thera-card">
          <div className="thera-card-header split">
            <div>
              <h2>{selectedBatch ? String(selectedBatch.import_name ?? "Selected Batch") : "Batch Review"}</h2>
              <p>{selectedBatch ? "Review source mappings and row outcomes before cutover." : "Select an import batch."}</p>
            </div>
          </div>

          {selectedBatch && (
            <>
              <div className="thera-metric-grid" style={{ marginBottom: 14 }}>
                <Metric label="Rows" value={selectedRows.length} />
                <Metric label="Ready / Retry" value={retryableRows.length} />
                <Metric label="Imported" value={selectedRows.filter((row) => row.row_status === "imported").length} />
                <Metric label="Duplicates" value={selectedRows.filter((row) => row.row_status === "duplicate").length} />
                <Metric label="Errors" value={selectedRows.filter((row) => ["error", "failed"].includes(String(row.row_status ?? ""))).length} />
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                <button type="button" className="thera-action" disabled={working !== null || retryableRows.length === 0} onClick={() => void commitRows()}>
                  {working === "import" ? "Importing..." : `Import / Resume (${retryableRows.length})`}
                </button>
                <button type="button" className="thera-action secondary" disabled={working !== null} onClick={() => void reconcile()}>
                  {working === "reconcile" ? "Reconciling..." : "Reconcile"}
                </button>
                <button type="button" className="thera-action secondary" disabled={working !== null || selectedBatch.rollback_status === "rolled_back"} onClick={() => void rollback()}>
                  {working === "rollback" ? "Rolling back..." : "Rollback Batch"}
                </button>
              </div>

              <div className="thera-alert" style={{ marginBottom: 14 }}>
                <strong>Source fingerprint:</strong> {String(selectedBatch.source_file_hash ?? "not recorded").slice(0, 24)}
                <br />
                <strong>Reconciliation:</strong> {JSON.stringify(selectedBatch.reconciliation ?? {})}
              </div>

              <div className="thera-table-wrap">
                <table className="thera-table">
                  <thead>
                    <tr>
                      <th>Row</th><th>Source Key</th><th>Status</th><th>Target</th><th>Attempts</th><th>Issue</th><th>Rollback</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRows.map((row) => (
                      <tr key={row.id}>
                        <td>{String(row.row_number ?? "—")}</td>
                        <td>{String(row.source_key ?? "—")}</td>
                        <td><StatusBadge value={String(row.row_status ?? "pending")} /></td>
                        <td>{row.target_id ? `${String(row.target_type ?? "record")}: ${row.target_id.slice(0, 8)}…` : "—"}</td>
                        <td>{String(row.attempt_count ?? 0)}</td>
                        <td>{String(row.error_message ?? selectedErrors.find((issue) => issue.import_row_id === row.id)?.message ?? "—")}</td>
                        <td>{String(row.rollback_error ?? row.rollback_status ?? "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <details style={{ marginTop: 14 }}>
                <summary>Saved source mapping</summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(selectedBatch.mapping_profile ?? {}, null, 2)}</pre>
              </details>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="thera-metric-card">
      <div className="thera-metric-label">{label}</div>
      <div className="thera-metric-value small">{value}</div>
    </div>
  );
}

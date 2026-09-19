import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "../../components/status-badge";
import { dateTime } from "../../lib/format";
import {
  getCurrentTenantId,
  referenceSelect,
  tenantInsert,
  tenantRpc,
  tenantSelect,
  tenantUpdate,
  type Row,
} from "../../lib/tenant-data-client";

type DataRow = Row & { id: string };

type ImportBatch = DataRow & {
  import_name?: string | null;
  import_status?: string | null;
  source_system?: string | null;
  created_at?: string | null;
};

type ImportRow = DataRow & {
  import_batch_id?: string | null;
  row_number?: number | null;
  raw_data?: Record<string, unknown> | null;
  mapped_data?: Record<string, unknown> | null;
  row_status?: string | null;
};

type ImportError = DataRow & {
  import_batch_id?: string | null;
  import_row_id?: string | null;
  severity?: string | null;
  field_name?: string | null;
  message?: string | null;
};

type Payer = DataRow & { name?: string | null };

type StagedPatient = {
  first_name: string;
  last_name: string;
  preferred_name: string;
  date_of_birth: string;
  sex: string;
  address_line1: string;
  phone: string;
  email: string;
  primary_payer: string;
  primary_payer_id: string;
  primary_member_id: string;
  primary_group_number: string;
  relationship_to_subscriber: string;
  subscriber_first_name: string;
  subscriber_last_name: string;
  subscriber_dob: string;
};

const REQUIRED_HEADERS = [
  "first_name",
  "last_name",
  "date_of_birth",
  "sex",
  "address_line1",
  "phone",
  "email",
  "primary_payer",
  "primary_member_id",
  "relationship_to_subscriber",
] as const;

const TEMPLATE_HEADERS = [
  "first_name",
  "last_name",
  "preferred_name",
  "date_of_birth",
  "sex",
  "address_line1",
  "phone",
  "email",
  "primary_payer",
  "primary_member_id",
  "primary_group_number",
  "relationship_to_subscriber",
  "subscriber_first_name",
  "subscriber_last_name",
  "subscriber_dob",
] as const;

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

export function ImportsPage() {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [clients, setClients] = useState<DataRow[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [sourceSystem, setSourceSystem] = useState("CSV");
  const [loading, setLoading] = useState(true);
  const [staging, setStaging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [batchRows, importRows, validationRows, payerRows, clientRows] = await Promise.all([
        tenantSelect<ImportBatch>("import_batches", { order: "created_at.desc" }),
        tenantSelect<ImportRow>("import_rows", { order: "created_at.desc" }),
        tenantSelect<ImportError>("import_validation_errors", { order: "created_at.desc" }),
        referenceSelect<Payer>("payers", { order: "name.asc" }),
        tenantSelect<DataRow>("clients"),
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
  const selectedValid = selectedRows.filter((row) => row.row_status === "valid");
  const selectedImported = selectedRows.filter((row) => row.row_status === "imported");
  const selectedFailed = selectedRows.filter((row) => row.row_status === "error" || row.row_status === "failed");

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

  function downloadTemplate() {
    const example = [
      "Jane",
      "Doe",
      "Jane",
      "1990-01-15",
      "F",
      "123 Main St",
      "3035551212",
      "jane@example.com",
      payers[0]?.name ?? "Payer Name",
      "ABC123456",
      "GROUP1",
      "self",
      "Jane",
      "Doe",
      "1990-01-15",
    ];
    const csv = [TEMPLATE_HEADERS.join(","), example.map(csvEscape).join(",")].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "therassistant-patient-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function stageFile(file: File) {
    setStaging(true);
    setError(null);
    setMessage(null);

    try {
      if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Upload a CSV file.");
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2) throw new Error("The CSV must include a header row and at least one patient row.");

      const headers = parsed[0].map(normalizeHeader);
      const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
      if (missingHeaders.length) {
        throw new Error(`Missing required CSV columns: ${missingHeaders.join(", ")}.`);
      }

      const tenantId = await getCurrentTenantId();
      const batch = await tenantInsert<ImportBatch>("import_batches", {
        import_name: file.name,
        import_status: "validating",
        source_system: sourceSystem.trim() || "CSV",
      });

      const withinFile = new Set<string>();
      let validCount = 0;
      let errorCount = 0;

      for (let index = 1; index < parsed.length; index += 1) {
        const raw = recordFromCsv(headers, parsed[index]);
        const rowErrors: Array<{ field: string | null; message: string }> = [];
        const first = raw.first_name ?? "";
        const last = raw.last_name ?? "";
        const dob = raw.date_of_birth ?? "";
        const sex = (raw.sex ?? "").toUpperCase();
        const payerName = raw.primary_payer ?? "";
        const payer = payerByName.get(payerName.trim().toLowerCase()) ?? null;
        const relationship = (raw.relationship_to_subscriber ?? "").trim().toLowerCase();

        for (const field of REQUIRED_HEADERS) {
          if (!String(raw[field] ?? "").trim()) {
            rowErrors.push({ field, message: `${field.replaceAll("_", " ")} is required.` });
          }
        }
        if (dob && !validDate(dob)) rowErrors.push({ field: "date_of_birth", message: "Date of birth must use YYYY-MM-DD." });
        if (sex && !["M", "F"].includes(sex)) rowErrors.push({ field: "sex", message: "Sex must be M or F." });
        if (payerName && !payer) rowErrors.push({ field: "primary_payer", message: `Payer "${payerName}" was not found in Therassistant.` });
        if (relationship && !["self", "spouse", "child", "parent", "other"].includes(relationship)) {
          rowErrors.push({ field: "relationship_to_subscriber", message: "Relationship must be self, spouse, child, parent, or other." });
        }

        const key = personKey(first, last, dob);
        if (first && last && dob && existingPatientKeys.has(key)) {
          rowErrors.push({ field: null, message: "Possible duplicate: a patient with the same name and DOB already exists." });
        }
        if (first && last && dob && withinFile.has(key)) {
          rowErrors.push({ field: null, message: "Duplicate patient appears more than once in this CSV." });
        }
        if (first && last && dob) withinFile.add(key);

        const self = relationship === "self";
        const mapped: StagedPatient = {
          first_name: first,
          last_name: last,
          preferred_name: raw.preferred_name ?? "",
          date_of_birth: dob,
          sex,
          address_line1: raw.address_line1 ?? "",
          phone: raw.phone ?? "",
          email: raw.email ?? "",
          primary_payer: payerName,
          primary_payer_id: payer?.id ?? "",
          primary_member_id: raw.primary_member_id ?? "",
          primary_group_number: raw.primary_group_number ?? "",
          relationship_to_subscriber: relationship,
          subscriber_first_name: raw.subscriber_first_name || (self ? first : ""),
          subscriber_last_name: raw.subscriber_last_name || (self ? last : ""),
          subscriber_dob: raw.subscriber_dob || (self ? dob : ""),
        };

        const importRow = await tenantInsert<ImportRow>("import_rows", {
          import_batch_id: batch.id,
          row_number: index,
          raw_data: raw,
          mapped_data: mapped,
          row_status: rowErrors.length ? "error" : "valid",
        });

        for (const issue of rowErrors) {
          await tenantInsert<ImportError>("import_validation_errors", {
            import_batch_id: batch.id,
            import_row_id: importRow.id,
            severity: "error",
            field_name: issue.field,
            message: issue.message,
          });
        }

        if (rowErrors.length) errorCount += 1;
        else validCount += 1;
      }

      await tenantUpdate<ImportBatch>("import_batches", batch.id, {
        import_status: errorCount ? "needs_review" : "ready",
      });

      setSelectedBatchId(batch.id);
      setMessage(`Staged ${validCount + errorCount} row(s): ${validCount} valid, ${errorCount} requiring review. No patient records were created yet.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to stage CSV.");
    } finally {
      setStaging(false);
    }
  }

  async function commitValidRows() {
    if (!selectedBatch || selectedValid.length === 0) return;
    setImporting(true);
    setError(null);
    setMessage(null);

    let imported = 0;
    let failed = 0;

    try {
      const tenantId = await getCurrentTenantId();
      await tenantUpdate<ImportBatch>("import_batches", selectedBatch.id, { import_status: "importing" });

      for (const row of selectedValid) {
        const patient = (row.mapped_data ?? {}) as unknown as StagedPatient;
        try {
          const subscriberName = [patient.subscriber_first_name, patient.subscriber_last_name].filter(Boolean).join(" ");
          await tenantRpc("create_patient_intake", {
            p_tenant_id: tenantId,
            p_patient: {
              first_name: patient.first_name,
              last_name: patient.last_name,
              preferred_name: patient.preferred_name || null,
              date_of_birth: patient.date_of_birth,
              sex: patient.sex,
              email: patient.email,
              phone: patient.phone,
              address_line1: patient.address_line1,
              client_status: "active",
              registration_status: "complete",
            },
            p_emergency_contact: null,
            p_primary_insurance: {
              payer_id: patient.primary_payer_id,
              payer_plan_id: null,
              member_id: patient.primary_member_id,
              group_number: patient.primary_group_number || null,
              subscriber_name: subscriberName || null,
              subscriber_dob: patient.subscriber_dob || null,
              relationship_to_subscriber: patient.relationship_to_subscriber,
              metadata: { imported_from_batch: selectedBatch.id },
            },
            p_secondary_insurance: null,
            p_portal_enrolled: false,
          });
          await tenantUpdate<ImportRow>("import_rows", row.id, { row_status: "imported" });
          imported += 1;
        } catch (rowError) {
          const messageText = rowError instanceof Error ? rowError.message : "Patient import failed.";
          await tenantUpdate<ImportRow>("import_rows", row.id, { row_status: "failed" });
          await tenantInsert<ImportError>("import_validation_errors", {
            import_batch_id: selectedBatch.id,
            import_row_id: row.id,
            severity: "error",
            field_name: null,
            message: messageText,
          });
          failed += 1;
        }
      }

      await tenantUpdate<ImportBatch>("import_batches", selectedBatch.id, {
        import_status: failed ? "partial" : "completed",
      });
      setMessage(`Import complete: ${imported} patient(s) created${failed ? `, ${failed} failed and remain for review` : ""}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to import valid rows.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">DATA QUALITY</div>
          <h1>Patient Imports</h1>
          <p>Stage CSV data, validate demographics and insurance, review exceptions, then commit only valid patients.</p>
        </div>
        <button type="button" className="thera-action secondary" onClick={downloadTemplate}>Download CSV Template</button>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}

      <section className="thera-card" style={{ marginBottom: 16 }}>
        <div className="thera-card-header">
          <div>
            <h2>Stage Patient CSV</h2>
            <p>Staging never creates patients. Rows are validated first and retained with an audit trail.</p>
          </div>
        </div>
        <div className="thera-form-grid">
          <label className="thera-field">
            <span className="thera-field-label">Source System</span>
            <input className="thera-input" value={sourceSystem} onChange={(event) => setSourceSystem(event.target.value)} placeholder="Legacy EHR, billing system, CSV export..." />
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
          Required: first name, last name, DOB, sex, address, phone, email, primary payer, member ID, and subscriber relationship. Payer names must match an existing payer.
        </div>
        {staging && <div className="thera-state">Validating and staging CSV...</div>}
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
                    <div>{String(batch.source_system ?? "CSV")} · {batchRows.length} row{batchRows.length === 1 ? "" : "s"}</div>
                    <div className="thera-table-subtext">{batch.created_at ? dateTime(String(batch.created_at)) : "—"}</div>
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
              <p>{selectedBatch ? "Review validation results before creating patients." : "Select an import batch."}</p>
            </div>
            {selectedBatch && selectedValid.length > 0 && (
              <button type="button" className="thera-action" disabled={importing} onClick={() => void commitValidRows()}>
                {importing ? "Importing..." : `Import Valid Rows (${selectedValid.length})`}
              </button>
            )}
          </div>

          {selectedBatch && (
            <>
              <div className="thera-metric-grid" style={{ marginBottom: 14 }}>
                <Metric label="Rows" value={selectedRows.length} />
                <Metric label="Valid" value={selectedValid.length} />
                <Metric label="Imported" value={selectedImported.length} />
                <Metric label="Errors / Failed" value={selectedFailed.length} />
              </div>

              {selectedErrors.length > 0 && (
                <div className="thera-alert" style={{ marginBottom: 12 }}>
                  {selectedErrors.length} validation error{selectedErrors.length === 1 ? "" : "s"} must be corrected in the source file and restaged, or the valid rows can be imported separately.
                </div>
              )}

              {selectedRows.length ? (
                <div className="thera-table-wrap">
                  <table className="thera-table">
                    <thead><tr><th>Row</th><th>Patient</th><th>DOB</th><th>Payer</th><th>Member ID</th><th>Status</th><th>Validation</th></tr></thead>
                    <tbody>
                      {selectedRows.map((row) => {
                        const mapped = (row.mapped_data ?? {}) as unknown as Partial<StagedPatient>;
                        const rowErrors = selectedErrors.filter((issue) => issue.import_row_id === row.id);
                        return (
                          <tr key={row.id}>
                            <td>{row.row_number ?? "—"}</td>
                            <td>{[mapped.first_name, mapped.last_name].filter(Boolean).join(" ") || "—"}</td>
                            <td>{mapped.date_of_birth || "—"}</td>
                            <td>{mapped.primary_payer || "—"}</td>
                            <td>{mapped.primary_member_id || "—"}</td>
                            <td><StatusBadge value={String(row.row_status ?? "unknown")} /></td>
                            <td>{rowErrors.length ? rowErrors.map((issue) => String(issue.message ?? "")).join(" · ") : "Passed"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <div className="thera-empty">This batch has no staged rows.</div>}
            </>
          )}
        </section>
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="thera-metric-card"><div className="thera-metric-label">{label}</div><div className="thera-metric-value">{value}</div></div>;
}
